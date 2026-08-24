'use strict';

/**
 * DOES THIS TRIP STILL HAVE A REASON TO BE ALIVE?
 *
 * ── THE BUG THIS EXISTS FOR ─────────────────────────────────────────────────
 *
 *   "I ended my trip and it was showing I wasn't on any trip, but I tried
 *    ordering another one and it's saying I already have a ride."
 *
 *   "I'm trying to book a driver-created trip but it's telling me I'm already
 *    on a ride and that I can book it but not for me."
 *
 *   "On the driver app I ordered another trip but it's still telling me live
 *    requests in queue, all 2 of them. But on the rider side I cancelled."
 *
 * All three are the same shape: a `Trip` row left in a LIVE status with nobody
 * on it. `Trip.status` is the lifecycle authority and `Booking.status` is seat
 * and money state (see trip-state.service.js), and the two are written by
 * different code paths — so any path that terminates the last booking without
 * also terminating the trip mints a ghost. `cancelBookingWithFee` had three
 * such holes: an early return when the seat set was already empty, an
 * `activeCount === 0` gate that a partially-cancelled set does not satisfy, and
 * a `SCHEDULED` carve-out that a hailed ride can reach through a redispatch.
 *
 * A ghost is not cosmetic. `findActiveTripForUser` sees it and refuses the
 * rider's next ride. `isDriverAvailable` sees it and takes the driver out of
 * the dispatch pool permanently. `listSearchesForDriver` sees it and keeps
 * advertising work that nobody is waiting for.
 *
 * ── WHY A SEPARATE MODULE ───────────────────────────────────────────────────
 *
 * Patching each cancellation path would be the same mistake with a longer list:
 * there are a dozen writers of `Booking.status` and there will be more. This is
 * the ONE derivation of "is this trip still real", called from the two read
 * paths that a ghost actually breaks (the rider's active-ride guard and the
 * driver's dispatch board) as a lazy guard, and from the cancellation path
 * eagerly so the common case is fixed before anyone reads it.
 *
 * Same two-layer design as trip-lifecycle.service.js: a lazy guard means
 * correctness never depends on a sweep having run.
 *
 * ── WHAT IT WILL AND WILL NOT TOUCH ─────────────────────────────────────────
 *
 * Only a trip with NO live passenger. Everything else is somebody's ride and is
 * left alone, including:
 *
 *   - `IN_PROGRESS`. A rider sitting in a moving car whose booking row went
 *     terminal is a data problem for support, not something to cancel out from
 *     under the driver.
 *   - `SCHEDULED` / `FILLING` with seats still on sale. An empty bus that has
 *     not departed is inventory, not a ghost — it goes back on sale instead,
 *     which is what `cancelBookingWithFee` already does for those two.
 *   - A driver-created trip that has never had a passenger and whose departure
 *     is still ahead of it. That is the entire point of publishing a trip.
 */

const prisma = require('../config/database');
const logger = require('../utils/logger');
const tripState = require('./trip-state.service');
const { livePassengerWhere } = require('../utils/booking-status');

const S = tripState.TRIP_STATUS;

/**
 * Statuses a ghost can be found in.
 *
 * `IN_PROGRESS` is deliberately absent — see the header. `SCHEDULED` and
 * `FILLING` are absent because an empty bus on sale is not a ghost.
 */
const RECONCILABLE = Object.freeze([
  S.REQUESTED,
  S.MATCHING,
  S.REASSIGNING,
  S.CONFIRMED,
  S.DRIVER_ASSIGNED,
  S.DRIVER_EN_ROUTE,
  S.ARRIVED_AT_PICKUP,
]);

/**
 * Grace before a brand-new trip may be judged.
 *
 * `requestRide` creates the Trip row and its Booking in one transaction, but
 * other paths (a driver publishing a trip, a scheduled intent being promoted)
 * legitimately have a live trip with no booking for a moment. Judging one of
 * those instantly would cancel a ride the rider is still paying for.
 */
const NEW_TRIP_GRACE_MS = 60 * 1000;

/**
 * Terminate a trip that has no passenger left, and say so through the state
 * machine so both apps are told rather than discovering it on a refetch.
 *
 * Idempotent and safe to call from a read path: it re-reads under its own
 * conditions, refuses anything terminal, and swallows a lost race.
 *
 * @param {string} tripId
 * @param {{reason?: string}} [opts]
 * @returns {Promise<boolean>} true when this call is what ended the trip.
 */
async function reconcileTrip(tripId, { reason = 'NO_LIVE_PASSENGERS' } = {}) {
  if (!tripId) return false;
  try {
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      select: {
        id: true,
        status: true,
        createdAt: true,
        driverId: true,
        routeId: true,
        requesterId: true,
        _count: { select: { bookings: { where: livePassengerWhere() } } },
      },
    });
    if (!trip) return false;
    if (!RECONCILABLE.includes(trip.status)) return false;
    if (trip._count.bookings > 0) return false;
    if (Date.now() - new Date(trip.createdAt).getTime() < NEW_TRIP_GRACE_MS) return false;

    /**
     * A DRIVER'S OWN PUBLISHED TRIP IS NOT A GHOST WHEN IT IS EMPTY.
     *
     * A driver who creates a route trip and puts it on sale legitimately has
     * zero bookings for as long as nobody has booked. Those live at SCHEDULED /
     * FILLING, which `RECONCILABLE` already excludes — but a redispatch can
     * push one into CONFIRMED or DRIVER_EN_ROUTE, and killing it there would
     * cancel a bus mid-route. A trip with a `routeId` and a driver who created
     * it is that shape; the hailed ride this exists for has neither.
     */
    if (trip.routeId && !trip.requesterId) return false;

    const result = await tripState.applyTransition(tripId, S.CANCELLED, {
      actor: tripState.ACTOR.SYSTEM,
      data: { cancelledBy: tripState.ACTOR.SYSTEM, cancellationReason: reason },
      payload: { reason, reconciled: true },
    });

    logger.warn('Reconciled a trip with no live passengers', {
      tripId,
      from: trip.status,
      hadDriver: !!trip.driverId,
      reason,
    });

    // Stop any search still running for a ride nobody is on. Required lazily:
    // dispatch-cascade requires this module's siblings and a top-level require
    // here would close the cycle.
    require('./dispatch-cascade.service')
      .cancelCascade(tripId)
      .catch((err) => logger.debug(`[Reconcile] cascade stop failed: ${err?.message ?? err}`));

    return !!result;
  } catch (err) {
    /**
     * NEVER let this break its caller. It is a guard on a read path: a rider
     * asking for their active ride, or a driver's board loading. A failure here
     * means the ghost survives one more request, which is strictly better than
     * a 500 on the screen that was trying to get past it.
     */
    logger.warn(`reconcileTrip(${tripId}) failed: ${err?.message ?? err}`);
    return false;
  }
}

/**
 * The lazy guard, in the shape read paths want: given a trip they were about to
 * treat as live, answer whether it really is.
 *
 * @param {{id: string, status: string} | null} trip
 * @returns {Promise<boolean>} true when the trip is still a real live ride.
 */
async function stillLive(trip) {
  if (!trip?.id) return false;
  const ended = await reconcileTrip(trip.id, { reason: 'STALE_ON_READ' });
  return !ended;
}

/**
 * THE MIRROR IMAGE: a live BOOKING pinned to a trip that is over.
 *
 * BUGFIX (item 12: "I'm trying to book a driver-created trip but it's telling
 * me I'm already on a ride… when I go to the activity page, nothing shows that
 * I'm on a live trip").
 *
 * `reconcileTrip` above fixes a live trip with no bookings. This is the other
 * orientation of the same split-brain: a `CONFIRMED`/`PAID`/`BOARDED` booking
 * row whose trip has since gone terminal, or has aged past the lifecycle
 * deadline and is never moving again. The rider's own surfaces read the TRIP
 * and correctly show nothing; `bookSeat`'s already-on-a-ride guard reads the
 * BOOKING and correctly refuses; the rider is locked out of the product with
 * nothing on screen explaining why.
 *
 * Deliberately narrow. It will only release a booking whose trip is genuinely
 * finished — terminal, or past the deadline `trip-lifecycle` would expire it on
 * anyway. A booking on a live ride is never touched, so this cannot be used to
 * cancel your way out of a trip you are actually on.
 *
 * @param {import('@prisma/client').PrismaClient} client  tx or prisma
 * @param {string} bookingId
 * @returns {Promise<boolean>} true when the booking was released.
 */
async function releaseOrphanBooking(client, bookingId) {
  if (!bookingId) return false;
  try {
    const booking = await client.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, status: true, trip: { select: { id: true, status: true, departureTime: true, updatedAt: true } } },
    });
    if (!booking?.trip) return false;

    const lifecycle = require('./trip-lifecycle.service');
    const dead =
      tripState.isTerminal(booking.trip.status) ||
      (typeof lifecycle.isPastDeadline === 'function' && lifecycle.isPastDeadline(booking.trip));
    if (!dead) return false;

    await client.booking.update({
      where: { id: bookingId },
      data: {
        status: 'CANCELLED',
        // `@@unique([tripId, seatNumber])` — a cancelled row that keeps its seat
        // number blocks that seat forever. Every release site nulls it.
        seatNumber: null,
        cancelledAt: new Date(),
        cancellationReason: 'ORPHANED_BOOKING',
      },
    });
    logger.warn('Released a booking orphaned on a finished trip', {
      bookingId,
      tripId: booking.trip.id,
      tripStatus: booking.trip.status,
    });
    return true;
  } catch (err) {
    logger.warn(`releaseOrphanBooking(${bookingId}) failed: ${err?.message ?? err}`);
    return false;
  }
}

/**
 * Sweep: every reconcilable trip with no live passenger, oldest first.
 *
 * The eager calls cover the paths we know about; this catches the ones we do
 * not, including rows left behind by a process that died mid-transaction. Cheap
 * enough to run alongside the stale-trip sweep — it is one indexed query with a
 * relation count.
 */
async function reconcileOrphanedTrips({ limit = 50 } = {}) {
  try {
    const candidates = await prisma.trip.findMany({
      where: {
        status: { in: [...RECONCILABLE] },
        createdAt: { lte: new Date(Date.now() - NEW_TRIP_GRACE_MS) },
        bookings: { none: livePassengerWhere() },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    let ended = 0;
    for (const t of candidates) {
      if (await reconcileTrip(t.id, { reason: 'ORPHANED_SWEEP' })) ended += 1;
    }
    if (ended > 0) logger.info(`Reconciled ${ended} orphaned trip(s)`);
    return ended;
  } catch (err) {
    logger.warn(`reconcileOrphanedTrips failed: ${err?.message ?? err}`);
    return 0;
  }
}

module.exports = {
  RECONCILABLE,
  NEW_TRIP_GRACE_MS,
  reconcileTrip,
  stillLive,
  releaseOrphanBooking,
  reconcileOrphanedTrips,
};
