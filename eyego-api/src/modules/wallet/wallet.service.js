'use strict';

const { v4: uuidv4 } = require('uuid');
const prisma = require('../../config/database');
const env = require('../../config/env');
const paystack = require('../payments/paystack.client');
const { AppError, NotFoundError } = require('../../utils/errors');
const { assertPesewas, formatGhs } = require('../../utils/money');

/**
 * Every amount crossing this module is an integer number of pesewas.
 *
 * `toCedis()` used to round each write to 2dp, which was the best that could be
 * done while the balance was a float. It is gone: there is nothing to round.
 * `balanceAfter = balanceBefore ± amount` is now an exact identity, which is
 * what makes the ledger auditable — you can re-add every row and land on the
 * balance, to the pesewa.
 */

// `transactionLimit` defaults to 50 for callers that just want a quick recent
// snapshot (getBalance), but getTransactions needs to fetch enough rows to
// actually satisfy whatever page it's paginating to — a flat take:50 here
// silently truncated any page/limit request beyond the first 50 transactions.
async function getWallet(driverId, transactionLimit = 50) {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { walletBalancePesewas: true },
  });
  if (!driver) throw new NotFoundError('Driver');

  const transactions = await prisma.walletTransaction.findMany({
    where: { driverId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(transactionLimit, 500),
  });

  return { balancePesewas: driver.walletBalancePesewas, transactions };
}

/** Nobody tops up a hundred thousand cedis by accident; a fat finger does. */
const MAX_TOPUP_PESEWAS = 500_000; // ₵5,000

async function topUp(driverId, amountPesewas, { method = 'MOMO_MTN' } = {}) {
  const safeAmount = assertPesewas(amountPesewas, 'top-up amount');
  if (safeAmount > MAX_TOPUP_PESEWAS) {
    throw new AppError(`The most you can add at once is ${formatGhs(MAX_TOPUP_PESEWAS)}.`, 400);
  }
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) throw new NotFoundError('Driver');

  /**
   * SIMULATED MODE — see env.PAYMENTS_SIMULATED for why this branch exists.
   *
   * The prefix is load-bearing twice over: `confirmTopUp` and the Paystack
   * webhook both dedupe on `paystackRef`, so a simulated reference can never
   * collide with a real charge; and any later reconciliation can find every
   * cedi that was never actually collected with one `LIKE 'sim_%'`.
   */
  if (env.PAYMENTS_SIMULATED) {
    const reference = `sim_topup_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const credited = await creditTopUp(driverId, reference, safeAmount, {
      description: `Wallet top-up (simulated — no payment gateway configured)`,
    });
    return {
      reference,
      simulated: true,
      status: 'SUCCESS',
      balancePesewas: credited.balanceAfterPesewas,
      message: `${formatGhs(safeAmount)} added to your wallet.`,
    };
  }

  const reference = `wallet_topup_${uuidv4().replace(/-/g, '').slice(0, 16)}`;

  // Initiate Paystack charge for the driver's wallet top-up
  const result = await paystack.initiateMomoCharge({
    email: `${driver.phone}@eyego.app`,
    amountPesewas: safeAmount,
    phone: driver.phone,
    method,
    reference,
    metadata: { driverId, type: 'WALLET_TOPUP' },
  });

  return { reference, simulated: false, ...result };
}

/**
 * The credit itself — the one place a TOP_UP row is written.
 *
 * Extracted from `confirmTopUp` so the simulated path and the gateway path
 * cannot drift: both take the same lock, write the same ledger shape and
 * preserve the same `balanceAfter = balanceBefore + amount` identity. The
 * balance is re-read INSIDE the transaction (the old `confirmTopUp` used the
 * row it had fetched before it started, so two concurrent credits both recorded
 * the same `balanceBefore` and the ledger stopped adding up).
 */
async function creditTopUp(driverId, reference, amountPesewas, { description } = {}) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.walletTransaction.findFirst({
      where: { paystackRef: reference, type: 'TOP_UP' },
      select: { id: true, balanceAfterPesewas: true },
    });
    if (existing) return existing;

    const current = await tx.driver.findUnique({
      where: { id: driverId },
      select: { walletBalancePesewas: true },
    });
    if (!current) throw new NotFoundError('Driver');

    const before = current.walletBalancePesewas;
    const after = before + amountPesewas;

    await tx.driver.update({
      where: { id: driverId },
      data: { walletBalancePesewas: after },
    });

    return tx.walletTransaction.create({
      data: {
        driverId,
        type: 'TOP_UP',
        amountPesewas,
        description: description ?? 'Wallet top-up via MoMo',
        balanceBeforePesewas: before,
        balanceAfterPesewas: after,
        paystackRef: reference,
      },
    });
  });
}

/**
 * The gateway confirmed a charge. Delegates to `creditTopUp` so this and the
 * simulated path write byte-identical ledger rows — and so the balanceBefore
 * bug this used to carry (read outside the transaction, so two concurrent
 * credits recorded the same "before") cannot come back on one of them only.
 */
async function confirmTopUp(driverId, reference, amountPesewas) {
  const safeAmount = assertPesewas(amountPesewas, 'top-up amount');
  return creditTopUp(driverId, reference, safeAmount);
}

async function withdraw(driverId, amountPesewas) {
  const safeAmount = assertPesewas(amountPesewas, 'withdrawal amount');
  if (safeAmount < env.DRIVER_MIN_WITHDRAWAL_PESEWAS) {
    // Formatted, not raw: the threshold is 2000 pesewas and a driver told
    // "Minimum withdrawal is GHS 2000" would reasonably close the app.
    throw new AppError(
      `Minimum withdrawal is ${formatGhs(env.DRIVER_MIN_WITHDRAWAL_PESEWAS)}`,
      400,
    );
  }

  const reference = `withdrawal_${uuidv4().replace(/-/g, '').slice(0, 16)}`;

  // Step 1: Deduct wallet + record ledger entry atomically.
  // Balance check is INSIDE the transaction to prevent TOCTOU race conditions.
  // Paystack calls are intentionally OUTSIDE this transaction — external HTTP calls
  // inside a DB transaction hold locks and can leave the DB in an inconsistent state
  // if the network call hangs or fails partway through.
  const driver = await prisma.$transaction(async (tx) => {
    const current = await tx.driver.findUnique({ where: { id: driverId }, select: { walletBalancePesewas: true, name: true, phone: true } });
    if (!current) throw new NotFoundError('Driver');

    const updated = await tx.driver.updateMany({
      where: { id: driverId, walletBalancePesewas: { gte: safeAmount } },
      data: { walletBalancePesewas: { decrement: safeAmount } },
    });

    if (updated.count === 0) {
      throw new AppError('Insufficient wallet balance', 402, 'INSUFFICIENT_WALLET');
    }

    await tx.walletTransaction.create({
      data: {
        driverId,
        type: 'WITHDRAWAL',
        amountPesewas: safeAmount,
        description: 'Withdrawal to MoMo',
        balanceBeforePesewas: current.walletBalancePesewas,
        balanceAfterPesewas: current.walletBalancePesewas - safeAmount,
        paystackRef: reference,
      },
    });

    return current;
  });

  // Step 2: Initiate Paystack transfer OUTSIDE transaction
  // If this fails, we run a compensating credit to restore the driver's balance.
  try {
    // Route to the driver's saved payout preference (bank or a specific MoMo
    // network) instead of always defaulting to MTN via their phone number.
    let payoutPref = null;
    try {
      const fresh = await prisma.driver.findUnique({ where: { id: driverId }, select: { payoutData: true } });
      payoutPref = fresh?.payoutData ? JSON.parse(fresh.payoutData) : null;
    } catch { /* malformed/missing payout data — fall back below */ }

    let recipientParams = { name: driver.name, accountNumber: driver.phone };
    if (payoutPref) {
      const resolved = await paystack.resolvePayoutBankCode(payoutPref);
      if (resolved) {
        recipientParams = {
          name: resolved.name || driver.name,
          accountNumber: resolved.accountNumber,
          bankCode: resolved.bankCode,
          recipientType: resolved.recipientType,
        };
      }
    }

    const recipient = await paystack.createTransferRecipient(recipientParams);

    await paystack.initiateTransfer({
      amountPesewas: safeAmount,
      recipient: recipient.data.recipient_code,
      reason: 'EyeGo Driver earnings withdrawal',
      reference,
    });
  } catch (paystackErr) {
    // Compensating transaction — credit wallet back and record the reversal.
    // Must use safeAmount, the exact integer that was debited in step 1. (When
    // this was floating-point cedis the note here warned about crediting back
    // an unrounded value and leaving the wallet off by a fraction of a pesewa;
    // integers make that impossible, but the debit and the credit must still
    // be literally the same number, not two computations of it.)
    await prisma.$transaction(async (tx) => {
      await tx.driver.update({
        where: { id: driverId },
        data: { walletBalancePesewas: { increment: safeAmount } },
      });
      await tx.walletTransaction.create({
        data: {
          driverId,
          type: 'WITHDRAWAL_REVERSAL',
          amountPesewas: safeAmount,
          description: 'Withdrawal reversal — Paystack transfer failed',
          balanceBeforePesewas: driver.walletBalancePesewas - safeAmount,
          balanceAfterPesewas: driver.walletBalancePesewas,
          paystackRef: `${reference}_reversal`,
        },
      });
    });
    throw new AppError('Withdrawal failed. Your balance has been restored.', 502, 'WITHDRAWAL_FAILED');
  }

  // notifications.lowWallet was defined but never called — nudge the driver if this
  // withdrawal took them below the minimum required to go online.
  const pushService = require('../../services/push.service');
  const remaining = driver.walletBalancePesewas - safeAmount;
  const lowBalanceThreshold = env.DRIVER_REQUIRED_WALLET_TO_GO_ONLINE_PESEWAS ?? 20;
  if (remaining < lowBalanceThreshold) {
    prisma.driver.findUnique({ where: { id: driverId }, select: { fcmToken: true } })
      .then((d) => { if (d?.fcmToken) pushService.notifications.lowWallet(d.fcmToken, remaining); })
      .catch(() => {});
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

module.exports = {
  getWallet,
  topUp,
  creditTopUp,
  confirmTopUp,
  withdraw,
  getPayoutAccount,
  updatePayoutAccount,
  MAX_TOPUP_PESEWAS,
};
