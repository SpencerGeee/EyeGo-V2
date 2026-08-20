'use strict';

const prisma = require('../config/database');
const { AppError, NotFoundError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * The rider wallet ledger.
 *
 * WHY THIS EXISTS. The driver side has had a ledger since the beginning; the
 * rider side had a bare `User.walletBalancePesewas` that code incremented and
 * decremented at will. Nothing recorded who moved it, when, or why — so a rider
 * disputing their balance could not be answered from the data, and an admin
 * crediting a goodwill refund left no trace of having done so.
 *
 * THE INVARIANT, which every function here upholds:
 *
 *     balanceAfterPesewas === balanceBeforePesewas + amountPesewas
 *
 * Debits are negative. **Never write `walletBalancePesewas` without writing a
 * row through this module** — a balance without a ledger line is exactly the
 * hole this was built to close.
 *
 * CONCURRENCY. Credits are unconditional. Debits use a conditional
 * `updateMany` guarded on the balance still being sufficient, so two
 * simultaneous debits cannot overdraw: the loser matches zero rows and raises,
 * rather than both reading the same balance and both writing.
 */

/** Every movement type the rider ledger recognises. */
const TYPES = {
  TOPUP: 'TOPUP',
  REFUND: 'REFUND',
  RIDE_PAYMENT: 'RIDE_PAYMENT',
  SEND: 'SEND',
  RECEIVE: 'RECEIVE',
  ADMIN_CREDIT: 'ADMIN_CREDIT',
  ADMIN_DEBIT: 'ADMIN_DEBIT',
};

/**
 * Move a rider's balance and record why, atomically.
 *
 * @param {object}  opts
 * @param {string}  opts.userId
 * @param {string}  opts.type          one of TYPES
 * @param {number}  opts.amountPesewas signed; negative debits
 * @param {string}  opts.description   shown to finance and to the rider
 * @param {object=} opts.tx            join an existing transaction if given
 */
async function record({
  userId,
  type,
  amountPesewas,
  description,
  bookingId = null,
  refundId = null,
  paystackRef = null,
  adminId = null,
  tx = null,
}) {
  if (!userId) throw new ValidationError('userId is required');
  if (!Object.values(TYPES).includes(type)) {
    throw new ValidationError(`Unknown wallet transaction type "${type}"`);
  }
  if (!Number.isInteger(amountPesewas) || amountPesewas === 0) {
    throw new ValidationError('amountPesewas must be a non-zero whole number of pesewas');
  }
  if (!description || !String(description).trim()) {
    throw new ValidationError('description is required — an unexplained balance move is unauditable');
  }

  const run = async (db) => {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, walletBalancePesewas: true },
    });
    if (!user) throw new NotFoundError('User');

    const before = user.walletBalancePesewas;
    const after = before + amountPesewas;

    if (amountPesewas < 0) {
      if (after < 0) {
        throw new AppError(
          `Insufficient wallet balance: holds ${before} pesewas, tried to take ${Math.abs(amountPesewas)}`,
          400,
          'INSUFFICIENT_BALANCE',
        );
      }
      // Conditional debit — see the concurrency note above.
      const moved = await db.user.updateMany({
        where: { id: userId, walletBalancePesewas: { gte: Math.abs(amountPesewas) } },
        data: { walletBalancePesewas: { decrement: Math.abs(amountPesewas) } },
      });
      if (moved.count === 0) {
        throw new AppError('Wallet balance changed during the debit', 409, 'BALANCE_CONFLICT');
      }
    } else {
      await db.user.update({
        where: { id: userId },
        data: { walletBalancePesewas: { increment: amountPesewas } },
      });
    }

    return db.riderWalletTransaction.create({
      data: {
        userId,
        type,
        amountPesewas,
        description: String(description).trim(),
        balanceBeforePesewas: before,
        balanceAfterPesewas: after,
        bookingId,
        refundId,
        paystackRef,
        adminId,
      },
    });
  };

  // `$transaction` when we own the boundary; otherwise join the caller's, so a
  // refund's ledger row and its booking update cannot half-commit.
  const row = tx ? await run(tx) : await prisma.$transaction((t) => run(t));

  logger.info('[wallet:rider] movement recorded', {
    userId, type, amountPesewas, bookingId, adminId,
  });
  return row;
}

/** Paged ledger for one rider. */
async function history(userId, { page = 1, limit = 25 } = {}) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(Math.max(1, parseInt(limit, 10) || 25), 100);
  const [rows, total, user] = await Promise.all([
    prisma.riderWalletTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: (p - 1) * l,
      take: l,
      include: { admin: { select: { id: true, name: true, email: true } } },
    }),
    prisma.riderWalletTransaction.count({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { walletBalancePesewas: true } }),
  ]);
  return {
    transactions: rows,
    total,
    page: p,
    totalPages: Math.ceil(total / l),
    balancePesewas: user?.walletBalancePesewas ?? 0,
  };
}

/**
 * Does the ledger still add up?
 *
 * Sums every movement and compares it to the stored balance. A mismatch means
 * something wrote the column directly, bypassing this module — which is the one
 * failure mode a ledger cannot detect on its own. Surfaced on the rider's admin
 * page so it is noticed by whoever is already looking at the account.
 */
async function reconcile(userId) {
  const [agg, user] = await Promise.all([
    prisma.riderWalletTransaction.aggregate({ where: { userId }, _sum: { amountPesewas: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { walletBalancePesewas: true } }),
  ]);
  const ledgerSum = agg._sum.amountPesewas ?? 0;
  const stored = user?.walletBalancePesewas ?? 0;
  return { ledgerSumPesewas: ledgerSum, storedBalancePesewas: stored, driftPesewas: stored - ledgerSum, balanced: stored === ledgerSum };
}

module.exports = { TYPES, record, history, reconcile };
