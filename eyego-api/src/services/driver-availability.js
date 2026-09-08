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

const { staleCutoff, IN_FLIGHT_IDLE_HOURS } = require('./stale-trips');

/**
 * Statuses that make a driver unconditionally unavailable — they are actively
 * engaged with a rider right now, whatever the departure time says.
 */
const HARD_BUSY_STATUSES = Object.freeze([
  'CONFIRMED',
  // A driver who has just claimed a trip but hasn't set off yet is busy. This
  // state did not exist before the canonical-Trip work; without it, the gap
  // between "accepted" and "en route" was a window where the driver could be
  // offered a second ride.
  'DRIVER_ASSIGNED',
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
// Read per call so an admin can retune it live (src/config/settings.js). Kept as
// a function rather than a const for exactly that reason.
const settings = require('./../config/settings');
const imminentDepartureMinutes = () => settings.get('DISPATCH_BUSY_LEAD_MINUTES') ?? 45;

/**
 * Prisma relation filter matching a driver who is NOT free.
 * Use as `trips: { some: busyTripFilter() }` to find busy drivers, or
 * `trips: { none: busyTripFilter() }` to find free ones.
 */
function busyTripFilter(now = new Date()) {
  const imminent = new Date(now.getTime() + imminentDepartureMinutes() * 60 * 1000);
  return {
    OR: [
      {
        status: { in: [...HARD_BUSY_STATUSES] },
        /**
         * BUGFIX — the hard-busy branch had NO time bound at all, which is the
         * same permanent-lockout bug the PENDING branch below already documents,
         * just on the statuses that matter more.
         *
         * A trip only leaves DRIVER_ASSIGNED / DRIVER_EN_ROUTE /
         * ARRIVED_AT_PICKUP / IN_PROGRESS when somebody explicitly moves it. Kill
         * the driver app mid-test, reinstall it, hand the phone to someone else —
         * the row stays exactly where it was, and this filter counted it as "on a
         * trip right now" forever. One abandoned trip and that driver silently
         * received no dispatch offer ever again, while their own app showed a
         * clear home screen. Reported (again) as "the rider requests and nothing
         * arrives on the driver phone".
         *
         * `updatedAt` is the right clock: `applyTransition` writes the trip row on
         * every status change, so a genuinely live ride is touched continuously
         * and is never within a thousand miles of this bound. The window is the
         * SAME one `stale-trips`/`trip-lifecycle` use to declare an in-flight trip
         * abandoned, so this filter and the sweeper that expires the row cannot
         * disagree about whether a driver is busy.
         */
        updatedAt: { gte: new Date(now.getTime() - IN_FLIGHT_IDLE_HOURS * 60 * 60 * 1000) },
      },
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
/**
 * @param {{ids?: string[]|null, excludeId?: string|string[]|null}} [opts]
 *   `excludeId` accepts an array so a redispatched trip can exclude EVERY
 *   driver who has abandoned it, not only the most recent one.
 */
function availableDriverWhere({ ids = null, excludeId = null } = {}) {
  const where = {
    status: 'ACTIVE',
    isOnline: true,
    // "Pause requests" — online, finishing the current trip, not taking the
    // next one. Enforced here because this file is the only eligibility source;
    // a pause honoured anywhere else is a pause that leaks offers.
    requestsPaused: false,
    trips: { none: busyTripFilter() },
  };
  if (Array.isArray(ids) && ids.length > 0) where.id = { in: ids };
  // One id or many. `{ id: { in: [] } }` would exclude nothing but still costs a
  // clause, so an empty array is dropped rather than emitted.
  if (Array.isArray(excludeId)) {
    if (excludeId.length > 0) where.NOT = { id: { in: excludeId } };
  } else if (excludeId) {
    where.NOT = { id: excludeId };
  }
  return where;
}

/**
 * ── ALMOST FREE IS FREE ENOUGH ───────────────────────────────────────────────
 *
 * FEATURE ("the popup should also pop up even in mid ride so they can choose to
 * accept that ride and fulfil it after their ride is done. This should only
 * come when the driver's trip is almost done, so the rider that requested the
 * second ride doesn't wait that long").
 *
 * `busyTripFilter` is a Prisma relation filter and can therefore only reason
 * about columns — a status and a timestamp. "How long until this driver is
 * free" is an ETA, which lives in a service, so it cannot be expressed in the
 * where-clause at all. That is why this is a SECOND pass rather than a change
 * to the filter: the query still returns the genuinely-free drivers, and this
 * adds back the ones whose current trip is within a few minutes of its last
 * drop-off.
 *
 * Three rules keep it honest:
 *   1. The trip must be IN_PROGRESS. A driver who has not collected their
 *      current passenger yet is not "almost done", whatever the ETA says.
 *   2. The ETA is to the FINAL drop, from the driver's live position — the same
 *      number the rider on board is being shown, so the two cannot disagree.
 *   3. The threshold is a PlatformSetting, so it is tunable without a deploy
 *      (this codebase's convention for every dispatch knob).
 *
 * A driver added here is offered the ride as a QUEUED one; they are still
 * finishing the trip they are on, and the offer surface says so.
 */
const MIDRIDE_ELIGIBLE_STATUSES = Object.freeze(['IN_PROGRESS']);
const midRideOfferEtaMinutes = () => settings.get('MIDRIDE_OFFER_ETA_MINUTES') ?? 5;

/**
 * Of `driverIds`, which are busy but within the mid-ride window?
 *
 * NEVER THROWS. An ETA provider that is slow or down must not be able to shrink
 * the candidate pool — this only ever ADDS drivers, so failing closed costs an
 * optimisation and failing open would cost a rider a car.
 *
 * @returns {Promise<string[]>} driver ids that may be offered a queued ride.
 */
async function midRideAvailableDriverIds(prisma, driverIds) {
  if (!Array.isArray(driverIds) || driverIds.length === 0) return [];
  const windowMin = midRideOfferEtaMinutes();
  if (!(windowMin > 0)) return [];

  try {
    const trips = await prisma.trip.findMany({
      where: {
        driverId: { in: driverIds },
        status: { in: [...MIDRIDE_ELIGIBLE_STATUSES] },
        // Same abandonment bound the busy filter uses — a trip nothing has
        // reported on for hours has no meaningful ETA to be near the end of.
        updatedAt: { gte: new Date(Date.now() - IN_FLIGHT_IDLE_HOURS * 60 * 60 * 1000) },
      },
      select: {
        id: true,
        driverId: true,
        dropoffLat: true,
        dropoffLng: true,
        route: { select: { destinationLat: true, destinationLng: true } },
        driver: { select: { currentLat: true, currentLng: true } },
      },
    });
    if (trips.length === 0) return [];

    const eta = require('./eta.service');
    const results = await Promise.all(
      trips.map(async (t) => {
        const destLat = t.dropoffLat ?? t.route?.destinationLat;
        const destLng = t.dropoffLng ?? t.route?.destinationLng;
        const fromLat = t.driver?.currentLat;
        const fromLng = t.driver?.currentLng;
        if (![destLat, destLng, fromLat, fromLng].every(Number.isFinite)) return null;
        try {
          const minutes = await eta.etaMinutes(
            { lat: fromLat, lng: fromLng },
            { lat: destLat, lng: destLng },
          );
          return Number.isFinite(minutes) && minutes <= windowMin ? t.driverId : null;
        } catch {
          return null;
        }
      }),
    );
    return results.filter(Boolean);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[driver-availability] mid-ride check failed: ${err.message}`);
    return [];
  }
}

/**
 * Imperative form of the same rule, for code paths that already hold a driver
 * id and just need a yes/no (the REST poll, socket handlers). Returns true when
 * the driver may be shown a dispatch offer.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.includeMidRide] also say yes to a driver who is
 *   finishing a trip that is within the mid-ride window. Off by default: most
 *   callers are asking "may I hand this driver the wheel right now".
 */
async function isDriverAvailable(prisma, driverId, opts = {}) {
  if (!driverId) return false;
  const driver = await prisma.driver.findFirst({
    where: { id: driverId, ...availableDriverWhere() },
    select: { id: true },
  });
  if (driver) return true;
  if (!opts.includeMidRide) return false;
  const nearlyFree = await midRideAvailableDriverIds(prisma, [driverId]);
  return nearlyFree.length > 0;
}

/**
 * WHY these drivers are not getting offers — one row per id, in this file
 * because this file owns the rules.
 *
 * Dispatch failures were, until now, undiagnosable from logs: `rankCandidates`
 * could only report "0 eligible" because the eligibility test is a `where`
 * clause, and a `where` clause that matches nothing cannot say which of its four
 * conditions did the excluding. Every investigation therefore started with
 * someone opening a psql session and guessing. That is the whole reason this bug
 * keeps coming back.
 *
 * Deliberately a SEPARATE query, run only when the funnel actually lost drivers,
 * and deliberately NOT a second eligibility predicate — it re-uses
 * `busyTripFilter()` for the busy check and reads the same three columns
 * `availableDriverWhere()` filters on, so it cannot drift from the rule it
 * explains.
 *
 * @returns {Promise<Array<{id: string, reason: string}>>}
 */
async function explainIneligible(prisma, ids, now = new Date()) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const drivers = await prisma.driver.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      status: true,
      isOnline: true,
      requestsPaused: true,
      trips: {
        where: busyTripFilter(now),
        select: { id: true, status: true, updatedAt: true },
        take: 1,
      },
    },
  });

  const found = new Set(drivers.map((d) => d.id));
  const out = ids
    .filter((id) => !found.has(id))
    // In the geo index but not in the drivers table: a deleted account, or a
    // stale index entry no `removeDriver` ever cleaned up.
    .map((id) => ({ id, reason: 'NO_SUCH_DRIVER' }));

  for (const d of drivers) {
    if (d.status !== 'ACTIVE') {
      // The single most common "dispatch is broken" report that is not a bug:
      // a driver who signed up but was never approved is invisible to dispatch
      // and their app says nothing about it.
      out.push({ id: d.id, reason: `NOT_ACTIVE(status=${d.status})` });
    } else if (!d.isOnline) {
      out.push({ id: d.id, reason: 'OFFLINE' });
    } else if (d.requestsPaused) {
      out.push({ id: d.id, reason: 'REQUESTS_PAUSED' });
    } else if (d.trips.length > 0) {
      out.push({
        id: d.id,
        reason: `BUSY(trip=${d.trips[0].id} status=${d.trips[0].status} updated=${d.trips[0].updatedAt.toISOString()})`,
      });
    }
  }
  return out;
}

module.exports = {
  HARD_BUSY_STATUSES,
  PENDING_BUSY_STATUSES,
  imminentDepartureMinutes,
  busyTripFilter,
  availableDriverWhere,
  isDriverAvailable,
  midRideAvailableDriverIds,
  midRideOfferEtaMinutes,
  explainIneligible,
};
