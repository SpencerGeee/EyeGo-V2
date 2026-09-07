'use strict';

const { ok, error, paginated } = require('../../utils/response');
const service = require('./geo.service');

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

/** GET /v1/geo/search?q=&lat=&lng=&limit= */
async function search(req, res) {
  const { results, meta } = await service.searchPlacesDetailed({
    query: req.query.q ?? req.query.query,
    limit: Math.min(parseInt(req.query.limit, 10) || 8, 15),
    lat: num(req.query.lat),
    lng: num(req.query.lng),
  });
  // `data` stays a plain array — every existing client reads it positionally.
  // `meta` rides alongside so the UI can say "showing results for IPMC" after a
  // relaxed match, and "search is unavailable" instead of "no such place" when
  // every provider is down. Two very different messages for a rider standing on
  // a street corner.
  return paginated(res, results, meta);
}

/** GET /v1/geo/reverse?lat=&lng= */
async function reverse(req, res) {
  const lat = num(req.query.lat);
  const lng = num(req.query.lng);
  if (lat === undefined || lng === undefined) return error(res, 'lat and lng are required', 400);
  const result = await service.reverseGeocode({ lat, lng });
  return ok(res, result);
}

/**
 * The routing profiles a client may ask for.
 *
 * A WHITELIST, not a passthrough: this value is interpolated into the upstream
 * Mapbox URL, so an unchecked query parameter would let a caller redirect the
 * request at any path on api.mapbox.com using our token.
 *
 * `walking` exists for the rider's approach line — the dashed leg from where
 * they are standing to a pickup point they chose somewhere else. Routing that
 * on `driving-traffic` would send a pedestrian the wrong way up a one-way
 * street and refuse to cross a footbridge.
 */
const ALLOWED_PROFILES = new Set(['driving-traffic', 'driving', 'walking', 'cycling']);

/** GET /v1/geo/route?originLat=&originLng=&destLat=&destLng=&profile= */
async function route(req, res) {
  const originLat = num(req.query.originLat);
  const originLng = num(req.query.originLng);
  const destLat = num(req.query.destLat);
  const destLng = num(req.query.destLng);
  if ([originLat, originLng, destLat, destLng].some((v) => v === undefined)) {
    return error(res, 'originLat, originLng, destLat and destLng are required', 400);
  }
  const requested = String(req.query.profile ?? '');
  if (requested && !ALLOWED_PROFILES.has(requested)) {
    return error(res, `Unsupported routing profile "${requested}"`, 400);
  }
  const result = await service.getRoute({
    originLat,
    originLng,
    destLat,
    destLng,
    // `getRoute` has always taken a profile and defaulted it to
    // `driving-traffic`; nothing forwarded one, so every caller got a driving
    // route whatever they were actually asking for.
    ...(requested ? { profile: requested } : {}),
  });
  if (!result) return error(res, 'Could not compute a route', 422);
  return ok(res, result);
}

module.exports = { search, reverse, route };
