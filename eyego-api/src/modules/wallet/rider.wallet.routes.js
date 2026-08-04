'use strict';

const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const authenticate = require('../../middleware/auth');
const idempotency = require('../../middleware/idempotency');
const { ok } = require('../../utils/response');
const prisma = require('../../config/database');
const paystack = require('../payments/paystack.client');
const { AppError } = require('../../utils/errors');
const { assertPesewas, formatGhs, fromCedis } = require('../../utils/money');

const router = Router();

/** Floor on a rider-to-rider transfer. GH₵1.00. */
const MIN_P2P_TRANSFER_PESEWAS = 100;
/**
 * Paystack will not tokenize a card without charging something, so saving a
 * card costs a token 50 pesewas. Written as a named constant in the unit the
 * gateway speaks rather than the bare `0.5` that used to sit inline — that
 * literal was cedis, and post-migration it would have been read as half a
 * pesewa and rejected.
 */
const CARD_TOKENIZATION_CHARGE_PESEWAS = fromCedis(0.5);

router.use(authenticate);

router.get('/balance', async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.userId },
    select: { walletBalancePesewas: true },
  });
  ok(res, {
    balancePesewas: user?.walletBalancePesewas ?? 0,
    currency: 'GHS',
    lastUpdated: new Date().toISOString(),
  });
});

router.get('/transactions', async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const skip = (Math.max(1, Number(page)) - 1) * Math.min(Number(limit), 100);
  const take = Math.min(Number(limit), 100);

  // BUGFIX: this filtered to `gatewayResponse: 'WALLET_TOPUP'`, so the rider's
  // wallet history showed top-ups and NOTHING else. Money sent to another
  // rider, money received from one, and every fare paid out of the wallet all
  // moved the balance with no corresponding line — the statement never
  // reconciled with the number above it. It also mislabelled a FAILED top-up as
  // a 'DEBIT', i.e. as if the rider had been charged for a payment that never
  // went through.
  //
  // Direction is now derived from what the row actually is, not from its
  // status: a top-up and an incoming P2P transfer credit the wallet, an
  // outgoing transfer and a wallet-funded fare debit it, and anything not yet
  // settled is PENDING and moves nothing.
  const where = { userId: req.user.userId };

  const [txns, total] = await Promise.all([
    prisma.paymentTransaction.findMany({
      where,
      select: {
        id: true,
        amountPesewas: true,
        status: true,
        createdAt: true,
        paystackRef: true,
        gatewayResponse: true,
        bookingId: true,
        booking: { select: { paymentMethod: true, trip: { select: { route: { select: { destinationName: true } } } } } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.paymentTransaction.count({ where }),
  ]);

  const describe = (t) => {
    const gw = t.gatewayResponse ?? '';
    if (gw === 'WALLET_TOPUP') {
      return {
        type: t.status === 'SUCCESS' ? 'CREDIT' : t.status === 'INTENT' ? 'PENDING' : 'FAILED',
        description:
          t.status === 'SUCCESS' ? 'Wallet top-up' : t.status === 'INTENT' ? 'Pending top-up' : 'Top-up failed',
      };
    }
    if (gw.startsWith('P2P_SEND')) return { type: 'DEBIT', description: 'Money sent' };
    if (gw.startsWith('P2P_RECEIVE')) return { type: 'CREDIT', description: 'Money received' };
    if (t.status === 'REFUNDED') return { type: 'CREDIT', description: 'Refund to wallet' };

    // A fare. Only wallet-funded fares actually move this balance; card/MoMo
    // fares are shown for the record but marked so they don't read as a
    // wallet debit that never happened.
    const dest = t.booking?.trip?.route?.destinationName;
    const label = dest ? `Trip to ${dest}` : 'Trip fare';
    if (t.status === 'INTENT' || t.status === 'PENDING') return { type: 'PENDING', description: label };
    if (t.booking?.paymentMethod === 'WALLET') return { type: 'DEBIT', description: label };
    return { type: 'EXTERNAL', description: `${label} (paid by ${(t.booking?.paymentMethod ?? 'card').toLowerCase()})` };
  };

  ok(res, {
    transactions: txns.map((t) => {
      const { type, description } = describe(t);
      return {
        id: t.id,
        type,
        amountPesewas: t.amountPesewas,
        reference: t.paystackRef,
        description,
        createdAt: t.createdAt.toISOString(),
      };
    }),
    total,
    page: Number(page),
    totalPages: Math.ceil(total / take),
  });
});

// ── Send Money (wallet-to-wallet P2P transfer) ─────────────────────────────
// Also backs "Scan & Pay" — the QR flow just resolves a scanned code to a
// recipientPhone client-side and calls this same endpoint.
router.post('/send', idempotency, async (req, res) => {
  const senderId = req.user.userId;
  const { recipientPhone, amountPesewas } = req.body;

  if (!recipientPhone) throw new AppError('recipientPhone is required', 400);
  // Guarded, not coerced: this is a client-supplied amount that is about to
  // move real money between two wallets. A fractional value here means the app
  // is still sending cedis, and `assertPesewas` says so instead of quietly
  // transferring a hundredth of the intended amount.
  const safeAmount = assertPesewas(amountPesewas, 'transfer amount');
  if (safeAmount < MIN_P2P_TRANSFER_PESEWAS) {
    throw new AppError(
      `Minimum transfer is ${formatGhs(MIN_P2P_TRANSFER_PESEWAS)}`,
      400,
      'INVALID_AMOUNT',
    );
  }

  // Ghana numbers are written four different ways for the same person:
  // 0244123456, 233244123456, +233244123456, and 244123456. This looked the
  // recipient up by exact string equality, so a scanned QR or a pasted contact
  // whose format didn't byte-match what the recipient signed up with returned
  // "No EyeGo user found with that phone number" for an account that plainly
  // exists. Try every equivalent spelling of the same subscriber number.
  const raw = String(recipientPhone).trim().replace(/[\s()-]/g, '');
  const local = raw.replace(/^\+?233/, '').replace(/^0/, '');
  const candidates = [...new Set([raw, `0${local}`, `233${local}`, `+233${local}`, local])].filter(Boolean);

  const recipient = await prisma.user.findFirst({ where: { phone: { in: candidates } } });
  if (!recipient) throw new AppError('No EyeGo user found with that phone number', 404, 'RECIPIENT_NOT_FOUND');
  if (recipient.id === senderId) throw new AppError('You cannot send money to yourself', 400, 'SELF_TRANSFER');

  const result = await prisma.$transaction(async (tx) => {
    // Atomic conditional decrement — the balance check happens as part of the
    // UPDATE itself (not a separate read-then-write), so concurrent sends
    // can never overdraw the sender's wallet. Same pattern as driver withdraw.
    const debited = await tx.user.updateMany({
      where: { id: senderId, walletBalancePesewas: { gte: safeAmount } },
      data: { walletBalancePesewas: { decrement: safeAmount } },
    });
    if (debited.count === 0) {
      throw new AppError('Insufficient wallet balance', 402, 'INSUFFICIENT_WALLET');
    }

    await tx.user.update({
      where: { id: recipient.id },
      data: { walletBalancePesewas: { increment: safeAmount } },
    });

    const reference = `p2p_${uuidv4().replace(/-/g, '').slice(0, 20)}`;
    await tx.paymentTransaction.create({
      data: { userId: senderId, amountPesewas: safeAmount, status: 'SUCCESS', paystackRef: reference, gatewayResponse: `P2P_SEND:${recipient.id}` },
    });
    await tx.paymentTransaction.create({
      data: { userId: recipient.id, amountPesewas: safeAmount, status: 'SUCCESS', paystackRef: reference, gatewayResponse: `P2P_RECEIVE:${senderId}` },
    });

    return { reference, recipientName: recipient.name };
  });

  ok(res, result, `${formatGhs(safeAmount)} sent to ${result.recipientName}`);
});

router.post('/topup', idempotency, async (req, res) => {
  const { amountPesewas, method, momoPhone, email } = req.body;

  if (!amount || amount <= 0) {
    throw new AppError('Amount must be greater than 0', 400, 'INVALID_AMOUNT');
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
  if (!user) throw new AppError('User not found', 404);

  const reference = `eyego_wallet_${uuidv4().replace(/-/g, '').slice(0, 20)}`;
  const userEmail = email || user.email || `${user.phone}@eyego.app`;
  const payMethod = method || 'MOMO_MTN';

  // Record the intent
  await prisma.paymentTransaction.create({
    data: {
      bookingId: null,
      userId: req.user.userId,
      amountPesewas: assertPesewas(amountPesewas, "top-up amount"),
      status: 'INTENT',
      paystackRef: reference,
      gatewayResponse: 'WALLET_TOPUP',
    },
  });

  try {
    const result = await paystack.initiateMomoCharge({
      email: userEmail,
      amountPesewas: assertPesewas(amountPesewas, "top-up amount"),
      phone: momoPhone || user.phone,
      method: payMethod,
      reference,
      metadata: { userId: req.user.userId, type: 'WALLET_TOPUP' },
    });

    ok(
      res,
      {
        reference,
        paystackResult: result,
      },
      'Top-up initiated. Complete payment on your phone.',
    );
  } catch (err) {
    await prisma.paymentTransaction.updateMany({
      where: { paystackRef: reference },
      data: { status: 'FAILED' },
    });
    throw new AppError(
      `Top-up initiation failed: ${err.message}`,
      400,
      'TOPUP_FAILED',
    );
  }
});

// ── Rider saved cards ──────────────────────────────────────────────────────────

router.get('/payment-methods', async (req, res) => {
  const cards = await prisma.savedCard.findMany({
    where: { userId: req.user.userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, last4: true, brand: true, expMonth: true, expYear: true,
      cardholderName: true, isDefault: true, createdAt: true,
    },
  });
  ok(res, { methods: cards.map((c) => ({ ...c, type: 'card', createdAt: c.createdAt.toISOString() })) });
});

router.delete('/payment-methods/:id', async (req, res) => {
  const card = await prisma.savedCard.findUnique({ where: { id: req.params.id } });
  if (!card || card.userId !== req.user.userId) throw new AppError('Payment method not found', 404, 'NOT_FOUND');
  await prisma.savedCard.delete({ where: { id: req.params.id } });
  ok(res, null, 'Payment method removed');
});

// Initialize Paystack hosted checkout for card tokenization (₵0.50 charge, reusable auth captured)
router.post('/payment-methods/initialize', async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
  if (!user) throw new AppError('User not found', 404);

  const reference = `card_save_${uuidv4().replace(/-/g, '').slice(0, 20)}`;
  const email = user.email || `${user.phone}@eyego.app`;

  const result = await paystack.initializeCheckout({
    email,
    amountPesewas: CARD_TOKENIZATION_CHARGE_PESEWAS,
    reference,
    metadata: { userId: req.user.userId, type: 'CARD_SAVE' },
  });

  ok(res, { reference, authorizationUrl: result.data.authorization_url });
});

// Verify checkout and persist the reusable card authorization
router.post('/payment-methods/verify', async (req, res) => {
  const { reference } = req.body;
  if (!reference) throw new AppError('reference is required', 400);

  const verification = await paystack.verifyTransaction(reference);

  if (verification.data?.status !== 'success') {
    throw new AppError('Card verification failed — payment not complete', 400, 'VERIFICATION_FAILED');
  }

  const auth = verification.data.authorization;
  if (!auth?.reusable) {
    throw new AppError('This card cannot be saved for future payments', 400, 'CARD_NOT_REUSABLE');
  }

  const customerName = verification.data.customer?.first_name
    ? `${verification.data.customer.first_name} ${verification.data.customer.last_name ?? ''}`.trim()
    : null;

  // Upsert — prevents duplicates if user completes checkout twice for the same card
  const card = await prisma.savedCard.upsert({
    where: {
      userId_authorizationCode: {
        userId: req.user.userId,
        authorizationCode: auth.authorization_code,
      },
    },
    update: {
      last4: auth.last4,
      brand: auth.brand,
      expMonth: auth.exp_month,
      expYear: auth.exp_year,
    },
    create: {
      userId: req.user.userId,
      authorizationCode: auth.authorization_code,
      last4: auth.last4,
      brand: auth.brand,
      expMonth: auth.exp_month,
      expYear: auth.exp_year,
      cardholderName: customerName,
    },
  });

  ok(res, {
    card: {
      id: card.id,
      last4: card.last4,
      brand: card.brand,
      expMonth: card.expMonth,
      expYear: card.expYear,
    },
  }, 'Card saved successfully');
});

module.exports = router;
