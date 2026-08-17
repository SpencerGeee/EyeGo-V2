'use strict';

const prisma = require('../config/database');
const redis = require('../config/redis');
const env = require('../config/env');
const logger = require('../utils/logger');
const { getDirections } = require('./mapbox.service');
const { haversineMeters, distanceToPolyline, realisticDurationMin } = require('../utils/geo');
const supply = require('./supply-index.service');
const { seatOccupyingWhere } = require('../utils/booking-status');

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
/**
 * How long a STRAIGHT-LINE estimate is allowed to stand in for a real route.
 *
 * `estimateLeg` returns a two-point LineString — literally a straight line from
 * origin to destination. It exists so a Mapbox outage degrades the map instead
 * of emptying it, but it was being cached under the same 180 s TTL as a real
 * route, so one failed or slow Directions call pinned a line straight through
 * the buildings for three minutes: "a straight polyline to the destination, and
 * it takes a big moment before it accurately maps to the road".
 *
 * A few seconds is enough to avoid hammering Directions while it is unhealthy,
 * and short enough that the next location ping repairs the line.
 */
const ESTIMATE_TTL_SEC = 8;
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
    // DRIVER_ASSIGNED was missing, and it is the status a ride sits at for the
    // whole gap between "driver accepted" and "driver tapped I'm on my way".
    // With no leg there was no geometry and no duration, so the driver's screen
    // showed a lone pin and "Calculating ETA…" that never resolved, and only
    // started drawing once the trip moved on. The driver is heading for the
    // pickup from the moment they accept — that is the leg.
    case 'DRIVER_ASSIGNED':
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
 * WHERE THE DRIVER IS ACTUALLY GOING TO FETCH THIS RIDE'S PASSENGER.
 *
 * BUGFIX ("it says heading to pickup but the pickup is exactly where the driver
 * put it" / a rider who moves their own pin from the group hub page is still
 * routed to the trip's original point).
 *
 * `Booking.pickupLat/Lng` exists precisely so a group-hub joiner can board
 * somewhere other than the trip's main pickup — the schema comment says so, and
 * `deviationSurchargePesewas` right below it means the rider is CHARGED for the
 * detour. Nothing then routed to it. Every consumer of "the pickup" read
 * `Trip.pickupLat/Lng` only, so the rider paid a deviation surcharge to be
 * collected from a point the driver was never sent to, and the arrival check
 * measured the driver against the wrong place as well.
 *
 * The rule, deliberately narrow: a booking's own pickup wins only when it is
 * the ONLY seat-occupying booking on the trip, because then "the pickup" is
 * unambiguous. With several scattered joiners the driver has an ordered set of
 * stops, which is a routing problem this function has no business inventing an
 * answer to — so it keeps the trip's main pickup (the shared hub), which is the
 * existing, correct behaviour for that case.
 *
 * Degrades safely: callers that did not select `bookings` get the old answer
 * rather than a wrong one.
 */
function effectivePickup(trip) {
  const fallback = { lat: trip.pickupLat, lng: trip.pickupLng };
  const bookings = Array.isArray(trip.bookings) ? trip.bookings : null;
  if (!bookings || bookings.length !== 1) return fallback;
  const own = bookings[0];
  if (!usable(own?.pickupLat) || !usable(own?.pickupLng)) return fallback;
  return { lat: own.pickupLat, lng: own.pickupLng };
}

/**
 * Metres between the driver and the point they are being sent to, or null when
 * either end is unknown. Shared so the "is the driver already there?" question
 * has ONE answer across the arrival check and the status copy.
 */
function metersFromPickup(trip, driver) {
  const pickup = effectivePickup(trip);
  if (!usable(pickup.lat) || !usable(pickup.lng)) return null;
  // Through `driverPos` so this accepts either shape callers hold — a plain
  // `{ lat, lng }` or a Prisma `driver` row with `currentLat`/`currentLng`.
  // Hoisted; declared below next to legEndpoints, its other consumer.
  const pos = driverPos(driver);
  if (!pos) return null;
  return haversineMeters(pos.lat, pos.lng, pickup.lat, pickup.lng);
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
/**
 * A driver's live position, whatever shape the caller had it in.
 *
 * Callers pass two different things here. The socket/tracking paths pass a
 * plain `{ lat, lng }` snapshot; `getTripByShareToken` passes `trip.driver`
 * straight off Prisma, where the columns are `currentLat` / `currentLng`. Only
 * the first shape was read, so for the invite link every `driver.lat` was
 * `undefined` — silently, because the code's next move is a fallback.
 *
 * On `toDropoff` that fallback is harmless (an unstarted trip should start its
 * line at the pickup anyway). On `toPickup` it is the difference between a route
 * and `null`, i.e. between a road line and no line at all.
 */
function driverPos(driver) {
  if (!driver) return null;
  const lat = usable(driver.lat) ? driver.lat : driver.currentLat;
  const lng = usable(driver.lng) ? driver.lng : driver.currentLng;
  return usable(lat) && usable(lng) ? { lat, lng } : null;
}

function legEndpoints(trip, leg, driver) {
  const pos = driverPos(driver);
  const destLat = usable(trip.dropoffLat) ? trip.dropoffLat : trip.route?.destLat;
  const destLng = usable(trip.dropoffLng) ? trip.dropoffLng : trip.route?.destLng;

  if (leg === 'toPickup') {
    if (!pos) return null;
    driver = pos;
    // The rider's OWN pickup point when they moved it — see effectivePickup.
    const pickup = effectivePickup(trip);
    if (!usable(pickup.lat) || !usable(pickup.lng)) return null;
    return {
      originLat: driver.lat,
      originLng: driver.lng,
      destLat: pickup.lat,
      destLng: pickup.lng,
    };
  }

  if (!usable(destLat) || !usable(destLng)) return null;
  // Once underway the line should start from the driver, not from the pickup
  // the driver has already left — otherwise the rider watches the puck run
  // alongside a line it is no longer on.
  //
  // `route.originLat` is the third fallback and it matters for ad-hoc trips: a
  // map-pin trip created by a driver can carry its endpoints on its Route rather
  // than on the Trip row, and with only `trip.pickupLat` to fall back on this
  // returned null — which is what left the invite page drawing its two-point
  // dashed hint even though the server was being asked for the real road.
  const pickupLat = usable(trip.pickupLat) ? trip.pickupLat : trip.route?.originLat;
  const pickupLng = usable(trip.pickupLng) ? trip.pickupLng : trip.route?.originLng;
  const originLat = pos ? pos.lat : pickupLat;
  const originLng = pos ? pos.lng : pickupLng;
  if (!usable(originLat) || !usable(originLng)) return null;
  return { originLat, originLng, destLat, destLng };
}

/**
 * Distance and duration only, when Mapbox is unreachable or unset.
 *
 * NO GEOMETRY, deliberately. This used to return the two-point straight line
 * between the endpoints, and every consumer drew it — so a ride opened with a
 * ruler-straight line cutting across the city that snapped onto roads a moment
 * later. Uber and Bolt never show that, and the reason is simply that they draw
 * nothing until the road route exists.
 *
 * The numbers are still worth having: an ETA from a haversine × road-factor is
 * approximately right and much better than "Calculating…". The line is not —
 * a straight line across Accra is not approximately the route, it is a
 * different route. So: keep the estimate, drop the drawing.
 */
function estimateLeg({ originLat, originLng, destLat, destLng }) {
  const straightKm = haversineMeters(originLat, originLng, destLat, destLng) / 1000;
  const distanceKm = Math.max(straightKm * ROAD_FACTOR, 0.05);
  return {
    distanceKm,
    durationMin: (distanceKm / Math.max(FALLBACK_KPH, 5)) * 60,
    geometry: null,
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
    // An estimate expires fast so the next fix can replace it with real roads.
    const ttl = value?.source === 'estimate' ? ESTIMATE_TTL_SEC : CACHE_TTL_SEC;
    await redis.set(cacheKey(tripId, leg), JSON.stringify(value), 'EX', ttl);
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
    // An estimate goes stale on its own short clock: it is a placeholder for a
    // road route, so the sooner it is retried the sooner the line lies on roads.
    const ttlSec = cached.source === 'estimate' ? ESTIMATE_TTL_SEC : CACHE_TTL_SEC;
    const stale = Date.now() - (cached.computedAt || 0) > ttlSec * 1000;

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
    // Clamped to a speed a car can hold through a city — see
    // `realisticDurationMin`. It only ever lengthens the number, and it is what
    // stops a live "arriving in 22 min" for a 14.5 km leg whenever the routing
    // provider has no congestion data and answers with posted limits.
    durationMin:
      Math.round(
        (realisticDurationMin(computed.durationMin, computed.distanceKm) ?? computed.durationMin) * 10,
      ) / 10,
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
        // Needed by `effectivePickup`: a lone joiner who moved their own pin is
        // routed to THAT point, not to the trip's original one.
        bookings: {
          where: { ...seatOccupyingWhere() },
          select: { pickupLat: true, pickupLng: true },
        },
      },
    });
    if (!trip || !activeLeg(trip.status)) return null;

    /**
     * WHERE THE DRIVER IS — FROM THE INDEX FIRST, THE ROW SECOND.
     *
     * BUGFIX ("the status is on heading to pickup but the tracking page is
     * showing blank for the calculating eta"). This only ever read
     * `Driver.currentLat/currentLng`, which is a COLD copy written at most every
     * 15 s or 60 m of movement and NULL for a driver who has not yet crossed
     * either threshold since the row was created. With no position there is no
     * `toPickup` leg to compute, so nothing was cached, so the snapshot carried
     * `eta: null`, so both apps sat on "Calculating ETA…" with, as the note above
     * puts it, nobody calculating anything — until some later ping happened to
     * move the driver far enough to persist a fix.
     *
     * The Redis supply index is refreshed on EVERY ping (and by the 25 s parked
     * heartbeat), so it has an answer within seconds of the driver coming online.
     * The column stays as the fallback for a driver who is offline entirely.
     */
    let driverPos = null;
    if (trip.driverId) {
      driverPos = await supply.driverPosition(trip.driverId).catch(() => null);
      if (!driverPos) {
        const d = await prisma.driver.findUnique({
          where: { id: trip.driverId },
          select: { currentLat: true, currentLng: true },
        });
        if (d && usable(d.currentLat) && usable(d.currentLng)) {
          driverPos = { lat: d.currentLat, lng: d.currentLng };
        }
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

/**
 * Build the `trip:eta` payload for a computed route.
 *
 * Lives here — next to the thing that produces `route` — rather than inside one
 * socket file, because three separate publishers now send this event (the
 * location handler, the tracking-room join, and the status transition below).
 * Two of them used to build the shape independently, which is the mechanism
 * behind "the ETA on the driver app is not consistent with the rider app".
 */
function etaPayloadFor(tripId, route) {
  const etaMinutes = Math.round(route.durationMin);
  return {
    tripId,
    leg: route.leg,
    etaMinutes,
    distanceKm: Math.round(route.distanceKm * 10) / 10,
    message: route.durationMin < 2
      ? (route.leg === 'toPickup' ? 'Arriving now' : 'Almost there')
      : `${etaMinutes} min ${route.leg === 'toPickup' ? 'away' : 'to destination'}`,
    geometry: route.geometry,
    rerouted: route.rerouted === true,
  };
}

/** The narrower "the line changed" payload, same single-source-of-shape rule. */
function routePayloadFor(tripId, route) {
  return {
    tripId,
    leg: route.leg,
    geometry: route.geometry,
    distanceKm: route.distanceKm,
    durationMin: route.durationMin,
  };
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
  etaPayloadFor,
  routePayloadFor,
  effectivePickup,
  metersFromPickup,
};
