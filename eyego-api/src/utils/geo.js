'use strict';

/** Haversine distance in metres between two WGS-84 coordinates. */
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6_371_000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Approximate minimum distance (in metres) from a point to a polyline.
 * Uses a simple segment-wise projection. For a straight-line route (dev
 * fallback) this is equivalent to the cross-track distance.  For real
 * Mapbox routes with many vertices it provides a reasonable deviation
 * check without a heavy spatial library.
 *
 * @param {number} lat  Point latitude
 * @param {number} lng  Point longitude
 * @param {Array<[number, number]>} polyline  Array of [lng, lat] coordinates
 * @returns {number}  Minimum distance in metres
 */
function distanceToPolyline(lat, lng, polyline) {
  if (!polyline || polyline.length < 2) return Infinity;

  let minDist = Infinity;
  const p = { lat, lng };

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = { lat: polyline[i][1], lng: polyline[i][0] };
    const b = { lat: polyline[i + 1][1], lng: polyline[i + 1][0] };
    const d = pointToSegmentMeters(p, a, b);
    if (d < minDist) minDist = d;
  }

  return minDist;
}

/** Minimum distance (metres) from point p to line segment a-b. */
function pointToSegmentMeters(p, a, b) {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const lenSq = dx * dx + dy * dy;

  let t = 0;
  if (lenSq > 0) {
    t = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
  }

  const proj = { lat: a.lat + t * dy, lng: a.lng + t * dx };
  return haversineMeters(p.lat, p.lng, proj.lat, proj.lng);
}

module.exports = { haversineMeters, distanceToPolyline };
