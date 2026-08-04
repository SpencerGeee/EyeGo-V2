'use strict';

const prisma = require('../../config/database');
const redis = require('../../config/redis');
const logger = require('../../utils/logger');
const { AppError, NotFoundError } = require('../../utils/errors');
const tripState = require('../../services/trip-state.service');
const cascade = require('../../services/dispatch-cascade.service');
const fareQuote = require('../../services/fare-quote.service');
const scheduledTasks = require('../../services/scheduled-task.service');
const supply = require('../../services/supply-index.service');
const { isDriverAvailable } = require('../../services/driver-availability');
const {
  TRIP_INCLUDE,
  buildTripSnapshot,
  findActiveTripForUser,
  findActiveTripForDriver,
} = require('../../services/trip-view');

const { TRIP_STATUS: S, ACTOR } = tripState;

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
    idempotencyKey = null,
  } = body;

  return withIdempotency(idempotencyKey, userId, async () => {
    // One live ride at a time. Without this, a double-tap on Confirm puts two
    // trips into dispatch and the rider watches two searches fight.
    const existing = await findActiveTripForUser(userId);
    if (existing) {
      throw new AppError(
        'You already have a ride in progress.',
        409,
        'RIDE_ALREADY_ACTIVE',
      );
    }

    // Redeeming the quote is what makes the quoted price the charged price —
    // and it is single-use, so a replayed quote cannot buy a second ride.
    const quote = await fareQuote.redeemQuote(quoteId, userId);

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
          maxSeats: 1,
          confirmedSeats: 1,
        },
      });

      // The rider's money-and-seat row. It carries no lifecycle: "where is my
      // driver" is answered by Trip.status and nothing else.
      await tx.booking.create({
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
        },
      });

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

      return created;
    });

    // Awaited. If dispatch cannot start the rider finds out now, rather than
    // getting a 200 and an eternal spinner — which is exactly what the old
    // `setImmediate` path did.
    try {
      await cascade.startCascade(trip.id, { kind: 'ON_DEMAND' });
    } catch (err) {
      logger.error(`Dispatch failed to start for trip ${trip.id}: ${err.message}`);
      await tripState
        .applyTransition(trip.id, S.NO_DRIVERS_FOUND, {
          actor: ACTOR.SYSTEM,
          payload: { reason: 'DISPATCH_START_FAILED', error: err.message },
        })
        .catch(() => {});
      throw new AppError('We could not start looking for a driver. Please try again.', 503, 'DISPATCH_UNAVAILABLE');
    }

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
  const snapshot = buildTripSnapshot(trip, { forUserId: userId });
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
    snapshot: buildTripSnapshot(trip, { forUserId: viewerId }),
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

  const full = await prisma.trip.findUnique({ where: { id: tripId }, include: TRIP_INCLUDE });
  return { tripId, status: result.trip.status, version: result.trip.version, snapshot: buildTripSnapshot(full, {}) };
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

async function completeTrip(driverId, tripId) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: { driverId: true } });
  if (!trip) throw new NotFoundError('Trip');
  if (trip.driverId !== driverId) throw new AppError('Not your trip', 403, 'FORBIDDEN');

  const { trip: updated } = await tripState.applyTransition(tripId, S.COMPLETED, {
    actor: ACTOR.DRIVER,
    actorId: driverId,
    sideEffects: async (tx) => {
      await tx.booking.updateMany({
        where: { tripId, status: { in: ['CONFIRMED', 'PAID', 'BOARDED'] } },
        data: { status: 'COMPLETED' },
      });
    },
  });
  // Back into the pool, immediately, without waiting for the next ping.
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { currentLat: true, currentLng: true, isOnline: true },
  });
  if (driver?.isOnline && driver.currentLat != null) {
    await supply.upsertDriver(driverId, driver.currentLat, driver.currentLng);
  }
  return { tripId, status: updated.status, version: updated.version };
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

  // The cancelling driver is excluded so they cannot immediately be re-offered
  // the ride they just dropped.
  await cascade.startCascade(tripId, { kind: 'REASSIGNMENT', excludeDriverId: driverId });

  const updated = await prisma.trip.findUnique({ where: { id: tripId } });
  return { tripId, status: updated.status, version: updated.version, redispatched: true };
}

/** Driver one-call rehydration. */
async function getDriverState(driverId) {
  const [driver, trip] = await Promise.all([
    prisma.driver.findUnique({
      where: { id: driverId },
      select: { id: true, name: true, status: true, isOnline: true, currentLat: true, currentLng: true, walletBalancePesewas: true },
    }),
    findActiveTripForDriver(driverId),
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
    trip: trip ? buildTripSnapshot(trip, {}) : null,
    serverNowMs: Date.now(),
  };
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
  TASK_REQUEST_EXPIRY,
};
