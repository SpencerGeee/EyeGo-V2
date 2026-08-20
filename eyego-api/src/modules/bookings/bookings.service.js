'use strict';

const prisma = require('../../config/database');
const env = require('../../config/env');
const { calculateFare, calculateEnRouteFare, detourKm, calculateDeviationSurcharge } = require('../trips/fare.calculator');
const { SeatTakenError, NotFoundError, AppError, ForbiddenError } = require('../../utils/errors');
const tripState = require('../../services/trip-state.service');
const { seatOccupyingWhere, SEAT_RELEASING_STATUSES } = require('../../utils/booking-status');
const routeGeometry = require('../../services/route-geometry.service');
const boardingPin = require('../../services/boarding-pin.service');
const { percentOf, sum, formatGhs, assertPesewas } = require('../../utils/money');
// Invite links follow the origin the API is being reached at, not the baked-in
// APP_URL — see utils/publicUrl.js.
const { inviteUrl } = require('../../utils/publicUrl');
const logger = require('../../utils/logger');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const SEAT_HOLD_MS = require('../../config/settings').get('SEAT_HOLD_DURATION_MINUTES') * 60 * 1000;

// Map the rider-facing method to a value we persist on the booking.
// MoMo defaults to the MTN provider key Paystack expects; the rider can still
// pay with another network at the prompt. CASH/WALLET/CARD are stored verbatim.
const VALID_PAYMENT_METHODS = ['MOMO', 'CARD', 'CASH', 'WALLET', 'MOMO_MTN', 'MOMO_TELECEL', 'MOMO_AIRTELTIGO'];
function normalizePaymentMethod(method) {
  if (!method) return 'MOMO_MTN';
  if (method === 'MOMO') return 'MOMO_MTN';
  if (!VALID_PAYMENT_METHODS.includes(method)) return 'MOMO_MTN';
  return method;
}

// Deviation surcharge (own pickup point) + heavy-cargo surcharge, applied on top
// of an already-computed per-person base fare (which may itself already be an
// en-route-boarding-discounted fare). Shared by bookSeat and the two post-booking
// update endpoints so there is exactly one place that combines these add-ons —
// applying them independently in multiple spots is what let the old client-only
// "heavy cargo" toggle drift out of sync with the actual charge.
/**
 * The heavy-cargo surcharge for one booking, in one place.
 *
 * `Booking.heavyCargo` is a boolean; the money it means is env-driven. Deriving
 * it in more than one spot is how the group hub ended up showing a total that
 * did not contain a surcharge the booking row had already been charged.
 */
function cargoSurchargeFor(booking) {
  return booking?.heavyCargo ? env.HEAVY_LOAD_SURCHARGE_PESEWAS : 0;
}

function applyFareAddons(baseFarePerPerson, { trip, pickupLat, pickupLng, heavyCargo }) {
  let deviationSurchargePesewas = 0;
  if (pickupLat != null && pickupLng != null && Number.isFinite(pickupLat) && Number.isFinite(pickupLng) && trip.route) {
    const extraKm = detourKm({
      fromLat: trip.route.originLat, fromLng: trip.route.originLng,
      viaLat: pickupLat, viaLng: pickupLng,
      toLat: trip.route.destLat, toLng: trip.route.destLng,
    });
    deviationSurchargePesewas = calculateDeviationSurcharge({ extraKm, perKmRatePesewas: trip.perKmRatePesewas });
  }
  const cargoSurcharge = cargoSurchargeFor({ heavyCargo });
  // All three terms are already whole pesewas, so the sum is exact — no
  // rounding step, and therefore no place for a rounding disagreement.
  const fareAmountPesewas = sum(baseFarePerPerson, deviationSurchargePesewas, cargoSurcharge);
  const commissionAmountPesewas = percentOf(fareAmountPesewas, env.PLATFORM_COMMISSION);
  return { fareAmountPesewas, commissionAmountPesewas, deviationSurchargePesewas, cargoSurcharge };
}

/**
 * Recompute a SEAT_HELD booking's fare after the rider changes their pickup point
 * and/or heavy-cargo flag post-booking (the booking is created immediately when the
 * invite screen mounts, before the rider has had any chance to set either). Whichever
 * add-on isn't passed in this call is preserved from the booking's current value —
 * so setting pickup doesn't silently clear a previously-set cargo flag or vice versa.
 * Runs the read-check-write as one atomic unit so a concurrent cancel/expiry between
 * the read and the write can't leave a CANCELLED booking with a freshly-written fare.
 */
async function recomputeBookingAddons(bookingId, userId, { pickupLat, pickupLng, pickupAddress, heavyCargo } = {}) {
  return prisma.$transaction(
    async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: { trip: { include: { route: true } } },
      });
      if (!booking) throw new NotFoundError('Booking');
      if (booking.userId !== userId) throw new ForbiddenError();
      // PENDING is pre-payment too — a cash booking sits there until the seat
      // is held. Excluding it meant toggling Heavy cargo on the group hub for a
      // cash ride answered "this booking is already confirmed", which is both
      // wrong and unactionable.
      if (booking.status !== 'SEAT_HELD' && booking.status !== 'PENDING') {
        throw new AppError('This booking is already confirmed and can no longer be changed', 400, 'BOOKING_LOCKED');
      }

      const trip = booking.trip;
      // Ad-hoc trips created by the group/on-demand pivot reuse the Route model
      // as a throwaway row, and a trip whose Route was never created (or was
      // cleaned up) reaches here with `route: null`. Reading `.distanceKm` off
      // that threw a TypeError, which surfaced to the rider as an opaque 500 on
      // an otherwise valid pickup change.
      if (!trip.route) {
        throw new AppError(
          'This trip has no route information yet, so pickup changes are unavailable.',
          409,
          'TRIP_ROUTE_MISSING',
        );
      }
      const baseFareData = calculateFare({
        tier: trip.tier,
        distanceKm: trip.route.distanceKm,
        seatCount: trip.maxSeats,
        doorstepPickup: trip.doorstepPickup,
        heavyLoad: trip.heavyLoad,
        surgeMultiplier: trip.surgeMultiplier,
        storedBaseFarePesewas: trip.baseFarePesewas,
        storedPerKmRatePesewas: trip.perKmRatePesewas,
      });
      // Preserve any existing en-route-boarding discount ratio this booking already had.
      const baseFarePerPerson = booking.enRouteRatio != null
        ? Math.round(baseFareData.farePerPersonPesewas * booking.enRouteRatio)
        : baseFareData.farePerPersonPesewas;

      const finalPickupLat = pickupLat !== undefined ? pickupLat : booking.pickupLat;
      const finalPickupLng = pickupLng !== undefined ? pickupLng : booking.pickupLng;
      const finalPickupAddress = pickupAddress !== undefined ? pickupAddress : booking.pickupAddress;
      const finalHeavyCargo = heavyCargo !== undefined ? heavyCargo : booking.heavyCargo;

      const addons = applyFareAddons(baseFarePerPerson, {
        trip, pickupLat: finalPickupLat, pickupLng: finalPickupLng, heavyCargo: finalHeavyCargo,
      });

      const result = await tx.booking.updateMany({
        where: { id: bookingId, status: { in: ['SEAT_HELD', 'PENDING'] } },
        data: {
          pickupLat: finalPickupLat ?? null,
          pickupLng: finalPickupLng ?? null,
          pickupAddress: finalPickupAddress ?? null,
          heavyCargo: !!finalHeavyCargo,
          deviationSurchargePesewas: addons.deviationSurchargePesewas,
          fareAmountPesewas: addons.fareAmountPesewas,
          commissionAmountPesewas: addons.commissionAmountPesewas,
        },
      });
      if (result.count === 0) {
        throw new AppError('This booking is already confirmed and can no longer be changed', 400, 'BOOKING_LOCKED');
      }
      return tx.booking.findUnique({ where: { id: bookingId } });
    },
    { isolationLevel: 'Serializable', maxWait: 5000, timeout: 10000 },
  ).then(async (updated) => {
    /**
     * TELL THE DRIVER. "I updated the pickup point on the group hub but it
     * never updates on the driver app, so everything seems as though it's the
     * same."
     *
     * It was: this wrote the new coordinates to the row and announced nothing.
     * The driver's app has no reason to re-read a booking it already has, so
     * it went on drawing — and driving to — the old point. A pickup the
     * passenger has moved and the driver cannot see is the one kind of stale
     * data on this screen that wastes somebody's fuel.
     *
     * The snapshot already carries each booking's own pickup (TRIP_INCLUDE
     * selects pickupLat/Lng/Address), so publishing the event is the whole fix
     * — there is nothing extra for the client to fetch.
     */
    if (updated?.tripId) {
      await tripState
        .recordEvent(updated.tripId, 'BOOKING_UPDATED', {
          actor: tripState.ACTOR.RIDER,
          payload: {
            bookingId,
            pickupLat: updated.pickupLat,
            pickupLng: updated.pickupLng,
            pickupAddress: updated.pickupAddress,
            heavyCargo: updated.heavyCargo,
          },
        })
        .catch(() => {});

      // The cached leg to the OLD pickup is now a route to the wrong place.
      // Dropping it forces the next ETA pass to re-route from scratch rather
      // than serving a line that no longer ends where the passenger is.
      await routeGeometry.clearRouteForTrip(updated.tripId).catch(() => {});
    }
    return updated;
  });
}

async function bookSeat(userId, tripId, seatNumber, pickupStopId = null, paymentMethod = null, guestName = null, guestPhone = null, joinerPickup = null) {
  // Use $transaction with Serializable isolation to prevent race conditions.
  // This ensures two riders can't book the same seat simultaneously and the
  // capacity check races are eliminated.
  const result = await prisma.$transaction(
    async (tx) => {
      // Re-read trip INSIDE the serializable transaction so we see the latest state
      const trip = await tx.trip.findUnique({
        where: { id: tripId },
        include: { route: { include: { virtualStops: { where: { isActive: true } } } } },
      });
      if (!trip) throw new NotFoundError('Trip');
      if (!['SCHEDULED', 'FILLING'].includes(trip.status)) {
        throw new AppError('This trip is no longer accepting bookings', 400, 'TRIP_UNAVAILABLE');
      }

      // Release the hold this PASSENGER already has on this trip — the "go back
      // and pick a different seat" flow, which would otherwise leave a ghost
      // seat behind. Null the seatNumber too, or the cancelled row keeps it and
      // re-picking that seat collides on @@unique([tripId, seatNumber]).
      //
      // THIS MUST RUN BEFORE THE CAPACITY COUNT. It used to run after, which
      // caused both halves of a single report:
      //
      //   "book and invite my group said 'could not reserve a seat, the trip
      //    may be full' — the only person on it was one offline rider the
      //    driver added"
      //   "when i go back to seat selection, 2 seats are reserved instead of
      //    the one offline seat"
      //
      // The group-hub screen creates a booking the moment it mounts. Re-enter
      // it — after a back, a retry, a failed payment — and the rider arrives
      // already holding a seat. The capacity count includes every non-cancelled
      // booking, so it counted the rider's OWN outstanding hold against them:
      // one offline rider + the rider's own stale hold reached `maxSeats` and
      // the trip reported itself full to the very person whose seat it was.
      //
      // Worse, throwing there meant this release never ran, so the stale hold
      // was preserved by the failure — the seat map legitimately showed two
      // reserved seats for one passenger, and each retry could strand another.
      // Releasing first makes the count mean what it says: seats held by
      // SOMEONE ELSE.
      //
      // BUGFIX (reported: "I booked for Sophia, then booked my own seat, and
      // the driver only ever sees one seat taken"). This used to key on
      // `{ tripId, userId }` alone. One account can legitimately hold SEVERAL
      // seats on one trip — their own plus a seat booked for each guest — and
      // every one of those rows carries the booker's userId. So the moment the
      // rider confirmed their own seat, this cancelled the guest's seat they
      // had just paid attention to, and the trip went back down to one booking.
      //
      // The unit of "same seat request" is the PASSENGER, not the account: a
      // guest is identified by the name/phone the booker entered, and the
      // booker themselves is the row with no guest attached.
      //
      // BUGFIX ("I chose pay for everyone, the hub said 36, then the tracking
      // page said 8 and the driver's receipt said one seat"). A COVERED SEAT IS
      // NOT THIS PASSENGER RE-PICKING A SEAT. `{ guestName: null }` alone matches
      // every seat the host is holding on the group's behalf — those rows carry
      // the host's userId and no guest — so the next `bookSeat` on the trip
      // cancelled all of them. And there is always a next one: the group hub
      // creates a booking whenever it mounts without one, and the payment screen
      // creates one whenever the stored hold does not match its checkout.
      //
      // So the flow "turn on pay-for-everyone → go to payment" silently
      // destroyed eleven of the twelve seats it had just claimed, which is why
      // every downstream number was one seat's worth: the snapshot summed one
      // booking, and the driver's receipt counted one passenger. Cover-all seats
      // are released by `syncCoveredSeatsTx` and nothing else.
      const samePassenger = guestName
        ? { guestName, guestPhone: guestPhone ?? null }
        : { guestName: null, isCoveredByLead: false };
      /**
       * AT MOST ONE ROW. This was an `updateMany`, and the identity it matches on
       * is not unique: two guests can share a name, and `guestPhone` is optional,
       * so booking a second seat for a second "Ama" with no phone number matched
       * BOTH rows and cancelled the first Ama's seat along with the stale hold it
       * was meant to clear. Booking several seats for people you only have first
       * names for is the normal case for this feature, not an edge case.
       *
       * The intent here is narrow — "this passenger is moving to a different
       * seat, drop the seat they were holding" — and that is exactly one row. So
       * take the most recent matching hold and release only that. If the match is
       * ambiguous the older rows are left alone; the worst case becomes a stale
       * hold that expires on its own timer, instead of a paid guest silently
       * losing their seat.
       */
      const staleHold = await tx.booking.findFirst({
        where: { tripId, userId, status: 'SEAT_HELD', ...samePassenger },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (staleHold) {
        await tx.booking.update({
          where: { id: staleHold.id },
          data: { status: 'CANCELLED', seatNumber: null },
        });
      }

      // ── Capacity guard: ensure there's still room ───────────────────────
      // Counted AFTER the release above, so this is the number of seats held by
      // everyone other than the passenger currently asking for one.
      // `seatOccupyingWhere()` rather than "not cancelled": a NO_SHOW, an
      // EXPIRED hold and a REFUNDED booking all release their seat, and the old
      // filter counted every one of them as still occupying it. That is how a
      // trip became permanently unfillable after one no-show.
      const activeBookingCount = await tx.booking.count({
        where: { tripId, ...seatOccupyingWhere() },
      });
      if (activeBookingCount >= trip.maxSeats) {
        throw new AppError('This trip is full', 400, 'TRIP_FULL');
      }

      // Check seat is not already taken by someone else. Same fix: this is what
      // stopped a specific seat number from ever being re-sold.
      const existing = await tx.booking.findFirst({
        where: { tripId, seatNumber, ...seatOccupyingWhere() },
      });
      if (existing) throw new SeatTakenError();

      // Calculate fare using maxSeats as the denominator — this is the fixed
      // capacity the driver set for the trip and matches the listing price exactly.
      const fareData = calculateFare({
        tier: trip.tier,
        distanceKm: trip.route.distanceKm,
        seatCount: trip.maxSeats,
        doorstepPickup: trip.doorstepPickup,
        heavyLoad: trip.heavyLoad,
        surgeMultiplier: trip.surgeMultiplier,
        storedBaseFarePesewas: trip.baseFarePesewas,
        storedPerKmRatePesewas: trip.perKmRatePesewas,
      });

      // En-route boarding: if a virtual stop was selected, apply a distance-
      // proportional discount (rider travels less of the route → pays less).
      let finalFareAmount = fareData.farePerPersonPesewas;
      let finalCommission = fareData.commissionPerSeatPesewas;
      let enRouteRatio = null;
      let resolvedPickupStopId = null;

      if (pickupStopId) {
        const stop = trip.route.virtualStops.find((s) => s.id === pickupStopId);
        if (!stop) throw new AppError('Invalid pickup stop for this route', 400, 'INVALID_STOP');

        const enRoute = calculateEnRouteFare({
          fullFarePerSeatPesewas: fareData.farePerPersonPesewas,
          stopLat: stop.lat,
          stopLng: stop.lng,
          destLat: trip.route.destLat,
          destLng: trip.route.destLng,
          totalRouteKm: trip.route.distanceKm,
        });

        finalFareAmount = enRoute.farePerSeatPesewas;
        finalCommission = percentOf(finalFareAmount, env.PLATFORM_COMMISSION);
        enRouteRatio = enRoute.ratio;
        resolvedPickupStopId = pickupStopId;
      }

      // Group-hub joiner picking their own pickup point (not the trip's main
      // pickup, e.g. a friend booked via invite link from a different part of
      // town) — surcharge only the genuinely large detours, per fare.calculator.
      const addons = applyFareAddons(finalFareAmount, {
        trip, pickupLat: joinerPickup?.lat, pickupLng: joinerPickup?.lng, heavyCargo: false,
      });
      finalFareAmount = addons.fareAmountPesewas;
      finalCommission = addons.commissionAmountPesewas;
      const deviationSurchargePesewas = addons.deviationSurchargePesewas;

      const boardingQr = crypto.randomBytes(16).toString('hex');
      const holdExpiry = new Date(Date.now() + SEAT_HOLD_MS);

      const booking = await tx.booking.create({
        data: {
          tripId,
          userId,
          seatNumber,
          fareAmountPesewas: finalFareAmount,
          commissionAmountPesewas: finalCommission,
          paymentMethod: normalizePaymentMethod(paymentMethod),
          status: 'SEAT_HELD',
          boardingQr,
          guestName,
          guestPhone,
          ...(resolvedPickupStopId && { pickupStopId: resolvedPickupStopId, enRouteRatio }),
          ...(joinerPickup?.lat != null && {
            pickupLat: joinerPickup.lat,
            pickupLng: joinerPickup.lng,
            pickupAddress: joinerPickup.address ?? null,
            deviationSurchargePesewas,
          }),
        },
      });

      // Update trip status to FILLING if first booking. Through the state
      // machine so the driver's app learns a seat was taken from the same
      // event stream as everything else, in the same transaction as the seat.
      let transition = null;
      if (trip.status === 'SCHEDULED') {
        transition = await tripState.applyTransitionTx(tx, tripId, 'FILLING', {
          actor: tripState.ACTOR.SYSTEM,
          payload: { firstBookingId: booking.id },
        });
      }

      /*
       * "Verify My Ride" — same transaction as the seat, for the same reason
       * as the on-demand path in rides.service.js. On a shared van this matters
       * more, not less: every passenger boards separately and each one needs
       * their own answer to "is this my car".
       */
      await boardingPin.issuePinForBooking(tx, { bookingId: booking.id, userId });

      return { booking, fareData, holdExpiry, transition };
    },
    {
      isolationLevel: 'Serializable', // Prevent double-booking race conditions
      maxWait: 5000, // Wait up to 5s for the transaction to begin
      timeout: 10000, // Abort after 10s if the transaction hasn't completed
    },
  );

  // Post-commit only — a SCHEDULED→FILLING event emitted from inside a
  // serializable transaction that then retried would tell the driver a seat
  // was taken twice.
  if (result.transition) tripState.publishCommitted(result.transition);
  return result;
}

/**
 * Create the ride group, or update the one that exists.
 *
 * TWO BUGS LIVED HERE, and together they made "I'll pay for everyone" a
 * checkbox that changed a number on one screen and nothing else.
 *
 * 1. `if (existing) return existing` — the group is created when the invite
 *    LINK is generated, which always happens before the host reaches the
 *    cover-all toggle. So by the time the toggle fired this call, the group
 *    already existed and the new `isCoverAll` was thrown away unread. The
 *    settlement code in payments.service reads `group.isCoverAll` and was
 *    therefore looking at a flag that could never become true.
 *
 * 2. Even with the flag set, settlement only covers seats that ALREADY have a
 *    held booking on them. A host who pays for everyone before anyone has
 *    joined has no siblings to settle, so the charge was one seat — which is
 *    the reported "I paid for everyone and the fare is 4.80", and the same
 *    root cause as the driver seeing one passenger and one seat of earnings:
 *    with no rows for the other seats, there was nothing for either app to
 *    count.
 *
 * So turning cover-all ON now claims the free seats for the host, as real
 * bookings flagged `isCoveredByLead`. That makes the seat map, the occupancy
 * count, the driver's earnings and the host's charge all fall out of the same
 * rows, with no second notion of "how many seats did they really buy".
 */
async function createRideGroup(tripId, userId, isCoverAll = false) {
  // Wrap in serializable transaction to eliminate TOCTOU race between check and insert.
  // Without this, concurrent calls could both see no existing group and both create one,
  // violating the unique constraint or creating duplicate groups.
  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.rideGroup.findUnique({ where: { tripId } });

      let group;
      if (existing) {
        // Only the lead may change how the group pays.
        if (existing.leadPassengerId !== userId) return existing;
        group =
          existing.isCoverAll === !!isCoverAll
            ? existing
            : await tx.rideGroup.update({
                where: { tripId },
                data: { isCoverAll: !!isCoverAll },
              });
      } else {
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h — matches generateInvite
        group = await tx.rideGroup.create({
          data: { tripId, leadPassengerId: userId, isCoverAll: !!isCoverAll, expiresAt },
        });
      }

      await syncCoveredSeatsTx(tx, tripId, userId, !!isCoverAll);
      return group;
    },
    { isolationLevel: 'Serializable', maxWait: 5000, timeout: 15000 },
  ).then(async (group) => {
    // Post-commit. Claiming (or releasing) every free seat changes what the
    // driver's seat map and passenger count should say, and the driver has no
    // reason to refetch on their own — without this the app keeps showing seats
    // as free until something else happens to reload it.
    await tripState
      .recordEvent(tripId, 'SEAT_UPDATE', {
        actor: tripState.ACTOR.RIDER,
        payload: { reason: isCoverAll ? 'COVER_ALL_ON' : 'COVER_ALL_OFF', leadPassengerId: userId },
      })
      .catch(() => {});
    return group;
  });
}

/**
 * Make the trip's seat rows agree with the host's cover-all choice.
 *
 * ON  — hold every remaining free seat for the host, priced identically to
 *       their own seat, flagged `isCoveredByLead` so it is distinguishable
 *       from a seat they deliberately booked for a named companion.
 * OFF — release only the seats claimed this way. A real joiner's booking is
 *       never touched, and neither is anything already paid for: money that
 *       has moved is not ours to undo here.
 */
async function syncCoveredSeatsTx(tx, tripId, leadUserId, coverAll) {
  const trip = await tx.trip.findUnique({
    where: { id: tripId },
    select: {
      maxSeats: true,
      tier: true,
      doorstepPickup: true,
      heavyLoad: true,
      surgeMultiplier: true,
      baseFarePesewas: true,
      perKmRatePesewas: true,
      route: { select: { distanceKm: true } },
    },
  });
  if (!trip) return;

  if (!coverAll) {
    await tx.booking.updateMany({
      where: {
        tripId,
        userId: leadUserId,
        isCoveredByLead: true,
        status: 'SEAT_HELD',
        paymentStatus: { notIn: ['PAID', 'CASH_PENDING'] },
      },
      /**
       * `seatNumber: null` is load-bearing.
       *
       * BUGFIX — turning cover-all OFF permanently destroyed those seats.
       *
       * The unique key is `@@unique([tripId, seatNumber])` with no status in
       * it, so a CANCELLED row that keeps `seatNumber: 3` blocks seat 3 for the
       * life of the trip. Two things then went wrong at once: no joiner could
       * ever take those seats (SeatTakenError on a seat the map draws as free),
       * and `createMany({ skipDuplicates: true })` below silently skipped them
       * if the host toggled cover-all back ON — so the host could not re-hold
       * the van they had just released either.
       *
       * Toggling this switch twice is not an edge case; it is the first thing
       * anyone does when they are deciding whether to pay for everyone.
       */
      data: {
        status: 'CANCELLED',
        seatNumber: null,
        cancelledAt: new Date(),
        cancellationReason: 'COVER_ALL_OFF',
      },
    });
    return;
  }

  const taken = await tx.booking.findMany({
    where: { tripId, ...seatOccupyingWhere() },
    select: { seatNumber: true },
  });
  const takenSeats = new Set(taken.map((b) => b.seatNumber).filter((n) => n != null));

  const free = [];
  for (let n = 1; n <= trip.maxSeats; n += 1) if (!takenSeats.has(n)) free.push(n);
  if (free.length === 0) return;

  // The same denominator the host's own seat was priced with (`maxSeats`), so
  // every seat on this trip costs the same and the total is exactly the trip's
  // total cost rather than a second, separately-derived number.
  const fareData = calculateFare({
    tier: trip.tier,
    distanceKm: trip.route?.distanceKm ?? 0,
    seatCount: trip.maxSeats,
    doorstepPickup: trip.doorstepPickup,
    heavyLoad: trip.heavyLoad,
    surgeMultiplier: trip.surgeMultiplier,
    storedBaseFarePesewas: trip.baseFarePesewas,
    storedPerKmRatePesewas: trip.perKmRatePesewas,
  });

  const lead = await tx.booking.findFirst({
    where: { tripId, userId: leadUserId, isCoveredByLead: false, ...seatOccupyingWhere() },
    select: { paymentMethod: true },
  });

  await tx.booking.createMany({
    data: free.map((seatNumber) => ({
      tripId,
      userId: leadUserId,
      seatNumber,
      fareAmountPesewas: fareData.farePerPersonPesewas,
      commissionAmountPesewas: fareData.commissionPerSeatPesewas,
      paymentMethod: lead?.paymentMethod ?? 'CASH',
      status: 'SEAT_HELD',
      isCoveredByLead: true,
      boardingQr: crypto.randomBytes(16).toString('hex'),
    })),
    skipDuplicates: true,
  });
}

/**
 * WHAT THIS RIDER OWES FOR THIS TRIP. One number, one derivation.
 *
 * BUGFIX (reported three ways: "heavy cargo doesn't change the total", "the hub
 * said 36 and the tracking page said 8", "the receipt says one seat at 8 while
 * the ride was 36"). Every surface was inventing its own answer:
 *
 *   group hub      trip.totalTripCostPesewas, or perSeat × members — client math
 *                  that structurally CANNOT contain a per-booking surcharge, so
 *                  the heavy-cargo line said "includes surcharge" next to a
 *                  number that did not
 *   payment screen the same client guess, while `initiatePayment` charged
 *                  booking + siblings — display and charge were two numbers
 *   tracking       Σ of the rider's booking rows (correct, and the only one)
 *   receipt        the driver's own reduce over whatever rows it could see
 *
 * The rider's obligation is not derivable from the trip; it is the SUM OF THE
 * BOOKING ROWS THEY OWN, which is where every surcharge, discount and covered
 * seat already lives. This returns exactly that, plus the components broken out
 * so a screen can name them WITHOUT adding anything up itself. No caller may
 * re-derive a total from a per-seat price again.
 *
 * `seatOccupyingWhere()` and not "not cancelled": a released hold, a no-show or
 * a refund is not money this rider owes.
 */
async function getTripFareForRider(tripId, userId, { tx = prisma, bookingId = null } = {}) {
  const SELECT = {
    id: true,
    userId: true,
    seatNumber: true,
    fareAmountPesewas: true,
    deviationSurchargePesewas: true,
    heavyCargo: true,
    isCoveredByLead: true,
    paymentStatus: true,
    paymentMethod: true,
    status: true,
  };
  const group = await tx.rideGroup.findUnique({
    where: { tripId },
    select: { isCoverAll: true, leadPassengerId: true },
  });
  const isCoverAll = !!(group?.isCoverAll && group.leadPassengerId === userId);

  /**
   * The rows this rider is settling — THE SAME SET `initiatePayment` charges for
   * and `confirmPayment` marks paid (payments.service.js: the booking in hand,
   * plus every other still-held seat on the trip when its owner is the cover-all
   * lead). It has to be the same set, or the group hub shows one number and the
   * gateway takes another, which is the whole class of defect this function
   * exists to end.
   *
   * `bookingId` scopes it to one checkout — pass it wherever a specific booking
   * is about to be paid for. Omitted (the tracking page, a receipt), the answer is
   * the rider's whole obligation on the trip, which for anyone who is not booking
   * for guests is the same rows.
   */
  const own = bookingId
    ? { id: bookingId, userId, ...seatOccupyingWhere() }
    : { userId, ...seatOccupyingWhere() };
  const bookings = await tx.booking.findMany({
    where: isCoverAll ? { tripId, OR: [own, { status: 'SEAT_HELD' }] } : { tripId, ...own },
    select: SELECT,
  });

  const totalPesewas = sum(...bookings.map((b) => b.fareAmountPesewas || 0));
  const cargoSurchargePesewas = sum(...bookings.map(cargoSurchargeFor));
  const deviationSurchargePesewas = sum(...bookings.map((b) => b.deviationSurchargePesewas || 0));
  const seatCount = bookings.length;
  // The clean unit price: the total with the extras taken back out. Derived FROM
  // the total rather than the total being derived from it, so the two can never
  // disagree by a rounding step.
  const baseTotal = totalPesewas - cargoSurchargePesewas - deviationSurchargePesewas;
  const perSeatPesewas = seatCount > 0 ? Math.round(baseTotal / seatCount) : 0;

  // "Committed" is the honest word for a cash seat: the rider has confirmed the
  // booking and owes the driver on boarding, but no money has moved yet. A
  // SEAT_HELD row is neither — it is a reservation with a timer on it.
  const isCommitted = (b) =>
    b.paymentStatus === 'PAID' || ['CONFIRMED', 'BOARDED', 'COMPLETED'].includes(b.status);

  return {
    currency: 'GHS',
    /** THE number. What this rider owes / has paid for this trip. */
    totalPesewas,
    seatCount,
    perSeatPesewas,
    cargoSurchargePesewas,
    deviationSurchargePesewas,
    committedSeatCount: bookings.filter(isCommitted).length,
    paidSeatCount: bookings.filter((b) => b.paymentStatus === 'PAID').length,
    heldSeatCount: bookings.filter((b) => b.status === 'SEAT_HELD').length,
    coveredSeatCount: bookings.filter((b) => b.isCoveredByLead).length,
    seatNumbers: bookings.map((b) => b.seatNumber).filter((n) => n != null).sort((a, b) => a - b),
    isCoverAll,
    /** Seats on this trip owned by somebody else that this rider is covering. */
    seatsCoveredForOthers: bookings.filter((b) => b.userId !== userId).length,
  };
}

async function cancelBooking(bookingId, userId, { reason, note } = {}) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { trip: { select: { status: true } } },
  });
  if (!booking) throw new NotFoundError('Booking');
  /**
   * OWNERSHIP, WITH NO NULL ESCAPE HATCH.
   *
   * SECURITY FIX. This read `if (booking.userId !== null && booking.userId !==
   * userId) throw` — so when `userId` WAS null the check passed and any
   * authenticated rider could cancel the booking, given only its id.
   *
   * The comment justified it as "guest bookings have userId=null", but that is
   * not where guest bookings come from. A rider booking on someone else's
   * behalf gets the BOOKER's userId plus guestName/guestPhone (see the
   * `passenger` handling in rides.service). The only rows with a null userId
   * are the driver's own offline/cash passengers, created by `addCashNoPhone` —
   * people who are not app users at all and whose seats a stranger has no
   * business releasing.
   *
   * Those are cancelled through the driver's endpoints, which authorise on trip
   * ownership. Nothing legitimate reaches this function with a null userId.
   */
  if (booking.userId === null || booking.userId !== userId) throw new ForbiddenError();
  if (booking.paymentStatus === 'PAID') {
    throw new AppError('Cannot cancel a paid booking here. Contact support.', 400, 'BOOKING_PAID');
  }

  const updated = await prisma.booking.update({
    where: { id: bookingId },
    data: { status: 'CANCELLED', seatNumber: null },
  });

  // If this was the last active booking on the trip and the trip hasn't started,
  // revert the trip status back to SCHEDULED so it still shows up in search
  try {
    const activeCount = await prisma.booking.count({
      where: {
        tripId: booking.tripId,
        ...seatOccupyingWhere(),
      },
    });
    if (activeCount === 0 && booking.trip?.status === 'FILLING') {
      await tripState.applyTransition(booking.tripId, 'SCHEDULED', {
        actor: tripState.ACTOR.SYSTEM,
        payload: { reason: 'LAST_BOOKING_RELEASED' },
      });
    }
  } catch (_) {
    // Non-blocking
  }

  return updated;
}

async function getUserBookings(userId, page = 1, limit = 20, status) {
  const take = Math.min(Math.max(1, parseInt(limit) || 20), 100);
  const skip = (Math.max(1, parseInt(page) || 1) - 1) * take;
  const where = { userId };
  if (status) {
    // Support comma-separated statuses: "CONFIRMED,SEAT_HELD,BOARDED"
    const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
    if (statuses.length === 1) {
      where.status = statuses[0];
    } else if (statuses.length > 1) {
      where.status = { in: statuses };
    }
  }
  const [bookings, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      include: {
        trip: {
          include: {
            route: true,
            driver: { select: { name: true, profilePhoto: true } },
            vehicle: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.booking.count({ where }),
  ]);

  // Fetch passenger ratings (how driver rated each passenger) in a separate
  // query — Booking model has no direct Prisma relation to PassengerRating,
  // so we join on userId + tripId manually.
  let enrichedBookings = bookings;
  if (bookings.length > 0) {
    const tripIds = [...new Set(bookings.map(b => b.tripId))];
    const userIds = [...new Set(bookings.map(b => b.userId).filter(Boolean))];
    const passengerRatings = userIds.length > 0 && tripIds.length > 0
      ? await prisma.passengerRating.findMany({
          where: { userId: { in: userIds }, tripId: { in: tripIds } },
          select: { userId: true, tripId: true, stars: true },
        })
      : [];
    const ratingMap = new Map(
      passengerRatings.map(r => [`${r.userId}:${r.tripId}`, r.stars])
    );
    enrichedBookings = bookings.map(b => ({
      ...b,
      passengerRating: b.userId ? (ratingMap.get(`${b.userId}:${b.tripId}`) ?? null) : null,
    }));
  }

  return { bookings: enrichedBookings, total, page: Math.max(1, parseInt(page) || 1), totalPages: Math.ceil(total / take) };
}

async function getBooking(bookingId, userId) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      trip: { include: { route: true, driver: { select: { name: true, profilePhoto: true } } } },
    },
  });
  if (!booking) throw new NotFoundError('Booking');
  if (booking.userId !== userId) throw new ForbiddenError();

  /**
   * THE RECEIPT'S NUMBERS, FROM THE ONE DERIVATION.
   *
   * This is the endpoint the rider's trip-complete screen calls, and it returned
   * the bare `Booking` row. The screen wants a `fareBreakdown` — its API type has
   * declared one all along — so with none present it fell through to its own
   * fallback: one booking's `fareAmountPesewas`, with `seatCount` defaulting to 1.
   *
   * That is, precisely, "the trip complete page says the gross fare was 1 seat
   * priced at 8 cedis, meanwhile the ride is 36 paid". The 8 was a single seat's
   * fare (floored to the per-seat minimum) and the "1 seat" was the client's
   * hardcoded default — because a cover-all host owns ONE BOOKING PER COVERED
   * SEAT, and this endpoint only ever looked at one of them.
   *
   * `getTripFareForRider` is the single fare derivation the group hub, the
   * tracking page and the cancellation quote all already use, so attaching it
   * here is what makes the receipt agree with every other screen instead of
   * being a fifth opinion. Field names match the client's declared contract
   * (`total`, not `totalPesewas`) — the mismatch is why even the cancellation
   * path's `fareBreakdown` was being ignored.
   *
   * Best-effort: a receipt that cannot price itself is still a valid receipt, and
   * the client keeps its fallback for exactly that case.
   */
  let fareBreakdown = null;
  try {
    const f = await getTripFareForRider(booking.tripId, userId, { bookingId });
    const surcharges = (f.cargoSurchargePesewas || 0) + (f.deviationSurchargePesewas || 0);
    fareBreakdown = {
      total: f.totalPesewas,
      seatCount: f.seatCount,
      perSeatPesewas: f.perSeatPesewas,
      surcharges,
      baseFarePesewas: f.totalPesewas - surcharges,
      cargoSurchargePesewas: f.cargoSurchargePesewas,
      deviationSurchargePesewas: f.deviationSurchargePesewas,
      seatNumbers: f.seatNumbers,
      isCoverAll: f.isCoverAll,
      // The rider is not billed a platform fee — commission is taken from the
      // driver's side — so this is 0 rather than a number invented to fill a field.
      platformFeePesewas: 0,
      discount: 0,
      tip: 0,
      currency: f.currency,
    };
  } catch (err) {
    logger.warn(`[bookings] fareBreakdown unavailable for ${bookingId}: ${err.message}`);
  }

  return { ...booking, fareBreakdown };
}

async function rateBooking(userId, bookingId, { rating, comment }) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { trip: { include: { driver: { select: { name: true, fcmToken: true } } } }, user: { select: { name: true } } }
  });
  if (!booking) throw new NotFoundError('Booking');
  if (booking.userId !== userId) throw new ForbiddenError('Not authorized');

  /**
   * YOU MAY ONLY RATE A RIDE THAT HAPPENED.
   *
   * There was no state check here at all — existence, ownership and the 1-5
   * range were the only gates. So a rider could rate a driver on a trip that was
   * CANCELLED before the driver ever arrived, on a request that expired with no
   * driver attached, or on a seat they were marked NO_SHOW for.
   *
   * That is not a cosmetic data-quality problem. `rating-integrity.service`
   * feeds driver averages into the go-online gate AND the dispatch ranking, so a
   * one-star rating on a ride that never took place can suppress a driver's
   * eligibility for real work. It is also the obvious griefing vector: cancel,
   * rate one star, repeat.
   *
   * `trip.status === 'COMPLETED'` is the authority — `Trip.status` is the
   * lifecycle, per the state-machine contract. The booking is checked separately
   * because a trip can complete while THIS passenger never travelled (their seat
   * was released as NO_SHOW, cancelled or refunded).
   */
  if (booking.trip?.status !== 'COMPLETED') {
    throw new AppError(
      'You can only rate a trip after it has been completed',
      400,
      'TRIP_NOT_COMPLETED',
    );
  }
  if (SEAT_RELEASING_STATUSES.includes(booking.status)) {
    throw new AppError(
      'This booking was not travelled, so it cannot be rated',
      400,
      'BOOKING_NOT_TRAVELLED',
    );
  }

  const stars = Number(rating);
  // `Number.isInteger` — the message promised an integer and the check never
  // enforced it, so 4.5 stars was accepted and stored.
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw new AppError('Stars must be an integer between 1 and 5', 400);
  }

  const driverRating = await prisma.driverRating.upsert({
    where: {
      userId_tripId: {
        userId,
        tripId: booking.tripId,
      }
    },
    update: {
      stars,
      comment: comment ?? undefined,
    },
    create: {
      driverId: booking.trip.driverId,
      userId,
      tripId: booking.trip.id,
      stars,
      comment,
    }
  });

  // ── Push notification to driver ───────────────────────────────────
  setImmediate(async () => {
    try {
      const pushService = require('../../services/push.service');
      const riderName = booking.user?.name || 'A rider';
      const starEmoji = ['', '⭐', '⭐⭐', '⭐⭐⭐', '⭐⭐⭐⭐', '⭐⭐⭐⭐⭐'][stars] || '⭐';
      if (booking.trip?.driver?.fcmToken) {
        await pushService.sendPush(
          booking.trip.driver.fcmToken,
          `🚀 New rating: ${stars}/5`,
          `${riderName} rated you ${starEmoji}`,
          { type: 'DRIVER_RATING', tripId: booking.tripId, stars: String(stars) },
        );
      }
    } catch (err) {
      // Non-blocking
    }
  });

  return driverRating;
}

async function applyPromoCode(userId, bookingId, code) {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: { trip: true }
    });
    if (!booking) throw new NotFoundError('Booking');
    if (booking.userId !== userId) throw new ForbiddenError();
    if (booking.paymentStatus === 'PAID') {
      throw new AppError('Cannot apply promo to a paid booking', 400);
    }
    if (booking.promotionId) {
      throw new AppError('Booking already has a promo code applied', 400);
    }

    const promo = await tx.promotion.findUnique({ where: { code } });
    if (!promo) throw new NotFoundError('Promotion');
    if (!promo.active || promo.expiry < new Date()) {
      throw new AppError('Promotion is inactive or expired', 400);
    }
    if (promo.maxRedemptions != null && promo.usageCount >= promo.maxRedemptions) {
      throw new AppError('Promo code has reached its usage limit', 400);
    }

    // Calculate discount
    let discount = (booking.fareAmountPesewas * promo.discountPercent) / 100;
    if (discount > promo.maxDiscountPesewas) {
      discount = promo.maxDiscountPesewas;
    }

    const newFare = Math.max(0, booking.fareAmountPesewas - discount);

    const [updatedBooking] = await Promise.all([
      tx.booking.update({
        where: { id: bookingId },
        data: { promotionId: promo.id, fareAmountPesewas: newFare },
      }),
      tx.promotion.update({
        where: { id: promo.id },
        data: { usageCount: { increment: 1 } },
      }),
    ]);

    return { booking: updatedBooking, discountAppliedPesewas: discount };
  });
}

/**
 * Trip statuses that still count as "the rider is on a live trip".
 *
 * BUGFIX — this list used to be
 *   ['SCHEDULED', 'FILLING', 'DRIVER_EN_ROUTE', 'IN_PROGRESS']
 * and it was missing BOTH:
 *
 *   * ARRIVED_AT_PICKUP — the driver has pulled up but nobody has moved yet.
 *   * CONFIRMED — set by confirmPayment once a trip reaches MIN_OCCUPANCY_TO_DEPART.
 *
 * So from the instant the driver tapped "I've arrived", this endpoint reported
 * that the rider had NO active booking. Downstream that read as "the trip is
 * over": the home screen's live-trip card lost its data, and the rider's
 * tracking screen (which inferred completion from a missing active booking)
 * pushed them into the arrived + rate-your-trip flow mid-ride. Reported as three
 * separate defects — the wrong live-trip card, "showed me an arrived safely page
 * during a live trip", and "clicking I've arrived ended the ride" — all from this
 * one array.
 *
 * Derive it by exclusion so a newly-added mid-trip status can never silently
 * fall out of it again: everything that is not terminal is live.
 */
/*
 * Deriving "live" by exclusion only works if the exclusion list is complete,
 * and it was not: NO_DRIVERS_FOUND and NO_SHOW are both absorbing terminal
 * states in TripStatus and neither was here. So the ride nobody accepted — the
 * most common way an on-demand request ends — came back from this endpoint as
 * the rider's ACTIVE booking, forever. That is the trip-less live card on the
 * home screen and the tracking screen that immediately bounces to the map.
 *
 * Keep in step with the terminal block of `enum TripStatus` in schema.prisma.
 */
const TERMINAL_TRIP_STATUSES = [
  'COMPLETED', 'CANCELLED', 'EXPIRED', 'NO_DRIVERS_FOUND', 'NO_SHOW',
];

/**
 * A HELD SEAT IS NOT A RIDE.
 *
 * BUGFIX ("I chose to book a trip and invite my group, went to the invite page,
 * came back — it showed my seat was booked and the live card was on the home
 * screen. I didn't finish booking the ride.")
 *
 * Generating an invite holds seats at SEAT_HELD so nobody else can take them
 * while the host shares the link. That is a reservation with a timer on it, not
 * a booking: no money has moved and the host has not committed to anything. But
 * this query excluded only the TERMINAL statuses, so a hold read as the rider's
 * active ride — the home screen drew the live-trip card for it and the seat map
 * showed the seat as theirs, for a trip they had not booked.
 *
 * Allow-list instead of deny-list, because the failure mode of getting this
 * wrong is claiming a ride exists. CONFIRMED covers cash bookings, whose
 * paymentStatus stays PENDING by design, so this does not require payment to
 * have cleared — only that the rider actually committed to the seat.
 */
const LIVE_BOOKING_STATUSES = ['CONFIRMED', 'PAID', 'BOARDED'];

async function getActiveBooking(userId) {
  const booking = await prisma.booking.findFirst({
    where: {
      userId,
      status: { in: LIVE_BOOKING_STATUSES },
      trip: { status: { notIn: TERMINAL_TRIP_STATUSES } },
    },
    include: {        trip: {
          include: {
            route: true,
            driver: { select: { name: true, profilePhoto: true } }, // phone intentionally excluded — use contact relay
            vehicle: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return booking ?? null;
}

/**
 * The mobile-money networks a charge can actually name — mirrors
 * `MOBILE_MONEY_PROVIDERS` in payments/paystack.client.js. `CASH`, `CARD` and
 * `WALLET` are payment METHODS but not networks, which is the distinction the
 * tip flow used to miss.
 */
const MOMO_METHODS = new Set(['MOMO_MTN', 'MOMO_TELECEL', 'MOMO_AIRTELTIGO']);
const DEFAULT_TIP_MOMO_METHOD = 'MOMO_MTN';

async function tipDriver(userId, bookingId, { amountPesewas, phone }) {
  const { v4: uuidv4 } = require('uuid');
  const paystack = require('../payments/provider');

  // A tip arrives from the client, so it is guarded rather than trusted:
  // `assertPesewas` rejects NaN, negatives, fractions (which would mean the
  // app is still sending cedis) and absurd amounts.
  assertPesewas(amountPesewas, 'tip amount', { client: true });
  if (amountPesewas <= 0) throw new AppError('Tip amount must be greater than 0', 400);

  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: { user: true, trip: { include: { driver: { select: { fcmToken: true } } } } },
    });
    if (!booking) throw new NotFoundError('Booking');
    if (booking.userId !== userId) throw new ForbiddenError();

    /**
     * A TIP IS FOR A RIDE THAT HAPPENED. This had no state check either, and
     * unlike a stray rating this one moves real money: a rider whose trip was
     * cancelled — or who was marked NO_SHOW, or whose seat was refunded — could
     * be charged a MoMo tip for a driver who never carried them. Same gate as
     * `rateBooking`, for the same reason.
     */
    if (booking.trip?.status !== 'COMPLETED') {
      throw new AppError(
        'You can only tip after the trip has been completed',
        400,
        'TRIP_NOT_COMPLETED',
      );
    }
    if (SEAT_RELEASING_STATUSES.includes(booking.status)) {
      throw new AppError(
        'This booking was not travelled, so it cannot be tipped',
        400,
        'BOOKING_NOT_TRAVELLED',
      );
    }

    const reference = `eyego_tip_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const email = booking.user?.email || `${booking.user.phone}@eyego.app`;
    const payPhone = phone || booking.user.phone;

    /**
     * A TIP IS ITS OWN PAYMENT — IT DOES NOT INHERIT THE RIDE'S METHOD.
     *
     * BUGFIX. This passed `booking.paymentMethod` straight into a mobile-money
     * charge. On the most common booking in this market that value is `CASH`,
     * which is not a MoMo provider, so `initiateMomoCharge` threw
     * "Unsupported MoMo method: CASH" and the rate-and-tip screen answered every
     * cash rider with a 500. `CARD` and `WALLET` fail the same way, for the same
     * reason: none of them names a network.
     *
     * The ride's method says how the FARE was settled, which is finished
     * business by the time anyone is tipping. A tip is charged to a MoMo wallet
     * on the phone number given, so the only thing worth inheriting is the
     * network — and only when the ride was itself paid by MoMo.
     */
    const method = MOMO_METHODS.has(booking.paymentMethod) ? booking.paymentMethod : DEFAULT_TIP_MOMO_METHOD;

    const result = await paystack.initiateMomoCharge({
      email,
      amountPesewas,
      phone: payPhone,
      method,
      reference,
      metadata: { bookingId, userId, type: 'TIP' },
    });

    await tx.paymentTransaction.create({
      data: {
        bookingId,
        userId: booking.userId,
        amountPesewas,
        status: 'INTENT',
        paystackRef: reference,
        gatewayResponse: 'TIP',
      },
    });

    // ── Push notification to driver ───────────────────────────────────
    setImmediate(async () => {
      try {
        const pushService = require('../../services/push.service');
        if (booking.trip?.driver?.fcmToken) {
          const driver = await prisma.driver.findUnique({
            where: { id: booking.trip.driverId },
            select: { name: true },
          });
          const riderName = booking.user?.name || 'A rider';
          await pushService.sendPush(
            booking.trip.driver.fcmToken,
            `💰 ${riderName} sent you a tip!`,
            `${formatGhs(amountPesewas)} tip received for trip #${booking.tripId.slice(0, 8)}`,
            { type: 'TIP', bookingId, amountPesewas: String(amountPesewas) },
          );
        }
      } catch (err) {
        // Non-blocking
      }
    });

    return { reference, ...result };
  });
}

async function submitDispute(userId, bookingId, { type, description }) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { trip: { select: { shortId: true, driverId: true, driver: { select: { fcmToken: true } } } } },
  });
  if (!booking) throw new NotFoundError('Booking');
  if (booking.userId !== userId) throw new ForbiddenError();

  const subject = `Dispute — ${type} — Booking #${bookingId.slice(0, 8)}`;

  const ticket = await prisma.$transaction(async (tx) => {
    const t = await tx.supportTicket.create({
      data: {
        userId,
        // Was never set, despite the schema having a dedicated driverId
        // column for exactly this — the driver-side ticket list had no real
        // way to associate a dispute with the trip it was about (it fell
        // back to matching on a shared phone number between accounts, which
        // only works by coincidence). Priority/category also defaulted to
        // MEDIUM/GENERAL, so a rider-safety dispute sorted identically to a
        // routine "how does this work" question.
        driverId: booking.trip?.driverId ?? null,
        subject,
        status: 'OPEN',
        priority: 'HIGH',
        category: 'TRIP',
      },
    });

    await tx.ticketMessage.create({
      data: {
        ticketId: t.id,
        senderId: userId,
        senderRole: 'USER',
        text: `Issue type: ${type}\n\nDescription: ${description || 'No description provided.'}`,
      },
    });

    return t;
  });

  // Notify the driver so a dispute is impossible to miss, not just something
  // that shows up if they happen to open their tickets list.
  if (booking.trip?.driver?.fcmToken) {
    const pushService = require('../../services/push.service');
    pushService.sendPush(
      booking.trip.driver.fcmToken,
      'A rider filed a dispute about your trip',
      `${type}${description ? ` — ${description.slice(0, 80)}` : ''}`,
      { type: 'DISPUTE', ticketId: ticket.id },
    ).catch(() => {});
  }

  return ticket;
}

async function generateInvite(bookingId, userId) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, userId },
    include: { trip: { select: { id: true, status: true, maxSeats: true } } },
  });
  if (!booking) throw new NotFoundError('Booking');

  // Upsert: create group if it doesn't exist, otherwise return existing
  const group = await prisma.rideGroup.upsert({
    where: { tripId: booking.tripId },
    update: {},
    create: {
      tripId: booking.tripId,
      leadPassengerId: userId,
      shareToken: crypto.randomBytes(12).toString('hex'),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
    },
  });

  const inviteLink = inviteUrl(group.shareToken);
  return { inviteToken: group.shareToken, inviteLink };
}

// Regenerate a new share token for an existing ride group (token rotation).
// This invalidates the old invite link — any previously shared link will
// stop working. Useful if the old token was leaked or compromised.
async function regenerateInvite(bookingId, userId) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, userId },
    include: { trip: { select: { id: true, group: true } } },
  });
  if (!booking) throw new NotFoundError('Booking');
  if (!booking.trip.group) {
    // No group exists yet — delegate to generateInvite instead of erroring
    return generateInvite(bookingId, userId);
  }

  const group = await prisma.rideGroup.update({
    where: { id: booking.trip.group.id },
    data: {
      shareToken: crypto.randomBytes(12).toString('hex'),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  const inviteLink = inviteUrl(group.shareToken);
  return { inviteToken: group.shareToken, inviteLink };
}

async function getGroup(bookingId, userId) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, userId },
    include: {
      trip: {
        include: {
          group: true,
          bookings: {
            where: { ...seatOccupyingWhere() },
            include: { user: { select: { id: true, name: true, profilePhoto: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
    },
  });
  if (!booking) throw new NotFoundError('Booking');

  const group = booking.trip.group;
  const inviteLink = group ? inviteUrl(group.shareToken) : '';

  // The group hub's money, computed here rather than on the phone. See
  // getTripFareForRider — the hub used to multiply a per-seat price by the
  // member count, which is why toggling heavy cargo moved a booking row and
  // nothing on screen.
  // Scoped to THIS booking, so the figure is exactly what pressing Pay will
  // charge for it (see getTripFareForRider).
  const fare = await getTripFareForRider(booking.tripId, userId, { bookingId });

  const members = booking.trip.bookings
    .filter(b => b.userId !== userId) // exclude the requesting user (shown as "You")
    .map(b => ({
      bookingId: b.id,
      passengerName: b.user?.name ?? b.guestName ?? 'Passenger',
      avatarUrl: b.user?.profilePhoto ?? null,
      seatNumber: b.seatNumber,
      joinedAt: b.createdAt.toISOString(),
    }));

  return {
    id: group?.id ?? '',
    inviteToken: group?.shareToken ?? '',
    inviteLink,
    hostBookingId: bookingId,
    members,
    maxSize: booking.trip.maxSeats,
    isCoverAll: !!group?.isCoverAll,
    // Every number the hub renders, already added up. Integer pesewas.
    fare,
  };
}

async function joinGroup(shareToken) {
  const group = await prisma.rideGroup.findUnique({
    where: { shareToken },
    // BUGFIX: the Route model field is `destinationName`, not `destName`. The old
    // select referenced a non-existent field, so Prisma threw on every call and
    // EVERY joiner saw "Invalid Link" — the join flow was fully broken. We also
    // include the coords + baseFarePesewas/seat fields the join screen renders.
    include: {
      trip: {
        include: { route: { select: { id: true, name: true, originName: true, destinationName: true, originLat: true, originLng: true, destLat: true, destLng: true } } },
      },
    },
  });
  if (!group) throw new NotFoundError('Invite link is invalid');
  if (group.expiresAt < new Date()) throw new AppError('This invite link has expired', 410, 'INVITE_EXPIRED');

  return { tripId: group.tripId, trip: group.trip };
}

module.exports = { bookSeat, normalizePaymentMethod, createRideGroup, generateInvite, regenerateInvite, getGroup, joinGroup, cancelBooking, getUserBookings, getBooking, rateBooking, applyPromoCode, getActiveBooking, tipDriver, submitDispute, recomputeBookingAddons, getTripFareForRider, cargoSurchargeFor };
