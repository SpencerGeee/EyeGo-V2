'use strict';

/**
 * Mapbox-backed geocoding + routing, proxied through our API.
 *
 * WHY A PROXY: the client apps previously called photon.komoot.io and
 * nominatim.openstreetmap.org directly. Those cover OSM data only, which in
 * Ghana means most commercial POIs simply do not exist — searching "IPMC
 * showroom" returned an empty list. Mapbox's Search Box API carries commercial
 * POI data and does true prefix/typeahead matching.
 *
 * The Mapbox token is a SECRET (MAPBOX_SECRET_TOKEN) and must never be shipped
 * in an app bundle, so every client request goes through here. This also gives
 * us one place to cache, rate-limit and fall back to the free OSM stack if the
 * Mapbox quota is exhausted or the token is missing.
 */

const axios = require('axios');
const env = require('../../config/env');
const logger = require('../../utils/logger');

/** Accra — bias for autocomplete when the caller sends no proximity. */
const DEFAULT_PROXIMITY = { lng: -0.187, lat: 5.6037 };

const SEARCH_TIMEOUT_MS = 6000;
const DIRECTIONS_TIMEOUT_MS = 8000;

/**
 * POI SEARCH — read before changing these URLs.
 *
 * `https://api.mapbox.com/search/geocode/v6/forward` (what this used to call)
 * is the GEOCODING API. Its feature types are country/region/postcode/district/
 * place/locality/neighborhood/street/address — there is **no `poi` type at all**.
 * A comment here previously claimed v6 forward "shares Search Box's POI index";
 * it does not, which is why searching a business by name ("IPMC showroom")
 * returned nothing however the query was phrased.
 *
 * Commercial POIs live in the **Search Box API**. Its `/suggest` endpoint needs a
 * session token plus a second `/retrieve` call to get coordinates, which would
 * double latency; `/forward` on the same index returns coordinates inline and
 * behaves like a one-shot geocode, so that is what we use.
 *
 * Geocoding v6 is kept as a SECOND query, not a replacement: it is still the
 * better answer for a plain street address, and merging both means neither kind
 * of query comes back empty.
 */
const SEARCHBOX_URL = 'https://api.mapbox.com/search/searchbox/v1/forward';
const SEARCH_URL = 'https://api.mapbox.com/search/geocode/v6/forward';
const REVERSE_URL = 'https://api.mapbox.com/search/geocode/v6/reverse';

/**
 * Search Box POI categories worth surfacing for a ride destination. Passing
 * `types` keeps the response focused on things a rider would name out loud
 * rather than administrative polygons.
 */
const SEARCHBOX_TYPES = 'poi,address,street,place,neighborhood,locality';

function hasMapbox() {
  const t = env.MAPBOX_SECRET_TOKEN;
  return !!t && !/^(your|changeme|placeholder|xxx)/i.test(t);
}

/**
 * Mapbox v6 features → the flat shape both apps already consume
 * (`GeocodeResult` in apps/rider/utils/geocoding.ts).
 */
function mapboxToResult(f) {
  const coords = f?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length !== 2) return null;
  const [longitude, latitude] = coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const p = f.properties ?? {};
  const name = p.name || p.name_preferred || p.full_address || p.place_formatted;
  if (!name) return null;

  return {
    placeId: p.mapbox_id || `${latitude.toFixed(5)},${longitude.toFixed(5)}`,
    name,
    fullAddress: p.full_address || p.place_formatted || name,
    latitude,
    longitude,
    // `poi` results are businesses/landmarks; the apps use this to pick an icon.
    kind: p.feature_type || 'place',
  };
}

/**
 * Photon fallback. Kept because it is the only free provider that does prefix
 * matching — if Mapbox is down or unconfigured the search box still works,
 * just with OSM-only coverage.
 */
async function photonSearch(query, limit, proximity) {
  try {
    const { data } = await axios.get('https://photon.komoot.io/api/', {
      params: { q: query, limit, lang: 'en', lat: proximity.lat, lon: proximity.lng },
      headers: { 'User-Agent': 'EyeGo/2.0 (eyego.app)' },
      timeout: SEARCH_TIMEOUT_MS,
    });
    const features = Array.isArray(data?.features) ? data.features : [];
    return features
      .map((f) => {
        const c = f.geometry?.coordinates;
        if (!Array.isArray(c) || c.length !== 2) return null;
        const [longitude, latitude] = c;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
        const p = f.properties ?? {};
        const street = [p.housenumber, p.street].filter(Boolean).join(' ');
        const name = p.name || street || p.district || p.city;
        if (!name) return null;
        const fullAddress = [name, p.district, p.city, p.state, p.country]
          .filter(Boolean)
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .join(', ');
        return {
          placeId: String(p.osm_id ?? `${latitude.toFixed(5)},${longitude.toFixed(5)}`),
          name,
          fullAddress: fullAddress || name,
          latitude,
          longitude,
          kind: p.osm_value || 'place',
        };
      })
      .filter(Boolean);
  } catch (err) {
    logger.warn(`Photon search failed for "${query}": ${err.message}`);
    return [];
  }
}

/** Two hits within ~11 m are the same place to a rider. */
function dedupeKey(r) {
  return `${r.latitude.toFixed(4)},${r.longitude.toFixed(4)}`;
}

/**
 * Forward search. Mapbox first (commercial POIs), Photon merged in behind it
 * deduped, so a place that only exists in OSM still shows up.
 */
async function searchPlaces({ query, limit = 8, lat, lng, country = 'gh' }) {
  const trimmed = String(query || '').trim();
  if (trimmed.length < 2) return [];

  const proximity =
    Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : DEFAULT_PROXIMITY;

  const tasks = [photonSearch(trimmed, limit, proximity)];

  if (hasMapbox()) {
    // Geocoding v6 — precise for street addresses, blind to businesses.
    tasks.unshift(
      axios
        .get(SEARCH_URL, {
          params: {
            q: trimmed,
            limit,
            country,
            language: 'en',
            proximity: `${proximity.lng},${proximity.lat}`,
            access_token: env.MAPBOX_SECRET_TOKEN,
          },
          timeout: SEARCH_TIMEOUT_MS,
        })
        .then(({ data }) => (Array.isArray(data?.features) ? data.features : []).map(mapboxToResult).filter(Boolean))
        .catch((err) => {
          logger.warn(`Mapbox geocode search failed for "${trimmed}": ${err.message}`);
          return [];
        }),
    );

    // Search Box — the ONLY source here that indexes businesses/landmarks.
    // Queried first so a named POI outranks a same-named street.
    tasks.unshift(
      axios
        .get(SEARCHBOX_URL, {
          params: {
            q: trimmed,
            // Search Box caps `limit` at 10.
            limit: Math.min(limit, 10),
            country,
            language: 'en',
            types: SEARCHBOX_TYPES,
            proximity: `${proximity.lng},${proximity.lat}`,
            access_token: env.MAPBOX_SECRET_TOKEN,
          },
          timeout: SEARCH_TIMEOUT_MS,
        })
        .then(({ data }) => (Array.isArray(data?.features) ? data.features : []).map(mapboxToResult).filter(Boolean))
        .catch((err) => {
          logger.warn(`Mapbox Search Box failed for "${trimmed}": ${err.message}`);
          return [];
        }),
    );
  }

  const groups = await Promise.all(tasks);
  const seen = new Set();
  const merged = [];
  for (const r of groups.flat()) {
    const key = dedupeKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(r);
  }
  return merged.slice(0, limit);
}

/** Reverse geocode for the map-pin picker. Coordinates stay the caller's. */
async function reverseGeocode({ lat, lng }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  if (hasMapbox()) {
    try {
      const { data } = await axios.get(REVERSE_URL, {
        params: {
          longitude: lng,
          latitude: lat,
          limit: 1,
          language: 'en',
          access_token: env.MAPBOX_SECRET_TOKEN,
        },
        timeout: SEARCH_TIMEOUT_MS,
      });
      const mapped = mapboxToResult(data?.features?.[0]);
      if (mapped) return { ...mapped, latitude: lat, longitude: lng };
    } catch (err) {
      logger.warn(`Mapbox reverse failed at ${lat},${lng}: ${err.message}`);
    }
  }

  try {
    const { data } = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: { lat, lon: lng, format: 'json', addressdetails: 1, zoom: 18 },
      headers: { 'User-Agent': 'EyeGo/2.0 (eyego.app)' },
      timeout: SEARCH_TIMEOUT_MS,
    });
    if (data && !data.error && data.display_name) {
      const a = data.address ?? {};
      const name =
        data.name || a.road || a.neighbourhood || a.suburb || a.village || a.town || a.city ||
        String(data.display_name).split(',')[0];
      return {
        placeId: String(data.place_id),
        name,
        fullAddress: data.display_name,
        latitude: lat,
        longitude: lng,
        kind: 'place',
      };
    }
  } catch (err) {
    logger.warn(`Nominatim reverse failed at ${lat},${lng}: ${err.message}`);
  }
  return null;
}

/**
 * Average driving speed used only when no routing provider answers.
 *
 * 22 km/h, not the 40+ km/h a naive "distance / highway speed" model implies.
 * Accra's observed mean urban speed sits in the low twenties once junctions,
 * traffic lights and congestion are counted, which is why the old estimate
 * claimed 8.3 km would take 12 minutes (≈41 km/h — motorway pace, in traffic).
 */
const FALLBACK_URBAN_KMH = 22;

/** Straight-line km between two points. */
function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Road distance is always longer than the straight line. 1.35 is the standard
 * circuity factor for a dense urban grid — without it every fallback ETA is
 * optimistic by roughly a third before traffic is even considered.
 */
const CIRCUITY_FACTOR = 1.35;

/**
 * Route between two points.
 *
 * Uses the `driving-traffic` profile, NOT `driving`: the plain profile returns
 * free-flow duration (what the trip would take on an empty road at 3am), which
 * is exactly the "8.3 km in 12 minutes" number the driver app was showing.
 * `driving-traffic` folds in live and historical congestion.
 *
 * Returns null only when there is no usable answer at all; a provider failure
 * degrades to the haversine estimate rather than to nothing, because callers
 * use this for fare and ETA and must not render a blank.
 */
async function getRoute({ originLat, originLng, destLat, destLng, profile = 'driving-traffic' }) {
  const coords = [originLat, originLng, destLat, destLng];
  if (!coords.every(Number.isFinite)) return null;

  if (hasMapbox()) {
    try {
      const url =
        `https://api.mapbox.com/directions/v5/mapbox/${profile}/` +
        `${originLng},${originLat};${destLng},${destLat}`;
      const { data } = await axios.get(url, {
        params: {
          geometries: 'geojson',
          overview: 'full',
          steps: false,
          alternatives: false,
          annotations: 'duration,distance',
          access_token: env.MAPBOX_SECRET_TOKEN,
        },
        timeout: DIRECTIONS_TIMEOUT_MS,
      });
      const route = data?.routes?.[0];
      if (route && Number.isFinite(route.distance) && Number.isFinite(route.duration)) {
        return {
          distanceKm: route.distance / 1000,
          durationMin: route.duration / 60,
          geometry: route.geometry,
          source: profile,
        };
      }
    } catch (err) {
      logger.warn(`Mapbox directions failed: ${err.message}`);
    }
  }

  // OSRM's public demo server is free-flow only and rate-limited, so it is a
  // second-choice source rather than a peer of Mapbox — but its geometry beats
  // a straight line for drawing a polyline.
  try {
    const { data } = await axios.get(
      `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}`,
      { params: { overview: 'full', geometries: 'geojson' }, timeout: DIRECTIONS_TIMEOUT_MS },
    );
    const route = data?.routes?.[0];
    if (route && Number.isFinite(route.distance) && Number.isFinite(route.duration)) {
      const distanceKm = route.distance / 1000;
      // OSRM duration assumes free flow. Re-time the real road distance at the
      // urban average instead of trusting it, then keep whichever is slower.
      const congested = (distanceKm / FALLBACK_URBAN_KMH) * 60;
      return {
        distanceKm,
        durationMin: Math.max(route.duration / 60, congested),
        geometry: route.geometry,
        source: 'osrm',
      };
    }
  } catch (err) {
    logger.warn(`OSRM directions failed: ${err.message}`);
  }

  const straight = haversineKm(originLat, originLng, destLat, destLng);
  const distanceKm = straight * CIRCUITY_FACTOR;
  return {
    distanceKm,
    durationMin: (distanceKm / FALLBACK_URBAN_KMH) * 60,
    geometry: {
      type: 'LineString',
      coordinates: [
        [originLng, originLat],
        [destLng, destLat],
      ],
    },
    source: 'estimate',
  };
}

/**
 * ETA only, for the many callers that need minutes and nothing else
 * (driver→pickup countdown, dispatch cards, tracking header).
 */
async function getEtaMinutes({ originLat, originLng, destLat, destLng }) {
  const route = await getRoute({ originLat, originLng, destLat, destLng });
  return route ? Math.max(1, Math.round(route.durationMin)) : null;
}

module.exports = {
  searchPlaces,
  reverseGeocode,
  getRoute,
  getEtaMinutes,
  haversineKm,
  hasMapbox,
  FALLBACK_URBAN_KMH,
  CIRCUITY_FACTOR,
};
