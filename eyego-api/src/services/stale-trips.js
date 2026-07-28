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
  const where = staleTripFilter();
  if (driverId) where.driverId = driverId;

  try {
    const { count } = await prisma.trip.updateMany({
      where,
      data: { status: 'EXPIRED' },
    });
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
  expireStaleTrips,
};
