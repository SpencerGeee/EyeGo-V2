'use strict';

const { ok, error } = require('../../utils/response');
const service = require('./geo.service');

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

/** GET /v1/geo/search?q=&lat=&lng=&limit= */
async function search(req, res) {
  const results = await service.searchPlaces({
    query: req.query.q ?? req.query.query,
    limit: Math.min(parseInt(req.query.limit, 10) || 8, 15),
    lat: num(req.query.lat),
    lng: num(req.query.lng),
  });
  return ok(res, results);
}

/** GET /v1/geo/reverse?lat=&lng= */
async function reverse(req, res) {
  const lat = num(req.query.lat);
  const lng = num(req.query.lng);
  if (lat === undefined || lng === undefined) return error(res, 'lat and lng are required', 400);
  const result = await service.reverseGeocode({ lat, lng });
  return ok(res, result);
}

/** GET /v1/geo/route?originLat=&originLng=&destLat=&destLng= */
async function route(req, res) {
  const originLat = num(req.query.originLat);
  const originLng = num(req.query.originLng);
  const destLat = num(req.query.destLat);
  const destLng = num(req.query.destLng);
  if ([originLat, originLng, destLat, destLng].some((v) => v === undefined)) {
    return error(res, 'originLat, originLng, destLat and destLng are required', 400);
  }
  const result = await service.getRoute({ originLat, originLng, destLat, destLng });
  if (!result) return error(res, 'Could not compute a route', 422);
  return ok(res, result);
}

module.exports = { search, reverse, route };
