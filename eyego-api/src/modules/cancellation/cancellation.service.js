'use strict';

const { formatGhs, assertPesewas, percentOf } = require('../../utils/money');

const prisma = require('../../config/database');
const env = require('../../config/env');
const { AppError, NotFoundError, ForbiddenError } = require('../../utils/errors');
const { pushEnd } = require('../../services/live-activity-push.service');
const tripState = require('../../services/trip-state.service');
const logger = require('../../utils/logger');

/**
 * Calculate cancellation fee based on time before departure.
 * Returns 0 if cancelled within the free cancellation window.
 */
async function calculateCancellationFee(bookingId, userId) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { trip: { select: { departureTime: true, tier: true } } },
  });
  if (!booking) throw new NotFoundError('Booking');
  if (booking.userId !== userId) throw new ForbiddenError();

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
    feeAmountPesewas: percentOf(booking.fareAmountPesewas, feePercentage / 100),
    freeCancelMinutes,
    minutesUntilDeparture: Math.round(minutesUntilDeparture),
    feeType,
    fareAmountPesewas: booking.fareAmountPesewas,
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
      cancellationFeePesewas = percentOf(booking.fareAmountPesewas, feePercentage / 100);
    }

    // If paid, process refund minus cancellation fee
    let refundAmountPesewas = 0;
    if (booking.paymentStatus === 'PAID') {
      refundAmountPesewas = cancellationFeePesewas
        ? Math.max(0, booking.fareAmountPesewas - cancellationFeePesewas)
        : booking.fareAmountPesewas;

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

    // Decrement confirmed seats if was paid
    if (booking.paymentStatus === 'PAID') {
      await tx.trip.update({
        where: { id: booking.tripId },
        data: { confirmedSeats: { decrement: 1 } },
      });
    }

    // Generate receipt if there was any payment
    let receipt = null;
    if (booking.paymentStatus === 'PAID') {
      receipt = await generateReceipt(tx, booking, refundAmountPesewas, cancellationFeePesewas);
    }

    // Check if trip should revert to SCHEDULED
    const activeCount = await tx.booking.count({
      where: {
        tripId: booking.tripId,
        status: { notIn: ['CANCELLED'] },
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

    return { booking: updated, refundAmountPesewas, cancellationFeePesewas, receipt, transition };
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
  const receipt = await prisma.receipt.findFirst({
    where: { bookingId, userId },
    include: {
      booking: {
        include: {
          trip: {
            include: {
              route: { select: { originName: true, destinationName: true } },
              driver: { select: { name: true, phone: true } },
              vehicle: { select: { make: true, model: true, plateNumber: true } },
            },
          },
        },
      },
    },
  });

  if (!receipt) throw new NotFoundError('Receipt');

  return receipt;
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
