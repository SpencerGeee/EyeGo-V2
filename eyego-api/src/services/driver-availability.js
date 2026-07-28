'use strict';

/**
 * SINGLE SOURCE OF TRUTH — "is this driver free to receive a new dispatch offer?"
 *
 * Before this module existed, four separate call sites (dispatch.service,
 * trip-request.service, drivers.service#redispatchTrip, and the
 * /trip-requests/pending poll) each hand-rolled their own eligibility `where`
 * clause, and every one of them was wrong in a different way:
 *
 *   - They excluded only `IN_PROGRESS` + `DRIVER_EN_ROUTE`. A driver who had
 *     just accepted a trip (`CONFIRMED`), was filling their own self-created
 *     bus route (`FILLING`/`SCHEDULED`), had already reached the pickup
 *     (`ARRIVED_AT_PICKUP`), or was mid-reassignment (`REASSIGNING`) still
 *     counted as "free" and kept getting the dispatch screen for unrelated
 *     riders.
 *   - dispatch.service never checked `isOnline` at all.
 *   - the no-coords broadcast fallback in trip-request.service had NO busy
 *     check whatsoever — it blasted every ACTIVE+online driver.
 *   - the REST poll fallback had no busy check AND no online/active check, so
 *     a busy driver could simply poll their way into an offer.
 *
 * Every dispatch path now goes through here. Do not inline a new one.
 */

const { staleCutoff } = require('./stale-trips');

/**
 * Statuses that make a driver unconditionally unavailable — they are actively
 * engaged with a rider right now, whatever the departure time says.
 */
const HARD_BUSY_STATUSES = Object.freeze([
  'CONFIRMED',
  'DRIVER_EN_ROUTE',
  'ARRIVED_AT_PICKUP',
  'IN_PROGRESS',
  'REASSIGNING',
]);

/**
 * Statuses for a trip the driver owns but hasn't started yet. A trip scheduled
 * for next week must NOT lock a driver out of driving today, so these only
 * count as busy once departure is imminent (or already overdue).
 */
const PENDING_BUSY_STATUSES = Object.freeze(['SCHEDULED', 'FILLING']);

/** How close to departure a SCHEDULED/FILLING trip starts blocking dispatch. */
const IMMINENT_DEPARTURE_MINUTES =
  parseInt(process.env.DISPATCH_BUSY_LEAD_MINUTES, 10) || 45;

/**
 * Prisma relation filter matching a driver who is NOT free.
 * Use as `trips: { some: busyTripFilter() }` to find busy drivers, or
 * `trips: { none: busyTripFilter() }` to find free ones.
 */
function busyTripFilter(now = new Date()) {
  const imminent = new Date(now.getTime() + IMMINENT_DEPARTURE_MINUTES * 60 * 1000);
  return {
    OR: [
      { status: { in: [...HARD_BUSY_STATUSES] } },
      {
        status: { in: [...PENDING_BUSY_STATUSES] },
        // BUGFIX: the upper bound alone (`lte: imminent`) is satisfied by ANY
        // past departure time, so one abandoned SCHEDULED/FILLING trip marked
        // the driver busy forever and they silently stopped receiving every
        // dispatch offer — reported as "the driver app is free but the request
        // never shows up". A trip whose departure is long past was never
        // started and is not blocking anyone; see services/stale-trips.js.
        departureTime: { lte: imminent, gte: staleCutoff(now) },
      },
    ],
  };
}

/**
 * The full `where` fragment for a driver who may be offered a new trip:
 * approved, online, and not already engaged.
 *
 * @param {object} [opts]
 * @param {string[]|null} [opts.ids]      restrict to these driver ids (e.g. geo-radius hit)
 * @param {string|null}   [opts.excludeId] driver to leave out (the requester / canceller)
 */
function availableDriverWhere({ ids = null, excludeId = null } = {}) {
  const where = {
    status: 'ACTIVE',
    isOnline: true,
    trips: { none: busyTripFilter() },
  };
  if (Array.isArray(ids) && ids.length > 0) where.id = { in: ids };
  if (excludeId) where.NOT = { id: excludeId };
  return where;
}

/**
 * Imperative form of the same rule, for code paths that already hold a driver
 * id and just need a yes/no (the REST poll, socket handlers). Returns true when
 * the driver may be shown a dispatch offer.
 */
async function isDriverAvailable(prisma, driverId) {
  if (!driverId) return false;
  const driver = await prisma.driver.findFirst({
    where: { id: driverId, ...availableDriverWhere() },
    select: { id: true },
  });
  return !!driver;
}

module.exports = {
  HARD_BUSY_STATUSES,
  PENDING_BUSY_STATUSES,
  IMMINENT_DEPARTURE_MINUTES,
  busyTripFilter,
  availableDriverWhere,
  isDriverAvailable,
};
