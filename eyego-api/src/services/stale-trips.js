'use strict';

/**
 * Stale-trip handling — a trip the driver created but never actually ran.
 *
 * WHY THIS EXISTS
 * A trip is created in `SCHEDULED` (or `FILLING`, for a bus route still taking
 * seats) and only leaves that state when the driver explicitly starts,
 * completes or cancels it. Nothing ever timed one out. So an ad-hoc map-pin
 * trip the driver created and then abandoned — closed the app, killed it,
 * reinstalled — stayed `FILLING` in the database forever, with a
 * `departureTime` receding further into the past every day. Two user-visible
 * failures came directly out of that:
 *
 *  1. NO DISPATCH OFFERS ("the driver app is free but the request never shows
 *     up"). `busyTripFilter` in driver-availability.js counts a SCHEDULED /
 *     FILLING trip as busy once `departureTime <= now + lead`, and a departure
 *     time in the past satisfies that forever. One abandoned trip locked the
 *     driver out of every future dispatch, permanently and silently.
 *
 *  2. PHANTOM "RESUME TRIP". `getActiveTrip` matched the same rows, so the
 *     driver home screen offered to resume a trip that had been abandoned days
 *     earlier — including right after a fresh install, which is exactly how it
 *     was reported.
 *
 * The rule: once a SCHEDULED/FILLING trip is more than STALE_GRACE_MINUTES past
 * its departure time without ever being started, it is dead. It stops counting
 * as busy, stops being resumable, and gets swept to `EXPIRED` so it also
 * disappears from listings. (`Trip.status` is a plain string column, so no
 * migration is needed for the new value.)
 *
 * The grace window is deliberately generous — a driver running late on a real
 * trip has already moved it to DRIVER_EN_ROUTE/IN_PROGRESS, which this never
 * touches.
 */

const STALE_STATUSES = Object.freeze(['SCHEDULED', 'FILLING']);

const STALE_GRACE_MINUTES =
  parseInt(process.env.TRIP_STALE_GRACE_MINUTES, 10) || 180;

/** Departure times at or after this instant are still considered live. */
function staleCutoff(now = new Date()) {
  return new Date(now.getTime() - STALE_GRACE_MINUTES * 60 * 1000);
}

/** Prisma `where` matching trips that were never run and are now past saving. */
function staleTripFilter(now = new Date()) {
  return {
    status: { in: [...STALE_STATUSES] },
    departureTime: { lt: staleCutoff(now) },
  };
}

/**
 * Prisma `where` fragment for a SCHEDULED/FILLING trip that is still live —
 * i.e. not yet stale. Use anywhere the old code said
 * `status: { in: ['SCHEDULED','FILLING'] }`.
 */
function liveUnstartedTripFilter(now = new Date()) {
  return {
    status: { in: [...STALE_STATUSES] },
    departureTime: { gte: staleCutoff(now) },
  };
}

/**
 * Statuses of a trip that is genuinely under way.
 *
 * BUGFIX: `DRIVER_ASSIGNED` was missing, and this list is what decides which
 * abandoned trips ever get swept to EXPIRED. `tripState.ACTIVE_STATUSES` has
 * always included it — so the cron sweep in trip-lifecycle.service cleaned those
 * rows up and the read-path sweep here did not, which is precisely the "private
 * copies of which-statuses-are-which" drift this codebase keeps paying for. A
 * driver who accepted an offer and then force-quit the app sat in
 * DRIVER_ASSIGNED, counted as busy by driver-availability, and received no
 * further dispatch offer on any read path that only ever ran THIS sweep.
 *
 * Kept as a literal rather than imported from trip-state.service on purpose:
 * driver-availability requires this module, and trip-state pulls in the
 * publisher and the scheduler behind it. See the lazy require in
 * `expireStaleTrips` below for the same reason.
 */
const IN_FLIGHT_STATUSES = Object.freeze([
  'CONFIRMED',
  'DRIVER_ASSIGNED',
  'DRIVER_EN_ROUTE',
  'ARRIVED_AT_PICKUP',
  'IN_PROGRESS',
]);

/**
 * Hours of total silence after which an already-started trip is written off.
 * Mirrors TRIP_EXPIRY_ACTIVE_IDLE_HOURS in trip-lifecycle.service so both layers
 * agree on when a trip is dead.
 */
const IN_FLIGHT_IDLE_HOURS =
  Number.parseFloat(process.env.TRIP_EXPIRY_ACTIVE_IDLE_HOURS) > 0
    ? Number.parseFloat(process.env.TRIP_EXPIRY_ACTIVE_IDLE_HOURS)
    : 6;

/**
 * Prisma `where` fragment for an in-flight trip that is still RESUMABLE.
 *
 * BUGFIX: the driver's "Resume trip" banner used a bare
 * `status: { in: IN_FLIGHT_STATUSES }`, on the stated assumption that a started
 * trip "stays resumable forever, which is the whole point of the banner". That
 * assumption is what let a trip taken at midnight still be resumable at lunchtime
 * the next day — and, because the same trip was still non-terminal, still show as
 * the rider's live trip. A started trip that nothing has said a word about for
 * hours is not resumable; it is abandoned.
 */
function liveInFlightTripFilter(now = new Date()) {
  return {
    status: { in: [...IN_FLIGHT_STATUSES] },
    updatedAt: { gte: new Date(now.getTime() - IN_FLIGHT_IDLE_HOURS * 60 * 60 * 1000) },
  };
}

/**
 * Mark abandoned trips as EXPIRED. Safe to call opportunistically on read
 * paths — it only ever touches rows that already fail `staleTripFilter`, and
 * a no-op update costs one indexed query.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {object}  [opts]
 * @param {string}  [opts.driverId] limit the sweep to one driver's trips
 * @returns {Promise<number>} number of trips expired
 */
async function expireStaleTrips(prisma, { driverId = null } = {}) {
  const now = new Date();
  const where = {
    OR: [
      staleTripFilter(now),
      // Also sweep started-then-abandoned trips, not just never-started ones.
      // Leaving these out is what kept a midnight trip alive and resumable the
      // following afternoon.
      {
        status: { in: [...IN_FLIGHT_STATUSES] },
        updatedAt: { lt: new Date(now.getTime() - IN_FLIGHT_IDLE_HOURS * 60 * 60 * 1000) },
      },
    ],
  };
  if (driverId) where.driverId = driverId;

  try {
    // Delegated per-trip instead of one `updateMany`: expiring a trip has to
    // release its bookings and zero its seat counter too, or the riders' seats
    // stay spent and their bookings stay "live" from the bookings side — which is
    // exactly the half this sweep used to miss. See trip-lifecycle.service.
    const { expireTrip } = require('./trip-lifecycle.service');
    const candidates = await prisma.trip.findMany({
      where,
      select: { id: true },
      orderBy: { departureTime: 'asc' },
      take: 200,
    });
    let count = 0;
    for (const t of candidates) {
      if (await expireTrip(t.id, 'READ_PATH')) count += 1;
    }
    return count;
  } catch (err) {
    // Never let housekeeping break the request that triggered it — the
    // filters above already exclude stale rows from the caller's own query.
    // eslint-disable-next-line no-console
    console.error('[stale-trips] sweep failed:', err.message);
    return 0;
  }
}

module.exports = {
  STALE_STATUSES,
  STALE_GRACE_MINUTES,
  staleCutoff,
  staleTripFilter,
  liveUnstartedTripFilter,
  liveInFlightTripFilter,
  IN_FLIGHT_STATUSES,
  IN_FLIGHT_IDLE_HOURS,
  expireStaleTrips,
};
