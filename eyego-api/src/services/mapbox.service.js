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

module.exports = { getDirections, roadDistanceKm, forwardGeocode, reverseGeocode, nominatimForwardGeocode, isWithinGhana };
