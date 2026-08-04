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
function publishOfferToDriver(driverId, payload) {
  if (!io) return;
  io.of('/driver')
    .to(`driver:${driverId}`)
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
  publishOfferToDriver,
  publishOfferRevoked,
  buildEnvelope,
};
