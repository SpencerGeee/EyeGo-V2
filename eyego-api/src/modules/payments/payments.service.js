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
async function initiatePayment({ userId, bookingId, phone, savedCardId, method: requestedMethod }) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { trip: { include: { route: true, group: true } }, user: true },
  });
  if (!booking) throw new NotFoundError('Booking');
  if (booking.userId !== userId) throw new AppError('Unauthorized', 403);
  if (booking.paymentStatus === 'PAID') throw new AppError('Already paid', 400);

  // "Pay for everyone": the gateway charge must cover every other held seat
  // on the trip too, not just this booking's own fare — confirmPayment marks
  // all of them PAID once this charge succeeds, so undercharging here would
  // let the host settle the whole group for the price of one seat.
  const isGroupHost = !!(booking.trip.group?.isCoverAll && booking.trip.group.leadPassengerId === userId);
  let chargeAmount = booking.fareAmount;
  if (isGroupHost) {
    const siblings = await prisma.booking.findMany({
      where: { tripId: booking.tripId, id: { not: bookingId }, status: 'SEAT_HELD' },
      select: { fareAmount: true },
    });
    chargeAmount = booking.fareAmount + siblings.reduce((sum, b) => sum + b.fareAmount, 0);
  }

  // Honor the method the rider actually picked on the payment screen. Without
  // this, a booking created with a placeholder method (e.g. group-invite always
  // pre-creates with CASH) silently ignored whatever the rider chose afterward,
  // because this used to always fall back to the DB's original paymentMethod.
  let method = booking.paymentMethod;
  if (requestedMethod) {
    const { normalizePaymentMethod } = require('../bookings/bookings.service');
    const normalized = normalizePaymentMethod(requestedMethod);
    if (normalized !== booking.paymentMethod) {
      await prisma.booking.update({ where: { id: bookingId }, data: { paymentMethod: normalized } });
      method = normalized;
    }
  }
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
        amount: chargeAmount,
        phone: phone || booking.user.phone,
        method: method === 'MOMO' ? 'MOMO_MTN' : method,
        reference,
        metadata,
      });
    } else if (method === 'CARD' && savedCardId) {
      // One-tap repeat charge: reuse a previously-saved card's authorization code
      // instead of forcing a fresh hosted checkout every time.
      const savedCard = await prisma.savedCard.findUnique({ where: { id: savedCardId } });
      if (!savedCard || savedCard.userId !== userId) {
        throw new AppError('Saved card not found', 404, 'CARD_NOT_FOUND');
      }
      result = await paystack.initiateCardCharge({
        email,
        amount: chargeAmount,
        authorizationCode: savedCard.authorizationCode,
        reference,
        metadata,
      });
    } else if (method === 'CARD') {
      result = await paystack.initializeCheckout({
        email,
        amount: chargeAmount,
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
        userId: booking.userId,
        amount: chargeAmount,
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
  const result = await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: { trip: { include: { route: true, group: true } } },
    });
    if (!booking) throw new NotFoundError('Booking');
    if (booking.paymentStatus === 'PAID' || booking.paymentStatus === 'CASH_PENDING') return booking; // idempotent

    if (booking.status !== 'SEAT_HELD' || booking.trip.confirmedSeats >= booking.trip.maxSeats) {
      const reason = booking.status !== 'SEAT_HELD' ? 'expired/cancelled booking' : 'trip full';
      if (isSync) {
        // Distinct, actionable messages instead of one generic string — the
        // client surfaces this verbatim in the "Payment Failed" alert, so a
        // rider whose seat hold expired needs a different next step (rebook)
        // than one who lost a genuine last-seat race (pick another trip).
        throw new AppError(
          reason === 'trip full'
            ? 'This trip filled up while you were completing payment. Please choose another trip.'
            : 'Your seat hold expired. Please select a seat again to rebook.',
          400,
          reason === 'trip full' ? 'TRIP_FULL' : 'SEAT_HOLD_EXPIRED',
        );
      }

      logger.info(`Booking failed (${reason}), triggering refund`, { bookingId, reference });

      await tx.paymentTransaction.create({
        data: {
          bookingId,
          userId: booking.userId,
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

    // "I'm paying for everyone": this booking's owner is the group's lead
    // passenger and isCoverAll is set — their single payment must settle
    // every other still-held seat on the trip too, not just their own.
    // Previously nothing read isCoverAll at all, so the toggle had zero
    // effect and every other member's seat stayed unpaid regardless of what
    // the host chose here.
    const isGroupHost = !!(booking.trip.group?.isCoverAll && booking.trip.group.leadPassengerId === booking.userId);
    const siblingBookings = isGroupHost
      ? await tx.booking.findMany({
          where: { tripId: booking.tripId, id: { not: bookingId }, status: 'SEAT_HELD' },
        })
      : [];
    const bookingsToSettle = [booking, ...siblingBookings];
    const totalFare = bookingsToSettle.reduce((sum, b) => sum + b.fareAmount, 0);

    // If paying by wallet, deduct the combined total up front — guard
    // prevents negative balance. Must happen before any status flips so a
    // shortfall aborts the whole settlement instead of partially confirming.
    if (booking.paymentMethod === 'WALLET') {
      const updated = await tx.user.updateMany({
        where: { id: booking.userId, walletBalance: { gte: totalFare } },
        data: { walletBalance: { decrement: totalFare } },
      });
      if (updated.count === 0) {
        throw new AppError('Insufficient wallet balance', 402, 'INSUFFICIENT_BALANCE');
      }
    }

    let settledCount = 0;
    for (const b of bookingsToSettle) {
      // Optimistic concurrency control to prevent race conditions
      const updatedBooking = await tx.booking.updateMany({
        where: { id: b.id, paymentStatus: b.paymentStatus },
        data: {
          paymentStatus: cashOnBoard ? 'CASH_PENDING' : 'PAID',
          status: 'CONFIRMED',
          paystackRef: reference,
        },
      });
      if (updatedBooking.count === 0) continue; // another transaction beat us to this one

      settledCount += 1;
      await tx.paymentTransaction.create({
        data: {
          bookingId: b.id,
          userId: booking.userId, // group host is the payer of record for covered seats
          amount: b.fareAmount,
          status: cashOnBoard ? 'PENDING' : 'SUCCESS',
          paystackRef: reference,
          gatewayResponse: cashOnBoard
            ? (b.id === bookingId ? 'Cash — collect on boarding' : 'Cash — covered by group host, collect on boarding')
            : (b.id === bookingId ? 'Payment confirmed' : 'Covered by group host payment'),
        }
      });
    }

    if (settledCount === 0) {
      // Someone else already settled this exact booking concurrently
      return tx.booking.findUnique({ where: { id: bookingId } });
    }

    // Increment confirmed seats once per booking actually settled
    const updatedTrip = await tx.trip.update({
      where: { id: booking.tripId },
      data: { confirmedSeats: { increment: settledCount } },
    });

    // Check if minimum occupancy met → update trip status
    if (
      updatedTrip.confirmedSeats >= env.MIN_OCCUPANCY_TO_DEPART &&
      updatedTrip.status === 'FILLING'
    ) {
      await tx.trip.update({ where: { id: booking.tripId }, data: { status: 'CONFIRMED' } });
    }

    // Send driver earnings to wallet (credited when trip completes, not now)
    logger.info('Payment confirmed', { bookingId, reference, settledCount, isGroupHost });

    return { ...booking, _justConfirmed: true, _settledBookingIds: bookingsToSettle.map((b) => b.id) };
  });

  if (result?._justConfirmed) {
    notifyEmergencyContactIfShareTripEnabled(bookingId).catch(() => {});
    for (const id of result._settledBookingIds) {
      notifyRideConfirmed(id).catch(() => {});
    }
  }
  return result;
}

// notifications.rideConfirmed / notifications.passengerJoined were defined in
// push.service.js but never called from anywhere — booking a seat produced no
// confirmation push to the rider and no "someone joined" push to the driver.
async function notifyRideConfirmed(bookingId) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      user: { select: { fcmToken: true, name: true, notificationPrefs: true } },
      trip: { include: { route: true, driver: { select: { fcmToken: true } } } },
    },
  });
  if (!booking) return;

  if (booking.user?.fcmToken) {
    const route = booking.trip?.route
      ? `${booking.trip.route.originName} → ${booking.trip.route.destinationName}`
      : 'your trip';
    const departure = booking.trip?.departureTime
      ? new Date(booking.trip.departureTime).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' })
      : '';
    await pushService.notifications.rideConfirmed(booking.user.fcmToken, route, departure, booking.user.notificationPrefs, booking.id, booking.tripId).catch(() => {});
  }

  if (booking.trip?.driver?.fcmToken) {
    await pushService.notifications.passengerJoined(
      booking.trip.driver.fcmToken,
      booking.user?.name || booking.guestName || 'A passenger',
      booking.seatNumber ?? 0,
      booking.tripId,
    ).catch(() => {});
  }

  // Express mode: this booking just filled the trip's last seat — switch the trip to
  // direct-to-destination mode and let the driver know so they can skip remaining stops.
  const trip = booking.trip;
  if (trip && !trip.isExpressMode && trip.confirmedSeats >= trip.maxSeats && trip.driver?.fcmToken) {
    await prisma.trip.update({ where: { id: trip.id }, data: { isExpressMode: true } }).catch(() => {});
    const destination = trip.route?.destinationName ?? 'the destination';
    await pushService.notifications.expressMode(trip.driver.fcmToken, destination, trip.id).catch(() => {});
  }
}

// "Share Trip Status" safety setting (profile/safety.tsx): when enabled, SMS the
// rider's default emergency contact a tracking link as soon as their trip is
// confirmed — previously this toggle persisted but nothing ever read it.
async function notifyEmergencyContactIfShareTripEnabled(bookingId) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { user: { include: { emergencyContacts: true } }, trip: { include: { route: true } } },
  });
  if (!booking?.user) return;

  let safetySettings = {};
  try {
    safetySettings = booking.user.safetySettings ? JSON.parse(booking.user.safetySettings) : {};
  } catch { /* ignore malformed settings */ }
  if (!safetySettings.shareTrip) return;

  const contact = booking.user.emergencyContacts?.[0];
  if (!contact?.phone) return;

  const smsService = require('../../services/sms.service');
  const trackingLink = `https://eyego.app/track/${booking.trip?.shortId ?? booking.tripId}`;
  await smsService.sendSms(
    contact.phone,
    `${booking.user.name || 'Your contact'} started an EyeGo trip to ${booking.trip?.route?.destinationName ?? 'their destination'}. Track live: ${trackingLink}`,
  ).catch(() => {});
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
