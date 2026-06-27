'use strict';

const { v4: uuidv4 } = require('uuid');
const prisma = require('../../config/database');
const env = require('../../config/env');
const paystack = require('../payments/paystack.client');
const { AppError, NotFoundError } = require('../../utils/errors');
const { toCedis } = require('../../utils/money');

async function getWallet(driverId) {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { walletBalance: true },
  });
  if (!driver) throw new NotFoundError('Driver');

  const transactions = await prisma.walletTransaction.findMany({
    where: { driverId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return { balance: driver.walletBalance, transactions };
}

async function topUp(driverId, amount) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) throw new NotFoundError('Driver');

  const reference = `wallet_topup_${uuidv4().replace(/-/g, '').slice(0, 16)}`;

  // Initiate Paystack charge for the driver's wallet top-up
  const result = await paystack.initiateMomoCharge({
    email: `${driver.phone}@eyego.app`,
    amount,
    phone: driver.phone,
    method: 'MOMO_MTN', // driver can choose on frontend
    reference,
    metadata: { driverId, type: 'WALLET_TOPUP' },
  });

  return { reference, ...result };
}

async function confirmTopUp(driverId, reference, amount) {
  const safeAmount = toCedis(amount);
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });

  return prisma.$transaction(async (tx) => {
    await tx.driver.update({
      where: { id: driverId },
      data: { walletBalance: { increment: safeAmount } },
    });

    await tx.walletTransaction.create({
      data: {
        driverId,
        type: 'TOP_UP',
        amount: safeAmount,
        description: 'Wallet top-up via MoMo',
        balanceBefore: driver.walletBalance,
        balanceAfter: toCedis(driver.walletBalance + safeAmount),
        paystackRef: reference,
      },
    });
  });
}

async function withdraw(driverId, amount) {
  const safeAmount = toCedis(amount);
  if (safeAmount < env.DRIVER_MIN_WITHDRAWAL) {
    throw new AppError(`Minimum withdrawal is GHS ${env.DRIVER_MIN_WITHDRAWAL}`, 400);
  }

  const reference = `withdrawal_${uuidv4().replace(/-/g, '').slice(0, 16)}`;

  // Step 1: Deduct wallet + record ledger entry atomically.
  // Balance check is INSIDE the transaction to prevent TOCTOU race conditions.
  // Paystack calls are intentionally OUTSIDE this transaction — external HTTP calls
  // inside a DB transaction hold locks and can leave the DB in an inconsistent state
  // if the network call hangs or fails partway through.
  const driver = await prisma.$transaction(async (tx) => {
    const current = await tx.driver.findUnique({ where: { id: driverId }, select: { walletBalance: true, name: true, phone: true } });
    if (!current) throw new NotFoundError('Driver');

    const updated = await tx.driver.updateMany({
      where: { id: driverId, walletBalance: { gte: safeAmount } },
      data: { walletBalance: { decrement: safeAmount } },
    });

    if (updated.count === 0) {
      throw new AppError('Insufficient wallet balance', 402, 'INSUFFICIENT_WALLET');
    }

    await tx.walletTransaction.create({
      data: {
        driverId,
        type: 'WITHDRAWAL',
        amount: safeAmount,
        description: 'Withdrawal to MoMo',
        balanceBefore: current.walletBalance,
        balanceAfter: toCedis(current.walletBalance - safeAmount),
        paystackRef: reference,
      },
    });

    return current;
  });

  // Step 2: Initiate Paystack transfer OUTSIDE transaction
  // If this fails, we run a compensating credit to restore the driver's balance.
  try {
    const recipient = await paystack.createTransferRecipient({
      name: driver.name,
      accountNumber: driver.phone,
    });

    await paystack.initiateTransfer({
      amount,
      recipient: recipient.data.recipient_code,
      reason: 'EyeGo Driver earnings withdrawal',
      reference,
    });
  } catch (paystackErr) {
    // Compensating transaction — credit wallet back and record the reversal
    await prisma.$transaction(async (tx) => {
      await tx.driver.update({
        where: { id: driverId },
        data: { walletBalance: { increment: amount } },
      });
      await tx.walletTransaction.create({
        data: {
          driverId,
          type: 'WITHDRAWAL_REVERSAL',
          amount,
          description: 'Withdrawal reversal — Paystack transfer failed',
          balanceBefore: driver.walletBalance - amount,
          balanceAfter: driver.walletBalance,
          paystackRef: `${reference}_reversal`,
        },
      });
    });
    throw new AppError('Withdrawal failed. Your balance has been restored.', 502, 'WITHDRAWAL_FAILED');
  }

  return { message: 'Withdrawal initiated. You will receive your MoMo payment shortly.', reference };
}

async function getPayoutAccount(driverId) {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { payoutData: true },
  });
  if (!driver) throw new NotFoundError('Driver');
  try {
    return driver.payoutData ? JSON.parse(driver.payoutData) : null;
  } catch {
    return null;
  }
}

async function updatePayoutAccount(driverId, data) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) throw new NotFoundError('Driver');

  const payout = {
    type: data.type,
    ...(data.type === 'bank' && {
      bankName: data.bankName,
      accountNumber: data.accountNumber,
      accountName: data.accountName,
    }),
    ...(data.type === 'momo' && {
      network: data.network,
      phone: data.phone,
    }),
  };

  await prisma.driver.update({
    where: { id: driverId },
    data: { payoutData: JSON.stringify(payout) },
  });

  return payout;
}

module.exports = { getWallet, topUp, confirmTopUp, withdraw, getPayoutAccount, updatePayoutAccount };
