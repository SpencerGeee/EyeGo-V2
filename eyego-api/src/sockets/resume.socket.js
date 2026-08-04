'use strict';

const prisma = require('../config/database');
const logger = require('../utils/logger');
const tripState = require('../services/trip-state.service');
const { buildTripSnapshotWithPath, TRIP_INCLUDE } = require('../services/trip-view');
const publisher = require('../services/trip-events.publisher');

/**
 * Resume / replay — the half of the realtime channel that was missing.
 *
 * THE PROBLEM. Every socket event this app sent was fire-and-forget with no
 * sequence number. A client that was backgrounded, on a dead network, or
 * reconnecting missed messages **and had no way to detect that it had**. It
 * only relearned the truth if some unrelated screen happened to refetch — so
 * "the driver arrived but my app still says en route" was not a bug in any one
 * handler, it was the transport having no notion of a gap.
 *
 * THE PROTOCOL (Uber's RAMEN, which is published and directly copyable):
 *
 *   1. On connect the client sends `trip:subscribe { tripId, lastSeq }`.
 *   2. The server joins it to the trip room and immediately replays every
 *      TripEvent with `seq > lastSeq`, then sends the current snapshot.
 *   3. **Reconnecting with a lastSeq IS the acknowledgement.** There is no
 *      separate ack round-trip for the common case; the client telling us
 *      where it got to is what lets us forget everything below that.
 *   4. `trip:ack { tripId, seq }` exists for long-lived connections that never
 *      reconnect, so the server still learns the high-water mark periodically.
 *
 * Because every event carries the COMPLETE snapshot, a client that missed
 * fifty events and replays only the last one is still correct. Replay is an
 * optimisation for animation continuity, not a correctness requirement — which
 * is what makes at-least-once delivery safe here.
 */

/** Cap on a single replay. Beyond this the snapshot alone is the truth. */
const MAX_REPLAY = 100;

function registerResumeProtocol(namespace, role) {
  namespace.on('connection', (socket) => {
    const viewerId = role === 'DRIVER' ? socket.driverId : socket.userId;

    /**
     * Subscribe to a trip and catch up.
     * Idempotent: calling it again after a reconnect is the normal path.
     */
    socket.on('trip:subscribe', async (payload = {}, callback) => {
      const tripId = payload.tripId;
      const lastSeq = Number.isFinite(payload.lastSeq) ? payload.lastSeq : 0;
      if (!tripId) {
        if (typeof callback === 'function') callback({ error: 'tripId required' });
        return;
      }

      try {
        const trip = await prisma.trip.findUnique({
          where: { id: tripId },
          include: TRIP_INCLUDE,
        });
        if (!trip) {
          if (typeof callback === 'function') callback({ error: 'not_found' });
          return;
        }

        // Authorisation is per-trip, not per-namespace: being a driver does not
        // entitle you to another driver's trip, and a rider may only watch a
        // trip they requested or hold a booking on.
        const permitted =
          role === 'DRIVER'
            ? trip.driverId === viewerId
            : trip.requesterId === viewerId || trip.bookings.some((b) => b.userId === viewerId);
        if (!permitted) {
          if (typeof callback === 'function') callback({ error: 'forbidden' });
          return;
        }

        socket.join(`trip:${tripId}`);

        const missed = await tripState.eventsSince(tripId, lastSeq, MAX_REPLAY);
        // With the route line: a client resuming mid-trip must get its map back
        // in one round trip, not draw a bare pair of pins and then wait for the
        // driver's next GPS fix to learn where the road goes.
        const snapshot = await buildTripSnapshotWithPath(trip, {
          forUserId: role === 'DRIVER' ? null : viewerId,
        });

        // Replay first, snapshot last: the snapshot is authoritative, so it
        // must be the final word even if the replay was truncated.
        for (const event of missed) {
          socket.emit('trip:event', publisher.buildEnvelope(trip, event, null));
        }
        socket.emit('trip:event', {
          tripId,
          seq: trip.version,
          version: trip.version,
          type: 'SNAPSHOT',
          actor: 'SYSTEM',
          status: trip.status,
          payload: {},
          snapshot,
          serverNowMs: Date.now(),
          ttlMs: 15 * 60_000,
          priority: 'HIGH',
          dedupeKey: `snapshot:${tripId}`,
        });

        if (typeof callback === 'function') {
          callback({
            ok: true,
            tripId,
            version: trip.version,
            replayed: missed.length,
            // Told explicitly so the client knows the replay was cut short and
            // should trust the snapshot rather than its own animation state.
            truncated: missed.length >= MAX_REPLAY,
            serverNowMs: Date.now(),
          });
        }
      } catch (err) {
        logger.warn(`trip:subscribe failed (${tripId}): ${err.message}`);
        if (typeof callback === 'function') callback({ error: 'internal' });
      }
    });

    socket.on('trip:unsubscribe', ({ tripId } = {}) => {
      if (tripId) socket.leave(`trip:${tripId}`);
    });

    /**
     * Periodic high-water mark for connections that stay up for hours. Uber
     * sends one roughly every 30s; the client owns the cadence.
     */
    socket.on('trip:ack', ({ tripId, seq } = {}) => {
      if (!tripId || !Number.isFinite(seq)) return;
      socket.data.lastAckedSeq = { ...(socket.data.lastAckedSeq || {}), [tripId]: seq };
    });

    /**
     * Liveness. Answers with server time so the client can measure both round
     * trip and clock skew, and render every countdown against ours.
     */
    socket.on('time:sync', (_payload, callback) => {
      if (typeof callback === 'function') callback({ serverNowMs: Date.now() });
    });
  });
}

module.exports = registerResumeProtocol;
