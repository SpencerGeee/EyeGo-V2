'use strict';

const axios = require('axios');
const env = require('../config/env');
const logger = require('../utils/logger');

// Ghana bounding box for coordinate validation
const GHANA_BOUNDS = {
  minLat: 4.5, maxLat: 11.5,
  minLng: -3.5, maxLng: 1.5,
};

/** Straight-line distance in km — local copy so this service has no cycle with
 *  the fare calculator (which imports nothing from here). */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isWithinGhana(lat, lng) {
  return (
    lat >= GHANA_BOUNDS.minLat && lat <= GHANA_BOUNDS.maxLat &&
    lng >= GHANA_BOUNDS.minLng && lng <= GHANA_BOUNDS.maxLng
  );
}

async function getDirections(originLng, originLat, destLng, destLat) {
  // `driving-traffic`, NOT `driving`. The plain profile returns FREE-FLOW
  // duration — what the trip would take on an empty road at 3am — which is
  // where the "8.3 km is about 12 minutes" ETA came from (≈41 km/h through
  // Accra traffic). `driving-traffic` folds in live and historical congestion.
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/` +
    `${originLng},${originLat};${destLng},${destLat}` +
    `?geometries=geojson&overview=full&steps=false&access_token=${env.MAPBOX_SECRET_TOKEN}`;

  const { data } = await axios.get(url, { timeout: 10000 });
  if (!data.routes?.length) throw new Error('No route found between these coordinates');

  const route = data.routes[0];
  return {
    distanceKm: route.distance / 1000,
    durationMin: route.duration / 60,
    geometry: route.geometry,
  };
}

/**
 * Road distance in km between two points, with a straight-line fallback.
 *
 * Why this exists: fares are `base + perKm × distanceKm`, so the distance is the
 * price. The driver's create-trip preview measured the ROAD distance (it draws
 * the route line, so it has it), while the trip that got persisted stored the
 * HAVERSINE distance between the same two pins. Road distance runs ~1.3–2× the
 * straight line, so the two apps quoted materially different fares for the same
 * ride — reported as "the driver app said ₵700 for the trip and the rider app
 * charged half that". This is the one place that answers "how far is it", so
 * every fare downstream is derived from the same number.
 *
 * Server-side on purpose: a client-supplied distance is a fare the rider can
 * edit. `fallbackMultiplier` keeps an unroutable pair (offline, no token,
 * Mapbox 5xx) from silently pricing as the crow flies — 1.35 is the typical
 * urban road-to-straight ratio.
 */
async function roadDistanceKm(originLat, originLng, destLat, destLng, { fallbackMultiplier = 1.35 } = {}) {
  const straightKm = haversineKm(originLat, originLng, destLat, destLng);
  try {
    const route = await getDirections(originLng, originLat, destLng, destLat);
    if (Number.isFinite(route?.distanceKm) && route.distanceKm > 0) {
      return { distanceKm: route.distanceKm, durationMin: route.durationMin ?? null, source: 'mapbox' };
    }
  } catch (err) {
    logger.warn('roadDistanceKm: routing failed, using straight-line estimate', { error: err.message });
  }
  return {
    distanceKm: Math.max(straightKm * fallbackMultiplier, 0.1),
    durationMin: null,
    source: 'estimate',
  };
}

async function forwardGeocode(query) {
  // `poi` is included on purpose: route endpoints are entered as names, and a
  // driver naming a landmark or business ("IPMC showroom", "Accra Mall") was
  // getting no match at all from the address-only type list, which silently
  // pushed callers onto their fallback coordinate.
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
    `?types=poi,place,locality,neighborhood,address&country=GH&limit=1&access_token=${env.MAPBOX_SECRET_TOKEN}`;

  try {
    const { data } = await axios.get(url, { timeout: 5000 });
    if (!data.features?.length) return null;
    const f = data.features[0];
    return {
      name: f.place_name,
      lat: f.center[1],
      lng: f.center[0],
    };
  } catch (err) {
    logger.warn(`Mapbox forwardGeocode failed for "${query}": ${err.message}`);
    return null;
  }
}

async function reverseGeocode(lng, lat) {
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json` +
    `?types=address,place&country=GH&access_token=${env.MAPBOX_SECRET_TOKEN}`;

  const { data } = await axios.get(url, { timeout: 5000 });
  return data.features?.[0]?.place_name || `${lat}, ${lng}`;
}

// Free fallback used whenever MAPBOX_SECRET_TOKEN is missing/placeholder — mirrors
// apps/rider/utils/geocoding.ts so route creation still gets real coordinates
// instead of silently defaulting every un-geocodable route to the same fake point.
async function nominatimForwardGeocode(query) {
  try {
    const { data } = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: { q: query, format: 'json', countrycodes: 'gh', limit: 1 },
      headers: { 'User-Agent': 'EyeGo/2.0 (eyego.app)' },
      timeout: 5000,
    });
    if (!Array.isArray(data) || !data.length) return null;
    return { name: data[0].display_name, lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch (err) {
    logger.warn(`Nominatim forwardGeocode failed for "${query}": ${err.message}`);
    return null;
  }
}

/**
 * A PLACE NAME FOR A COORDINATE, OR NULL — NEVER A THROW, NEVER A FAKE.
 *
 * `reverseGeocode` above has two properties that make it unusable anywhere a
 * page has to render: it throws when the request fails or the token is missing,
 * and on an empty result it returns the coordinate pair back as a STRING. A
 * caller that displays the result therefore cannot tell "this is where they are"
 * from "we have no idea" — the two look identical, which is exactly how the
 * admin SOS console ended up showing lat/lng as though it were an address.
 *
 * Nominatim is the fallback for the same reason `nominatimForwardGeocode`
 * exists: MAPBOX_SECRET_TOKEN is frequently absent in a working deployment, and
 * a safety console is the last screen that should degrade silently because of a
 * billing key.
 *
 * Results are cached in Redis for a day. A coordinate's name does not change,
 * and the SOS list re-renders on every operator poll.
 */
async function placeNameFor(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const key = `geo:rev:${lat.toFixed(4)},${lng.toFixed(4)}`;
  let redis = null;
  try {
    redis = require('../config/redis');
    const hit = await redis.get(key);
    // Empty string is a cached MISS — distinct from no cache entry at all, so a
    // coordinate in the sea is not re-queried on every poll.
    if (hit != null) return hit || null;
  } catch {
    /* cache is optional */
  }

  let name = null;
  const hasToken =
    env.MAPBOX_SECRET_TOKEN && !/placeholder|your[-_]?token/i.test(env.MAPBOX_SECRET_TOKEN);
  if (hasToken) {
    try {
      const url =
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json` +
        `?types=address,place,poi&country=GH&access_token=${env.MAPBOX_SECRET_TOKEN}`;
      const { data } = await axios.get(url, { timeout: 5000 });
      name = data.features?.[0]?.place_name ?? null;
    } catch (err) {
      logger.warn(`reverse geocode (mapbox) failed for ${lat},${lng}: ${err.message}`);
    }
  }
  if (!name) {
    try {
      const { data } = await axios.get('https://nominatim.openstreetmap.org/reverse', {
        params: { lat, lon: lng, format: 'json', zoom: 18, addressdetails: 1 },
        headers: { 'User-Agent': 'EyeGo/2.0 (eyego.app)' },
        timeout: 5000,
      });
      name = data?.display_name ?? null;
    } catch (err) {
      logger.warn(`reverse geocode (nominatim) failed for ${lat},${lng}: ${err.message}`);
    }
  }

  if (redis) await redis.set(key, name ?? '', 'EX', 86_400).catch(() => {});
  return name;
}

module.exports = { getDirections, roadDistanceKm, forwardGeocode, reverseGeocode, placeNameFor, nominatimForwardGeocode, isWithinGhana };
