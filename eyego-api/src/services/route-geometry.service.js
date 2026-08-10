'use strict';

const prisma = require('../config/database');
const redis = require('../config/redis');
const env = require('../config/env');
const logger = require('../utils/logger');
const { getDirections } = require('./mapbox.service');
const { haversineMeters, distanceToPolyline } = require('../utils/geo');

/**
 * The route line, owned by the server.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * Every screen that drew a route asked Mapbox for it itself. Four consequences
 * the user could feel:
 *
 *   1. The rider and the driver drew DIFFERENT lines for the same ride, because
 *      each called Directions at a different moment with a different origin.
 *   2. The line vanished on navigation and had to be re-fetched, which is the
 *      "map has to think about it again" feeling on every screen change.
 *   3. Quota: one Directions call per screen per retry, per participant.
 *   4. Nothing could reason about the route server-side, so off-route detection
 *      had to re-derive a polyline it did not own.
 *
 * Uber computes the route once, server-side, publishes it on the trip, and
 * recomputes only on a real deviation. That is what this is.
 *
 * ── THE TWO LEGS ─────────────────────────────────────────────────────────────
 * A ride is two different journeys and they must never be confused:
 *
 *   toPickup   driver → rider. Live while DRIVER_EN_ROUTE. This is the leg the
 *              "4 min away" countdown is about.
 *   toDropoff  pickup → destination. Live once the ride is IN_PROGRESS.
 *
 * The old ETA code routed to the FINAL DESTINATION in every state, so while the
 * driver was still coming to fetch the rider, "8 min away" was the time to the
 * rider's destination — a number that had nothing to do with the wait.
 */

/** Recompute when the driver is further than this from the line. */
const OFF_ROUTE_M = 80;
/** ...and only after this many consecutive off-route fixes, so one bad GPS
 *  fix under a bridge does not burn a Directions call. */
const OFF_ROUTE_STRIKES = 3;
/** A cached leg is stale after this even if the driver stayed on it — traffic
 *  moves, and the ETA rides on the same response. */
const CACHE_TTL_SEC = 180;
/** Congested Accra urban mean. Mirrors ETA_FALLBACK_SPEED_KPH in the sockets
 *  and FALLBACK_URBAN_KMH in geo.service.js. */
const FALLBACK_KPH = Number(process.env.ETA_FALLBACK_SPEED_KPH) || 22;
/** Road distance ÷ straight-line distance, typical urban. */
const ROAD_FACTOR = 1.35;

const cacheKey = (tripId, leg) => `route:${tripId}:${leg}`;
const strikeKey = (tripId) => `route:${tripId}:strikes`;

/**
 * Which leg is live for a trip status.
 *
 * SCHEDULED/FILLING return `toDropoff` on purpose: a group trip that has not
 * departed still wants its line drawn, so riders can see where the bus goes
 * before they book a seat.
 */
function activeLeg(status) {
  switch (status) {
    case 'CONFIRMED':
    case 'DRIVER_EN_ROUTE':
    case 'ARRIVED_AT_PICKUP':
      return 'toPickup';
    case 'IN_PROGRESS':
    case 'SCHEDULED':
    case 'FILLING':
      return 'toDropoff';
    default:
      return null;
  }
}

function usable(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Origin and destination for a leg.
 *
 * `toPickup` starts wherever the driver is NOW, so it is the only leg whose
 * origin moves; `toDropoff` is anchored at the pickup so it is stable for the
 * whole ride and can be cached hard.
 *
 * The group/bus product has no `dropoffLat` on the Trip — its destination lives
 * on the Route — so both are consulted. This is the single place that knows
 * that, which is why on-demand rides used to get no route at all: the old ETA
 * code read `trip.route.destLat` only, and an on-demand trip has no route.
 */
function legEndpoints(trip, leg, driver) {
  const destLat = usable(trip.dropoffLat) ? trip.dropoffLat : trip.route?.destLat;
  const destLng = usable(trip.dropoffLng) ? trip.dropoffLng : trip.route?.destLng;

  if (leg === 'toPickup') {
    if (!driver || !usable(driver.lat) || !usable(driver.lng)) return null;
    if (!usable(trip.pickupLat) || !usable(trip.pickupLng)) return null;
    return {
      originLat: driver.lat,
      originLng: driver.lng,
      destLat: trip.pickupLat,
      destLng: trip.pickupLng,
    };
  }

  if (!usable(destLat) || !usable(destLng)) return null;
  // Once underway the line should start from the driver, not from the pickup
  // the driver has already left — otherwise the rider watches the puck run
  // alongside a line it is no longer on.
  const originLat = usable(driver?.lat) ? driver.lat : trip.pickupLat;
  const originLng = usable(driver?.lng) ? driver.lng : trip.pickupLng;
  if (!usable(originLat) || !usable(originLng)) return null;
  return { originLat, originLng, destLat, destLng };
}

/** Straight line + a road multiplier. Used when Mapbox is unreachable or unset. */
function estimateLeg({ originLat, originLng, destLat, destLng }) {
  const straightKm = haversineMeters(originLat, originLng, destLat, destLng) / 1000;
  const distanceKm = Math.max(straightKm * ROAD_FACTOR, 0.05);
  return {
    distanceKm,
    durationMin: (distanceKm / Math.max(FALLBACK_KPH, 5)) * 60,
    geometry: {
      type: 'LineString',
      coordinates: [[originLng, originLat], [destLng, destLat]],
    },
    source: 'estimate',
  };
}

async function readCache(tripId, leg) {
  try {
    const raw = await redis.get(cacheKey(tripId, leg));
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    logger.debug('[route] cache read failed', { error: err?.message });
    return null;
  }
}

async function writeCache(tripId, leg, value) {
  try {
    await redis.set(cacheKey(tripId, leg), JSON.stringify(value), 'EX', CACHE_TTL_SEC);
  } catch (err) {
    logger.debug('[route] cache write failed', { error: err?.message });
  }
}

/**
 * How far the driver has strayed from the line, in metres.
 * `Infinity` when there is no line to stray from.
 */
function deviationMeters(route, lat, lng) {
  const coords = route?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return Infinity;
  return distanceToPolyline(lat, lng, coords);
}

/**
 * Count consecutive off-route fixes, and report only when the driver has
 * genuinely left the route rather than bounced once.
 *
 * The counter lives in Redis rather than in a module Map so it survives the
 * driver's socket reconnecting to a different server process — which is
 * exactly when a re-route matters most.
 */
async function registerDeviation(tripId, offRoute) {
  try {
    if (!offRoute) {
      await redis.del(strikeKey(tripId));
      return 0;
    }
    const n = await redis.incr(strikeKey(tripId));
    await redis.expire(strikeKey(tripId), 120);
    return n;
  } catch {
    // Without Redis, fall back to reacting immediately: a missed re-route is
    // worse than an extra Directions call.
    return offRoute ? OFF_ROUTE_STRIKES : 0;
  }
}

/**
 * The current route for a trip, computing it only when it actually needs to be.
 *
 * @param {object} trip   Trip row with status, pickup/dropoff and optional route
 * @param {{lat:number,lng:number}|null} driver  live driver position
 * @param {{force?:boolean}} [opts]
 * @returns {Promise<null|{leg:string,geometry:object,distanceKm:number,durationMin:number,computedAt:number,source:string,rerouted:boolean}>}
 */
async function getRouteForTrip(trip, driver, opts = {}) {
  const leg = activeLeg(trip.status);
  if (!leg) return null;

  const endpoints = legEndpoints(trip, leg, driver);
  if (!endpoints) return null;

  const cached = await readCache(trip.id, leg);

  let rerouted = false;
  if (cached && !opts.force) {
    // `toPickup` is redrawn from the driver's current position, so it is
    // deliberately allowed to go stale between recomputes — the puck moving
    // along a slightly old line reads fine; a line that jumps every 2 seconds
    // does not.
    const dev = driver && usable(driver.lat)
      ? deviationMeters(cached, driver.lat, driver.lng)
      : 0;
    const strikes = await registerDeviation(trip.id, dev > OFF_ROUTE_M);
    const stale = Date.now() - (cached.computedAt || 0) > CACHE_TTL_SEC * 1000;

    if (strikes < OFF_ROUTE_STRIKES && !stale) return cached;
    rerouted = strikes >= OFF_ROUTE_STRIKES;
    if (rerouted) await redis.del(strikeKey(trip.id)).catch(() => {});
  }

  let computed;
  const hasToken = env.MAPBOX_SECRET_TOKEN && env.MAPBOX_SECRET_TOKEN !== 'placeholder';
  if (hasToken) {
    try {
      const r = await getDirections(
        endpoints.originLng, endpoints.originLat,
        endpoints.destLng, endpoints.destLat,
      );
      computed = { ...r, source: 'mapbox' };
    } catch (err) {
      logger.warn('[route] directions failed, estimating', { tripId: trip.id, leg, error: err.message });
      computed = estimateLeg(endpoints);
    }
  } else {
    computed = estimateLeg(endpoints);
  }

  const value = {
    leg,
    geometry: computed.geometry,
    distanceKm: Math.round(computed.distanceKm * 100) / 100,
    durationMin: Math.round(computed.durationMin * 10) / 10,
    source: computed.source,
    computedAt: Date.now(),
  };
  await writeCache(trip.id, leg, value);
  return { ...value, rerouted };
}

/** Read-only: whatever is cached for the trip's live leg, without computing. */
async function peekRouteForTrip(trip) {
  const leg = activeLeg(trip.status);
  if (!leg) return null;
  return readCache(trip.id, leg);
}

/**
 * Compute the trip's live leg NOW, so the first snapshot after a status change
 * already carries a line and an ETA.
 *
 * BUGFIX ("when i swipe to start the trip it visibly takes a while to show the
 * estimated eta, the route polyline and all that — i think it's stuck on
 * calculating eta").
 *
 * It was not stuck; it had nothing to show yet. `activeLeg(status)` changes the
 * moment the trip does — `toPickup` becomes `toDropoff` on departure — and the
 * new leg's cache is empty. Snapshots are built with `peekRouteForTrip`, which
 * is deliberately read-only (rendering a snapshot must not block on a Mapbox
 * round trip, and must not let a client spend Directions quota by refreshing).
 * So every consumer got `path: null` and `eta: null` until the driver's NEXT
 * location ping happened to call `getRouteForTrip` — several seconds of a blank
 * map and a "Calculating ETA..." that had nobody calculating anything.
 *
 * The transition is the right moment to pay for the recompute: it happens once,
 * it is user-initiated, and it is exactly when the answer changes. Best-effort
 * on purpose — a trip whose line could not be drawn is still a started trip, so
 * this must never be able to fail the swipe that triggered it.
 */
async function warmRouteForTrip(tripId) {
  try {
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      select: {
        id: true, status: true, driverId: true,
        pickupLat: true, pickupLng: true, dropoffLat: true, dropoffLng: true,
        route: { select: { originLat: true, originLng: true, destLat: true, destLng: true } },
      },
    });
    if (!trip || !activeLeg(trip.status)) return null;

    let driverPos = null;
    if (trip.driverId) {
      const d = await prisma.driver.findUnique({
        where: { id: trip.driverId },
        select: { currentLat: true, currentLng: true },
      });
      if (d && usable(d.currentLat) && usable(d.currentLng)) {
        driverPos = { lat: d.currentLat, lng: d.currentLng };
      }
    }
    // `force` because the cache we care about is the one for the leg that just
    // became live, and a stale entry from a previous pass through this leg
    // would be measured from wherever the driver used to be.
    return await getRouteForTrip(trip, driverPos, { force: true });
  } catch (err) {
    logger.warn('[route] warm failed', { tripId, error: err?.message });
    return null;
  }
}

/** Drop both legs — call when a trip ends or is reassigned to another driver. */
async function clearRouteForTrip(tripId) {
  try {
    await redis.del(cacheKey(tripId, 'toPickup'), cacheKey(tripId, 'toDropoff'), strikeKey(tripId));
  } catch (err) {
    logger.debug('[route] clear failed', { error: err?.message });
  }
}

module.exports = {
  OFF_ROUTE_M,
  OFF_ROUTE_STRIKES,
  activeLeg,
  legEndpoints,
  deviationMeters,
  getRouteForTrip,
  peekRouteForTrip,
  warmRouteForTrip,
  clearRouteForTrip,
};
