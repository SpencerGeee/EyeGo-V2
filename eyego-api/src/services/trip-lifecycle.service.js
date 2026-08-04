'use strict';

const prisma = require('../config/database');
const logger = require('../utils/logger');
const tripState = require('./trip-state.service');

/**
 * Trip lifetime enforcement.
 *
 * PROBLEM THIS SOLVES. A trip could stay "live" indefinitely. A ride taken at
 * midnight was still being offered to the rider as their active trip — and still
 * resumable by the driver — at lunchtime the next day. Anything that interrupts
 * the happy path leaves one behind: the driver force-quits, reinstalls, loses the
 * phone, runs out of battery, or simply never taps "complete". Those trips then
 * hold seats, keep appearing on both apps' live surfaces, distort earnings, and
 * let a driver "resume" a journey that finished half a day ago.
 *
 * The old sweep was in server.js and was not enough on three counts:
 *   1. it ran every SIX HOURS, so a trip could be stale for most of a day before
 *      anything looked at it — which is exactly the reported symptom;
 *   2. its windows were 24 h (pre-trip) and 48 h (in-progress), i.e. far longer
 *      than any real journey in this market;
 *   3. it flipped `Trip.status` ONLY. Every Booking on the trip stayed
 *      non-terminal, so riders' seats were never released and their bookings
 *      stayed "live" from the bookings side.
 *
 * DESIGN.
 *  - Two layers. A periodic SWEEP does the bulk work, and a LAZY GUARD
 *    (`isPastDeadline`) lets read paths refuse a trip that is past its deadline
 *    even if the sweep hasn't run yet — so correctness never depends on a timer
 *    having fired. This is the standard pattern for expiry in a system that
 *    cannot afford to be wrong between ticks.
 *  - Terminal status is `EXPIRED`, deliberately NOT `CANCELLED`. "The system gave
 *    up on this trip" and "a human cancelled this trip" have different meanings
 *    for support, for driver cancellation-rate metrics and for refunds; the old
 *    sweep conflated them, which made cancellation stats punish drivers for the
 *    platform's own housekeeping. Trip/Booking status are plain `String` columns
 *    in this schema, so no enum migration is required, and `EXPIRED` is already
 *    in bookings.service's TERMINAL_TRIP_STATUSES.
 *  - Idempotent and re-entrant: every write is conditioned on the row still
 *    being non-terminal, so a second instance (or an overlapping tick) is a
 *    no-op rather than a double-cancellation.
 *  - Batched, oldest first, with a cap per tick so one bad backlog can't hold a
 *    transaction open long enough to matter.
 */

/** Hours after `departureTime` that a never-started trip is written off. */
const PRETRIP_GRACE_HOURS = numFromEnv('TRIP_EXPIRY_PRETRIP_HOURS', 3);
/**
 * Hours WITHOUT ANY UPDATE that an already-running trip is written off. Keyed on
 * `updatedAt`, so a genuinely long journey that keeps reporting progress is never
 * touched — only a trip nothing has said anything about.
 */
const ACTIVE_IDLE_HOURS = numFromEnv('TRIP_EXPIRY_ACTIVE_IDLE_HOURS', 6);
/** Absolute backstop measured from `departureTime`, whatever else is happening. */
const HARD_MAX_HOURS = numFromEnv('TRIP_EXPIRY_HARD_MAX_HOURS', 18);
/** Trips processed per tick. */
const BATCH_SIZE = numFromEnv('TRIP_EXPIRY_BATCH_SIZE', 200);

function numFromEnv(key, fallback) {
  const n = Number.parseFloat(process.env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Derived from the state machine, NOT hand-maintained.
//
// These were three local literal arrays, and they had already drifted: the
// pre-trip list still contained `DISPATCHING`, a status that no longer exists,
// and the terminal list was missing `NO_DRIVERS_FOUND` — so the sweep both
// crashed on every run and, had it run, would have treated a
// no-drivers-found trip as still expirable. Private copies of "which statuses
// are which" are the exact failure the enum and the shared constants exist to
// prevent; there is one list now and this file reads it.
const {
  PRE_TRIP_STATUSES,
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  PRE_DRIVER_STATUSES,
} = tripState;
/** Booking states that still hold a seat / still read as live to a rider. */
const LIVE_BOOKING_STATUSES = ['SEAT_HELD', 'CONFIRMED', 'PAID', 'BOARDED', 'PENDING'];

function hoursAgo(h) {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}

/**
 * Lazy guard for read paths (trip detail, driver resume, rider tracking).
 *
 * Returns true when this trip is past its deadline and should be treated as
 * expired REGARDLESS of the status currently stored — i.e. the sweep is simply
 * late. Cheap and synchronous: it only looks at fields the caller already has.
 */
function isPastDeadline(trip) {
  if (!trip) return false;
  const status = String(trip.status ?? '').toUpperCase();
  if (TERMINAL_STATUSES.includes(status)) return false;

  const departure = trip.departureTime ? new Date(trip.departureTime).getTime() : null;
  const updated = trip.updatedAt ? new Date(trip.updatedAt).getTime() : null;
  const now = Date.now();

  if (departure && now - departure > HARD_MAX_HOURS * 3600_000) return true;
  // Pre-driver states (REQUESTED/MATCHING/REASSIGNING) get the same grace.
  // They already have their own 5-minute `RIDE_REQUEST_EXPIRY` ScheduledTask,
  // so reaching here means that task never fired — which is precisely when a
  // backstop is worth having.
  if (
    [...PRE_TRIP_STATUSES, ...PRE_DRIVER_STATUSES].includes(status) &&
    departure &&
    now - departure > PRETRIP_GRACE_HOURS * 3600_000
  ) {
    return true;
  }
  if (ACTIVE_STATUSES.includes(status) && updated && now - updated > ACTIVE_IDLE_HOURS * 3600_000) {
    return true;
  }
  return false;
}

/**
 * Expire ONE trip and everything hanging off it. Safe to call on a trip that is
 * already terminal (returns false without writing).
 *
 * @returns {Promise<boolean>} whether this call is the one that expired it
 */
async function expireTrip(tripId, reason = 'STALE') {
  try {
    const transition = await prisma.$transaction(async (tx) => {
      // Re-read inside the transaction and condition on non-terminal: this is
      // what makes concurrent sweeps and the lazy guard safe to run together.
      const trip = await tx.trip.findUnique({
        where: { id: tripId },
        select: { id: true, status: true, driverId: true },
      });
      if (!trip) return false;
      if (TERMINAL_STATUSES.includes(String(trip.status).toUpperCase())) return false;

      // Through the state machine, not a raw update. Two things this buys that
      // the direct write could not: the expiry produces a TripEvent both apps
      // observe (so a rider staring at a dead trip finds out immediately
      // rather than on their next poll), and reaching a terminal status
      // automatically cancels every ScheduledTask still armed for this trip —
      // no offer timeout can fire against a ride the sweep has written off.
      let releasedCount = 0;
      const transition = await tripState.applyTransitionTx(tx, tripId, 'EXPIRED', {
        actor: tripState.ACTOR.SYSTEM,
        payload: { reason },
        // The seat counter is derived state; zero it rather than decrementing,
        // so a sweep can never leave it drifting.
        data: { arrivedAt: null, confirmedSeats: 0 },
        sideEffects: async (innerTx) => {
          // Release every seat still held/confirmed. Without this the rider's
          // booking stayed live and their seat stayed spent — the half of the
          // old sweep that was missing entirely.
          const released = await innerTx.booking.updateMany({
            where: { tripId, status: { in: LIVE_BOOKING_STATUSES } },
            data: { status: 'EXPIRED' },
          });
          releasedCount = released.count;
        },
      });

      logger.info(`Trip ${tripId} expired (${reason}); released ${releasedCount} booking(s)`);
      return transition;
    });

    // Post-commit. Both apps drop the dead trip from their live surfaces off
    // the same versioned event as every other status change — no bespoke
    // sweep-only socket message to keep in sync with the rest.
    tripState.publishCommitted(transition);
    return true;
  } catch (err) {
    // A trip that went terminal between the read and the write raises
    // TRIP_TERMINAL / VERSION_CONFLICT. That is the guard working, not a
    // failure: another actor got there first and the trip is already closed.
    if (err.code === 'TRIP_TERMINAL' || err.code === 'VERSION_CONFLICT') return false;
    logger.warn(`Failed to expire trip ${tripId} (non-blocking): ${err.message}`);
    return false;
  }
}

/**
 * Periodic sweep. Returns the number of trips expired.
 *
 * The `io` parameter is gone: notifying open apps is no longer this function's
 * job. `expireTrip` publishes the standard `trip:event`, so a sweep expiry is
 * indistinguishable — to the clients — from any other status change, and there
 * is one code path to keep correct instead of two.
 */
async function expireStaleTrips() {
  const candidates = await prisma.trip.findMany({
    where: {
      status: { notIn: TERMINAL_STATUSES },
      OR: [
        {
          status: { in: [...PRE_TRIP_STATUSES, ...PRE_DRIVER_STATUSES] },
          departureTime: { lt: hoursAgo(PRETRIP_GRACE_HOURS) },
        },
        { status: { in: ACTIVE_STATUSES }, updatedAt: { lt: hoursAgo(ACTIVE_IDLE_HOURS) } },
        { departureTime: { lt: hoursAgo(HARD_MAX_HOURS) } },
      ],
    },
    select: { id: true, driverId: true },
    orderBy: { departureTime: 'asc' },
    take: BATCH_SIZE,
  });

  let expired = 0;
  for (const trip of candidates) {
    const didExpire = await expireTrip(trip.id, 'SWEEP');
    if (didExpire) expired += 1;
  }

  if (expired > 0) logger.info(`Trip expiry sweep: expired ${expired} stale trip(s)`);
  return expired;
}

module.exports = {
  expireStaleTrips,
  expireTrip,
  isPastDeadline,
  TERMINAL_STATUSES,
  PRE_TRIP_STATUSES,
  ACTIVE_STATUSES,
};
