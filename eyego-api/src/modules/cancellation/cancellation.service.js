'use strict';

const { formatGhs, assertPesewas, percentOf } = require('../../utils/money');

const prisma = require('../../config/database');
const env = require('../../config/env');
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
 * Calculate cancellation fee based on time before departure.
 * Returns 0 if cancelled within the free cancellation window.
 *
 * Quoted for EVERY seat this rider holds on the trip — see `riderSeatsOnTrip`.
 */
async function calculateCancellationFee(bookingId, userId) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { trip: { select: { departureTime: true, tier: true } } },
  });
  if (!booking) throw new NotFoundError('Booking');
  if (booking.userId !== userId) throw new ForbiddenError();

  const seats = await riderSeatsOnTrip(prisma, booking.tripId, userId);
  // The booking being quoted may itself already be cancelled; the rider is still
  // entitled to a truthful answer about it, so fall back to it alone.
  const seatSet = seats.length > 0 ? seats : [booking];
  const totalFarePesewas = seatSet.reduce((sum, b) => sum + (b.fareAmountPesewas ?? 0), 0);

  // Get policy for this tier
  const policy = await prisma.cancellationPolicy.findFirst({
    where: { tier: booking.trip.tier, isActive: true },
    orderBy: { createdAt: 'desc' },
  });

  const freeCancelMinutes = policy?.freeCancelMin ?? 60;
  const lateFeePct = policy?.lateFeePct ?? 50;
  const noShowFeePct = policy?.noShowFeePct ?? 100;

  const now = new Date();
  const departure = new Date(booking.trip.departureTime);
  const minutesUntilDeparture = (departure - now) / (1000 * 60);

  let feePercentage = 0;
  let feeType = 'FREE';

  if (minutesUntilDeparture <= 0) {
    // No-show / missed trip
    feePercentage = noShowFeePct;
    feeType = 'NO_SHOW';
  } else if (minutesUntilDeparture < freeCancelMinutes) {
    // Late cancellation
    feePercentage = lateFeePct;
    feeType = 'LATE_CANCELLATION';
  }

  return {
    feePercentage,
    // ONE fee, over the whole set — not one fee per row.
    feeAmountPesewas: percentOf(totalFarePesewas, feePercentage / 100),
    freeCancelMinutes,
    minutesUntilDeparture: Math.round(minutesUntilDeparture),
    feeType,
    fareAmountPesewas: totalFarePesewas,
    // So the confirm sheet can say "cancel all 4 seats" rather than implying one.
    seatCount: seatSet.length,
  };
}

/**
 * Cancel a booking with cancellation fee calculation and receipt generation.
 */
async function cancelBookingWithFee(bookingId, userId, { reason, note } = {}) {
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

    // Calculate cancellation fee
    const policy = await tx.cancellationPolicy.findFirst({
      where: { tier: booking.trip.tier, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    const freeCancelMinutes = policy?.freeCancelMin ?? 60;
    const lateFeePct = policy?.lateFeePct ?? 50;
    const noShowFeePct = policy?.noShowFeePct ?? 100;

    const now = new Date();
    const departure = new Date(booking.trip.departureTime);
    const minutesUntilDeparture = (departure - now) / (1000 * 60);

    let feePercentage = 0;
    let cancellationFeePesewas = null;

    if (minutesUntilDeparture <= 0) {
      feePercentage = noShowFeePct;
    } else if (minutesUntilDeparture < freeCancelMinutes) {
      feePercentage = lateFeePct;
    }

    if (feePercentage > 0) {
      // ONE fee for the cancellation, charged against the total the rider is
      // walking away from. Charging it per row would multiply the penalty by the
      // number of seats — a lead booker with four seats paid four late fees.
      cancellationFeePesewas = percentOf(totalFarePesewas, feePercentage / 100);
    }

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

    // Check if trip should revert to SCHEDULED
    const activeCount = await tx.booking.count({
      where: {
        tripId: booking.tripId,
        ...seatOccupyingWhere(),
      },
    });
    let transition = null;
    if (activeCount === 0 && ['FILLING', 'CONFIRMED'].includes(booking.trip.status)) {
      // Last rider left: the trip goes back on sale. Through the state machine
      // so the driver's app sees it happen rather than discovering it on a
      // refetch.
      transition = await tripState.applyTransitionTx(tx, booking.tripId, 'SCHEDULED', {
        actor: tripState.ACTOR.SYSTEM,
        payload: { reason: 'ALL_BOOKINGS_CANCELLED' },
      });
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

  // Post-commit: tell both apps the trip went back on sale.
  tripState.publishCommitted(result.transition);

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
