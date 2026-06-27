'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../../config/database');
const env = require('../../config/env');
const paystack = require('./paystack.client');
const pushService = require('../../services/push.service');
const { NotFoundError, PaymentError, AppError } = require('../../utils/errors');
const logger = require('../../utils/logger');
const redis = require('../../config/redis');

const MOMO_METHODS = ['MOMO', 'MOMO_MTN', 'MOMO_TELECEL', 'MOMO_AIRTELTIGO'];

// Initiate payment for a held booking. Branches by the booking's payment method:
//   • MoMo  → real Paystack mobile-money charge; confirmed later via webhook → PENDING
//   • Card  → Paystack hosted checkout; client opens authorizationUrl → PENDING
//   • Wallet→ synchronous balance debit inside confirmPayment → SUCCESS
//   • Cash  → no gateway; seat confirmed now, rider pays driver on board → SUCCESS
async function initiatePayment({ userId, bookingId, phone }) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { trip: { include: { route: true } }, user: true },
  });
  if (!booking) throw new NotFoundError('Booking');
  if (booking.userId !== userId) throw new AppError('Unauthorized', 403);
  if (booking.paymentStatus === 'PAID') throw new AppError('Already paid', 400);

  const method = booking.paymentMethod;
  const reference = `eyego_${uuidv4().replace(/-/g, '').slice(0, 20)}`;
  const email = booking.user?.email || `${booking.user.phone}@eyego.app`;
  const metadata = { bookingId, tripId: booking.tripId, userId };

  // ── Synchronous methods: no external gateway round-trip ──────────────
  if (method === 'WALLET' || method === 'CASH') {
    // confirmPayment is idempotent and, for WALLET, debits the balance atomically
    // with a guard that rejects insufficient funds. For CASH it simply confirms
    // the seat (the rider settles with the driver on boarding).
    await confirmPayment(bookingId, reference, { cashOnBoard: method === 'CASH', isSync: true });
    return {
      reference,
      status: 'SUCCESS',
      method,
      requiresVerification: false,
    };
  }

  // ── Idempotency guard: return the existing pending charge if one is already in-flight
  // for this booking. Prevents double charges from concurrent taps or retries.
  const lockKey = `lock:initiate_payment:${bookingId}`;
  const acquired = await redis.set(lockKey, '1', 'EX', 10, 'NX');
  if (!acquired) {
    throw new AppError('Payment initiation in progress. Please wait.', 429);
  }

  try {
    const existingIntent = await prisma.paymentTransaction.findFirst({
      where: { bookingId, status: 'INTENT' },
      orderBy: { createdAt: 'desc' },
    });
    if (existingIntent) {
      return {
        reference: existingIntent.paystackRef,
        status: 'PENDING',
        method,
        requiresVerification: true,
      };
    }

    // ── Asynchronous methods: Paystack mobile money or hosted card checkout ──
    let result;
    if (MOMO_METHODS.includes(method)) {
      result = await paystack.initiateMomoCharge({
        email,
        amount: booking.fareAmount,
        phone: phone || booking.user.phone,
        method: method === 'MOMO' ? 'MOMO_MTN' : method,
        reference,
        metadata,
      });
    } else if (method === 'CARD') {
      result = await paystack.initializeCheckout({
        email,
        amount: booking.fareAmount,
        reference,
        metadata,
      });
    } else {
      throw new AppError(`Unsupported payment method: ${method}`, 400, 'UNSUPPORTED_METHOD');
    }

    await prisma.booking.update({
      where: { id: bookingId },
      data: { paystackRef: reference },
    });

    await prisma.paymentTransaction.create({
      data: {
        bookingId,
        amount: booking.fareAmount,
        status: 'INTENT',
        paystackRef: reference,
      },
    });

    return {
      reference,
      // Paystack hosted-checkout returns authorization_url under data.authorization_url
      authorizationUrl: result?.data?.authorization_url,
      accessCode: result?.data?.access_code,
      status: 'PENDING',
      method,
      requiresVerification: true,
    };
  } finally {
    await redis.del(lockKey);
  }
}

async function verifyPayment(reference, requestingUserId) {
  const result = await paystack.verifyTransaction(reference);
  if (result.data?.status !== 'success') {
    throw new PaymentError(`Payment not successful: ${result.data?.gateway_response}`);
  }

  const metadata = result.data.metadata;

  if (metadata?.type === 'WALLET_TOPUP') {
    if (metadata?.userId) {
      if (requestingUserId && metadata.userId !== requestingUserId) {
        throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
      }
      const txn = await prisma.paymentTransaction.findFirst({
        where: { paystackRef: reference, status: 'INTENT' },
      });
      if (txn) {
        await prisma.$transaction(async (tx) => {
          const updatedTxn = await tx.paymentTransaction.updateMany({
            where: { id: txn.id, status: 'INTENT' },
            data: { status: 'SUCCESS' },
          });
          if (updatedTxn.count > 0) {
            await tx.user.update({
              where: { id: metadata.userId },
              data: { walletBalance: { increment: txn.amount } },
            });
          }
        });
      }
    } else if (metadata?.driverId) {
      if (requestingUserId && metadata.driverId !== requestingUserId) {
        throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
      }
      const driver = await prisma.driver.findUnique({ where: { id: metadata.driverId } });
      if (driver) {
        await prisma.$transaction(async (tx) => {
          const existing = await tx.walletTransaction.findFirst({
            where: { paystackRef: reference, type: 'TOP_UP' }
          });
          if (!existing) {
            await tx.driver.update({
              where: { id: metadata.driverId },
              data: { walletBalance: { increment: result.data.amount / 100 } },
            });
            await tx.walletTransaction.create({
              data: {
                driverId: metadata.driverId,
                type: 'TOP_UP',
                amount: result.data.amount / 100,
                description: 'Wallet top-up via MoMo',
                balanceBefore: driver.walletBalance,
                balanceAfter: driver.walletBalance + (result.data.amount / 100),
                paystackRef: reference,
              },
            });
          }
        });
      }
    }
    return { type: 'WALLET_TOPUP', status: 'SUCCESS' };
  }

  const bookingId = metadata?.bookingId;

  // Ownership check: verify the booking belongs to the requesting user
  if (requestingUserId && bookingId) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { userId: true },
    });
    if (booking && booking.userId !== requestingUserId) {
      throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
    }
  }

  return confirmPayment(bookingId, reference);
}

async function confirmPayment(bookingId, reference, { cashOnBoard = false, isSync = false } = {}) {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: { trip: { include: { route: true } } },
    });
    if (!booking) throw new NotFoundError('Booking');
    if (booking.paymentStatus === 'PAID' || booking.paymentStatus === 'CASH_PENDING') return booking; // idempotent

    if (booking.status !== 'SEAT_HELD' || booking.trip.confirmedSeats >= booking.trip.maxSeats) {
      if (isSync) {
        throw new AppError('Booking expired or trip is full', 400);
      }

      const reason = booking.status !== 'SEAT_HELD' ? 'expired/cancelled booking' : 'trip full';
      logger.info(`Booking failed (${reason}), triggering refund`, { bookingId, reference });
      
      await tx.paymentTransaction.create({
        data: {
          bookingId,
          amount: booking.fareAmount,
          status: 'REFUNDED',
          paystackRef: reference,
          gatewayResponse: `Refunded to wallet due to ${reason}`,
        }
      });

      // If they actually paid via an external gateway, refund to their wallet
      if (['MOMO', 'MOMO_MTN', 'MOMO_TELECEL', 'MOMO_AIRTELTIGO', 'CARD'].includes(booking.paymentMethod)) {
        await tx.user.update({
          where: { id: booking.userId },
          data: { walletBalance: { increment: booking.fareAmount } },
        });
      }
      
      return booking;
    }

    // Optimistic concurrency control to prevent race conditions
    const updatedBooking = await tx.booking.updateMany({
      where: { id: bookingId, paymentStatus: booking.paymentStatus },
      data: {
        paymentStatus: cashOnBoard ? 'CASH_PENDING' : 'PAID',
        status: 'CONFIRMED',
        paystackRef: reference,
      },
    });

    if (updatedBooking.count === 0) {
      // Another transaction beat us to it
      return tx.booking.findUnique({ where: { id: bookingId } });
    }

    await tx.paymentTransaction.create({
      data: {
        bookingId,
        amount: booking.fareAmount,
        status: cashOnBoard ? 'PENDING' : 'SUCCESS',
        paystackRef: reference,
        gatewayResponse: cashOnBoard ? 'Cash — collect on boarding' : 'Payment confirmed',
      }
    });

    // If user paid via wallet, deduct fare — guard prevents negative balance
    if (booking.paymentMethod === 'WALLET') {
      const updated = await tx.user.updateMany({
        where: { id: booking.userId, walletBalance: { gte: booking.fareAmount } },
        data: { walletBalance: { decrement: booking.fareAmount } },
      });
      if (updated.count === 0) {
        throw new AppError('Insufficient wallet balance', 402, 'INSUFFICIENT_BALANCE');
      }
    }

    // Increment confirmed seats
    const updatedTrip = await tx.trip.update({
      where: { id: booking.tripId },
      data: { confirmedSeats: { increment: 1 } },
    });

    // Check if minimum occupancy met → update trip status
    if (
      updatedTrip.confirmedSeats >= env.MIN_OCCUPANCY_TO_DEPART &&
      updatedTrip.status === 'FILLING'
    ) {
      await tx.trip.update({ where: { id: booking.tripId }, data: { status: 'CONFIRMED' } });
    }

    // Send driver earnings to wallet (credited when trip completes, not now)
    logger.info('Payment confirmed', { bookingId, reference });

    return booking;
  });
}

async function handleWebhook(rawBody, signature) {
  // Verify Paystack signature using a constant-time comparison to avoid
  // leaking information via timing side-channels.
  const hash = crypto
    .createHmac('sha512', env.PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest('hex');

  const sigValid =
    typeof signature === 'string' &&
    signature.length === hash.length &&
    crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));

  if (!sigValid) {
    throw new AppError('Invalid webhook signature', 401, 'INVALID_SIGNATURE');
  }

  const event = JSON.parse(rawBody);
  logger.info('Paystack webhook', { event: event.event });

  if (event.event === 'charge.success') {
    const { reference, metadata } = event.data;

    // Redis NX lock — prevents duplicate processing under concurrent webhook deliveries
    const lockKey = `lock:webhook:${reference}`;
    const acquired = await redis.set(lockKey, '1', 'EX', 30, 'NX');
    if (!acquired) {
      logger.info(`[Webhook] Duplicate processing skipped for ${reference}`);
      return { duplicate: true };
    }

    try {
      // Idempotency guard: skip if this reference was already processed successfully
      const alreadyProcessed = await prisma.paymentTransaction.findFirst({
        where: { paystackRef: reference, status: 'SUCCESS' },
      });
      if (alreadyProcessed) {
        logger.info('Webhook replay ignored (already processed)', { reference });
        return { received: true };
      }

      // Wallet top-ups are initiated from rider.wallet.routes.js with type='WALLET_TOPUP'
      if (metadata?.type === 'WALLET_TOPUP') {
        if (metadata?.userId) {
          const txn = await prisma.paymentTransaction.findFirst({
            where: { paystackRef: reference, status: 'INTENT' },
          });
          if (txn) {
            await prisma.$transaction(async (tx) => {
              const updatedTxn = await tx.paymentTransaction.updateMany({
                where: { id: txn.id, status: 'INTENT' },
                data: { status: 'SUCCESS' },
              });
              if (updatedTxn.count > 0) {
                await tx.user.update({
                  where: { id: metadata.userId },
                  data: { walletBalance: { increment: txn.amount } },
                });
              }
            });
          }
        } else if (metadata?.driverId) {
          // Driver wallet top-up
          const driver = await prisma.driver.findUnique({ where: { id: metadata.driverId } });
          if (driver) {
            await prisma.$transaction(async (tx) => {
              // Check if already processed by looking for a wallet transaction
              const existing = await tx.walletTransaction.findFirst({
                where: { paystackRef: reference, type: 'TOP_UP' }
              });
              if (!existing) {
                await tx.driver.update({
                  where: { id: metadata.driverId },
                  data: { walletBalance: { increment: event.data.amount / 100 } }, // Paystack amount is in pesewas
                });
                await tx.walletTransaction.create({
                  data: {
                    driverId: metadata.driverId,
                    type: 'TOP_UP',
                    amount: event.data.amount / 100,
                    description: 'Wallet top-up via MoMo',
                    balanceBefore: driver.walletBalance,
                    balanceAfter: driver.walletBalance + (event.data.amount / 100),
                    paystackRef: reference,
                  },
                });
              }
            });
          }
        }
      } else if (metadata?.bookingId) {
        await confirmPayment(metadata.bookingId, reference);
      }
    } finally {
      await redis.del(lockKey);
    }
  }

  if (event.event === 'transfer.success') {
    const { reference } = event.data;
    await prisma.walletTransaction.updateMany({
      where: { paystackRef: reference },
      data: { description: 'Withdrawal completed' },
    });
  }

  return { received: true };
}

module.exports = { initiatePayment, verifyPayment, handleWebhook, confirmPayment };
