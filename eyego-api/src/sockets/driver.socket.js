'use strict';

const redis = require('../config/redis');
const prisma = require('../config/database');
const { isWithinGhana } = require('../services/mapbox.service');
const {
  getRouteForTrip,
  peekRouteForTrip,
  warmRouteForTrip,
  deviationMeters,
  clearRouteForTrip,
} = require('../services/route-geometry.service');
const { completeTrip } = require('../modules/trips/trips.service');
const { sendMulticastPush, sendPush } = require('../services/push.service');
const liveActivityPush = require('../services/live-activity-push.service');
const { haversineMeters } = require('../utils/geo');
const supply = require('../services/supply-index.service');
const logger = require('../utils/logger');
const env = require('../config/env');
const { seatOccupyingWhere } = require('../utils/booking-status');

const LOCATION_UPDATE_CHANNEL = (driverId) => `driver:${driverId}:location`;
const TRIP_ROOM = (tripId) => `trip:${tripId}`;

// How often a live GPS fix is written through to Postgres. Redis takes every
// fix; the row is the cold copy. See the location handler for why.
const DB_PERSIST_INTERVAL_MS = 15_000;
const DB_PERSIST_DISTANCE_M = 60;

// ── iOS Live Activity (ActivityKit) push fan-out ─────────────────────────
// Separate channel from the FCM-based pushNotifications above — these go
// straight to APNs via live-activity-push.service.js. Every rider with an
// active booking on the trip AND a registered liveActivityPushToken gets
// pushed; riders who never started a Live Activity (e.g. Android, or an iOS
// rider who denied the permission) simply have no token and are skipped.
const LIVE_ACTIVITY_STATUS_TEXT = {
  DRIVER_EN_ROUTE: 'Driver is on the way',
  ARRIVED_AT_PICKUP: 'Your driver has arrived',
  IN_PROGRESS: 'Trip in progress',
  COMPLETED: 'You have arrived',
  CANCELLED: 'Trip cancelled',
};

/**
 * Build the `trip:eta` payload for a trip's live leg.
 *
 * Extracted so the join handler and the location handler cannot drift into
 * publishing different shapes for the same fact — which is the mechanism behind
 * "the ETA on the driver app is not consistent with the rider app".
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

/**
 * Send whoever just joined the current line and ETA, straight away.
 *
 * Prefers the cache; computes only when there is nothing cached at all, which
 * is the case immediately after a status change flips the live leg. Emitted to
 * the ONE socket, not the room — everybody else already has it.
 */
async function emitRouteSnapshotTo(socket, tripId) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      id: true, status: true,
      pickupLat: true, pickupLng: true,
      dropoffLat: true, dropoffLng: true,
      route: { select: { destLat: true, destLng: true } },
    },
  });
  if (!trip) return;

  let route = await peekRouteForTrip(trip);
  if (!route) route = await warmRouteForTrip(tripId);
  if (!route || !route.geometry) return;

  socket.emit('trip:eta', etaPayloadFor(tripId, route));
  socket.emit('trip:route', {
    tripId,
    leg: route.leg,
    geometry: route.geometry,
    distanceKm: route.distanceKm,
    durationMin: route.durationMin,
  });
}

async function pushLiveActivityUpdate(tripId, { status, etaMinutes, distanceKm, driverLat, driverLng } = {}) {
  try {
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      select: {
        status: true,
        bookings: {
          where: { liveActivityPushToken: { not: null }, status: { in: ['CONFIRMED', 'PAID', 'BOARDED'] } },
          select: { id: true, liveActivityPushToken: true },
        },
      },
    });
    if (!trip || !trip.bookings.length) return;

    const resolvedStatus = status || trip.status;
    const contentState = {
      status: resolvedStatus,
      statusText: LIVE_ACTIVITY_STATUS_TEXT[resolvedStatus] || resolvedStatus,
      etaMinutes: etaMinutes ?? null,
      distanceKm: distanceKm ?? null,
      driverLat: driverLat ?? null,
      driverLng: driverLng ?? null,
      updatedAt: Date.now(),
    };

    await Promise.all(
      trip.bookings.map((b) => liveActivityPush.pushUpdate(b.liveActivityPushToken, contentState))
    );
  } catch (err) {
    logger.debug('[DriverSocket] Live Activity push update failed (non-blocking):', err?.message ?? err);
  }
}

// `endLiveActivityForTrip` lived here. Ending the activity is a consequence of
// reaching a terminal status, not of a socket message, so it now happens in
// services/trip-notify.service.js off the committed transition — which also
// means it fires for a trip cancelled by the rider or expired by the sweeper,
// neither of which ever reached this file.

// ── ETA throttle config ────────────────────────────────────────────────────────
const ETA_INTERVAL_MS = 10_000;   // minimum ms between ETA calculations per driver
const ETA_DISTANCE_M  = 50;       // also recalculate if driver moved > 50 m

// Per-driver ETA cache: driverId → { tripId, destLat, destLng, lastCalcAt, lastLat, lastLng }
const etaCache = new Map();

// ── Ride-check / route-deviation safety (Phase 3B) ───────────────────────────────
// Per-driver safety state.  Keyed by driverId, cleaned up on disconnect.
//   { tripId, lastLat, lastLng, lastSpeed, stoppedSince, lastCheckAt }
const safetyState = new Map();

// Thresholds (with env overrides for testing)
const DEVIATION_THRESHOLD_M = env.DEVIATION_THRESHOLD_M ?? 350;
const STOPPED_THRESHOLD_MS  = (env.STOPPED_THRESHOLD_SEC ?? 180) * 1000;
const SAFETY_CHECK_COOLDOWN_MS = (env.SAFETY_CHECK_COOLDOWN_SEC ?? 300) * 1000;

// Key used to flag that we already have a safety check pending for this trip.
const SAFETY_PENDING = new Set();

/**
 * ── Presence: how many live sockets a driver has, and a grace period ────────
 *
 * BUG THIS FIXES. `disconnect` flipped `isOnline: false` on the driver row the
 * instant a socket dropped. On a mobile network that happens constantly —
 * a tunnel, a lift, a cell handover, iOS suspending the app for eight seconds
 * while the driver reads a text — and `availableDriverWhere()` filters on
 * `isOnline: true`, so each of those blips silently removed the driver from
 * dispatch. Worse, nothing set it back: the reconnect handler joined rooms but
 * never restored the flag, so a driver whose socket bounced once was invisible
 * for the rest of the shift while their own app still said "You're online".
 *
 * Two sockets per driver is also normal here (the app opens one and the
 * background location task rides the same namespace), so the LAST disconnect
 * is the only one that means anything — hence a refcount rather than a boolean.
 *
 * The grace period is deliberately shorter than the supply index's 90s
 * presence TTL: this is about the durable `isOnline` flag, and the index
 * expires on its own.
 */
const OFFLINE_GRACE_MS = (env.DRIVER_OFFLINE_GRACE_SEC ?? 45) * 1000;
const liveSockets = new Map();      // driverId -> count
const pendingOffline = new Map();   // driverId -> timeout

/** Set when the SERVER took a driver offline for silence, not the driver. */
const PRESENCE_DROPPED_KEY = (driverId) => `driver:${driverId}:presence_dropped`;
/** How long a dropped driver may resume simply by pinging again. */
const PRESENCE_DROPPED_TTL_SEC = 30 * 60;

function markDriverConnected(driverId) {
  liveSockets.set(driverId, (liveSockets.get(driverId) ?? 0) + 1);
  const timer = pendingOffline.get(driverId);
  if (timer) {
    clearTimeout(timer);
    pendingOffline.delete(driverId);
    logger.debug(`[DriverSocket] ${driverId} reconnected inside the grace window — staying online`);
  }
}

function markDriverDisconnected(driverId) {
  const remaining = Math.max(0, (liveSockets.get(driverId) ?? 1) - 1);
  if (remaining > 0) {
    liveSockets.set(driverId, remaining);
    return;
  }
  liveSockets.delete(driverId);
  if (pendingOffline.has(driverId)) return;

  const timer = setTimeout(async () => {
    pendingOffline.delete(driverId);
    // Reconnected while we waited — nothing to do.
    if ((liveSockets.get(driverId) ?? 0) > 0) return;
    try {
      await prisma.driver.update({ where: { id: driverId }, data: { isOnline: false } });
      // Close the hours-tracking session too. Leaving it open was how a driver
      // whose app was killed accrued online hours overnight.
      await prisma.onlineSession.updateMany({
        where: { driverId, endTime: null },
        data: { endTime: new Date() },
      }).catch(() => {});
      await supply.removeDriver(driverId);
      await redis.zrem('drivers:online', driverId).catch(() => {});
      // Mark that WE took them offline, they didn't. Read by the location
      // handler to distinguish "lost the network for two minutes" (resume them
      // on their next ping) from "tapped the toggle" (leave them alone — being
      // resurrected by a stray background fix after deliberately going offline
      // is how a driver ends up getting offers at midnight).
      await redis.set(PRESENCE_DROPPED_KEY(driverId), '1', 'EX', PRESENCE_DROPPED_TTL_SEC).catch(() => {});
      logger.info(`[DriverSocket] ${driverId} offline after ${OFFLINE_GRACE_MS}ms with no socket`);
    } catch (err) {
      logger.warn(`Failed to set driver ${driverId} offline after grace: ${err.message}`);
    }
  }, OFFLINE_GRACE_MS);
  // Never let presence bookkeeping hold the process open on shutdown.
  if (typeof timer.unref === 'function') timer.unref();
  pendingOffline.set(driverId, timer);
}


module.exports = function registerDriverSocket(io, driverNamespace) {
  driverNamespace.on('connection', async (socket) => {
    const driverId = socket.userId;
    logger.info(`Driver connected: ${driverId}`);
    markDriverConnected(driverId);

    // Join driver-specific room
    socket.join(`driver:${driverId}`);

    // Auto-rejoin trip room if driver has an active trip (handles socket reconnects)
    try {
      const activeTrip = await prisma.trip.findFirst({
        where: {
          driverId: driverId,
          // Include SCHEDULED/FILLING — the boarding phase where chat is most used.
          // Without these, a reconnect during boarding left the driver out of the
          // trip room and dropped inbound chat messages.
          status: { in: ['SCHEDULED', 'FILLING', 'DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'IN_PROGRESS'] },
        },
        select: { id: true },
      });
      if (activeTrip) {
        const tripRoom = TRIP_ROOM(activeTrip.id);
        socket.join(tripRoom);
        logger.debug(`Driver ${driverId} auto-rejoined trip room ${activeTrip.id} on reconnect`);
        // BUGFIX: Skip chat history fetch on auto-rejoin to avoid duplicate messages.
        // The driver:join_tracking handler (fired separately on reconnect) already
        // fetches and sends chat history. Fetching here too causes duplicates.
        // Socket join alone is sufficient to receive new messages.
      }
    } catch (err) {
      logger.error('Failed to auto-rejoin trip room on driver reconnect:', err);
    }

    // ── Location update (fires every ~3s from app) ──────────
    socket.on('driver:location_update', async ({ lat, lng, heading = 0, speed = 0 }) => {
      if (!lat || !lng) return;

      // Per-socket throttle: max one location update per 2s
      const now = Date.now();
      if (socket._lastLocationUpdate && now - socket._lastLocationUpdate < 2000) return;
      socket._lastLocationUpdate = now;

      // Validate coordinates are in Ghana (controlled by GEO_VALIDATION_ENABLED env var).
      // BUGFIX: Previously used NODE_ENV !== 'development' which meant any staging/preview
      // env with NODE_ENV=development bypassed geofencing. Now uses dedicated env var.
      const geoValidationEnabled = env.GEO_VALIDATION_ENABLED !== 'false';
      if (geoValidationEnabled && !isWithinGhana(lat, lng)) {
        // Previously a silent drop — the driver never landed in the DB or the
        // drivers:online geo-set (so never appeared on the admin live map and
        // was never eligible for dispatch), with nothing in the server logs
        // to explain why. Log it and tell the client explicitly so this is
        // diagnosable instead of looking like dispatch is just "broken".
        logger.warn(`[DriverSocket] Rejected out-of-Ghana location for driver ${driverId}: ${lat}, ${lng}`);
        socket.emit('driver:location_rejected', {
          message: 'Location outside Ghana — you will not appear online or receive trip requests until GPS reports a location inside Ghana.',
          code: 'INVALID_LOCATION',
          lat, lng,
        });
        return;
      }

      // ── Where the live position actually lives ─────────────────────────
      // Redis is the hot store and is written on EVERY fix; Postgres is the
      // durable one and is written far less often. This used to be one row
      // UPDATE per driver per two seconds — a thousand drivers online is 500
      // writes a second against the same table that dispatch reads, for a
      // value that is stale before it commits. Dispatch reads the Redis geo-set
      // below, so the DB copy only has to be good enough for a cold read
      // (admin live map, a REST fetch, a driver who has just reconnected).
      const locationPayload = JSON.stringify({ lat, lng, heading, speed, timestamp: Date.now() });
      await redis.set(`driver:${driverId}:location`, locationPayload, 'EX', 3600).catch(() => {});

      const dbAge = now - (socket._lastLocationPersist || 0);
      const dbMoved = socket._lastPersistLat != null
        ? haversineMeters(lat, lng, socket._lastPersistLat, socket._lastPersistLng)
        : Infinity;
      if (dbAge >= DB_PERSIST_INTERVAL_MS || dbMoved >= DB_PERSIST_DISTANCE_M) {
        socket._lastLocationPersist = now;
        socket._lastPersistLat = lat;
        socket._lastPersistLng = lng;
        try {
          await prisma.driver.update({
            where: { id: driverId },
            data: { currentLat: lat, currentLng: lng, currentHeading: heading },
          });
        } catch (err) { logger.debug('[DriverSocket] Non-critical DB location update error:', err?.message ?? err); }
      }

      // Publish to Redis — all passenger sockets subscribed to this driver will receive it
      await redis.publish(LOCATION_UPDATE_CHANNEL(driverId), locationPayload);

      // Also publish to admin update channel for Live Map
      // Include driver metadata so admin knows who this is
      const adminPayload = JSON.stringify({
        driverId,
        lat, lng, heading, speed,
        timestamp: Date.now(),
      });
      await redis.publish('admin:driver_locations', adminPayload).catch(() => {});

      /**
       * ── The supply index — THE thing dispatch actually searches ──────────
       *
       * BUG THIS FIXES (severity: no ride ever gets a driver). `supply-index.
       * service.js` is what `matcher.service.js` queries for candidates, and
       * its presence key has a 90-SECOND TTL by design — a dead phone is meant
       * to fall out of the pool on its own rather than rely on a `goOffline`
       * that a force-quit app never sends. That design only works if something
       * refreshes it, and nothing did: the only two writers in the codebase
       * were `acceptRide` (which REMOVES the driver) and `completeTrip`. This
       * handler — the one thing that fires every few seconds for every online
       * driver — wrote to the legacy `drivers:online` set instead and never
       * touched the index at all.
       *
       * So every driver aged out of the dispatch pool 90 seconds after their
       * last completed trip and never returned, and a driver who had just come
       * online was never in it in the first place. The pool was, in the steady
       * state, empty.
       *
       * `upsertDriver` refreshes position AND presence in one pipeline, so
       * putting it on the ping is the whole fix.
       */
      await supply.upsertDriver(driverId, lat, lng);

      // Resume a driver the grace timer took offline while they were in a
      // tunnel or on a dead cell. Only ever fires when the flag above is set,
      // so a deliberate go-offline is never undone by a late ping.
      const wasDropped = await redis.get(PRESENCE_DROPPED_KEY(driverId)).catch(() => null);
      if (wasDropped) {
        await redis.del(PRESENCE_DROPPED_KEY(driverId)).catch(() => {});
        try {
          await prisma.driver.update({ where: { id: driverId }, data: { isOnline: true } });
          // A fresh session: the old one was closed when we gave up on them, so
          // reopening it would bill the dead time as worked hours.
          await prisma.onlineSession.create({ data: { driverId, startTime: new Date() } });
          logger.info(`[DriverSocket] ${driverId} resumed online after a presence drop`);
        } catch (err) {
          logger.warn(`Failed to resume driver ${driverId} after presence drop: ${err.message}`);
        }
      }

      // The legacy geo-set stays: the admin live map, the heatmap and the
      // redispatch broadcast still read `drivers:online` directly. It has no
      // presence TTL, which is exactly why it is not what dispatch searches.
      await redis.geoadd('drivers:online', lng, lat, driverId).catch(() => {});

      // ── Route + ETA (throttled) ──────────────────────────────────────────
      // One route, computed here, published to both apps. Neither client calls
      // Directions any more, so the rider and the driver are looking at the
      // same line for the same ride — see services/route-geometry.service.js.
      const cache = etaCache.get(driverId) || {};
      const msSinceLast = now - (cache.lastCalcAt || 0);
      const mSinceLast = cache.lastLat != null
        ? haversineMeters(lat, lng, cache.lastLat, cache.lastLng)
        : Infinity;

      if (msSinceLast < ETA_INTERVAL_MS && mSinceLast < ETA_DISTANCE_M) return;

      // The STATUS is re-read every pass, not cached. The status decides which
      // LEG the route is about (driver→pickup vs pickup→destination), and a
      // stale status routes to the wrong end of the ride — which is exactly the
      // old bug where "6 min away" during pickup was the time to the rider's
      // destination.
      let trip;
      try {
        trip = await prisma.trip.findFirst({
          where: {
            driverId,
            status: { in: ['SCHEDULED', 'FILLING', 'DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'IN_PROGRESS'] },
          },
          select: {
            id: true, status: true,
            pickupLat: true, pickupLng: true,
            dropoffLat: true, dropoffLng: true,
            route: { select: { destLat: true, destLng: true } },
          },
        });
      } catch (err) {
        logger.warn(`ETA: DB lookup failed for driver ${driverId}: ${err.message}`);
        return;
      }
      if (!trip) return;

      // On-demand rides used to fall out here: the old code read the
      // destination from `trip.route`, and an on-demand trip has no route, so
      // the rider's map never received a polyline at all for the product we
      // actually sell. The route service reads the Trip's own dropoff first.
      let route;
      try {
        route = await getRouteForTrip(trip, { lat, lng });
      } catch (err) {
        logger.warn(`ETA: route computation failed for driver ${driverId}: ${err.message}`);
        return;
      }
      if (!route) return;

      const tripId = trip.id;
      // Same builder the join handler uses — one shape, one set of numbers.
      const etaPayload = etaPayloadFor(tripId, route);

      io.of('/passenger').to(TRIP_ROOM(tripId)).emit('trip:eta', etaPayload);
      driverNamespace.to(TRIP_ROOM(tripId)).emit('trip:eta', etaPayload);

      // A separate, narrower event so a client can redraw the line without
      // having to treat every ETA tick as a geometry change. The driver app
      // listens to this for turn-by-turn re-routing.
      if (route.rerouted) {
        const reroutePayload = { tripId, leg: route.leg, geometry: route.geometry, distanceKm: route.distanceKm, durationMin: route.durationMin };
        io.of('/passenger').to(TRIP_ROOM(tripId)).emit('trip:route', reroutePayload);
        driverNamespace.to(TRIP_ROOM(tripId)).emit('trip:route', reroutePayload);
        logger.info('[route] re-routed', { tripId, leg: route.leg });
      }

      // Live Activity update — fire-and-forget, throttled by the same
      // ETA_INTERVAL_MS/ETA_DISTANCE_M gate above (~1 push per 10s or 50m),
      // well inside Apple's rate limits.
      pushLiveActivityUpdate(tripId, {
        etaMinutes: etaPayload.etaMinutes,
        distanceKm: etaPayload.distanceKm,
        driverLat: lat,
        driverLng: lng,
      });

      etaCache.set(driverId, { tripId, lastCalcAt: now, lastLat: lat, lastLng: lng });

      // ── Ride-check safety ────────────────────────────────────────────────
      // Only while the rider is actually in the car.
      if (trip.status === 'IN_PROGRESS') {
        try {
          const sState = safetyState.get(driverId)
            || { tripId, lastLat: lat, lastLng: lng, lastSpeed: speed, stoppedSince: null };

          // Deviation uses the SAME line the rider is looking at, measured by
          // the service that owns it. DEVIATION_THRESHOLD_M is much larger than
          // the re-route threshold on purpose: an alarming a rider is a far
          // heavier action than spending one Directions call.
          const distM = deviationMeters(route, lat, lng);
          if (Number.isFinite(distM) && distM > DEVIATION_THRESHOLD_M) {
            emitSafetyCheck(io, tripId, 'route_deviation');
          }

          const currentSpeed = speed || 0;
          const movedSignificantly = haversineMeters(lat, lng, sState.lastLat, sState.lastLng) > 10;
          if (currentSpeed < 1 && !movedSignificantly) {
            if (!sState.stoppedSince) {
              sState.stoppedSince = now;
            } else if (now - sState.stoppedSince >= STOPPED_THRESHOLD_MS) {
              emitSafetyCheck(io, tripId, 'stopped_too_long');
              sState.stoppedSince = now; // reset so repeated checks are spaced
            }
          } else {
            sState.stoppedSince = null;
          }

          sState.tripId = tripId;
          sState.lastLat = lat;
          sState.lastLng = lng;
          sState.lastSpeed = currentSpeed;
          safetyState.set(driverId, sState);
        } catch (err) {
          logger.debug('[DriverSocket] Non-blocking safety check error:', err?.message ?? err);
        }
      }
    });

/** Emit a safety check to the passenger namespace, debounced per trip. */
function emitSafetyCheck(io, tripId, reason) {
  if (SAFETY_PENDING.has(tripId)) return; // debounce — one active check per trip
  SAFETY_PENDING.add(tripId);

  io.of('/passenger').to(TRIP_ROOM(tripId)).emit('safety:check', {
    tripId,
    reason,
    timestamp: Date.now(),
  });

  // Auto-clear after cooldown so repeated checks can fire if driver stays off-route.
  setTimeout(() => SAFETY_PENDING.delete(tripId), SAFETY_CHECK_COOLDOWN_MS);
}

    // ── Join trip room (for tracking screen socket reconnections) ──
    socket.on('driver:join_tracking', async ({ tripId }) => {
      if (tripId) {
        // ISOLATION FIX: this had no ownership check at all, unlike its sibling
        // driver:trip_started handler. Any authenticated driver socket could
        // emit an arbitrary tripId and (a) join that trip's room, receiving the
        // rider's live location and every status change for a ride they have
        // nothing to do with, and (b) be handed 100 messages of that trip's
        // chat history, private threads included, since `isPrivate: false`
        // matches every public message on ANY trip. The passenger side already
        // gated its equivalent join on having a booking; this is the same rule
        // for the driver side.
        try {
          const owns = await prisma.trip.findFirst({
            where: { id: tripId, driverId },
            select: { id: true },
          });
          if (!owns) {
            logger.warn(`driver:join_tracking rejected — driver ${driverId} does not own trip ${tripId}`);
            socket.emit('error', { message: 'Not authorized for this trip room', code: 'FORBIDDEN' });
            return;
          }
        } catch (err) {
          logger.error('Failed to verify trip ownership for driver:join_tracking:', err);
          socket.emit('error', { message: 'Server authorization error', code: 'INTERNAL_ERROR' });
          return;
        }

        socket.join(TRIP_ROOM(tripId));
        logger.debug(`Driver ${driverId} joined tracking room ${tripId}`);

        // THE LINE AND THE ETA, NOW — NOT ON THE NEXT GPS PING.
        //
        // DriverTripMap's own comment says "the server publishes the leg's
        // geometry on join", and it did not. Joining only entered the room and
        // sent chat history, so the first `trip:eta` a driver could receive was
        // whatever the location handler produced NEXT — and that handler is
        // throttled on time AND distance moved. A driver who has just swiped to
        // start and is still sitting at the kerb satisfies neither gate, so the
        // screen sat on "Calculating ETA..." with an empty map for as long as
        // they stayed put. Reported verbatim as "stuck at calculating eta and
        // no polyline is shown".
        //
        // The rider never saw this because rider snapshots carry `path` from
        // the same cache — which is also why the two apps disagreed about the
        // ETA. They now read the identical route object.
        emitRouteSnapshotTo(socket, tripId).catch((err) =>
          logger.warn(`join_tracking route emit failed for ${tripId}: ${err.message}`),
        );

        // Send chat history so the driver sees past messages
        // Includes all public messages + private threads involving this driver
        try {
          const history = await prisma.message.findMany({
            where: {
              tripId,
              OR: [
                { isPrivate: false },
                { senderId: driverId },
                { recipientId: driverId },
              ],
            },
            orderBy: { createdAt: 'asc' },
            take: 100,
          });
          socket.emit('chat:history', history.map(h => ({
            senderId: h.senderId,
            senderName: h.senderName,
            senderRole: h.senderRole,
            seatNumber: h.seatNumber,
            text: h.text,
            isPrivate: h.isPrivate ?? false,
            recipientId: h.recipientId,
            timestamp: h.timestamp.toISOString(),
          })));
        } catch (err) {
          logger.error('Failed to fetch chat history for driver:', err);
        }
      }
    });

    // ── Trip events ─────────────────────────────────────────

    /**
     * Which DB statuses may legally precede each socket-announced status.
     * Mirrors TRIP_TRANSITIONS in drivers.service.js — the REST layer runs every
     * transition through `assertTransition`, but these socket handlers used to
     * check ownership ONLY and then broadcast whatever status their event name
     * implied. So a stale, duplicated or out-of-order emit from a driver client
     * could announce any status for a trip regardless of what the trip actually
     * was, and `driver:arrived` went further and *completed* the trip outright.
     * That is how a rider mid-ride could be shown "you have arrived, rate your
     * trip" while the driver was still driving.
     */
    const SOCKET_STATUS_PRECONDITIONS = {
      DRIVER_EN_ROUTE:   ['CONFIRMED', 'SCHEDULED', 'FILLING', 'DRIVER_EN_ROUTE'],
      ARRIVED_AT_PICKUP: ['DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP'],
      IN_PROGRESS:       ['ARRIVED_AT_PICKUP', 'IN_PROGRESS'],
      COMPLETED:         ['IN_PROGRESS', 'COMPLETED'],
    };

    /**
     * Verifies the emitting driver owns `tripId` AND that the trip is in a state
     * from which `nextStatus` is reachable. Returns the trip row on success,
     * null when the event must be dropped.
     *
     * Announcing a status the trip cannot be in is worse than dropping the
     * event: the rider's UI acts on these immediately (banners, Live Activity,
     * and for COMPLETED a forced navigation into the rating flow), so a bogus
     * announcement is not recoverable from the rider's side.
     */
    async function authorizeStatusEvent(event, tripId, nextStatus) {
      if (!tripId) return null;
      let trip;
      try {
        trip = await prisma.trip.findFirst({
          where: { id: tripId, driverId },
          select: { id: true, status: true },
        });
      } catch (err) {
        logger.error(`Failed to verify trip for ${event}:`, err);
        return null;
      }
      if (!trip) {
        logger.warn(`${event} rejected — driver ${driverId} does not own trip ${tripId}`);
        return null;
      }
      const allowed = SOCKET_STATUS_PRECONDITIONS[nextStatus] ?? [];
      if (!allowed.includes(trip.status)) {
        logger.warn(
          `${event} rejected — trip ${tripId} is ${trip.status}, cannot announce ${nextStatus}`,
        );
        return null;
      }
      return trip;
    }

    /**
     * ── The three "announce" handlers below are now room joins ──────────────
     *
     * They existed because the CLIENT told the server what had just happened,
     * and the server relayed it: `trip:status_change`, a GraphQL publish and a
     * Live Activity push, all triggered by a socket emit the driver app fired
     * immediately after the REST call that actually performed the transition.
     *
     * That is the anti-pattern the rewire exists to remove. The transition is
     * already committed and versioned by the time this arrives, and
     * `publishCommitted` now fans out `trip:event` AND — via
     * services/trip-notify.service.js — the push, the Live Activity and the
     * GraphQL publish. Doing it again here is at best a duplicate buzz on the
     * rider's phone and at worst a contradiction: nothing stopped a client
     * announcing a status the transition had not actually reached.
     *
     * Kept as no-ops (rather than deleted) so builds already in the field keep
     * working, and because `trip_started` genuinely does need the room join.
     */
    socket.on('driver:trip_started', async ({ tripId }) => {
      if (!(await authorizeStatusEvent('driver:trip_started', tripId, 'DRIVER_EN_ROUTE'))) return;
      socket.join(TRIP_ROOM(tripId));
    });

    // Driver arrived at the PICKUP stop — distinct from 'driver:arrived' below,
    // which actually means arrived at the FINAL DESTINATION and completes the
    // whole trip. This transition (DRIVER_EN_ROUTE -> ARRIVED_AT_PICKUP) never
    // had a socket emit at all: arriveAtPickup() only updated the DB status and
    // sent an FCM push, so a rider actively on the tracking screen got no
    // real-time signal that the driver had arrived — the next thing they'd see
    // was the driver's SUBSEQUENT "depart" transition, which looked like the
    // trip had jumped straight from "en route" to "in progress" with the
    // arrival silently skipped.
    socket.on('driver:arrived_at_pickup', async ({ tripId }) => {
      if (!(await authorizeStatusEvent('driver:arrived_at_pickup', tripId, 'ARRIVED_AT_PICKUP'))) return;
      socket.join(TRIP_ROOM(tripId));
    });

    socket.on('driver:trip_departed', async ({ tripId }) => {
      if (!(await authorizeStatusEvent('driver:trip_departed', tripId, 'IN_PROGRESS'))) return;
      socket.join(TRIP_ROOM(tripId));
    });

    socket.on('driver:arrived', async ({ tripId }) => {
      // THE guard that matters most on this socket. Ownership alone (all this
      // used to check) let a trip be completed from ANY state — including one the
      // driver had not yet driven. `arrived` here means "arrived at the final
      // destination", so it is only legal from IN_PROGRESS; a driver who has just
      // tapped "I've arrived" at the PICKUP is in ARRIVED_AT_PICKUP and this
      // event must be dropped rather than ending their passenger's ride.
      if (!(await authorizeStatusEvent('driver:arrived', tripId, 'COMPLETED'))) return;

      // Persist trip + booking completion in DB so rider Past tab and trip count update
      try {
        await completeTrip(tripId);
      } catch (err) {
        // The COMPLETED emit below still goes out (riders shouldn't hang on a
        // finished trip), so a lost DB write would leave the trip active in the
        // DB with earnings never credited. completeTrip is idempotent
        // (alreadyCompleted early-return), so one delayed retry is safe.
        logger.error('Failed to complete trip in DB — retrying once in 5s:', err);
        setTimeout(() => {
          completeTrip(tripId).catch((err2) =>
            logger.error('Retry completeTrip also failed — needs manual reconciliation:', err2),
          );
        }, 5000);
      }

      // Clear ETA + route caches — trip is over, and a stale cached leg would
      // otherwise be served to the next client that asks for this trip.
      etaCache.delete(driverId);
      safetyState.delete(driverId);
      clearRouteForTrip(tripId).catch(() => {});

      // No status announcement and no Live Activity end here: completing the
      // trip above transitions it, and `publishCommitted` → trip-notify owns
      // both. This handler survives only as the safety net its retry ladder
      // describes — an old client that emitted this without the REST call.
    });

    // ── Typing indicators ────────────────────────────────────
    socket.on('chat:typing_start', ({ tripId }) => {
      if (!tripId) return;
      io.of('/passenger').to(TRIP_ROOM(tripId)).emit('chat:typing', {
        senderId: driverId,
        senderName: 'Driver',
        senderRole: 'DRIVER',
        isTyping: true,
      });
    });

    socket.on('chat:typing_stop', ({ tripId }) => {
      if (!tripId) return;
      io.of('/passenger').to(TRIP_ROOM(tripId)).emit('chat:typing', {
        senderId: driverId,
        senderRole: 'DRIVER',
        isTyping: false,
      });
    });

    // ── Chat messages (global broadcast to trip room) ─────────
    // BUGFIX: Server-side chat input sanitization — enforce length limit and trim.
    // Strips only HTML tags (not angle brackets in content like "2 < 3 km").
    const MAX_CHAT_LENGTH = 500;
    function sanitizeChatText(raw) {
      if (typeof raw !== 'string') return '';
      return raw.trim().replace(/<[^>]*>/g, '').slice(0, MAX_CHAT_LENGTH);
    }

    socket.on('chat:send', async ({ tripId, text, timestamp }) => {
      if (!tripId || !text) return;
      text = sanitizeChatText(text);
      if (!text) return;

      // Security: verify this driver is actually assigned to this trip
      try {
        const trip = await prisma.trip.findUnique({
          where: { id: tripId },
          select: { driverId: true },
        });
        if (!trip || trip.driverId !== driverId) {
          logger.warn(`Unauthorized chat attempt: Driver ${driverId} not assigned to trip ${tripId}`);
          socket.emit('error', { message: 'Unauthorized chat access', code: 'UNAUTHORIZED' });
          return;
        }
      } catch (err) {
        logger.error('Failed to authorize driver chat send:', err);
        return;
      }

      let senderName = '';
      try {
        const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { name: true } });
        if (driver) senderName = driver.name;

        await prisma.message.create({
          data: {
            tripId,
            senderId: driverId,
            senderName,
            senderRole: 'DRIVER',
            isPrivate: false,
            text,
            timestamp: timestamp ? new Date(timestamp) : new Date(),
          },
        });
      } catch (err) {
        logger.error('Failed to persist driver chat message:', err);
      }

      const messagePayload = {
        senderId: driverId,
        senderName,
        senderRole: 'DRIVER',
        text,
        isPrivate: false,
        timestamp: timestamp || new Date().toISOString(),
      };

      // Direct echo to sender — guarantees the driver sees their own message even
      // if their socket hasn't (re)joined the trip room yet (symmetry with the
      // passenger chat:send handler).
      socket.emit('chat:message', messagePayload);

      driverNamespace.to(TRIP_ROOM(tripId)).emit('chat:message', messagePayload);
      io.of('/passenger').to(TRIP_ROOM(tripId)).emit('chat:message', messagePayload);

      // Push notification to passengers who may be in the background
      try {
        const bookings = await prisma.booking.findMany({
          where: { tripId, status: { in: ['CONFIRMED', 'SEAT_HELD', 'BOARDED', 'PAID'] } },
          select: { user: { select: { fcmToken: true } } },
        });
        const tokens = bookings.map(b => b.user?.fcmToken).filter(Boolean);
        if (tokens.length > 0) {
          sendMulticastPush(tokens, `💬 ${senderName}`, text.length > 80 ? text.slice(0, 77) + '…' : text, { type: 'CHAT_MESSAGE', tripId });
        }
      } catch (err) {
        logger.warn('Failed to send chat push to passengers:', err.message);
      }
    });

    // ── Private chat (driver → specific rider) ─────────────────
    socket.on('chat:private_send', async ({ tripId, text, recipientId, timestamp }) => {
      if (!tripId || !text || !recipientId) return;
      text = sanitizeChatText(text);
      if (!text) return;

      // Security: verify this driver is assigned to the trip AND the recipient has a booking
      try {
        const trip = await prisma.trip.findUnique({
          where: { id: tripId },
          select: { driverId: true },
        });
        if (!trip || trip.driverId !== driverId) {
          logger.warn(`Unauthorized private chat attempt: Driver ${driverId} not assigned to trip ${tripId}`);
          socket.emit('error', { message: 'Unauthorized chat access', code: 'UNAUTHORIZED' });
          return;
        }
        const recipientBooking = await prisma.booking.findFirst({
          where: { tripId, userId: recipientId, ...seatOccupyingWhere() },
          select: { id: true },
        });
        if (!recipientBooking) {
          logger.warn(`Unauthorized private chat: Driver ${driverId} tried messaging non-passenger ${recipientId}`);
          socket.emit('error', { message: 'Recipient not found on this trip', code: 'RECIPIENT_NOT_FOUND' });
          return;
        }
      } catch (err) {
        logger.error('Failed to authorize driver private chat:', err);
        return;
      }

      let senderName = '';
      try {
        const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { name: true } });
        if (driver) senderName = driver.name;

        await prisma.message.create({
          data: {
            tripId,
            senderId: driverId,
            senderName,
            senderRole: 'DRIVER',
            isPrivate: true,
            recipientId,
            text,
            timestamp: timestamp ? new Date(timestamp) : new Date(),
          },
        });
      } catch (err) {
        logger.error('Failed to persist private chat message:', err);
      }

      const messagePayload = {
        senderId: driverId,
        senderName,
        senderRole: 'DRIVER',
        text,
        isPrivate: true,
        recipientId,
        timestamp: timestamp || new Date().toISOString(),
      };

      // Deliver only to the specific rider + echo back to driver
      io.of('/passenger').to(`user:${recipientId}`).emit('chat:private_message', messagePayload);
      socket.emit('chat:private_message', messagePayload);

      // Push notification to that rider only
      try {
        const booking = await prisma.booking.findFirst({
          where: { tripId, userId: recipientId },
          select: { user: { select: { fcmToken: true } } },
        });
        if (booking?.user?.fcmToken) {
          await sendPush(booking.user.fcmToken, `💬 ${senderName}`, text.length > 80 ? text.slice(0, 77) + '…' : text, { type: 'PRIVATE_CHAT', tripId });
        }
      } catch (err) {
        logger.warn('Failed to send private chat push:', err.message);
      }
    });

    // ── Read receipts ────────────────────────────────────────────
    socket.on('chat:read', async ({ tripId, messageIds }) => {
      if (!tripId || !messageIds || !Array.isArray(messageIds) || messageIds.length === 0) return;

      try {
        // BUGFIX: Removed redundant prisma require — already imported at top of module

        // Mark all specified messages as read (only if they're not already read)
        await prisma.message.updateMany({
          where: {
            id: { in: messageIds },
            tripId,
            senderId: { not: driverId },  // only mark messages FROM OTHERS as read
            readAt: null,
          },
          data: { readAt: new Date() },
        });

        // Find the senders of these messages to notify them
        const updatedMessages = await prisma.message.findMany({
          where: { id: { in: messageIds }, tripId, readAt: { not: null } },
          select: { id: true, senderId: true },
        });

        // Emit read receipt back to the reader (for UI update)
        socket.emit('chat:read_receipt', { tripId, messageIds: updatedMessages.map(m => m.id), readBy: driverId });

        // Group by sender and notify each sender
        const senderGroups = new Map();
        for (const msg of updatedMessages) {
          if (!senderGroups.has(msg.senderId)) senderGroups.set(msg.senderId, []);
          senderGroups.get(msg.senderId).push(msg.id);
        }

        for (const [senderId, ids] of senderGroups) {
          io.of('/driver').to(`driver:${senderId}`).emit('chat:read_receipt', {
            tripId,
            messageIds: ids,
            readBy: driverId,
          });
          io.of('/passenger').to(`user:${senderId}`).emit('chat:read_receipt', {
            tripId,
            messageIds: ids,
            readBy: driverId,
          });
        }
      } catch (err) {
        logger.error('Failed to process read receipt:', err);
      }
    });

    socket.on('driver:seat_updated', async ({ tripId, seatData }) => {
      io.of('/passenger').to(TRIP_ROOM(tripId)).emit('trip:seat_update', {
        tripId,
        seatData,
      });
    });

    socket.on('disconnect', async () => {
      logger.info(`Driver disconnected: ${driverId}`);
      etaCache.delete(driverId);
      safetyState.delete(driverId); // clean up safety check state
      // Going offline is now deferred and refcounted — see markDriverDisconnected.
      markDriverDisconnected(driverId);
    });

    socket.on('error', (err) => logger.error(`Driver socket error ${driverId}:`, err));
  });
};
