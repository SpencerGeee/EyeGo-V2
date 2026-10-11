'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../../config/database');
const env = require('../../config/env');
const paystack = require('./provider');
const tripState = require('../../services/trip-state.service');
const pushService = require('../../services/push.service');
const { NotFoundError, PaymentError, AppError } = require('../../utils/errors');
const logger = require('../../utils/logger');
const redis = require('../../config/redis');
const { assertPesewas, percentOf, formatGhs } = require('../../utils/money');

const MOMO_METHODS = ['MOMO', 'MOMO_MTN', 'MOMO_TELECEL', 'MOMO_AIRTELTIGO'];

// Initiate payment for a held booking. Branches by the booking's payment method:
//   • MoMo  → real Paystack mobile-money charge; confirmed later via webhook → PENDING
//   • Card  → Paystack hosted checkout; client opens authorizationUrl → PENDING
//   • Wallet→ synchronous balance debit inside confirmPayment → SUCCESS
//   • Cash  → no gateway; seat confirmed now, rider pays driver on board → SUCCESS
const riderWallet = require('../../services/rider-wallet.service');

/**
 * A rider top-up the gateway confirmed: claim the intent, credit through the
 * ledger. Shared by the app's verify and the webhook, which used to carry two
 * copies of a bare balance increment with no ledger row.
 */
async function creditRiderTopUp(txn, userId, reference) {
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.paymentTransaction.updateMany({
      where: { id: txn.id, status: 'INTENT' },
      data: { status: 'SUCCESS' },
    });
    if (claimed.count === 0) return;
    await riderWallet.record({
      userId,
      type: riderWallet.TYPES.TOPUP,
      amountPesewas: txn.amountPesewas,
      description: 'Wallet top-up',
      paystackRef: reference,
      tx,
    });
  });
}

/** How long a pending charge may be handed back instead of starting a new one. */
const INTENT_REUSE_MS = 3 * 60 * 1000;

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
  let chargeAmountPesewas = booking.fareAmountPesewas;
  if (isGroupHost) {
    const siblings = await prisma.booking.findMany({
      where: { tripId: booking.tripId, id: { not: bookingId }, status: 'SEAT_HELD' },
      select: { fareAmountPesewas: true },
    });
    chargeAmountPesewas = booking.fareAmountPesewas + siblings.reduce((sum, b) => sum + b.fareAmountPesewas, 0);
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
    try {
      await confirmPayment(bookingId, reference, { cashOnBoard: method === 'CASH', isSync: true });
    } catch (err) {
      // Last check before telling a rider their payment failed: re-read the
      // booking. A confirm that raced with another request, a retry after a lost
      // response, or a transaction that committed and then threw downstream all
      // arrive here with the seat already settled — and "Payment failed" on a
      // live, confirmed booking is the single worst thing this endpoint can say.
      // Only a booking that genuinely is not settled surfaces the error.
      const fresh = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { status: true, paymentStatus: true },
      });
      const settled =
        fresh &&
        (fresh.paymentStatus === 'PAID' ||
          (fresh.status === 'CONFIRMED' && method === 'CASH') ||
          fresh.status === 'BOARDED');
      if (!settled) throw err;
      logger.warn('Sync payment reported an error on an already-settled booking; treating as success', {
        bookingId,
        method,
        error: err.message,
      });
    }
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
    /**
     * Reuse a charge only while it can still complete. A MoMo prompt that was
     * declined or timed out left its INTENT row behind for ever, and this handed
     * that dead reference back on every retry — the rider could never pay. A
     * stale intent is set aside; if it does land late after all, confirmPayment
     * returns it to the wallet as a duplicate. Tip intents are not fares.
     */
    const notTip = { OR: [{ gatewayResponse: null }, { gatewayResponse: { not: 'TIP' } }] };
    const existingIntent = await prisma.paymentTransaction.findFirst({
      where: { bookingId, status: 'INTENT', ...notTip },
      orderBy: { createdAt: 'desc' },
    });
    if (existingIntent && Date.now() - existingIntent.createdAt.getTime() < INTENT_REUSE_MS) {
      return {
        reference: existingIntent.paystackRef,
        status: 'PENDING',
        method,
        requiresVerification: true,
      };
    }
    if (existingIntent) {
      await prisma.paymentTransaction.updateMany({
        where: { bookingId, status: 'INTENT', ...notTip },
        data: { status: 'ABANDONED' },
      });
    }

    // ── Asynchronous methods: Paystack mobile money or hosted card checkout ──
    let result;
    if (MOMO_METHODS.includes(method)) {
      result = await paystack.initiateMomoCharge({
        email,
        amountPesewas: chargeAmountPesewas,
        phone: phone || booking.user.phone,
        // A bare 'MOMO' was forced to MTN, so a Telecel or AirtelTigo number
        // got an MTN charge that could never be approved. The client now
        // reads the network off the number (paystack.client momoMethodForPhone).
        method,
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
        amountPesewas: chargeAmountPesewas,
        authorizationCode: savedCard.authorizationCode,
        reference,
        metadata,
      });
    } else if (method === 'CARD') {
      result = await paystack.initializeCheckout({
        email,
        amountPesewas: chargeAmountPesewas,
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
        amountPesewas: chargeAmountPesewas,
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
    // A charge that is over and did not succeed is closed, so the next tap on
    // Pay starts a new one instead of re-polling a dead prompt.
    if (['failed', 'abandoned', 'reversed'].includes(String(result.data?.status ?? '').toLowerCase())) {
      await prisma.paymentTransaction.updateMany({
        where: { paystackRef: reference, status: 'INTENT' },
        data: { status: 'FAILED' },
      });
    }
    throw new PaymentError(`Payment not successful: ${result.data?.gateway_response}`);
  }

  const metadata = result.data.metadata;

  if (metadata?.type === 'TIP') {
    if (requestingUserId && metadata.userId && metadata.userId !== requestingUserId) {
      throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
    }
    await settleTip(reference);
    return { type: 'TIP', status: 'SUCCESS' };
  }

  if (metadata?.type === 'WALLET_TOPUP') {
    if (metadata?.userId) {
      if (requestingUserId && metadata.userId !== requestingUserId) {
        throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
      }
      const txn = await prisma.paymentTransaction.findFirst({
        where: { paystackRef: reference, status: 'INTENT' },
      });
      if (txn) await creditRiderTopUp(txn, metadata.userId, reference);
    } else if (metadata?.driverId) {
      if (requestingUserId && metadata.driverId !== requestingUserId) {
        throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
      }
      // Paystack's `data.amount` is the SUBUNIT — pesewas for GHS. Through the
      // one credit path (deduped on the reference, balance read in the tx).
      await require('../wallet/wallet.service').creditTopUp(
        metadata.driverId,
        reference,
        assertPesewas(result.data.amount, 'Paystack top-up amount'),
      );
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
  // Captured inside the transaction, published after it commits.
  let confirmTransition = null;
  const result = await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: { trip: { include: { route: true, group: true } } },
    });
    if (!booking) throw new NotFoundError('Booking');
    if (booking.paymentStatus === 'PAID' || booking.paymentStatus === 'CASH_PENDING') {
      /**
       * A SECOND SUCCESSFUL CHARGE FOR A PAID BOOKING — a retried MoMo prompt
       * where both went through. It was silently kept. Returned to the wallet,
       * once (the row's status flip is the lock).
       */
      if (!isSync && reference && booking.paystackRef && reference !== booking.paystackRef) {
        const dup = await tx.paymentTransaction.findFirst({
          where: { paystackRef: reference, status: { in: ['INTENT', 'ABANDONED', 'FAILED'] } },
          select: { id: true, amountPesewas: true, userId: true },
        });
        if (dup) {
          const claimed = await tx.paymentTransaction.updateMany({
            where: { id: dup.id, status: { in: ['INTENT', 'ABANDONED', 'FAILED'] } },
            data: { status: 'REFUNDED', gatewayResponse: 'Duplicate payment refunded to wallet' },
          });
          if (claimed.count > 0) {
            await riderWallet.record({
              userId: dup.userId,
              type: riderWallet.TYPES.REFUND,
              amountPesewas: dup.amountPesewas,
              description: 'Duplicate payment refunded',
              bookingId,
              paystackRef: reference,
              tx,
            });
          }
        }
      }
      return booking; // idempotent
    }

    // BUGFIX ("Pay in cash → Payment failed", including the group host's
    // pay-for-everyone flow): cash bookings are CONFIRMED at creation with
    // paymentStatus 'PENDING' — cash is owed to the driver, not to us, so there
    // is nothing to collect online. When the rider then pressed "Pay in cash",
    // this fell through to the SEAT_HELD guard below, which saw a CONFIRMED
    // booking, decided the seat hold had expired, and threw — surfacing as a
    // flat "Payment failed" on a booking that was in fact perfectly fine.
    //
    // The 'PENDING' paymentStatus cannot carry this on its own: it is also the
    // initial value for an unpaid card/MoMo booking, so it is the CONFIRMED
    // status that distinguishes "already settled, cash owed on boarding".
    const cashSettled =
      booking.status === 'CONFIRMED' &&
      booking.paymentStatus === 'PENDING' &&
      (cashOnBoard || booking.paymentMethod === 'CASH');
    if (cashSettled) return booking; // idempotent

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

      /**
       * ONCE PER CHARGE, FOR WHAT WAS CHARGED.
       *
       * The webhook and the app's own verify both arrive here for the same
       * reference, and REFUNDED rows are not what the webhook's SUCCESS dedupe
       * looks for — so both used to refund, and the wallet was credited twice.
       * Claiming the charge's INTENT row is the lock: whoever flips it refunds.
       * And the amount is the INTENT's, i.e. what the gateway actually took — a
       * group host's charge covers every sibling seat, not just their own.
       */
      const intent = await tx.paymentTransaction.findFirst({
        where: { paystackRef: reference, status: 'INTENT' },
        select: { id: true, amountPesewas: true },
      });
      if (intent) {
        const claimed = await tx.paymentTransaction.updateMany({
          where: { id: intent.id, status: 'INTENT' },
          data: { status: 'SETTLED' },
        });
        if (claimed.count === 0) return booking;
      } else if (
        await tx.paymentTransaction.findFirst({ where: { paystackRef: reference, status: 'REFUNDED' }, select: { id: true } })
      ) {
        return booking;
      }
      const chargedPesewas = intent?.amountPesewas ?? booking.fareAmountPesewas;

      logger.info(`Booking failed (${reason}), triggering refund`, { bookingId, reference, chargedPesewas });

      await tx.paymentTransaction.create({
        data: {
          bookingId,
          userId: booking.userId,
          amountPesewas: chargedPesewas,
          status: 'REFUNDED',
          paystackRef: reference,
          gatewayResponse: `Refunded to wallet due to ${reason}`,
        }
      });

      // If they actually paid via an external gateway, refund to their wallet
      if (['MOMO', 'MOMO_MTN', 'MOMO_TELECEL', 'MOMO_AIRTELTIGO', 'CARD'].includes(booking.paymentMethod)) {
        await riderWallet.record({
          userId: booking.userId,
          type: riderWallet.TYPES.REFUND,
          amountPesewas: chargedPesewas,
          description: reason === 'trip full' ? 'Refund: the trip filled before your payment landed' : 'Refund: your seat hold expired',
          bookingId,
          paystackRef: reference,
          tx,
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
    const totalFare = bookingsToSettle.reduce(
      // Guarded per row, not on the sum. One booking with a null
      // `fareAmountPesewas` makes the whole reduce `NaN`, and `NaN` then goes
      // into `walletBalancePesewas: { gte: NaN }` — a comparison nothing
      // satisfies — so a cover-all host with a full wallet is told
      // "Insufficient wallet balance" and has no way to find out why. Naming
      // the row that is wrong turns that into a real error.
      (sum, b) => sum + assertPesewas(b.fareAmountPesewas, `booking ${b.id} fare`),
      0,
    );

    // If paying by wallet, deduct the combined total up front — guard
    // prevents negative balance. Must happen before any status flips so a
    // shortfall aborts the whole settlement instead of partially confirming.
    if (booking.paymentMethod === 'WALLET') {
      // The friendly refusal first; the ledger's conditional debit below is the
      // authority if two payments race for the same balance.
      const payer = await tx.user.findUnique({ where: { id: booking.userId }, select: { walletBalancePesewas: true } });
      if (!payer || payer.walletBalancePesewas < totalFare) {
        throw new AppError('Insufficient wallet balance', 402, 'INSUFFICIENT_BALANCE');
      }
      await riderWallet.record({
        userId: booking.userId,
        type: riderWallet.TYPES.RIDE_PAYMENT,
        amountPesewas: -totalFare,
        description: siblingBookings.length ? `Ride payment (${bookingsToSettle.length} seats)` : 'Ride payment',
        bookingId,
        paystackRef: reference,
        tx,
      });
    }

    let settledCount = 0;
    let settledFarePesewas = 0;
    for (const b of bookingsToSettle) {
      // Optimistic concurrency control to prevent race conditions
      const updatedBooking = await tx.booking.updateMany({
        where: { id: b.id, paymentStatus: b.paymentStatus },
        data: {
          // 'PENDING' (not a separate 'CASH_PENDING' value) — every other cash
          // consumer in the codebase (admin dashboard badge map, arriveTrip's
          // booking filter, the driver add-passenger flow) treats literal
          // 'PENDING' as "cash owed, collect on boarding". 'CASH_PENDING' was
          // an isolated value nothing downstream ever read, which made
          // in-app cash bookings invisible to those consumers and rendered
          // an unstyled badge in the admin console.
          paymentStatus: cashOnBoard ? 'PENDING' : 'PAID',
          status: 'CONFIRMED',
          paystackRef: reference,
        },
      });
      if (updatedBooking.count === 0) continue; // another transaction beat us to this one

      settledCount += 1;
      settledFarePesewas += b.fareAmountPesewas;
      await tx.paymentTransaction.create({
        data: {
          bookingId: b.id,
          userId: booking.userId, // group host is the payer of record for covered seats
          amountPesewas: b.fareAmountPesewas,
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

    /**
     * CLOSE THE CHARGE, AND GIVE BACK WHAT WAS NOT SPENT.
     *
     * The INTENT row stayed INTENT for ever, so the rider's wallet history
     * listed every card/MoMo trip as "pending" next to its real line. And a
     * group host is charged for every sibling seat held at the moment they
     * tapped Pay; a sibling whose hold lapsed before the money landed was not
     * settled here, and the difference was simply kept.
     */
    if (!cashOnBoard && booking.paymentMethod !== 'WALLET') {
      const intent = await tx.paymentTransaction.findFirst({
        where: { paystackRef: reference, status: 'INTENT' },
        select: { id: true, amountPesewas: true },
      });
      if (intent) {
        const claimed = await tx.paymentTransaction.updateMany({
          where: { id: intent.id, status: 'INTENT' },
          data: { status: 'SETTLED' },
        });
        const excess = intent.amountPesewas - settledFarePesewas;
        if (claimed.count > 0 && excess > 0) {
          await riderWallet.record({
            userId: booking.userId,
            type: riderWallet.TYPES.REFUND,
            amountPesewas: excess,
            description: 'Refund: seats released before your group payment settled',
            bookingId,
            paystackRef: reference,
            tx,
          });
          await tx.paymentTransaction.create({
            data: {
              bookingId,
              userId: booking.userId,
              amountPesewas: excess,
              status: 'REFUNDED',
              paystackRef: `${reference}_excess`,
              gatewayResponse: 'Refunded to wallet: seats released before your payment settled',
            },
          });
        }
      }
    }

    // Increment confirmed seats once per booking actually settled
    const updatedTrip = await tx.trip.update({
      where: { id: booking.tripId },
      data: { confirmedSeats: { increment: settledCount } },
    });

    // Check if minimum occupancy met → update trip status
    if (
      updatedTrip.confirmedSeats >= (require('../../config/settings').get('MIN_OCCUPANCY_TO_DEPART') ?? env.MIN_OCCUPANCY_TO_DEPART) &&
      updatedTrip.status === 'FILLING'
    ) {
      // Minimum occupancy reached — the trip is going. Emitted through the
      // state machine so the driver and every seated rider learn it from the
      // same versioned event instead of each app inferring it from its own
      // seat count.
      confirmTransition = await tripState.applyTransitionTx(tx, booking.tripId, 'CONFIRMED', {
        actor: tripState.ACTOR.SYSTEM,
        payload: { confirmedSeats: updatedTrip.confirmedSeats, trigger: 'MIN_OCCUPANCY' },
      });
    }

    // Send driver earnings to wallet (credited when trip completes, not now)
    logger.info('Payment confirmed', { bookingId, reference, settledCount, isGroupHost });

    return { ...booking, _justConfirmed: true, _settledBookingIds: bookingsToSettle.map((b) => b.id) };
  });

  // Post-commit. Money and trip status moved together inside the transaction;
  // both apps hear about it together, once, after it is durable.
  tripState.publishCommitted(confirmTransition);

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
      booking.guestName || booking.user?.name || 'A passenger',
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

/**
 * A TIP THE GATEWAY CONFIRMED: 100 % TO THE DRIVER, ONCE.
 *
 * Nothing used to do this. The rider's MoMo was charged, the driver was pushed
 * "sent you a tip!" before the money had even moved, and no TIP wallet row was
 * ever written — so driver earnings, which read TIP rows, were always short.
 * Claiming the INTENT row is the lock; the push goes out only once credited.
 */
async function settleTip(reference) {
  const credited = await prisma.$transaction(async (tx) => {
    const intent = await tx.paymentTransaction.findFirst({
      where: { paystackRef: reference, gatewayResponse: 'TIP' },
      select: {
        id: true,
        amountPesewas: true,
        booking: { select: { tripId: true, trip: { select: { driverId: true } }, user: { select: { name: true } } } },
      },
    });
    const driverId = intent?.booking?.trip?.driverId;
    if (!intent || !driverId) return null;
    const claimed = await tx.paymentTransaction.updateMany({
      where: { id: intent.id, status: 'INTENT' },
      data: { status: 'SUCCESS' },
    });
    if (claimed.count === 0) return null;
    const { walletBalancePesewas: after, fcmToken } = await tx.driver.update({
      where: { id: driverId },
      data: { walletBalancePesewas: { increment: intent.amountPesewas } },
      select: { walletBalancePesewas: true, fcmToken: true },
    });
    await tx.walletTransaction.create({
      data: {
        driverId,
        type: 'TIP',
        amountPesewas: intent.amountPesewas,
        description: 'Tip from your rider',
        balanceBeforePesewas: after - intent.amountPesewas,
        balanceAfterPesewas: after,
        paystackRef: reference,
      },
    });
    return {
      fcmToken,
      amountPesewas: intent.amountPesewas,
      tripId: intent.booking.tripId,
      riderName: intent.booking.user?.name || 'A rider',
    };
  });

  if (credited?.fcmToken) {
    require('../../services/push.service')
      .sendPush(
        credited.fcmToken,
        `💰 ${credited.riderName} sent you a tip!`,
        `${formatGhs(credited.amountPesewas)} tip received for trip #${credited.tripId.slice(0, 8)}`,
        { type: 'TIP', amountPesewas: String(credited.amountPesewas) },
      )
      .catch(() => {});
  }
  return credited;
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

      // Checked BEFORE `bookingId`: a tip carries the booking it is for, and
      // used to fall into confirmPayment — a no-op on a paid booking — so no
      // tip ever reached a driver.
      if (metadata?.type === 'TIP') {
        await settleTip(reference);
      } else if (metadata?.type === 'WALLET_TOPUP') {
        if (metadata?.userId) {
          const txn = await prisma.paymentTransaction.findFirst({
            where: { paystackRef: reference, status: 'INTENT' },
          });
          if (txn) await creditRiderTopUp(txn, metadata.userId, reference);
        } else if (metadata?.driverId) {
          // Driver wallet top-up — through the ONE credit path (dedupe on the
          // reference, balance read inside the transaction). This used to be a
          // copy with the balance read outside it, so a webhook racing the
          // app's own confirm wrote a ledger that did not add up.
          // `event.data.amount` is already pesewas.
          await require('../wallet/wallet.service').creditTopUp(
            metadata.driverId,
            reference,
            assertPesewas(event.data.amount, 'Paystack webhook top-up amount'),
          );
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
      where: { paystackRef: reference, type: 'WITHDRAWAL' },
      data: { description: 'Withdrawal completed' },
    });
  }

  /**
   * A PAYOUT THAT FAILS AFTER IT WAS ACCEPTED. MoMo transfers routinely do
   * (wrong network, wallet limit). Unhandled, the driver's wallet stayed
   * debited for money that never arrived. Idempotent: replays are no-ops.
   */
  if (event.event === 'transfer.failed' || event.event === 'transfer.reversed') {
    await require('../wallet/wallet.service').reverseWithdrawal(
      event.data?.reference,
      `Withdrawal reversal — transfer ${event.event === 'transfer.failed' ? 'failed' : 'reversed'}`,
    );
  }

  return { received: true };
}

module.exports = { initiatePayment, verifyPayment, handleWebhook, confirmPayment, settleTip };
