'use strict';

const redis = require('../config/redis');
const logger = require('../utils/logger');
const { haversineMeters } = require('../utils/geo');

const haversineKm = (aLat, aLng, bLat, bLng) => haversineMeters(aLat, aLng, bLat, bLng) / 1000;

/**
 * Pickup ETA — how long until this driver actually reaches this rider.
 *
 * WHY THIS EXISTS. Dispatch ranked candidates by straight-line distance. In
 * Accra that is the wrong answer often enough to be the difference between
 * "Uber-quality dispatch" and "why did it send someone across the Odaw when
 * there was a car on my street". Straight-line ignores rivers, one-ways,
 * closed junctions and traffic; the driver 1.2 km away across the Ring Road
 * interchange loses to the driver 2.5 km away with a clear run, and only a
 * routing engine knows that.
 *
 * Uber's own lineage here (OSRM → Goldeta → Gurafu) is public and the lesson
 * is consistent: match on ETA, never on distance.
 *
 * DESIGN
 *  - One batched Mapbox Matrix call per candidate sweep, not one per driver.
 *  - Results cached in Redis on a coarse geohash-ish key, so a second rider
 *    on the same street within the TTL costs nothing.
 *  - A free-flow fallback (road-distance estimate ÷ assumed speed) when the
 *    matrix is unavailable, flagged `degraded: true`, so a Mapbox outage
 *    degrades ranking quality instead of stopping dispatch. The old code was
 *    permanently in this degraded mode without knowing it.
 */

const MAPBOX_TOKEN = process.env.MAPBOX_ACCESS_TOKEN || process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
/**
 * `driving-traffic`, NOT `driving`.
 *
 * The plain profile returns FREE-FLOW durations — the time the trip would take
 * on empty roads at the posted limit. Every ETA in the app that came through
 * here was therefore an answer to "how long if the driver never stops", which in
 * Accra is not the question anyone is asking. Reported as "does the ETA take
 * traffic into account? Bolt and Uber are very accurate". It did not; it does
 * now. `services/mapbox.service.js#getDirections` was already on the traffic
 * profile, so the two were also disagreeing with each other.
 */
const MATRIX_URL = 'https://api.mapbox.com/directions-matrix/v1/mapbox/driving-traffic';

/**
 * Coordinate cap per Matrix call, INCLUDING the destination.
 *
 * The traffic profile allows 10 coordinates, not the 25 the plain profile
 * allows — so this dropped from 24 with the profile change. Sending more comes
 * back 422, which the catch below would have quietly turned into free-flow
 * fallbacks for the whole sweep: traffic-aware in name only.
 */
const MAX_MATRIX_SOURCES = 9;
const CACHE_TTL_SECONDS = parseInt(process.env.ETA_CACHE_TTL_SECONDS, 10) || 60;
/** Urban average including junctions — the free-flow fallback's assumption. */
const FALLBACK_SPEED_KMH = parseFloat(process.env.ETA_FALLBACK_SPEED_KMH) || 22;
/** Straight-line → road distance inflation, same constant the fare path uses. */
const ROAD_FACTOR = 1.35;

/** ~100 m buckets. Fine enough to be honest, coarse enough to actually hit. */
function coarse(lat, lng) {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

function cacheKey(from, to) {
  return `eta:${coarse(from.lat, from.lng)}:${coarse(to.lat, to.lng)}`;
}

function freeFlowSeconds(from, to) {
  const km = haversineKm(from.lat, from.lng, to.lat, to.lng) * ROAD_FACTOR;
  return Math.round((km / FALLBACK_SPEED_KMH) * 3600);
}

/**
 * Pickup ETAs from many drivers to one pickup point.
 *
 * @param {{lat:number,lng:number}} destination  the rider's pickup
 * @param {Array<{driverId:string, lat:number, lng:number}>} origins
 * @returns {Promise<Map<string, {seconds:number, degraded:boolean}>>}
 */
async function etaMatrix(destination, origins) {
  const out = new Map();
  const usable = origins.filter((o) => Number.isFinite(o.lat) && Number.isFinite(o.lng));
  if (usable.length === 0) return out;

  // 1. Cache.
  const keys = usable.map((o) => cacheKey(o, destination));
  let cached = [];
  try {
    cached = await redis.mget(keys);
  } catch {
    cached = usable.map(() => null);
  }

  const misses = [];
  usable.forEach((o, i) => {
    const hit = cached[i];
    if (hit != null) out.set(o.driverId, { seconds: Number(hit), degraded: false });
    else misses.push(o);
  });
  if (misses.length === 0) return out;

  // 2. One batched matrix call for the misses.
  if (MAPBOX_TOKEN) {
    for (let i = 0; i < misses.length; i += MAX_MATRIX_SOURCES) {
      const chunk = misses.slice(i, i + MAX_MATRIX_SOURCES);
      try {
        // Sources = drivers, destination = pickup. `annotations=duration`
        // keeps the response small; we do not need distances.
        const coords = [
          ...chunk.map((o) => `${o.lng},${o.lat}`),
          `${destination.lng},${destination.lat}`,
        ].join(';');
        const sources = chunk.map((_, idx) => idx).join(';');
        const destIdx = chunk.length;
        const url =
          `${MATRIX_URL}/${coords}` +
          `?sources=${sources}&destinations=${destIdx}` +
          `&annotations=duration&access_token=${MAPBOX_TOKEN}`;

        const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
        if (!res.ok) throw new Error(`matrix ${res.status}`);
        const body = await res.json();
        const durations = body?.durations;
        if (!Array.isArray(durations)) throw new Error('matrix: no durations');

        const pipeline = redis.pipeline();
        chunk.forEach((o, idx) => {
          const seconds = durations[idx]?.[0];
          if (Number.isFinite(seconds)) {
            out.set(o.driverId, { seconds: Math.round(seconds), degraded: false });
            pipeline.set(cacheKey(o, destination), Math.round(seconds), 'EX', CACHE_TTL_SECONDS);
          }
        });
        pipeline.exec().catch(() => {});
      } catch (err) {
        logger.warn(`ETA matrix chunk failed (falling back to free-flow): ${err.message}`);
      }
    }
  }

  // 3. Free-flow for anything still missing. Never leave a driver unranked —
  //    a Mapbox outage must cost ranking quality, not the rider's ride.
  for (const o of misses) {
    if (!out.has(o.driverId)) {
      out.set(o.driverId, { seconds: freeFlowSeconds(o, destination), degraded: true });
    }
  }
  return out;
}

/** Single-pair ETA, same cache and fallback. */
async function etaSeconds(from, to) {
  const m = await etaMatrix(to, [{ driverId: '_', lat: from.lat, lng: from.lng }]);
  return m.get('_') ?? { seconds: freeFlowSeconds(from, to), degraded: true };
}

module.exports = { etaMatrix, etaSeconds, freeFlowSeconds, FALLBACK_SPEED_KMH };
