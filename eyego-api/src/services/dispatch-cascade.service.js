'use strict';

/**
 * Sequential dispatch cascade — one driver at a time, Uber/Bolt style.
 *
 * WHY THIS REPLACES THE BROADCAST
 * -------------------------------
 * Both dispatch paths used to fan a single ride out to the five nearest drivers
 * simultaneously and let them race. That has three problems the rider felt
 * directly:
 *
 *   1. There is no such thing as "the driver who was offered the ride", so the
 *      rider's screen has nothing to point at — no ETA, no pin, no polyline.
 *   2. Four of the five drivers get an offer that is guaranteed to be revoked,
 *      which trains drivers to ignore the dispatch screen.
 *   3. A failure is indistinguishable from silence. If all five decline, nothing
 *      happens at all; the rider just watches a spinner forever.
 *
 * The cascade instead holds an ordered candidate list and offers the ride to
 * exactly one driver for `OFFER_TTL_SECONDS`. Decline or timeout advances to the
 * next. When the list is exhausted the rider is told so explicitly, which is
 * what drives the "all our drivers are busy" screen.
 *
 * Every state change is broadcast to the rider's `user:{id}` room so the request
 * screen can draw the live polyline to whichever driver currently holds the
 * offer, and re-draw it when the offer moves on.
 *
 * PROCESS MODEL: state lives in a module-level Map with real timers, so it is
 * per-process. The API runs as a single instance today. If it is ever scaled
 * horizontally this must move to Redis with a keyspace-expiry listener, because
 * two instances would otherwise each run their own cascade for the same ride.
 */

const prisma = require('../config/database');
const redis = require('../config/redis');
const logger = require('../utils/logger');
const { availableDriverWhere, isDriverAvailable } = require('./driver-availability');
const { sendMulticastPush } = require('./push.service');

/** How long a single driver holds an exclusive offer before it moves on. */
const OFFER_TTL_SECONDS = parseInt(process.env.DISPATCH_OFFER_TTL_SECONDS, 10) || 20;

/** Nearest-first search radius, and the wider sweep used if nobody is close. */
const DISPATCH_RADIUS_KM = parseFloat(process.env.DISPATCH_RADIUS_KM) || 5;
const DISPATCH_EXTENDED_RADIUS_KM = parseFloat(process.env.DISPATCH_EXTENDED_RADIUS_KM) || 12;

/** Cap on how many drivers one ride will ever be walked through. */
const MAX_CANDIDATES = parseInt(process.env.DISPATCH_MAX_CANDIDATES, 10) || 8;

/** rideId → cascade state. */
const cascades = new Map();

function io() {
  try {
    return require('../app').get('io');
  } catch {
    return null;
  }
}

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
 * Ordered candidate drivers, nearest first.
 *
 * The Redis `drivers:online` geo-set is used as a RANKING HINT ONLY, never as
 * the membership list. It is populated by location pings, so a driver who just
 * went online, whose ping hasn't landed, or who is running against a restarted
 * Redis is simply absent from it — and because an id filter intersects, one
 * unrelated driver being present was historically enough to exclude everyone
 * Redis didn't know about. That silent exclusion is the single most common
 * cause of "I'm online and free but no request ever arrives".
 */
async function buildCandidates({ pickupLat, pickupLng, excludeDriverId, radiusKm }) {
  const hasPickup = Number.isFinite(pickupLat) && Number.isFinite(pickupLng);

  let geoIds = [];
  if (hasPickup) {
    try {
      geoIds = await redis.geosearch(
        'drivers:online',
        'FROMLONLAT', pickupLng, pickupLat,
        'BYRADIUS', radiusKm, 'km',
        'ASC', 'COUNT', 50,
      );
    } catch {
      geoIds = await redis
        .georadius('drivers:online', pickupLng, pickupLat, radiusKm, 'km', 'ASC', 'COUNT', 50)
        .catch(() => []);
    }
  }
  const geoSet = new Set(Array.isArray(geoIds) ? geoIds : []);

  const drivers = await prisma.driver.findMany({
    where: availableDriverWhere({ excludeId: excludeDriverId || null }),
    select: { id: true, fcmToken: true, currentLat: true, currentLng: true, userId: true },
  });

  const ranked = drivers
    .map((d) => {
      const distanceKm =
        hasPickup && d.currentLat != null && d.currentLng != null
          ? haversineKm(pickupLat, pickupLng, d.currentLat, d.currentLng)
          : null;
      return { ...d, inGeoSet: geoSet.has(d.id), distanceKm };
    })
    // A driver with no known position is kept rather than dropped — missing
    // telemetry must never cost a rider their ride.
    .filter((d) => !hasPickup || d.inGeoSet || d.distanceKm == null || d.distanceKm <= radiusKm)
    .sort((a, b) => (a.distanceKm ?? Number.MAX_SAFE_INTEGER) - (b.distanceKm ?? Number.MAX_SAFE_INTEGER))
    .slice(0, MAX_CANDIDATES);

  return ranked;
}

/** Tell the rider which driver currently holds the offer (drives the polyline). */
function emitToRider(state, event, data) {
  const server = io();
  if (!server || !state.riderUserIds?.length) return;
  for (const userId of state.riderUserIds) {
    server.of('/passenger').to(`user:${userId}`).emit(event, { rideId: state.rideId, ...data });
  }
}

function emitToDriver(driverId, payload) {
  const server = io();
  if (!server) return;
  // Emitted unconditionally, independent of any FCM token. The push below is a
  // best-effort backup for a backgrounded app, NOT a precondition — gating the
  // socket emit on a token is why drivers on sideloaded builds (no FCM
  // registration) never saw a single dispatch.
  server.of('/driver').to(`driver:${driverId}`).emit('trip:assigned', payload);
}

async function pushToDriver(driver, state, expiresAt) {
  if (!driver.fcmToken) return;
  try {
    await sendMulticastPush(
      [driver.fcmToken],
      state.pushTitle,
      state.pushBody,
      {
        ...state.pushData,
        type: state.kind === 'REQUEST' ? 'TRIP_REQUEST_DISPATCH' : 'DISPATCH_REQUEST',
        expiresAt,
      },
    );
  } catch (err) {
    logger.warn(`Dispatch push failed for driver ${driver.id}: ${err.message}`);
  }
}

/**
 * Offer the ride to the candidate at `state.index`, or finish the cascade.
 *
 * Availability is re-checked immediately before the offer rather than trusted
 * from the moment the list was built — a driver near the front of a queue can
 * easily accept something else while the cascade is still walking earlier
 * candidates.
 */
async function offerNext(rideId) {
  const state = cascades.get(rideId);
  if (!state || state.done) return;

  clearTimeout(state.timer);

  // Ride may have been accepted, cancelled or expired out from under us.
  if (state.isStillOpen) {
    const open = await state.isStillOpen().catch(() => true);
    if (!open) {
      finish(rideId, 'resolved');
      return;
    }
  }

  while (state.index < state.candidates.length) {
    const driver = state.candidates[state.index];
    state.index += 1;

    if (state.declined.has(driver.id)) continue;

    const free = await isDriverAvailable(prisma, driver.id).catch(() => false);
    if (!free) {
      logger.info('Dispatch skipped busy candidate', { rideId, driverId: driver.id });
      continue;
    }

    const expiresAt = new Date(Date.now() + OFFER_TTL_SECONDS * 1000).toISOString();
    state.currentDriverId = driver.id;
    state.expiresAt = expiresAt;

    emitToDriver(driver.id, { ...state.driverPayload, expiresAt });
    pushToDriver(driver, state, expiresAt);

    emitToRider(state, 'dispatch:offer', {
      driverId: driver.id,
      driverLat: driver.currentLat ?? null,
      driverLng: driver.currentLng ?? null,
      attempt: state.index,
      totalCandidates: state.candidates.length,
      expiresAt,
    });

    logger.info('Dispatch offer sent', {
      rideId,
      driverId: driver.id,
      attempt: state.index,
      of: state.candidates.length,
      hasFcm: !!driver.fcmToken,
      distanceKm: driver.distanceKm,
    });

    state.timer = setTimeout(() => {
      logger.info('Dispatch offer timed out', { rideId, driverId: driver.id });
      // A timeout is a soft decline: the driver may simply have had the phone in
      // a pocket, so they stay eligible for the widened second sweep.
      offerNext(rideId).catch((e) => logger.warn(`Dispatch cascade error: ${e.message}`));
    }, OFFER_TTL_SECONDS * 1000);
    return;
  }

  // Everyone in range has passed. Widen once before giving up — the rider is
  // better served by a driver 10 km away than by a failure screen.
  if (!state.widened) {
    state.widened = true;
    const wider = await buildCandidates({
      pickupLat: state.pickupLat,
      pickupLng: state.pickupLng,
      excludeDriverId: state.excludeDriverId,
      radiusKm: DISPATCH_EXTENDED_RADIUS_KM,
    });
    const seen = new Set(state.candidates.map((d) => d.id));
    const extra = wider.filter((d) => !seen.has(d.id));
    if (extra.length > 0) {
      logger.info('Dispatch widening radius', { rideId, extra: extra.length });
      state.candidates = state.candidates.concat(extra);
      emitToRider(state, 'dispatch:widening', { totalCandidates: state.candidates.length });
      return offerNext(rideId);
    }
  }

  logger.info('Dispatch exhausted — no driver accepted', { rideId, tried: state.candidates.length });
  emitToRider(state, 'dispatch:exhausted', { tried: state.candidates.length });
  state.onExhausted?.().catch?.((e) => logger.warn(`onExhausted failed: ${e.message}`));
  finish(rideId, 'exhausted');
}

function finish(rideId, reason) {
  const state = cascades.get(rideId);
  if (!state) return;
  state.done = true;
  clearTimeout(state.timer);
  cascades.delete(rideId);
  logger.info('Dispatch cascade finished', { rideId, reason });
}

/**
 * Begin cascading a ride to drivers.
 *
 * @param {object}   opts
 * @param {string}   opts.rideId           Trip id or TripRequest id — whatever the driver app will accept.
 * @param {'REQUEST'|'DISPATCH'|'REASSIGNMENT'} opts.kind  Tells the driver app which accept endpoint to call.
 * @param {number}   [opts.pickupLat]
 * @param {number}   [opts.pickupLng]
 * @param {string[]} opts.riderUserIds     Rider user ids to stream progress to.
 * @param {object}   opts.driverPayload    Body of the driver's `trip:assigned` event.
 * @param {string}   opts.pushTitle
 * @param {string}   opts.pushBody
 * @param {object}   [opts.pushData]
 * @param {string}   [opts.excludeDriverId]
 * @param {() => Promise<boolean>} [opts.isStillOpen]  False once the ride no longer needs a driver.
 * @param {() => Promise<void>}    [opts.onExhausted]  Runs when nobody accepted.
 */
async function startCascade(opts) {
  const { rideId } = opts;
  if (!rideId) return;

  // Restarting a ride's cascade (e.g. driver cancelled) must not leave the old
  // timer running, or two chains would advance the same ride independently.
  if (cascades.has(rideId)) finish(rideId, 'restarted');

  const candidates = await buildCandidates({
    pickupLat: opts.pickupLat,
    pickupLng: opts.pickupLng,
    excludeDriverId: opts.excludeDriverId,
    radiusKm: DISPATCH_RADIUS_KM,
  });

  const state = {
    rideId,
    kind: opts.kind ?? 'DISPATCH',
    pickupLat: opts.pickupLat,
    pickupLng: opts.pickupLng,
    excludeDriverId: opts.excludeDriverId,
    riderUserIds: opts.riderUserIds ?? [],
    driverPayload: { tripId: rideId, kind: opts.kind ?? 'DISPATCH', ...opts.driverPayload },
    pushTitle: opts.pushTitle ?? 'New trip nearby',
    pushBody: opts.pushBody ?? 'A rider needs a trip',
    pushData: opts.pushData ?? {},
    isStillOpen: opts.isStillOpen,
    onExhausted: opts.onExhausted,
    candidates,
    index: 0,
    declined: new Set(),
    widened: false,
    done: false,
    timer: null,
    currentDriverId: null,
    expiresAt: null,
  };
  cascades.set(rideId, state);

  emitToRider(state, 'dispatch:searching', { totalCandidates: candidates.length });

  if (candidates.length === 0) {
    // Straight to the widening sweep — `offerNext` handles the empty list and
    // will emit `dispatch:exhausted` if that comes back empty too.
    logger.info('No drivers in initial radius', { rideId, radiusKm: DISPATCH_RADIUS_KM });
  }

  await offerNext(rideId);
}

/**
 * Driver declined (or their accept lost the race). Advances immediately rather
 * than waiting out the remaining TTL.
 */
function declineOffer(rideId, driverId) {
  const state = cascades.get(rideId);
  if (!state || state.done) return false;
  state.declined.add(driverId);
  // Ignore a decline from a driver who no longer holds the offer — it is a late
  // tap on an offer that already moved on, and acting on it would skip a
  // candidate who is mid-decision.
  if (state.currentDriverId !== driverId) return false;
  offerNext(rideId).catch((e) => logger.warn(`Dispatch cascade error: ${e.message}`));
  return true;
}

/** Driver accepted — stop the cascade and tell the rider who won. */
function acceptOffer(rideId, driverId) {
  const state = cascades.get(rideId);
  if (!state) return;
  emitToRider(state, 'dispatch:matched', { driverId });
  finish(rideId, 'accepted');
}

/** Rider cancelled, or the ride expired. */
function cancelCascade(rideId) {
  if (cascades.has(rideId)) finish(rideId, 'cancelled');
}

/** Current offer state, for the rider's polling fallback when sockets are down. */
function getCascadeState(rideId) {
  const state = cascades.get(rideId);
  if (!state) return null;
  return {
    rideId,
    currentDriverId: state.currentDriverId,
    expiresAt: state.expiresAt,
    attempt: state.index,
    totalCandidates: state.candidates.length,
  };
}

module.exports = {
  startCascade,
  declineOffer,
  acceptOffer,
  cancelCascade,
  getCascadeState,
  buildCandidates,
  OFFER_TTL_SECONDS,
  DISPATCH_RADIUS_KM,
  DISPATCH_EXTENDED_RADIUS_KM,
};
