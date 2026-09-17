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

/**
 * The fastest average speed we are willing to PROMISE a rider, km/h.
 *
 * BUGFIX ("i chose a destination that's really far but it's telling me i'll get
 * there in 22 minutes — it's 14.5 km, i don't think that's accurate at all").
 * 14.5 km in 22 minutes is a 39.5 km/h door-to-door average, which is what a
 * routing provider returns for Accra whenever it has no live traffic data for
 * those roads and quietly falls back to posted speed limits. Every ETA source in
 * this codebase already has a conservative FALLBACK of 22 km/h for when it has
 * NO answer — but nothing checked the answers it did get, so a free-flow number
 * sailed through as though it were traffic-aware. The same arithmetic is behind
 * the older "8.3 km is about 12 minutes" report.
 *
 * 32 km/h is an ordinary urban arterial average with junctions and lights in it:
 * fast enough not to insult a genuinely clear run, slow enough that a rider is
 * never told a number the road cannot produce. Tunable, because the right value
 * for Accra at 5pm is not the right value for a quiet regional town.
 */
/**
 * Where on the line a point lands, and how far along the line that is.
 *
 * The seat page lets a rider drop a pin ANYWHERE on the route; the fare for
 * that seat is the fraction of the road actually ridden, and "fraction" needs
 * the distance ALONG the polyline to the nearest point, not just the distance
 * TO it. Returns metres off the line (`distanceM`), metres along it from its
 * start (`alongM`), the line's total length, and the snapped point.
 *
 * `[lng, lat]` pairs, the GeoJSON order every route in this codebase uses.
 */
function projectOntoPolyline(lat, lng, polyline) {
  if (!polyline || polyline.length < 2) return null;
  const p = { lat, lng };
  let best = null;
  let cursor = 0;
  let total = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = { lat: polyline[i][1], lng: polyline[i][0] };
    const b = { lat: polyline[i + 1][1], lng: polyline[i + 1][0] };
    const segLen = haversineMeters(a.lat, a.lng, b.lat, b.lng);
    const dx = b.lng - a.lng;
    const dy = b.lat - a.lat;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 0) t = Math.max(0, Math.min(1, ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / lenSq));
    const proj = { lat: a.lat + t * dy, lng: a.lng + t * dx };
    const d = haversineMeters(p.lat, p.lng, proj.lat, proj.lng);
    if (!best || d < best.distanceM) {
      best = { distanceM: d, alongM: cursor + segLen * t, point: proj, index: i };
    }
    cursor += segLen;
    total = cursor;
  }
  return best ? { ...best, totalM: total } : null;
}

const MAX_PROMISED_AVG_KMH = Number(process.env.ETA_MAX_AVG_KMH) || 32;

/**
 * Clamp a routing provider's duration to something a car can actually do.
 *
 * ONE-SIDED on purpose. It can only ever make an ETA LONGER: a provider that
 * reports heavy congestion is reporting something it measured and we have no
 * business overruling it, whereas a provider reporting an empty road is usually
 * reporting the absence of data. Under-promising is also the right direction to
 * be wrong in — a rider who arrives early is pleased.
 *
 * @param {number|null|undefined} durationMin  what the provider said
 * @param {number|null|undefined} distanceKm   road distance for the same leg
 * @returns {number|null} minutes, or null when there is nothing to clamp
 */
function realisticDurationMin(durationMin, distanceKm) {
  if (!Number.isFinite(durationMin)) return null;
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return durationMin;
  const floorMin = (distanceKm / MAX_PROMISED_AVG_KMH) * 60;
  return Math.max(durationMin, floorMin);
}

module.exports = {
  projectOntoPolyline,
  haversineMeters,
  distanceToPolyline,
  realisticDurationMin,
  MAX_PROMISED_AVG_KMH,
};
