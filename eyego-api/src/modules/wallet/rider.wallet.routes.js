'use strict';

const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const authenticate = require('../../middleware/auth');
const idempotency = require('../../middleware/idempotency');
const { ok } = require('../../utils/response');
const prisma = require('../../config/database');
const paystack = require('../payments/paystack.client');
const { AppError } = require('../../utils/errors');

const router = Router();

router.use(authenticate);

router.get('/balance', async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.userId },
    select: { walletBalance: true },
  });
  ok(res, {
    balance: user?.walletBalance ?? 0,
    currency: 'GHS',
    lastUpdated: new Date().toISOString(),
  });
});

router.get('/transactions', async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const skip = (Math.max(1, Number(page)) - 1) * Math.min(Number(limit), 100);
  const take = Math.min(Number(limit), 100);

  // Track wallet top-ups via PaymentTransaction records with gatewayResponse='WALLET_TOPUP'
  const [txns, total] = await Promise.all([
    prisma.paymentTransaction.findMany({
      where: {
        userId: req.user.userId,
        gatewayResponse: 'WALLET_TOPUP',
      },
      select: {
        id: true,
        amount: true,
        status: true,
        createdAt: true,
        paystackRef: true,
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.paymentTransaction.count({
      where: {
        userId: req.user.userId,
        gatewayResponse: 'WALLET_TOPUP',
      },
    }),
  ]);

  ok(res, {
    transactions: txns.map((t) => ({
      id: t.id,
      type: t.status === 'SUCCESS' ? 'CREDIT' : t.status === 'FAILED' ? 'DEBIT' : 'PENDING',
      amount: t.amount,
      reference: t.paystackRef,
      description:
        t.status === 'SUCCESS'
          ? 'Wallet top-up'
          : t.status === 'FAILED'
            ? 'Top-up failed'
            : 'Pending top-up',
      createdAt: t.createdAt.toISOString(),
    })),
    total,
    page: Number(page),
    totalPages: Math.ceil(total / take),
  });
});

router.post('/topup', idempotency, async (req, res) => {
  const { amount, method, momoPhone, email } = req.body;

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
      amount: Number(amount),
      status: 'INTENT',
      paystackRef: reference,
      gatewayResponse: 'WALLET_TOPUP',
    },
  });

  try {
    const result = await paystack.initiateMomoCharge({
      email: userEmail,
      amount: Number(amount),
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
    amount: 0.5, // ₵0.50 tokenization charge
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
