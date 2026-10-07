'use strict';

const { v4: uuidv4 } = require('uuid');
const prisma = require('../../config/database');
const env = require('../../config/env');
const paystack = require('../payments/provider');
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
  const safeAmount = assertPesewas(amountPesewas, 'top-up amount', { client: true });
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
  const safeAmount = assertPesewas(amountPesewas, 'top-up amount', { client: true });
  return creditTopUp(driverId, reference, safeAmount);
}

async function withdraw(driverId, amountPesewas) {
  const safeAmount = assertPesewas(amountPesewas, 'withdrawal amount', { client: true });
  /**
   * THE LIVE VALUE, NOT THE ONE BOOT HAPPENED TO SEE.
   *
   * `DRIVER_MIN_WITHDRAWAL_PESEWAS` is a console-editable PlatformSetting, and
   * `publicConfig()` ships the CURRENT value to the driver app as the floor it
   * displays. Reading `env` here read the snapshot taken from .env at process
   * start instead, so lowering the minimum in the console changed the number
   * the app promised while this endpoint went on refusing against the old one —
   * the driver is rejected for an amount the app just told them was allowed.
   */
  const minWithdrawal =
    require('../../config/settings').get('DRIVER_MIN_WITHDRAWAL_PESEWAS')
    ?? env.DRIVER_MIN_WITHDRAWAL_PESEWAS;
  if (safeAmount < minWithdrawal) {
    // Formatted, not raw: the threshold is 2000 pesewas and a driver told
    // "Minimum withdrawal is GHS 2000" would reasonably close the app.
    throw new AppError(
      `Minimum withdrawal is ${formatGhs(minWithdrawal)}`,
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
    const current = await tx.driver.findUnique({
      where: { id: driverId },
      select: { walletBalancePesewas: true, name: true, phone: true, payoutHold: true, payoutHoldReason: true },
    });
    if (!current) throw new NotFoundError('Driver');

    /**
     * An operator's hold, checked INSIDE the transaction alongside the balance.
     *
     * Outside it, a hold applied between the read and the debit would be
     * ignored by a withdrawal already in flight — which is precisely the moment
     * a hold is most likely to be applied.
     *
     * Separate from suspending the account on purpose: suspension stops a
     * driver earning, while this lets them keep working and keep accruing while
     * the money in question is investigated. The reason is surfaced so they are
     * not left guessing.
     */
    if (current.payoutHold) {
      throw new AppError(
        current.payoutHoldReason
          ? `Withdrawals are paused on your account: ${current.payoutHoldReason}. Contact support.`
          : 'Withdrawals are paused on your account while we review it. Contact support.',
        403,
        'PAYOUT_ON_HOLD',
      );
    }

    const updated = await tx.driver.updateMany({
      where: { id: driverId, walletBalancePesewas: { gte: safeAmount } },
      data: { walletBalancePesewas: { decrement: safeAmount } },
    });

    if (updated.count === 0) {
      throw new AppError('Insufficient wallet balance', 402, 'INSUFFICIENT_WALLET');
    }

    // The balance AFTER our debit, read under the row lock our update holds.
    // `current` was read before it: two concurrent withdrawals both logged the
    // same "before" and the ledger stopped adding up.
    const { walletBalancePesewas: after } = await tx.driver.findUnique({
      where: { id: driverId },
      select: { walletBalancePesewas: true },
    });
    await tx.walletTransaction.create({
      data: {
        driverId,
        type: 'WITHDRAWAL',
        amountPesewas: safeAmount,
        description: 'Withdrawal to MoMo',
        balanceBeforePesewas: after + safeAmount,
        balanceAfterPesewas: after,
        paystackRef: reference,
      },
    });

    return { ...current, walletBalancePesewas: after + safeAmount };
  });

  // Step 2: Initiate Paystack transfer OUTSIDE transaction.
  // Recipient set-up failing means no transfer can exist — reverse at once.
  let recipientCode;
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
    recipientCode = (await paystack.createTransferRecipient(recipientParams)).data.recipient_code;
  } catch {
    await reverseWithdrawal(reference, 'Withdrawal reversal — payout account could not be set up');
    throw new AppError('Withdrawal failed. Your balance has been restored.', 502, 'WITHDRAWAL_FAILED');
  }

  try {
    await paystack.initiateTransfer({
      amountPesewas: safeAmount,
      recipient: recipientCode,
      reason: 'EyeGo Driver earnings withdrawal',
      reference,
    });
  } catch (paystackErr) {
    /**
     * A REFUSAL IS NOT THE SAME AS NO ANSWER.
     *
     * This used to restore the balance on ANY error — including a timeout on a
     * transfer Paystack had in fact accepted, which paid the driver AND gave the
     * money back. Only a definite refusal (the gateway answered 4xx) reverses
     * here. Anything else is asked again by reference; if Paystack never saw
     * it, reverse; if it did, the transfer webhook settles it either way.
     */
    const refused = paystackErr?.statusCode === 402;
    let neverArrived = false;
    let failed = false;
    if (!refused) {
      try {
        const v = await paystack.verifyTransfer(reference);
        failed = ['failed', 'reversed', 'abandoned'].includes(String(v?.data?.status ?? '').toLowerCase());
      } catch (verifyErr) {
        neverArrived = verifyErr?.cause?.response?.status === 404;
      }
    }
    if (refused || neverArrived || failed) {
      await reverseWithdrawal(reference, 'Withdrawal reversal — Paystack transfer failed');
      throw new AppError('Withdrawal failed. Your balance has been restored.', 502, 'WITHDRAWAL_FAILED');
    }
    await prisma.walletTransaction.updateMany({
      where: { paystackRef: reference, type: 'WITHDRAWAL' },
      data: { description: 'Withdrawal processing — awaiting confirmation' },
    });
    return {
      message: 'Withdrawal is processing. If it does not arrive, the amount returns to your wallet automatically.',
      reference,
      pending: true,
    };
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

/**
 * Give a withdrawal back — ONCE, whoever asks first: the failed synchronous
 * call above, or Paystack's `transfer.failed` / `transfer.reversed` webhook
 * (MoMo payouts often fail after being accepted; those were never returned).
 * The reversal row's reference is the idempotency key.
 */
async function reverseWithdrawal(reference, description = 'Withdrawal reversal — transfer failed') {
  return prisma.$transaction(async (tx) => {
    const original = await tx.walletTransaction.findFirst({
      where: { paystackRef: reference, type: 'WITHDRAWAL' },
      select: { driverId: true, amountPesewas: true },
    });
    if (!original) return null;
    const done = await tx.walletTransaction.findFirst({
      where: { paystackRef: `${reference}_reversal`, type: 'WITHDRAWAL_REVERSAL' },
      select: { id: true },
    });
    if (done) return null;
    const { walletBalancePesewas: after } = await tx.driver.update({
      where: { id: original.driverId },
      data: { walletBalancePesewas: { increment: original.amountPesewas } },
      select: { walletBalancePesewas: true },
    });
    return tx.walletTransaction.create({
      data: {
        driverId: original.driverId,
        type: 'WITHDRAWAL_REVERSAL',
        amountPesewas: original.amountPesewas,
        description,
        balanceBeforePesewas: after - original.amountPesewas,
        balanceAfterPesewas: after,
        paystackRef: `${reference}_reversal`,
      },
    });
  });
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

  /**
   * Validated here because nothing else checks it before money moves: an empty
   * account number or an unknown network saved "successfully" and the driver
   * found out at cash-out time, as "Withdrawal failed".
   */
  const clean = (v) => String(v ?? '').trim();
  let payout;
  if (data.type === 'momo') {
    const phone = clean(data.phone).replace(/\D/g, '').replace(/^233/, '0');
    const n = clean(data.network);
    const network = /mtn/i.test(n) ? 'MOMO_MTN' : /voda|telecel/i.test(n) ? 'MOMO_TELECEL' : /airtel|tigo/i.test(n) ? 'MOMO_AIRTELTIGO' : null;
    if (!network) throw new AppError('Choose your mobile money network', 400, 'VALIDATION_ERROR');
    if (!/^0[235]\d{8}$/.test(phone)) throw new AppError('Enter the 10-digit mobile money number, e.g. 024 123 4567', 400, 'VALIDATION_ERROR');
    payout = { type: 'momo', network, phone, ...(clean(data.accountName) ? { accountName: clean(data.accountName) } : {}) };
  } else {
    const accountNumber = clean(data.accountNumber).replace(/\s/g, '');
    if (!clean(data.bankName)) throw new AppError('Choose your bank', 400, 'VALIDATION_ERROR');
    if (!/^\d{6,20}$/.test(accountNumber)) throw new AppError('Enter a valid account number (digits only)', 400, 'VALIDATION_ERROR');
    if (clean(data.accountName).length < 3) throw new AppError('Enter the name on the account', 400, 'VALIDATION_ERROR');
    payout = { type: 'bank', bankName: clean(data.bankName), accountNumber, accountName: clean(data.accountName) };
  }

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
  reverseWithdrawal,
  getPayoutAccount,
  updatePayoutAccount,
  MAX_TOPUP_PESEWAS,
};
