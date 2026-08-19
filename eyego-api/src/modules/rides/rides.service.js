'use strict';

const prisma = require('../../config/database');
const redis = require('../../config/redis');
const logger = require('../../utils/logger');
const { AppError, NotFoundError } = require('../../utils/errors');
const tripState = require('../../services/trip-state.service');
const cascade = require('../../services/dispatch-cascade.service');
const fareQuote = require('../../services/fare-quote.service');
const boardingPin = require('../../services/boarding-pin.service');
const scheduledTasks = require('../../services/scheduled-task.service');
const supply = require('../../services/supply-index.service');
const { isDriverAvailable } = require('../../services/driver-availability');
const { effectivePickup } = require('../../services/route-geometry.service');
const { haversineMeters } = require('../../utils/geo');
const { seatOccupyingWhere, livePassengerWhere } = require('../../utils/booking-status');
const env = require('../../config/env');
// Settlement lives here and only here — see completeTrip below for why this is
// a delegation rather than a second implementation.
const tripsService = require('../trips/trips.service');
const {
  TRIP_INCLUDE,
  buildTripSnapshot,
  buildTripSnapshotWithPath,
  findActiveTripForUser,
  findActiveTripForDriver,
} = require('../../services/trip-view');

const { TRIP_STATUS: S, ACTOR } = tripState;

/**
 * The only states `failTripHard` may force to NO_DRIVERS_FOUND.
 *
 * Every one of them is "the trip exists and nobody has taken it". A trip that
 * has left this set has a driver attached, and forcing it terminal would cancel
 * a live ride — see the note in `failTripHard`.
 */
const FORCEABLE_STATUSES = [S.REQUESTED, S.MATCHING, S.REASSIGNING];

/**
 * How close counts as "at the pickup point". Kept identical to the copy in
 * sockets/driver.socket.js — one number, two entry points, or a driver could
 * arrive on the ping and not on the accept.
 */
const ARRIVAL_RADIUS_M = Number(env.ARRIVAL_RADIUS_M ?? 75);

/**
 * On-demand rides — the single canonical path.
 *
 * WHAT THIS REPLACES. Two divergent dispatch flows. One booking route ran the
 * sequential cascade and gave the rider a live "driver 2 of 8, 20s left"
 * experience; the other ran `setImmediate(() => dispatchToNearbyDrivers(trip))`
 * — an unawaited broadcast that emitted no rider progress at all and, if it
 * threw, threw after the request had already returned 200, so nothing ever
 * dispatched and nobody found out. Same product, two behaviours. That is a
 * direct cause of "it's not consistent".
 *
 * There is now one entry point, and it is synchronous with respect to its own
 * failure: if dispatch cannot start, the caller gets an error, not a 200 and a
 * spinner.
 *
 * THE OTHER STRUCTURAL CHANGE. A ride is a `Trip` row from the instant the
 * rider taps Confirm — status REQUESTED, `driverId` null. Previously a Trip
 * could not exist without a driver, so "requested but not yet matched" had no
 * representation, the rider and driver ended up on two different rows
 * (`Booking` vs `Trip`) with two independent status strings, and a driver
 * cancelling meant inventing a brand-new trip and losing the receipt, the share
 * link and the support thread. Now a driver cancel sends THIS trip back to
 * dispatch.
 */

/** Trips a rider may still be charged a cancellation fee against. */
const FREE_CANCEL_STATUSES = [S.REQUESTED, S.MATCHING, S.REASSIGNING];
/** How long a REQUESTED/MATCHING trip may sit before the system gives up. */
const REQUEST_EXPIRY_SECONDS = parseInt(process.env.RIDE_REQUEST_EXPIRY_SECONDS, 10) || 300;
/** Redispatch attempts after driver cancels before the rider is told no. */
const MAX_REDISPATCH = parseInt(process.env.RIDE_MAX_REDISPATCH, 10) || 2;

const TASK_REQUEST_EXPIRY = 'RIDE_REQUEST_EXPIRY';

/**
 * How long the durable dispatch-start row waits before assuming the in-process
 * kick never happened. Long enough that it never races a healthy start (which
 * happens on the next tick of the event loop), short enough that a rider whose
 * request landed on a process that then died is not left watching nothing.
 */
const DISPATCH_START_RECOVERY_SECONDS = 8;

// ── idempotency ──────────────────────────────────────────────────────────────

/**
 * Ride creation is money-adjacent and phone networks retry. Without a key, a
 * flaky connection during Confirm books two rides and charges twice.
 *
 * Returns the previously-created tripId when this key has been seen, so a
 * retry replays the original result instead of creating a second ride.
 */
async function withIdempotency(key, userId, fn) {
  if (!key) return fn();
  const k = `idem:ride:${userId}:${key}`;
  const claimed = await redis.set(k, 'PENDING', 'EX', 600, 'NX');
  if (!claimed) {
    const existing = await redis.get(k);
    if (existing && existing !== 'PENDING') return { replayed: true, tripId: existing };
    throw new AppError('That request is still being processed', 409, 'IDEMPOTENT_IN_FLIGHT');
  }
  try {
    const result = await fn();
    await redis.set(k, result.tripId ?? result.id ?? 'DONE', 'EX', 600);
    return result;
  } catch (err) {
    await redis.del(k).catch(() => {});
    throw err;
  }
}

// ── rider: request a ride ────────────────────────────────────────────────────

/**
 * Quote a ride. Pure read; issues a signed, short-lived, single-use price.
 */
async function quoteRide(userId, params) {
  return fareQuote.createQuote({ userId, ...params });
}

/**
 * Put a trip into a terminal state, and mean it.
 *
 * This used to be `applyTransition(...).catch(() => {})`, and the swallow was
 * the whole bug. The Trip and Booking rows are committed BEFORE dispatch is
 * attempted, so when dispatch failed and the transition also failed — a guard
 * rejection, a dropped connection, anything — the ride stayed at REQUESTED with
 * a CONFIRMED booking and no driver, permanently. The rider's home screen reads
 * a non-terminal booking as a live ride, so it drew the trip card with every
 * field fallen through to its placeholder ("Your driver", "your destination");
 * tapping it opened tracking, which had nothing to track and bounced straight
 * back to the map.
 *
 * The state machine stays the first choice, because it writes the TripEvent
 * that every downstream consumer replays. But a trip that cannot be
 * transitioned must still not be left looking live, so the fallback writes the
 * terminal status directly and cancels the seat with it — for the pre-driver
 * states ONLY. See the note in the catch block for why that qualification is
 * the whole safety of this function.
 */
async function failTripHard(tripId, reason, error) {
  try {
    await tripState.applyTransition(tripId, S.NO_DRIVERS_FOUND, {
      actor: ACTOR.SYSTEM,
      payload: { reason, error },
    });
    return;
  } catch (transitionErr) {
    /**
     * ONE REASON THE TRANSITION FAILS IS THAT IT SHOULD HAVE.
     *
     * `ILLEGAL_TRANSITION` from a trip that now has a driver is not a fault to
     * force past — it is the state machine reporting that somebody else won.
     * Dispatch giving up and a driver tapping Accept are two independent
     * timers, and they can land in the same instant: the cascade's last offer
     * expires, `failTripHard` runs, and the driver's accept has already moved
     * the trip to DRIVER_EN_ROUTE. Forcing NO_DRIVERS_FOUND on top of that
     * killed a live, accepted ride and cancelled every seat on it — the rider
     * watched a driver arrive on the map and then the trip vanish.
     *
     * So: re-read, and only force a trip that is still waiting for a driver.
     * Anything else is somebody's live ride.
     */
    const current = await prisma.trip
      .findUnique({ where: { id: tripId }, select: { status: true } })
      .catch(() => null);
    if (current && !FORCEABLE_STATUSES.includes(current.status)) {
      logger.warn(
        `Not forcing trip ${tripId} terminal: it is ${current.status}, which means ` +
          `it was claimed while dispatch was giving up. (${transitionErr.message})`,
      );
      return;
    }
    logger.error(
      `applyTransition to NO_DRIVERS_FOUND failed for trip ${tripId}: ` +
        `${transitionErr.message}. Forcing the terminal status directly.`,
    );
  }

  await prisma
    .$transaction(async (tx) => {
      // `status: { in: FORCEABLE_STATUSES }` makes this a compare-and-swap
      // rather than a blind write, so the same race cannot slip through between
      // the re-read above and this update.
      const forced = await tx.trip.updateMany({
        where: { id: tripId, status: { in: FORCEABLE_STATUSES } },
        data: {
          status: S.NO_DRIVERS_FOUND,
          cancelledAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (forced.count === 0) {
        logger.warn(`Trip ${tripId} left alone — it moved out of a pre-driver state mid-force.`);
        return;
      }
      await tx.booking.updateMany({
        where: { tripId, ...livePassengerWhere() },
        // `seatNumber: null` — this was the ONE seat-release site in the codebase
        // that did not null it (see utils/booking-status.js, and the twelve other
        // release sites that all do). `Booking` carries
        // `@@unique([tripId, seatNumber])`, so a cancelled row that keeps its
        // seat number permanently blocks that seat from being re-sold. It matters
        // even on a dead trip: this same trip row is what a re-dispatch or an
        // admin recovery would reuse, and the blocked seat would follow it.
        data: { status: 'CANCELLED', seatNumber: null },
      });
    })
    .catch((forceErr) => {
      // Nothing left to try. Log loudly: this is a trip that will need sweeping.
      logger.error(`Could not force trip ${tripId} terminal: ${forceErr.message}`);
    });
}

/**
 * Create the ride and start dispatch.
 *
 * The Trip row exists before any driver does. Dispatch is awaited far enough to
 * know it started; the cascade itself then runs on durable timers.
 */
async function requestRide(userId, body) {
  const {
    quoteId,
    pickupLat,
    pickupLng,
    pickupAddress,
    dropoffLat,
    dropoffLng,
    dropoffAddress,
    paymentMethod = 'CASH',
    doorstepPickup = false,
    /** How many people are travelling. Capacity information for the driver —
     *  see the note where it is written to the trip. Clamped, never trusted. */
    seatCount = 1,
    idempotencyKey = null,
    /**
     * The rider has SEEN the "you already have a ride" prompt and chosen to
     * book a second one anyway.
     *
     * The guard below exists to stop a double-tap on Confirm putting two
     * searches into dispatch, and for that it must stay the default. But it was
     * also the only answer to a legitimate request — booking a car for someone
     * else while your own ride is still running, which is the case Uber and
     * Bolt both support. An accidental second request and a deliberate one look
     * identical to the server, so the client has to say which it is.
     */
    allowConcurrent = false,
    /**
     * Who is actually travelling, when it is not the account holder.
     *
     * Stored on the BOOKING as guestName/guestPhone — the columns the group
     * flow already uses for exactly this, so the driver's passenger list, the
     * seat map and the receipt all render the right name with no new plumbing.
     * The booker still owns the trip: they pay, they see the tracking, and
     * they are who cancellation and support act on.
     */
    passenger = null,
  } = body;

  // Clamped server-side as well as validated at the route: this becomes the
  // trip's capacity, and a bad value would publish a trip claiming seats the
  // vehicle does not have.
  const partySize = Math.min(Math.max(Math.trunc(Number(seatCount)) || 1, 1), 6);

  const guestName = typeof passenger?.name === 'string' ? passenger.name.trim() || null : null;
  const guestPhone = typeof passenger?.phone === 'string' ? passenger.phone.trim() || null : null;

  return withIdempotency(idempotencyKey, userId, async () => {
    // One live ride at a time unless the rider has explicitly asked for a
    // second — see `allowConcurrent`. Without this, a double-tap on Confirm
    // puts two trips into dispatch and the rider watches two searches fight.
    if (!allowConcurrent) {
      const existing = await findActiveTripForUser(userId);
      if (existing) {
        throw new AppError(
          'You already have a ride in progress.',
          409,
          'RIDE_ALREADY_ACTIVE',
        );
      }
    }

    // Redeeming the quote is what makes the quoted price the charged price —
    // and it is single-use, so a replayed quote cannot buy a second ride.
    const quote = await fareQuote.redeemQuote(quoteId, userId);

    /**
     * Everything below this line has already spent the quote, and any of it can
     * still fail. A failure that leaves the quote spent is not recoverable from
     * the rider's side: they retry, the server says the price expired, and the
     * only way out is to back all the way to the map and re-quote. So every
     * failure path from here on hands the quote back before it rethrows.
     */
    const giveQuoteBack = () =>
      fareQuote.restoreQuote(quoteId, quote).catch(() => false);

    const trip = await prisma.$transaction(async (tx) => {
      const created = await tx.trip.create({
        data: {
          requesterId: userId,
          // No driver, no vehicle, no route. This is the shape the old schema
          // could not express.
          driverId: null,
          vehicleId: null,
          routeId: null,
          tier: quote.tier,
          status: S.REQUESTED,
          version: 0,
          doorstepPickup,
          pickupLat,
          pickupLng,
          pickupAddress,
          dropoffLat,
          dropoffLng,
          dropoffAddress,
          departureTime: new Date(),
          requestedAt: new Date(),
          baseFarePesewas: quote.breakdown.baseFarePesewas,
          perKmRatePesewas: quote.breakdown.perKmRatePesewas,
          surgeMultiplier: quote.surgeMultiplier,
          commissionRate: quote.breakdown.commissionRate,
          /**
           * Party size, not a pricing input.
           *
           * BUGFIX — this was hardcoded to 1 while the rider's seat stepper
           * happily let them pick up to four, and nothing carried the choice to
           * the server. Three people waited at a kerb for a driver whose app
           * said one passenger.
           *
           * The FARE is unaffected: an on-demand ride is priced as the whole
           * car (the quote passes `seatCount: 1` deliberately), and the rider
           * pays the quoted amount whatever this says. This is what the driver
           * is shown so they know how many people to expect and whether their
           * vehicle fits them.
           */
          maxSeats: partySize,
          confirmedSeats: partySize,
        },
      });

      // The rider's money-and-seat row. It carries no lifecycle: "where is my
      // driver" is answered by Trip.status and nothing else.
      const bookingRow = await tx.booking.create({
        data: {
          tripId: created.id,
          userId,
          seatNumber: 1,
          fareAmountPesewas: quote.amountPesewas,
          commissionAmountPesewas: quote.breakdown.commissionPerSeatPesewas,
          paymentMethod,
          paymentStatus: 'PENDING',
          status: 'CONFIRMED',
          pickupLat,
          pickupLng,
          pickupAddress,
          // Null for the ordinary case; set when booking on someone's behalf.
          guestName,
          guestPhone,
        },
      });

      /*
       * "Verify My Ride". Minted inside the same transaction as the booking —
       * a booking that exists without the pin it is supposed to have is one the
       * driver cannot board. No-ops for riders who have the setting off, which
       * is everyone by default.
       */
      await boardingPin.issuePinForBooking(tx, { bookingId: bookingRow.id, userId });

      await tx.tripEvent.create({
        data: {
          tripId: created.id,
          seq: 0,
          type: S.REQUESTED,
          actor: ACTOR.RIDER,
          actorId: userId,
          payload: {
            quoteId,
            amountPesewas: quote.amountPesewas,
            distanceKm: quote.distanceKm,
            surgeMultiplier: quote.surgeMultiplier,
          },
        },
      });

      // Nobody is going to answer forever. Armed in the same transaction so it
      // cannot be lost by a deploy — the failure mode that used to leave riders
      // searching indefinitely.
      await scheduledTasks.enqueueTx(tx, {
        type: TASK_REQUEST_EXPIRY,
        dedupeKey: created.id,
        tripId: created.id,
        runAt: new Date(Date.now() + REQUEST_EXPIRY_SECONDS * 1000),
        payload: { tripId: created.id },
      });

      /**
       * The search, armed on disk before the response is written.
       *
       * This is what lets the cascade run OUT of the request (see below). If the
       * in-process kick never happens — a crash, a deploy, a throw between the
       * commit and the `setImmediate` — this row starts the search a couple of
       * seconds later instead of leaving the rider on a spinner. `startCascade`
       * cancels it the moment the real search begins, so it normally expires
       * unused.
       */
      await scheduledTasks.enqueueTx(tx, {
        type: cascade.TASK_DISPATCH_START,
        dedupeKey: created.id,
        tripId: created.id,
        runAt: new Date(Date.now() + DISPATCH_START_RECOVERY_SECONDS * 1000),
        payload: { tripId: created.id, kind: 'ON_DEMAND' },
      });

      return created;
    }).catch(async (err) => {
      // Nothing was written, so the quote bought nothing. Hand it back before
      // the error leaves — otherwise the retry fails as FARE_EXPIRED instead of
      // as whatever actually went wrong, and the rider is stuck.
      await giveQuoteBack();
      throw err;
    });

    /**
     * DISPATCH RUNS AFTER THE RESPONSE, NOT INSIDE IT.
     *
     * This used to be `await cascade.startCascade(...)`, with a comment arguing
     * that awaiting meant "the rider finds out now" instead of getting a 200 and
     * a spinner. The argument was right about spinners and wrong about the cost.
     * Measured against the production Postgres, whose round trip is ~300 ms, the
     * awaited version put the whole funnel inside the HTTP call:
     *
     *     REQUESTED :16 → MATCHING :20 → SEARCHING :25 → OFFERED :30
     *
     * Fourteen seconds, against a fifteen-second client timeout. The rider was
     * shown "we couldn't reach the server" for a request that had succeeded, and
     * their retry hit "you already have a ride in progress" — because it did.
     * Every ghost trip in the activity list came from this.
     *
     * The spinner the old comment feared is covered properly instead of by
     * blocking: `TASK_DISPATCH_START` above guarantees the search starts even if
     * this process dies, and `TASK_REQUEST_EXPIRY` guarantees it ends. A rider
     * cannot be stranded by a dispatch that silently never began.
     */
    setImmediate(() => {
      cascade.startCascade(trip.id, { kind: 'ON_DEMAND' }).catch(async (err) => {
        logger.error(`Dispatch failed to start for trip ${trip.id}: ${err.message}`);
        // The rider already has a 200 and a trip on screen, so failing has to be
        // said on the trip's own channel rather than as an HTTP error.
        await failTripHard(trip.id, 'DISPATCH_START_FAILED', err.message).catch(() => {});
        await giveQuoteBack();
      });
    });

    const full = await prisma.trip.findUnique({ where: { id: trip.id }, include: TRIP_INCLUDE });
    return { tripId: trip.id, snapshot: buildTripSnapshot(full, { forUserId: userId }) };
  });
}

// ── rider: read ──────────────────────────────────────────────────────────────

/**
 * ONE-CALL REHYDRATION.
 *
 * Neither app had this. Cold start, foreground and reconnect each assembled
 * "where am I" from whatever queries the current screen happened to run, so an
 * app that was killed mid-trip came back not knowing it was on one. Both
 * dossiers name this single endpoint as killing an entire bug class.
 */
async function getActiveRide(userId) {
  const trip = await findActiveTripForUser(userId);
  if (!trip) return { trip: null, serverNowMs: Date.now() };
  const snapshot = await buildTripSnapshotWithPath(trip, { forUserId: userId });
  const dispatchState = [S.REQUESTED, S.MATCHING, S.REASSIGNING].includes(trip.status)
    ? await cascade.getCascadeState(trip.id)
    : null;
  return { trip: snapshot, dispatch: dispatchState, serverNowMs: Date.now() };
}

/** Replay. The client sends the last seq it applied; it gets everything after. */
async function getRideEvents(tripId, viewerId, sinceSeq = 0) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, include: TRIP_INCLUDE });
  if (!trip) throw new NotFoundError('Trip');
  const isParticipant =
    trip.requesterId === viewerId ||
    trip.driverId === viewerId ||
    trip.bookings.some((b) => b.userId === viewerId);
  if (!isParticipant) throw new AppError('Not authorized', 403, 'FORBIDDEN');

  const events = await tripState.eventsSince(tripId, sinceSeq);
  return {
    tripId,
    snapshot: await buildTripSnapshotWithPath(trip, { forUserId: viewerId }),
    events,
    serverNowMs: Date.now(),
  };
}

// ── rider: cancel ────────────────────────────────────────────────────────────

async function cancelRide(userId, tripId, reason = null) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) throw new NotFoundError('Trip');
  if (trip.requesterId !== userId) {
    const booking = await prisma.booking.findFirst({ where: { tripId, userId } });
    if (!booking) throw new AppError('Not authorized', 403, 'FORBIDDEN');
  }

  // Kill the offer chain first so no further driver is disturbed by a ride the
  // rider has already walked away from.
  await cascade.cancelCascade(tripId);

  const freeCancel = FREE_CANCEL_STATUSES.includes(trip.status);
  const { trip: updated } = await tripState.applyTransition(tripId, S.CANCELLED, {
    actor: ACTOR.RIDER,
    actorId: userId,
    payload: { reason, freeCancel },
    data: { cancelledBy: ACTOR.RIDER, cancellationReason: reason },
    sideEffects: async (tx) => {
      await tx.booking.updateMany({
        where: { tripId, status: { in: ['PENDING', 'SEAT_HELD', 'CONFIRMED', 'PAID', 'BOARDED'] } },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: reason },
      });
    },
  });

  return { tripId, status: updated.status, version: updated.version, freeCancel };
}

// ── driver ───────────────────────────────────────────────────────────────────

/**
 * Driver accepts an offer.
 *
 * The claim is a compare-and-swap inside `applyTransition`: conditioned on both
 * the status and the version we read, so two drivers tapping Accept in the same
 * millisecond resolve to exactly one winner and the loser gets a 409.
 *
 * The offer timer is stopped BEFORE the transaction (otherwise the next offer
 * fires at a second driver while this claim is in flight) and the winner is
 * announced AFTER it commits. Those used to be one call made before the
 * transaction, which meant a driver about to lose a 409 still told the rider
 * "matched with driver X" and killed the cascade.
 */
async function acceptRide(driverId, tripId) {
  if (!(await isDriverAvailable(prisma, driverId))) {
    throw new AppError('Finish your current trip before accepting another.', 409, 'DRIVER_BUSY');
  }

  const vehicle = await prisma.vehicle.findFirst({
    where: { driverId, isActive: true },
    orderBy: { isVerified: 'desc' },
  });
  if (!vehicle) {
    throw new AppError('No active vehicle registered.', 400, 'NO_VEHICLE');
  }

  await cascade.stopOfferTimer(tripId);

  let result;
  try {
    result = await tripState.applyTransition(tripId, S.DRIVER_ASSIGNED, {
      actor: ACTOR.DRIVER,
      actorId: driverId,
      data: { driverId, vehicleId: vehicle.id },
      payload: { vehicleId: vehicle.id },
    });
  } catch (err) {
    // This driver lost, or the trip moved on. Hand the cascade back its work
    // rather than leaving the rider stranded on a stopped chain.
    await cascade.resumeAfterFailedClaim(tripId, driverId).catch(() => {});
    if (err.code === 'VERSION_CONFLICT' || err.code === 'ILLEGAL_TRANSITION') {
      throw new AppError('This trip is no longer available', 409, 'TRIP_UNAVAILABLE');
    }
    throw err;
  }

  // Committed — only now is anyone told.
  await cascade.announceWinner(tripId, driverId);
  // A driver on a trip is not dispatchable supply.
  await supply.removeDriver(driverId);

  // A driver who accepted from the kerb outside the pickup is already there.
  const arrived = await autoArriveIfAtPickup(tripId, driverId);

  const full = await prisma.trip.findUnique({ where: { id: tripId }, include: TRIP_INCLUDE });
  return {
    tripId,
    status: full?.status ?? result.trip.status,
    version: full?.version ?? result.trip.version,
    snapshot: buildTripSnapshot(full, {}),
    arrivedAtPickup: arrived,
  };
}

/**
 * WHEN THE DRIVER IS ALREADY THERE, SKIP "HEADING TO PICKUP" ENTIRELY.
 *
 * BUGFIX ("the driver tracking page is showing that the driver is at the pickup
 * point (eta) but it's still showing the text heading to pickup ... I think you
 * need to make sure that if the driver is at the pickup point, they skip the
 * heading to pickup status altogether and it moves straight to the at pickup
 * status. That would fix the discrepancy between the driver and rider apps.")
 *
 * The two apps were never disagreeing with each other — they were both rendering
 * DRIVER_EN_ROUTE correctly, because nothing could move the trip off it except
 * the driver tapping "I've arrived". A driver who accepted a ride from the very
 * kerb they were being sent to therefore spent the whole wait "on the way".
 *
 * Runs on accept; the location handler in driver.socket.js runs the same rule on
 * every fix for the driver who accepts from further out. Both go through
 * `applyTransition`, so the change is published on the trip channel like any
 * other and neither app has to compute anything.
 *
 * @returns {Promise<boolean>} whether the trip was moved to ARRIVED_AT_PICKUP.
 */
async function autoArriveIfAtPickup(tripId, driverId) {
  try {
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      select: {
        id: true, status: true, pickupLat: true, pickupLng: true,
        bookings: {
          where: { ...seatOccupyingWhere() },
          select: { pickupLat: true, pickupLng: true },
        },
      },
    });
    if (!trip || (trip.status !== S.DRIVER_ASSIGNED && trip.status !== S.DRIVER_EN_ROUTE)) return false;

    const pickup = effectivePickup(trip);
    if (!pickup || !Number.isFinite(pickup.lat) || !Number.isFinite(pickup.lng)) return false;

    // Redis holds every fix; the Driver row is written through only every 15 s
    // or 60 m, so it can be a block behind at exactly the moment this matters.
    let where = null;
    try {
      const raw = await redis.get(`driver:${driverId}:location`);
      if (raw) {
        const p = JSON.parse(raw);
        if (Number.isFinite(p?.lat) && Number.isFinite(p?.lng)) where = { lat: p.lat, lng: p.lng };
      }
    } catch { /* fall through to the row */ }
    if (!where) {
      const d = await prisma.driver.findUnique({
        where: { id: driverId },
        select: { currentLat: true, currentLng: true },
      });
      if (Number.isFinite(d?.currentLat) && Number.isFinite(d?.currentLng)) {
        where = { lat: d.currentLat, lng: d.currentLng };
      }
    }
    if (!where) return false;

    const metres = haversineMeters(where.lat, where.lng, pickup.lat, pickup.lng);
    if (!(metres <= ARRIVAL_RADIUS_M)) return false;

    // The table has no DRIVER_ASSIGNED → ARRIVED_AT_PICKUP edge, and it should
    // not grow one: every ride passes through EN_ROUTE so the timeline, the
    // receipts and the driver's own history stay comparable. Stepping through it
    // in the same breath is what makes the intermediate state unobservable,
    // which is the whole of what "skip it" means here.
    if (trip.status === S.DRIVER_ASSIGNED) {
      await tripState.applyTransition(tripId, S.DRIVER_EN_ROUTE, {
        actor: ACTOR.SYSTEM, actorId: driverId,
        payload: { auto: true, reason: 'ALREADY_AT_PICKUP' },
      });
    }
    await tripState.applyTransition(tripId, S.ARRIVED_AT_PICKUP, {
      actor: ACTOR.SYSTEM, actorId: driverId,
      payload: { auto: true, distanceM: Math.round(metres) },
    });
    logger.info(`[arrival] driver ${driverId} accepted trip ${tripId} from ${Math.round(metres)}m — landed at pickup`);
    return true;
  } catch (err) {
    // Never let this fail an accept. The worst case is the old behaviour.
    logger.debug(`[arrival] auto-arrive on accept skipped for ${tripId}: ${err?.message ?? err}`);
    return false;
  }
}

async function declineRide(driverId, tripId) {
  const advanced = await cascade.declineOffer(tripId, driverId);
  return { tripId, advanced };
}

/** Driver-side lifecycle. Every one of these is the same guarded write. */
async function driverAdvance(driverId, tripId, to, payload = {}) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: { driverId: true } });
  if (!trip) throw new NotFoundError('Trip');
  if (trip.driverId !== driverId) throw new AppError('Not your trip', 403, 'FORBIDDEN');

  const { trip: updated } = await tripState.applyTransition(tripId, to, {
    actor: ACTOR.DRIVER,
    actorId: driverId,
    payload,
  });
  return { tripId, status: updated.status, version: updated.version };
}

const startEnRoute = (d, t) => driverAdvance(d, t, S.DRIVER_EN_ROUTE);
const markArrived = (d, t) => driverAdvance(d, t, S.ARRIVED_AT_PICKUP);
const startTrip = (d, t) => driverAdvance(d, t, S.IN_PROGRESS);

/**
 * Complete a trip — and settle it.
 *
 * BUG THIS FIXES: THE DRIVER WAS NOT PAID.
 *
 * This used to run its own `applyTransition` to COMPLETED plus a booking
 * sweep, and stop there. All of the money — the commission decrement, the
 * wallet credit, the cash auto-settle for seats never marked boarded, the
 * `WalletTransaction` ledger rows, the rider Receipts and the DriverReceipt —
 * lives in `trips.service.completeTrip`, which was only ever reached through
 * the legacy `driver:arrived` SOCKET event. The rewired driver app completes
 * over `POST /rides/:id/complete`, which lands here. So on the new path the
 * ride ended, the rider was charged, and nothing was credited to anyone: no
 * earnings, no commission taken, no receipt, and a cash booking left
 * `paymentStatus: PENDING` forever.
 *
 * The fix is delegation, not duplication. Two implementations of settlement
 * is how the numbers drift apart — and `trips.service.completeTrip` already
 * does the whole thing inside ONE transaction (so completion and payment
 * settle or fail together), applies the transition itself via
 * `applyTransitionTx`, and guards its own idempotency on the trip status.
 * That guard is also why the transition cannot happen here first: this
 * function marking the trip COMPLETED would make the settlement bail out
 * early and move no money at all — precisely the failure documented at
 * drivers.service.js's boardPassenger.
 */
async function completeTrip(driverId, tripId) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: { driverId: true } });
  if (!trip) throw new NotFoundError('Trip');
  if (trip.driverId !== driverId) throw new AppError('Not your trip', 403, 'FORBIDDEN');

  // Transition + booking closure + full settlement, in one transaction.
  await tripsService.completeTrip(tripId);

  const updated = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { status: true, version: true },
  });

  // Back into the pool, immediately, without waiting for the next ping.
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { currentLat: true, currentLng: true, isOnline: true },
  });
  if (driver?.isOnline && driver.currentLat != null) {
    await supply.upsertDriver(driverId, driver.currentLat, driver.currentLng);
  }
  return { tripId, status: updated?.status ?? S.COMPLETED, version: updated?.version ?? 0 };
}

/**
 * Driver cancels an assigned ride.
 *
 * The trip goes to REASSIGNING and back into dispatch — SAME trip id, same
 * receipt, same share link, same support thread. That is what
 * `driverId String?` bought. Under the old NOT-NULL model the only way to
 * recover was to mint a new trip and lose all of it.
 */
async function driverCancel(driverId, tripId, reason = null) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { driverId: true, status: true, redispatchCount: true, routeId: true },
  });
  if (!trip) throw new NotFoundError('Trip');
  if (trip.driverId !== driverId) throw new AppError('Not your trip', 403, 'FORBIDDEN');

  const canRedispatch = !trip.routeId && trip.redispatchCount < MAX_REDISPATCH;

  if (!canRedispatch) {
    const { trip: updated } = await tripState.applyTransition(tripId, S.CANCELLED, {
      actor: ACTOR.DRIVER,
      actorId: driverId,
      payload: { reason, redispatchExhausted: trip.redispatchCount >= MAX_REDISPATCH },
      data: { cancelledBy: ACTOR.DRIVER, cancellationReason: reason },
    });
    return { tripId, status: updated.status, version: updated.version, redispatched: false };
  }

  await tripState.applyTransition(tripId, S.REASSIGNING, {
    actor: ACTOR.SYSTEM,
    actorId: driverId,
    payload: { reason, previousDriverId: driverId },
    data: {
      driverId: null,
      vehicleId: null,
      assignedAt: null,
      redispatchCount: { increment: 1 },
    },
  });

  /**
   * Record the abandonment before restarting the search.
   *
   * `excludeDriverId` below only covers THIS restart. On the second or third
   * redispatch of the same trip, the driver who dropped it first would be a
   * candidate again — `startCascade` clears the previous run's state, so nothing
   * in Redis remembers them. It reads these rows instead, which survive the
   * clear, a deploy and a Redis flush.
   *
   * `CANCELLED` rather than `DECLINED` on purpose: a decline is re-offerable on
   * a later sweep, abandoning an accepted trip is not. It also stops a
   * cancellation counting against the driver's decline rate, which is measured
   * from `action: 'DECLINED'` specifically.
   */
  await prisma.dispatchAction
    .create({ data: { driverId, tripId, action: 'CANCELLED' } })
    .catch(() => {});

  // The cancelling driver is excluded so they cannot immediately be re-offered
  // the ride they just dropped.
  await cascade.startCascade(tripId, { kind: 'REASSIGNMENT', excludeDriverId: driverId });

  const updated = await prisma.trip.findUnique({ where: { id: tripId } });
  return { tripId, status: updated.status, version: updated.version, redispatched: true };
}

/** Driver one-call rehydration. */
async function getDriverState(driverId) {
  const [driver, trip, offer, pendingRequests] = await Promise.all([
    prisma.driver.findUnique({
      where: { id: driverId },
      select: { id: true, name: true, status: true, isOnline: true, currentLat: true, currentLng: true, walletBalancePesewas: true },
    }),
    findActiveTripForDriver(driverId),
    // "Is anyone waiting on me right now?" An offer is pushed over a socket
    // and never replayed — it carries no trip seq — so a phone that was asleep
    // or reconnecting for those twenty seconds has no other way to find out.
    cascade.getOfferForDriver(driverId).catch(() => null),
    /**
     * EVERY LIVE SEARCH, NOT JUST THE ONE OFFER.
     *
     * BUGFIX ("if I go to the dispatch page on the alerts page, I should be
     * able to see if there's an unaccepted offer").
     *
     * The exclusive offer above is a 45-second window and evaporates with its
     * own Redis TTL. The SEARCH behind it runs for five minutes, and for all of
     * that time there is a rider waiting who this driver could still take. That
     * is the durable fact a foregrounding app needs, and until now nothing
     * served it — which is why a driver who was a minute late back had no way
     * to discover the ride existed at all.
     */
    cascade.listSearchesForDriver(driverId).catch(() => []),
  ]);
  if (!driver) throw new NotFoundError('Driver');

  return {
    driver: {
      id: driver.id,
      name: driver.name,
      status: driver.status,
      isOnline: driver.isOnline,
      lat: driver.currentLat,
      lng: driver.currentLng,
      walletBalancePesewas: driver.walletBalancePesewas,
    },
    trip: trip ? await buildTripSnapshotWithPath(trip, {}) : null,
    // Suppressed while already on a trip: a driver mid-ride cannot take a new
    // offer, and surfacing one would put a modal over their live trip screen.
    offer: trip ? null : offer,
    // Same rule for the list — but it is a LIST, not a modal, so it is only
    // suppressed from the offer card's point of view. The alerts screen still
    // asks for it separately.
    pendingRequests: trip ? [] : pendingRequests,
    serverNowMs: Date.now(),
  };
}

/**
 * FOREGROUND RESYNC — one call, everything true again.
 *
 * BUGFIX ("I need it to come as soon as I switch over to the driver app and the
 * app is foregrounded… fix this background and foreground thing so it's fixed
 * once and for all").
 *
 * `getDriverState` is a READ. It answers "is anyone waiting on me" perfectly
 * well, and it is what the app polls — but it cannot make anything happen, and
 * the failing case needs something to happen: a cascade parked on a driver who
 * was unreachable has to be told to look again, and an offer published into an
 * empty socket room has to be re-published now that the room has somebody in
 * it. Neither is a side effect a GET is allowed to have.
 *
 * So the app's foreground handler makes exactly one POST, and this is it. It
 * nudges the cascade first, then answers with the state — in that order, so a
 * search that was resweeped into an offer by the nudge is already in the reply
 * rather than waiting on the next poll.
 */
async function resyncDriver(driverId) {
  const { nudged } = await cascade.resyncDriver(driverId).catch(() => ({ nudged: 0 }));
  const state = await getDriverState(driverId);
  return { ...state, nudged };
}

// ── durable timer: nobody answered ───────────────────────────────────────────

scheduledTasks.registerHandler(TASK_REQUEST_EXPIRY, async (task) => {
  const { tripId } = task.payload || {};
  if (!tripId) return;
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: { status: true } });
  if (!trip || !tripState.isLive(trip.status)) return;
  if (![S.REQUESTED, S.MATCHING, S.REASSIGNING].includes(trip.status)) return;

  await cascade.cancelCascade(tripId).catch(() => {});
  await tripState.applyTransition(tripId, S.EXPIRED, {
    actor: ACTOR.SYSTEM,
    payload: { reason: 'NO_DRIVER_IN_TIME', afterSeconds: REQUEST_EXPIRY_SECONDS },
  });
  logger.info(`Ride request ${tripId} expired — no driver in ${REQUEST_EXPIRY_SECONDS}s`);
});

module.exports = {
  quoteRide,
  requestRide,
  getActiveRide,
  getRideEvents,
  cancelRide,
  acceptRide,
  declineRide,
  startEnRoute,
  markArrived,
  startTrip,
  completeTrip,
  driverCancel,
  getDriverState,
  resyncDriver,
  TASK_REQUEST_EXPIRY,
};
