'use strict';

const prisma = require('../../config/database');
const env = require('../../config/env');
const { AppError, NotFoundError, ForbiddenError } = require('../../utils/errors');
const { pushEnd } = require('../../services/live-activity-push.service');
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
    feeAmount: Math.round((booking.fareAmount * feePercentage) / 100 * 100) / 100,
    freeCancelMinutes,
    minutesUntilDeparture: Math.round(minutesUntilDeparture),
    feeType,
    fareAmount: booking.fareAmount,
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
    let cancellationFee = null;

    if (minutesUntilDeparture <= 0) {
      feePercentage = noShowFeePct;
    } else if (minutesUntilDeparture < freeCancelMinutes) {
      feePercentage = lateFeePct;
    }

    if (feePercentage > 0) {
      cancellationFee = Math.round((booking.fareAmount * feePercentage) / 100 * 100) / 100;
    }

    // If paid, process refund minus cancellation fee
    let refundAmount = 0;
    if (booking.paymentStatus === 'PAID') {
      refundAmount = cancellationFee
        ? Math.max(0, booking.fareAmount - cancellationFee)
        : booking.fareAmount;

      // Record refund transaction
      await tx.paymentTransaction.create({
        data: {
          bookingId,
          userId: booking.userId,
          amount: refundAmount,
          status: cancellationFee ? 'PARTIAL_REFUND' : 'REFUNDED',
          paystackRef: booking.paystackRef,
          gatewayResponse: cancellationFee
            ? `Refunded GHS ${refundAmount.toFixed(2)} (fee: GHS ${cancellationFee.toFixed(2)})`
            : 'Full refund processed',
        },
      });

      // Credit the refund to the rider's wallet — the PaymentTransaction row above
      // is just a ledger record and does not itself move money.
      if (refundAmount > 0) {
        await tx.user.update({
          where: { id: booking.userId },
          data: { walletBalance: { increment: refundAmount } },
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
        cancellationReason: reason || null,
        cancellationFee: cancellationFee,
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
      receipt = await generateReceipt(tx, booking, refundAmount, cancellationFee);
    }

    // Check if trip should revert to SCHEDULED
    const activeCount = await tx.booking.count({
      where: {
        tripId: booking.tripId,
        status: { notIn: ['CANCELLED'] },
      },
    });
    if (activeCount === 0 && ['FILLING', 'CONFIRMED'].includes(booking.trip.status)) {
      await tx.trip.update({
        where: { id: booking.tripId },
        data: { status: 'SCHEDULED' },
      });
    }

    return { booking: updated, refundAmount, cancellationFee, receipt };
  });

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
async function generateReceipt(tx, booking, refundAmount = 0, cancellationFee = null) {
  const receiptNumber = `RCT-${Date.now().toString(36).toUpperCase()}-${booking.id.slice(0, 4).toUpperCase()}`;

  // Calculate breakdown
  const platformFee = booking.commissionAmount || 0;
  const driverEarnings = booking.fareAmount - platformFee;

  const receipt = await tx.receipt.create({
    data: {
      bookingId: booking.id,
      userId: booking.userId,
      receiptNumber,
      totalPaid: refundAmount > 0 ? refundAmount : booking.fareAmount,
      platformFee: cancellationFee ? Math.min(platformFee, booking.fareAmount - refundAmount) : platformFee,
      driverEarnings: cancellationFee ? Math.max(0, driverEarnings - cancellationFee) : driverEarnings,
      discountApplied: 0,
      cancellationFee: cancellationFee,
      paymentMethod: booking.paymentMethod,
      paidAt: refundAmount > 0 ? new Date() : booking.updatedAt,
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
      amount: booking.fareAmount,
      status: 'REFUNDED',
      paystackRef: booking.paystackRef,
      gatewayResponse: `Refunded: ${reasonLabel}`,
    },
  });

  if (booking.userId) {
    await tx.user.update({
      where: { id: booking.userId },
      data: { walletBalance: { increment: booking.fareAmount } },
    });
  }

  return generateReceipt(tx, booking, booking.fareAmount, null);
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
