'use strict';

const { formatGhs, assertPesewas, percentOf } = require('../../utils/money');

const prisma = require('../../config/database');
const env = require('../../config/env');
const settings = require('../../config/settings');
const { AppError, NotFoundError, ForbiddenError } = require('../../utils/errors');
const { pushEnd } = require('../../services/live-activity-push.service');
const tripState = require('../../services/trip-state.service');
const logger = require('../../utils/logger');
const { seatOccupyingWhere } = require('../../utils/booking-status');

/**
 * EVERY SEAT THIS RIDER HOLDS ON THIS TRIP — the unit a cancellation acts on.
 *
 * A rider who covered a group owns one `Booking` row PER SEAT
 * (`isCoveredByLead`), and so does anyone who simply booked three seats for
 * their family. Both endpoints here took a single `bookingId`, and the rider app
 * has no per-seat cancel UI — there is one "cancel my booking" button. So a lead
 * booker with four seats got one of two wrong answers depending on how the
 * client behaved:
 *
 *   - call it once  → one seat cancelled, three still live and still billable,
 *                     with the rider believing they had cancelled;
 *   - call it N times → N separate late-cancellation fees, each computed against
 *                     one seat's fare, and N receipts for one cancellation.
 *
 * Neither is defensible. The fee is a penalty for cancelling a booking, not for
 * owning rows. This resolves the set once so both the quote and the cancellation
 * are computed over the same seats, in one transaction, with one fee and one
 * receipt.
 *
 * Scoped to seat-OCCUPYING statuses so a set that is half-cancelled already
 * (a retry, a partial failure) does not re-charge for seats that are gone.
 */
async function riderSeatsOnTrip(client, tripId, userId) {
  return client.booking.findMany({
    where: { tripId, userId, ...seatOccupyingWhere() },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * THE ONE DERIVATION OF "WHAT DOES CANCELLING COST".
 *
 * Read by the quote (`calculateCancellationFee`, which the rider's cancel sheet
 * shows) and by the charge (`cancelBookingWithFee`). It used to be written out
 * twice, once in each, which is how a quote and a charge come to disagree.
 *
 * TWO PRODUCTS, TWO CLOCKS.
 *
 * A seat on a bus is cancelled against the bus's departure time, and
 * `CancellationPolicy` prices that: free up to `freeCancelMin` before, half
 * after that, 100% once it has left. A HAILED RIDE HAS NO SUCH TIME — it is
 * created with `departureTime: new Date()` — so that arithmetic put every
 * hailed cancellation permanently in the "missed the bus" bucket and charged
 * the whole fare, one second after a driver accepted. A hailed ride is measured
 * from the moment a driver was assigned instead, which is when a real cost
 * (a driver already driving to the pickup) starts existing.
 *
 * @param {object} trip     needs status, tier, routeId, departureTime, assignedAt
 * @param {number} totalFarePesewas  the whole seat set's fare
 */
async function cancellationTermsFor(trip, totalFarePesewas) {
  const isHailed = trip.routeId == null;

  if (isHailed) {
    // Nobody has been sent anywhere yet — always free, whatever the knobs say.
    if (!tripState.hasDriver(trip.status)) {
      return {
        feePercentage: 0, feeAmountPesewas: 0, feeType: 'FREE',
        freeCancelSeconds: settings.get('RIDE_CANCEL_GRACE_SECONDS') ?? 120,
        secondsSinceAssigned: null,
        fareAmountPesewas: totalFarePesewas,
      };
    }

    const graceSeconds = settings.get('RIDE_CANCEL_GRACE_SECONDS') ?? 120;
    const flatFeePesewas = settings.get('RIDE_CANCEL_FEE_PESEWAS') ?? 0;
    const assignedAt = trip.assignedAt ? new Date(trip.assignedAt) : null;
    const secondsSinceAssigned = assignedAt ? Math.max(0, Math.round((Date.now() - assignedAt.getTime()) / 1000)) : 0;
    const withinGrace = secondsSinceAssigned <= graceSeconds;

    // Capped at the fare: a GH₵5 flat fee on a GH₵3 ride would charge more for
    // not taking it than for taking it.
    const fee = withinGrace ? 0 : Math.min(flatFeePesewas, totalFarePesewas);
    return {
      feePercentage: totalFarePesewas > 0 ? Math.round((fee / totalFarePesewas) * 100) : 0,
      feeAmountPesewas: fee,
      feeType: fee > 0 ? 'LATE_CANCELLATION' : 'FREE',
      freeCancelSeconds: graceSeconds,
      secondsSinceAssigned,
      fareAmountPesewas: totalFarePesewas,
    };
  }

  // ── the bus product, unchanged ──────────────────────────────────────────
  const policy = await prisma.cancellationPolicy.findFirst({
    where: { tier: trip.tier, isActive: true },
    orderBy: { createdAt: 'desc' },
  });

  const freeCancelMinutes = policy?.freeCancelMin ?? 60;
  const lateFeePct = policy?.lateFeePct ?? 50;
  const noShowFeePct = policy?.noShowFeePct ?? 100;

  const minutesUntilDeparture = (new Date(trip.departureTime) - new Date()) / (1000 * 60);

  let feePercentage = 0;
  let feeType = 'FREE';
  if (minutesUntilDeparture <= 0) {
    feePercentage = noShowFeePct;
    feeType = 'NO_SHOW';
  } else if (minutesUntilDeparture < freeCancelMinutes) {
    feePercentage = lateFeePct;
    feeType = 'LATE_CANCELLATION';
  }

  return {
    feePercentage,
    // ONE fee, over the whole set — not one fee per row.
    feeAmountPesewas: percentOf(totalFarePesewas, feePercentage / 100),
    feeType,
    freeCancelMinutes,
    minutesUntilDeparture: Math.round(minutesUntilDeparture),
    fareAmountPesewas: totalFarePesewas,
  };
}

/**
 * What cancelling would cost, for the rider's confirm sheet.
 *
 * Quoted for EVERY seat this rider holds on the trip — see `riderSeatsOnTrip`.
 */
/**
 * A BOOKING ID *OR* A TRIP ID — BECAUSE THE APP SENDS BOTH.
 *
 * BUGFIX — "I tried cancelling the trip I booked and it's telling me
 * cancellation failed and that booking not found."
 *
 * `/ride/[id]/cancel` is reached from four places. Three pass `booking.id`
 * (Activity, Trips, the trips banner). The fourth — `AssignedStage`, the cancel
 * button on the LIVE tracking surface, which is where a rider naturally
 * cancels — passed `tripId`, because every sibling route under `/ride/[id]/`
 * (tracking, chat, invite, sos) is keyed by trip. The screen then handed that
 * straight to `/cancellation/:bookingId/*`, which looked up a Booking by a Trip
 * id, found nothing, and reported the literal truth.
 *
 * The caller is fixed too, but this is the durable half: the two id spaces look
 * identical (both cuid), the route segment is genuinely ambiguous, and the next
 * screen to link here will make the same choice. Resolving it server-side means
 * it can only ever be wrong once.
 *
 * Trip ids resolve to the rider's OWN live seat on that trip — never anyone
 * else's — so this widens what the endpoint accepts without widening what it
 * lets you cancel.
 */
async function resolveBookingId(id, userId) {
  const direct = await prisma.booking.findUnique({ where: { id }, select: { id: true } });
  if (direct) return direct.id;

  const byTrip = await prisma.booking.findFirst({
    where: { tripId: id, userId, status: { notIn: ['CANCELLED', 'EXPIRED'] } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (byTrip) return byTrip.id;

  // Nothing live — but the rider may be asking about a seat they already
  // cancelled, and they are entitled to a truthful answer about that too.
  const anyOnTrip = await prisma.booking.findFirst({
    where: { tripId: id, userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (anyOnTrip) return anyOnTrip.id;

  throw new NotFoundError('Booking');
}

async function calculateCancellationFee(id, userId) {
  const bookingId = await resolveBookingId(id, userId);
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { trip: { select: { departureTime: true, tier: true, status: true, routeId: true, assignedAt: true } } },
  });
  if (!booking) throw new NotFoundError('Booking');
  if (booking.userId !== userId) throw new ForbiddenError();

  const seats = await riderSeatsOnTrip(prisma, booking.tripId, userId);
  // The booking being quoted may itself already be cancelled; the rider is still
  // entitled to a truthful answer about it, so fall back to it alone.
  const seatSet = seats.length > 0 ? seats : [booking];
  const totalFarePesewas = seatSet.reduce((sum, b) => sum + (b.fareAmountPesewas ?? 0), 0);

  const terms = await cancellationTermsFor(booking.trip, totalFarePesewas);
  return {
    ...terms,
    // So the confirm sheet can say "cancel all 4 seats" rather than implying one.
    seatCount: seatSet.length,
  };
}

/**
 * Cancel a booking with cancellation fee calculation and receipt generation.
 */
async function cancelBookingWithFee(id, userId, { reason, note } = {}) {
  // Same either-id resolution as the fee quote above — the two endpoints are
  // reached from the same screen and must accept the same thing.
  const bookingId = await resolveBookingId(id, userId);
  const result = await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: {
        trip: {
          include: {
            route: { select: { originName: true, destinationName: true } },
            driver: { select: { name: true } },
          },
        },
        user: true,
      },
    });
    if (!booking) throw new NotFoundError('Booking');
    if (booking.userId !== userId) throw new ForbiddenError();

    /**
     * Cancel the rider's WHOLE seat set on this trip, not the one row named in
     * the URL. See `riderSeatsOnTrip` for why. Everything below — the fee, the
     * refund, the seat-counter decrement, the receipt — is computed once over
     * this set.
     */
    const seatSet = await riderSeatsOnTrip(tx, booking.tripId, userId);
    // Already cancelled (a retry, a double tap): nothing to do, and re-running
    // would charge a second fee for a booking that no longer holds a seat.
    if (seatSet.length === 0) {
      return { booking, refundAmountPesewas: 0, cancellationFeePesewas: null, receipt: null, transition: null, seatCount: 0, alreadyCancelled: true };
    }
    const seatIds = seatSet.map((b) => b.id);
    const totalFarePesewas = seatSet.reduce((sum, b) => sum + (b.fareAmountPesewas ?? 0), 0);
    const paidSeats = seatSet.filter((b) => b.paymentStatus === 'PAID');
    const paidFarePesewas = paidSeats.reduce((sum, b) => sum + (b.fareAmountPesewas ?? 0), 0);

    const now = new Date();
    /**
     * The SAME derivation the rider was quoted — see `cancellationTermsFor`.
     * This block used to restate the policy inline, so the quote and the charge
     * were two implementations of one rule and free to drift.
     *
     * ONE fee for the cancellation, charged against the total the rider is
     * walking away from. Charging it per row would multiply the penalty by the
     * number of seats — a lead booker with four seats paid four late fees.
     */
    const terms = await cancellationTermsFor(booking.trip, totalFarePesewas);
    const cancellationFeePesewas = terms.feeAmountPesewas > 0 ? terms.feeAmountPesewas : null;

    // Refund only what was actually paid. Unpaid seats in the set (cash, or a
    // hold that never settled) owe nothing back.
    let refundAmountPesewas = 0;
    if (paidSeats.length > 0) {
      refundAmountPesewas = cancellationFeePesewas
        ? Math.max(0, paidFarePesewas - cancellationFeePesewas)
        : paidFarePesewas;

      // Record refund transaction
      await tx.paymentTransaction.create({
        data: {
          bookingId,
          userId: booking.userId,
          amountPesewas: refundAmountPesewas,
          status: cancellationFeePesewas ? 'PARTIAL_REFUND' : 'REFUNDED',
          paystackRef: booking.paystackRef,
          gatewayResponse: cancellationFeePesewas
            ? `Refunded ${formatGhs(refundAmountPesewas)} (fee: ${formatGhs(cancellationFeePesewas)})`
            : 'Full refund processed',
        },
      });

      // Credit the refund to the rider's wallet — the PaymentTransaction row above
      // is just a ledger record and does not itself move money.
      if (refundAmountPesewas > 0) {
        await tx.user.update({
          where: { id: booking.userId },
          data: { walletBalancePesewas: { increment: refundAmountPesewas } },
        });
      }
    }

    // Cancel every seat in the set. The fee is stamped on the named booking
    // only (below), so a report summing `cancellationFeePesewas` across rows
    // sees the one penalty that was actually charged.
    if (seatIds.length > 1) {
      await tx.booking.updateMany({
        where: { id: { in: seatIds.filter((id) => id !== bookingId) } },
        data: {
          status: 'CANCELLED',
          seatNumber: null,
          cancelledAt: now,
          cancellationReason: note ? `${reason || 'other'}: ${note}` : (reason || null),
        },
      });
    }

    // Update booking with cancellation info
    const updated = await tx.booking.update({
      where: { id: bookingId },
      data: {
        status: 'CANCELLED',
        seatNumber: null,
        cancelledAt: now,
        // Booking has no separate free-text column — fold the rider's "Other"
        // note into the reason string so it isn't silently dropped.
        cancellationReason: note ? `${reason || 'other'}: ${note}` : (reason || null),
        cancellationFeePesewas: cancellationFeePesewas,
      },
    });

    /**
     * Give back one counted seat per PAID booking cancelled.
     *
     * `confirmedSeats` is incremented only when money settles, so only the paid
     * rows in this set were ever counted. Clamped by reading the current value
     * rather than a bare `gt: 0` guard: decrementing by N when fewer than N are
     * counted would take it negative, and `availableSeats` is
     * `maxSeats - confirmedSeats`, so a negative counter advertises MORE seats
     * than the vehicle has.
     */
    if (paidSeats.length > 0) {
      const current = await tx.trip.findUnique({
        where: { id: booking.tripId },
        select: { confirmedSeats: true },
      });
      const give = Math.min(paidSeats.length, current?.confirmedSeats ?? 0);
      if (give > 0) {
        await tx.trip.update({
          where: { id: booking.tripId },
          data: { confirmedSeats: { decrement: give } },
        });
      }
    }

    // One receipt for one cancellation, carrying the set's totals.
    let receipt = null;
    if (paidSeats.length > 0) {
      receipt = await generateReceipt(
        tx,
        { ...booking, fareAmountPesewas: paidFarePesewas },
        refundAmountPesewas,
        cancellationFeePesewas,
      );
    }

    /**
     * NOBODY IS ON THE TRIP ANY MORE. WHAT HAPPENS TO THE TRIP?
     *
     * This asked only one of the two questions: "should a part-full bus go back
     * on sale?" — and answered it for FILLING and CONFIRMED. A hailed ride is
     * never in either state, so cancelling one moved the BOOKING to CANCELLED
     * and left the TRIP exactly where it was. Everything downstream then
     * believed a ride was still running that had no passenger:
     *
     *   - the driver kept the trip on their screen and drove to the pickup;
     *   - `isDriverAvailable` saw them as busy, so dispatch skipped them;
     *   - the rider could not book anything else — `POST /rides` answered
     *     "You already have a ride in progress" for a ride they had just
     *     cancelled AND paid a fee on.
     *
     * A bus with seats left goes back on sale; anything else with nobody left
     * aboard is over, and has to be said through the state machine so both apps
     * are told rather than discovering it on a refetch.
     */
    const activeCount = await tx.booking.count({
      where: {
        tripId: booking.tripId,
        ...seatOccupyingWhere(),
      },
    });
    let transition = null;
    if (activeCount === 0 && !tripState.isTerminal(booking.trip.status)) {
      if (['FILLING', 'CONFIRMED'].includes(booking.trip.status)) {
        // Last rider left a bus that has not set off: back on sale.
        transition = await tripState.applyTransitionTx(tx, booking.tripId, 'SCHEDULED', {
          actor: tripState.ACTOR.SYSTEM,
          payload: { reason: 'ALL_BOOKINGS_CANCELLED' },
        });
      } else if (booking.trip.status !== 'SCHEDULED' && booking.trip.status !== 'IN_PROGRESS') {
        // A hailed ride, or a bus already under way to a pickup with nobody on
        // it. `IN_PROGRESS` is excluded deliberately: a rider sitting in the car
        // does not cancel their way out of a moving trip — that is support's to
        // do, and the state machine refuses it for a RIDER anyway.
        transition = await tripState.applyTransitionTx(tx, booking.tripId, 'CANCELLED', {
          actor: tripState.ACTOR.RIDER,
          actorId: userId,
          data: { cancelledBy: tripState.ACTOR.RIDER, cancellationReason: reason || null },
          payload: { reason: reason || null, cancellationFeePesewas },
        });
      }
    }

    return {
      booking: updated,
      refundAmountPesewas,
      cancellationFeePesewas,
      receipt,
      transition,
      // The client says "4 seats cancelled", not "your booking was cancelled".
      seatCount: seatSet.length,
    };
  });

  // Post-commit: tell both apps what happened to the trip itself.
  tripState.publishCommitted(result.transition);

  /**
   * And stop looking for a driver for a ride nobody is on.
   *
   * A hailed ride cancelled while it was still REASSIGNING (the driver bailed
   * and dispatch was mid-sweep) leaves an offer chain running. Without this the
   * next driver in the cascade is woken for a trip that is already CANCELLED,
   * accepts it, and gets a 409 they did nothing to deserve.
   */
  if (result.transition?.trip?.status === 'CANCELLED') {
    require('../../services/dispatch-cascade.service')
      .cancelCascade(result.transition.trip.id)
      .catch((err) => logger.debug(`[Cancellation] cascade stop failed (non-blocking): ${err?.message ?? err}`));
  }

  // Fire-and-forget: end this rider's Live Activity outside the DB
  // transaction (it's a network call to Apple, not something that should
  // hold a transaction open or roll back the cancellation if it fails).
  if (result.booking.liveActivityPushToken) {
    pushEnd(result.booking.liveActivityPushToken, { status: 'CANCELLED', statusText: 'Trip cancelled' })
      .then(() => prisma.booking.update({
        where: { id: result.booking.id },
        data: { liveActivityPushToken: null, liveActivityId: null },
      }))
      .catch((err) => logger.debug('[Cancellation] Live Activity end push failed (non-blocking):', err?.message ?? err));
  }

  return result;
}

/**
 * Generate a receipt for a completed booking.
 */
async function generateReceipt(tx, booking, refundAmountPesewas = 0, cancellationFeePesewas = null) {
  const receiptNumber = `RCT-${Date.now().toString(36).toUpperCase()}-${booking.id.slice(0, 4).toUpperCase()}`;

  // Calculate breakdown
  const platformFeePesewas = booking.commissionAmountPesewas || 0;
  const driverEarningsPesewas = booking.fareAmountPesewas - platformFeePesewas;

  const receipt = await tx.receipt.create({
    data: {
      bookingId: booking.id,
      userId: booking.userId,
      receiptNumber,
      totalPaidPesewas: refundAmountPesewas > 0 ? refundAmountPesewas : booking.fareAmountPesewas,
      platformFeePesewas: cancellationFeePesewas ? Math.min(platformFeePesewas, booking.fareAmountPesewas - refundAmountPesewas) : platformFeePesewas,
      driverEarningsPesewas: cancellationFeePesewas ? Math.max(0, driverEarningsPesewas - cancellationFeePesewas) : driverEarningsPesewas,
      discountAppliedPesewas: 0,
      cancellationFeePesewas: cancellationFeePesewas,
      paymentMethod: booking.paymentMethod,
      paidAt: refundAmountPesewas > 0 ? new Date() : booking.updatedAt,
    },
  });

  return receipt;
}

/**
 * Full (100%) refund for a booking cancelled by the driver/platform, not the rider.
 * No cancellation fee applies since the rider isn't at fault. Must be called inside
 * an existing $transaction (tx) alongside the booking status update.
 */
async function refundBookingForDriverCancellation(tx, booking, reasonLabel = 'Driver-cancelled trip') {
  if (booking.paymentStatus !== 'PAID') return null;

  await tx.paymentTransaction.create({
    data: {
      bookingId: booking.id,
      userId: booking.userId,
      amountPesewas: booking.fareAmountPesewas,
      status: 'REFUNDED',
      paystackRef: booking.paystackRef,
      gatewayResponse: `Refunded: ${reasonLabel}`,
    },
  });

  if (booking.userId) {
    await tx.user.update({
      where: { id: booking.userId },
      data: { walletBalancePesewas: { increment: booking.fareAmountPesewas } },
    });
  }

  return generateReceipt(tx, booking, booking.fareAmountPesewas, null);
}

/**
 * Get receipt for a booking.
 */
async function getReceipt(bookingId, userId) {
  const TRIP_INCLUDE = {
    trip: {
      include: {
        route: { select: { originName: true, destinationName: true } },
        driver: { select: { name: true, phone: true } },
        vehicle: { select: { make: true, model: true, plateNumber: true } },
      },
    },
  };

  const receipt = await prisma.receipt.findFirst({
    where: { bookingId, userId },
    include: { booking: { include: TRIP_INCLUDE } },
  });

  /**
   * A CASH RIDE HAS NO RECEIPT ROW, AND STILL HAS A FARE.
   *
   * BUGFIX ("on the trip complete page of the rider app it's showing that my
   * total fare is 5.75, which is supposed to be 69 since i paid for everyone").
   *
   * `Receipt` rows are minted by `generateTripReceipt`, which returns early
   * unless `paymentStatus === 'PAID'` — so a cash trip, the default in this
   * market, finishes with no row at all. This function then threw 404, the
   * rider's complete screen lost `fareBreakdown` with it, and its fallback chain
   * dropped to `activeBooking.fareAmountPesewas`: ONE booking, ONE seat. A rider
   * who covered twelve seats was shown a twelfth of what they owe.
   *
   * So the receipt ROW is now optional and only supplies the receipt number and
   * the platform fee. The fare comes from `getTripFareForRider` either way,
   * which is the same derivation every other surface reads and the only one that
   * knows about cover-all.
   */
  const booking =
    receipt?.booking ??
    (await prisma.booking.findFirst({
      where: { id: bookingId, userId },
      include: TRIP_INCLUDE,
    }));

  if (!booking) throw new NotFoundError('Receipt');

  /**
   * WHAT THE RIDER ACTUALLY PAID FOR THIS TRIP, not what one seat cost.
   *
   * BUGFIX. A `Receipt` row is per BOOKING, and a rider who chose "I'm paying for
   * everyone" owns one booking per covered seat — so the rider's trip-complete
   * screen read a single row and announced one seat's fare for a ride they had
   * paid the whole van's price for. Same defect as the driver's receipt, from the
   * other side of the same rows.
   *
   * `fareBreakdown` is the whole obligation, from the one derivation every other
   * surface now reads (bookings.service `getTripFareForRider`). The per-seat row
   * is still there underneath it, unchanged, for anyone who wants the single seat.
   */
  const { getTripFareForRider } = require('../bookings/bookings.service');
  const tripFare = await getTripFareForRider(booking.tripId, userId).catch(() => null);

  return {
    ...(receipt ?? {}),
    // A cash ride genuinely has no receipt number yet. Null says so; inventing
    // one would put a reference on screen that support cannot look up.
    receiptNumber: receipt?.receiptNumber ?? null,
    booking,
    fareBreakdown: tripFare
      ? {
          baseFarePesewas: tripFare.totalPesewas - tripFare.cargoSurchargePesewas - tripFare.deviationSurchargePesewas,
          surcharges: tripFare.cargoSurchargePesewas + tripFare.deviationSurchargePesewas,
          platformFeePesewas: receipt?.platformFeePesewas ?? 0,
          discount: receipt?.discountAppliedPesewas ?? 0,
          tip: 0,
          total: tripFare.totalPesewas,
          seatCount: tripFare.seatCount,
          perSeatPesewas: tripFare.perSeatPesewas,
        }
      : undefined,
  };
}

/**
 * Generate receipt for a completed trip (called when trip completes).
 */
async function generateTripReceipt(bookingId) {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: { trip: true },
    });
    if (!booking) throw new NotFoundError('Booking');
    if (booking.paymentStatus !== 'PAID') return null;

    // Check if receipt already exists
    const existing = await tx.receipt.findFirst({ where: { bookingId } });
    if (existing) return existing;

    return generateReceipt(tx, booking);
  });
}

/**
 * Get all receipts for a user.
 */
async function getUserReceipts(userId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  const [receipts, total] = await Promise.all([
    prisma.receipt.findMany({
      where: { userId },
      include: {
        booking: {
          include: {
            trip: {
              select: {
                id: true,
                shortId: true,
                departureTime: true,
                route: { select: { originName: true, destinationName: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.receipt.count({ where: { userId } }),
  ]);

  return { receipts, total, page, totalPages: Math.ceil(total / limit) };
}

module.exports = {
  calculateCancellationFee,
  cancelBookingWithFee,
  refundBookingForDriverCancellation,
  getReceipt,
  getUserReceipts,
  generateTripReceipt,
};
