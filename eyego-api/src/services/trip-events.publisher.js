'use strict';

const logger = require('../utils/logger');
const { buildTripSnapshot, TRIP_INCLUDE } = require('./trip-view');
const prisma = require('../config/database');

/**
 * The one realtime envelope.
 *
 * WHAT THIS REPLACES. About twenty independent, fire-and-forget socket events
 * (`trip:status_update`, `trip:assigned`, `dispatch:progress`,
 * `dispatch:matched`, `trip_request:accepted`, `seat:update`, …) each with its
 * own payload shape and its own client handler. Four of them were different
 * ways to learn overlapping facts. None carried a sequence number, so a client
 * that was backgrounded, on a dead network, or reconnecting missed messages
 * **and could not tell that it had**. It only relearned the truth if some other
 * screen happened to refetch.
 *
 * THE REPLACEMENT. One event, `trip:event`, carrying:
 *
 *   seq       strictly increasing per trip, gap-free, == Trip.version.
 *             A client that receives seq > lastSeq + 1 knows it missed
 *             something and calls the replay endpoint.
 *   snapshot  the COMPLETE ride state after this event. One message is
 *             sufficient truth; no follow-up fetch, no partial application.
 *   serverNowMs  every countdown renders against server time, so a device
 *             with a skewed clock cannot show a different timer.
 *   ttlMs / priority / dedupeKey
 *             RAMEN's delivery hints: stale messages are dropped rather than
 *             applied late, and only the newest of a repeating type is kept.
 *
 * Delivery is at-least-once and the client is expected to be idempotent —
 * which it can be, because applying an event is just "if seq > mine, replace".
 */

let io = null;

/** Wired once from sockets/index.js after the server is constructed. */
function setIo(server) {
  io = server;
}

/** Status changes a user must not miss vs. background chatter. */
const HIGH_PRIORITY_TYPES = new Set([
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVED',
  'ARRIVED_AT_PICKUP',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_DRIVERS_FOUND',
  'EXPIRED',
  'NO_SHOW',
  'REASSIGNING',
  'OFFER',
]);

/**
 * How long a message is still worth applying. A "driver is 2 minutes away"
 * delivered eleven minutes late is worse than not delivered: the old channel
 * had no way to express that, so late messages were applied as if fresh.
 */
function ttlFor(type) {
  if (type === 'DRIVER_LOCATION') return 15_000;
  if (type === 'DISPATCH_PROGRESS') return 30_000;
  if (HIGH_PRIORITY_TYPES.has(type)) return 15 * 60_000;
  return 60_000;
}

/**
 * Repeating types where only the newest matters — a client that wakes with
 * four queued progress updates should apply one, not animate through four.
 */
function dedupeKeyFor(tripId, type) {
  if (type === 'DRIVER_LOCATION' || type === 'DISPATCH_PROGRESS' || type === 'ETA') {
    return `${tripId}:${type}`;
  }
  return null; // status transitions are all distinct facts; never collapse them
}

function buildEnvelope(trip, event, snapshot) {
  return {
    tripId: trip.id,
    seq: event.seq,
    version: trip.version,
    type: event.type,
    actor: event.actor,
    status: trip.status,
    payload: event.payload ?? {},
    snapshot,
    serverNowMs: Date.now(),
    ttlMs: ttlFor(event.type),
    priority: HIGH_PRIORITY_TYPES.has(event.type) ? 'HIGH' : 'NORMAL',
    dedupeKey: dedupeKeyFor(trip.id, event.type),
  };
}

/**
 * Fan a committed trip event out to everyone entitled to see it.
 *
 * Called ONLY after the transaction that produced the event has committed —
 * an emit for a transaction that then rolls back is a lie the clients cannot
 * un-hear. Failures here are logged, never thrown: the database is the source
 * of truth and the client's next reconnect replays from `seq`.
 */
function publish(trip, event, snapshotOverride = null) {
  if (!io) {
    logger.warn('trip:event dropped — socket server not wired yet');
    return;
  }
  try {
    // The driver must not see the rider's payment fields and vice versa, so
    // each side gets its own serialization of the same row.
    const riderView =
      snapshotOverride ?? buildTripSnapshot(trip, { forUserId: trip.requesterId ?? null });
    const driverView = snapshotOverride ?? buildTripSnapshot(trip, {});

    const riderEnvelope = buildEnvelope(trip, event, riderView);
    const driverEnvelope = buildEnvelope(trip, event, driverView);

    const room = `trip:${trip.id}`;
    io.of('/passenger').to(room).emit('trip:event', riderEnvelope);
    io.of('/driver').to(room).emit('trip:event', driverEnvelope);

    // Personal rooms so an app that is open but not on the trip screen — or
    // has not joined the trip room yet, which is exactly the moment a driver
    // is assigned — still gets it.
    if (trip.requesterId) {
      io.of('/passenger').to(`user:${trip.requesterId}`).emit('trip:event', riderEnvelope);
    }
    if (trip.driverId) {
      io.of('/driver').to(`driver:${trip.driverId}`).emit('trip:event', driverEnvelope);
    }
  } catch (err) {
    logger.warn(`publish(trip:event) failed for ${trip?.id}: ${err.message}`);
  }
}

/**
 * Publish by id when the caller does not already hold a fully-included trip.
 * Prefer `publish()` with the row you already have — this costs a query.
 */
async function publishById(tripId, event) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, include: TRIP_INCLUDE });
  if (trip) publish(trip, event);
}

/**
 * A non-persisted push aimed at ONE driver — a dispatch offer.
 *
 * Offers are not trip lifecycle: three drivers may be offered the same trip in
 * sequence and only one becomes a transition. They still ride the same
 * envelope so the client has exactly one handler and one staleness rule.
 */
/**
 * A seat changed hands. Tell both sides, and tell them ENOUGH.
 *
 * THE LATENCY BUG THIS FIXES. Three call sites each emitted `trip:seat_update`
 * carrying `{ tripId, seatData }` — a seat map, which is exactly what the
 * RIDER's seat picker renders. The DRIVER's trip screen does not read a seat
 * map: it derives its passenger list from `trip.bookings` (see the `seats`
 * memo in the driver's active-trip screen). So the frame arrived with nothing
 * the driver screen could use, and the only thing the client could do with it
 * was `invalidateQueries` — throw the push away and pull the whole trip back
 * over HTTP.
 *
 * Against this database that refetch is not free. A trip fetch with its
 * relations is several round trips at ~280 ms each, behind a 500 ms debounce,
 * which is the "the driver side takes a very hot minute before it shows the
 * seat was booked" report almost exactly.
 *
 * So the event now carries the booking rows too. The driver writes them
 * straight into its cache and the refetch stops being on the critical path —
 * the same push, carrying the data it should have carried all along.
 */
async function publishSeatUpdate(tripId) {
  if (!io || !tripId) return;
  try {
    const prisma = require('../config/database');
    const tripsService = require('../modules/trips/trips.service');
    const [seatMap, trip] = await Promise.all([
      tripsService.getSeatMap(tripId),
      prisma.trip.findUnique({
        where: { id: tripId },
        select: {
          driverId: true,
          maxSeats: true,
          confirmedSeats: true,
          bookings: {
            where: { status: { notIn: ['CANCELLED', 'REFUNDED', 'EXPIRED'] } },
            select: {
              id: true, seatNumber: true, status: true, paymentStatus: true,
              fareAmountPesewas: true, commissionAmountPesewas: true,
              guestName: true, isOffline: true, seatHeldUntil: true,
              user: { select: { id: true, name: true } },
            },
            orderBy: { seatNumber: 'asc' },
          },
        },
      }),
    ]);
    if (!trip) return;

    const payload = {
      tripId,
      // Unchanged, for the rider's seat picker.
      seatData: seatMap.seats,
      // New, for the driver's passenger list — the same shape the trip endpoint
      // returns, so the client can write it into the existing cache as-is.
      bookings: trip.bookings,
      maxSeats: trip.maxSeats,
      confirmedSeats: trip.confirmedSeats,
    };

    io.of('/passenger').to(`trip:${tripId}`).emit('trip:seat_update', payload);
    if (trip.driverId) {
      io.of('/driver').to(`driver:${trip.driverId}`).emit('trip:seat_update', payload);
      io.of('/driver').to(`trip:${tripId}`).emit('trip:seat_update', payload);
    }
  } catch (err) {
    // A seat map that failed to broadcast must never fail the booking that
    // caused it — the client's own refetch is still there as a backstop.
    logger.warn(`publishSeatUpdate(${tripId}) failed: ${err.message}`);
  }
}

/**
 * How many live driver sockets are sitting in a driver's personal room.
 *
 * Exported because the count is the single most useful fact about a dispatch
 * that "did not arrive", and until now it existed only as a log line on the
 * server. `offerNext` puts it on the DISPATCH_PROGRESS event so the admin
 * dispatch board can say "offered to driver X, delivered to 0 sockets" instead
 * of leaving an operator to guess between a broken cascade and a phone that was
 * never connected. Resolves 0 rather than throwing — an unknown count and a
 * count of zero lead to the same conclusion here.
 */
async function countDriverSockets(driverId) {
  if (!io) return 0;
  try {
    const sockets = await io.of('/driver').in(`driver:${driverId}`).fetchSockets();
    return sockets.length;
  } catch {
    return 0;
  }
}

function publishOfferToDriver(driverId, payload) {
  if (!io) {
    // Worth an error, not a shrug: an offer published before the socket server
    // is wired is an offer no driver can ever receive, and the cascade will
    // still burn its offer window waiting for an answer.
    logger.error(`OFFER for driver ${driverId} dropped — socket server not wired yet`);
    return;
  }
  const room = `driver:${driverId}`;

  /**
   * DID IT LAND ANYWHERE?
   *
   * An offer is a fire-and-forget frame into a room, and the two historical
   * failures on this hop — the driver socket never dialling out, and the room
   * being joined under a different id — are both invisible from the server side
   * unless someone counts the sockets in the room. `fetchSockets()` goes through
   * the Redis adapter, so the count spans every API instance rather than just
   * this one. Async and detached: the emit below must not wait on it.
   */
  countDriverSockets(driverId)
    .then((count) => {
      if (count === 0) {
        logger.warn(
          `OFFER for trip ${payload.tripId} published to an EMPTY room ${room} — ` +
            'the driver app is not connected to /driver. Only the FCM push and the ' +
            'driver-state REST hydrate can deliver this offer.',
        );
      } else {
        logger.info(`OFFER delivered to ${count} socket(s) in ${room}`, {
          tripId: payload.tripId,
        });
      }
    })
    .catch((err) => logger.debug(`offer room probe failed for ${room}: ${err.message}`));

  io.of('/driver')
    .to(room)
    .emit('trip:event', {
      tripId: payload.tripId,
      seq: null, // not a lifecycle fact; carries no trip sequence
      version: null,
      type: 'OFFER',
      actor: 'SYSTEM',
      status: null,
      payload,
      snapshot: null,
      serverNowMs: Date.now(),
      // Slightly longer than the offer itself so a late arrival is visibly
      // expired rather than silently applied as live.
      ttlMs: (payload.expiresInSeconds ?? 20) * 1000 + 2000,
      priority: 'HIGH',
      dedupeKey: `offer:${driverId}`,
    });
}

/**
 * Push a freshly-computed leg to everyone watching the trip, right now.
 *
 * BUGFIX ("after the driver swipes to start, the rider's page sits on
 * Calculating ETA for ages").
 *
 * `warmRouteForTrip` already ran on every transition — it COMPUTED and CACHED
 * the new leg — but computing is not telling. Nothing emitted the result, and
 * the two channels that could have carried it both decline to:
 *
 *   - `publish()` above builds its snapshot with `buildTripSnapshot`, the
 *     synchronous variant, which has no `path`. So the `trip:event` announcing
 *     the transition arrives with `path: null`.
 *   - the location handler in driver.socket.js is throttled on BOTH time
 *     (~10 s) and distance moved (~50 m), and a driver who has just swiped to
 *     start is by definition stationary at the kerb, so it satisfies neither
 *     gate and does not fire.
 *
 * Meanwhile the clients correctly DISCARD what they were holding, because the
 * live leg just changed and a `toDropoff` line is not an answer to "where is my
 * driver". So both apps blanked their ETA and their polyline and then waited for
 * a message that only the driver pulling into traffic would trigger.
 *
 * A transition is exactly when the answer changes, so it is exactly when it must
 * be sent. Best-effort and never thrown: a trip whose line could not be drawn is
 * still a started trip.
 *
 * NOT a notification. This carries no push, no Live Activity and no GraphQL
 * publish — trip-notify.service.js remains the sole owner of all three. It is
 * the same geometry event the location handler already emits, from the one other
 * moment it is known to be stale.
 */
function publishRouteForTrip(tripId, route) {
  if (!io || !route || !route.geometry) return;
  try {
    const { etaPayloadFor, routePayloadFor } = require('./route-geometry.service');
    const etaPayload = etaPayloadFor(tripId, route);
    const routePayload = routePayloadFor(tripId, route);
    const room = `trip:${tripId}`;
    for (const ns of ['/passenger', '/driver']) {
      io.of(ns).to(room).emit('trip:eta', etaPayload);
      io.of(ns).to(room).emit('trip:route', routePayload);
    }
  } catch (err) {
    logger.warn(`publishRouteForTrip failed for ${tripId}: ${err.message}`);
  }
}

/** Tell a driver an offer is no longer theirs (taken, cancelled, timed out). */
function publishOfferRevoked(driverId, tripId, reason) {
  if (!io) return;
  io.of('/driver')
    .to(`driver:${driverId}`)
    .emit('trip:event', {
      tripId,
      seq: null,
      version: null,
      type: 'OFFER_REVOKED',
      actor: 'SYSTEM',
      status: null,
      payload: { tripId, reason },
      snapshot: null,
      serverNowMs: Date.now(),
      ttlMs: 30_000,
      priority: 'HIGH',
      dedupeKey: `offer:${driverId}`,
    });
}

module.exports = {
  setIo,
  publish,
  publishById,
  publishRouteForTrip,
  publishOfferToDriver,
  publishOfferRevoked,
  publishSeatUpdate,
  countDriverSockets,
  buildEnvelope,
};
