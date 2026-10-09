'use strict';

const prisma = require('../config/database');

/**
 * DRIVER PAYOUTS, AS OPS SEES THEM.
 *
 * A withdrawal is one WITHDRAWAL ledger row written when the driver asks; its
 * outcome lands on that row or beside it later:
 *   - `transfer.success` rewrites the description to "Withdrawal completed";
 *   - a failed / reversed transfer writes a WITHDRAWAL_REVERSAL row with
 *     reference `${ref}_reversal` and puts the money back in the wallet;
 *   - neither yet → still processing at the provider.
 *
 * There was no console view of any of this, so a driver ringing in about a
 * MoMo payout that "never came" could not be answered without a database.
 * State is DERIVED here from those rows — never stored twice.
 */

const STALE_HOURS = 24;

function stateOf(row, reversed) {
  if (reversed) return 'FAILED';
  if (/completed/i.test(row.description ?? '')) return 'PAID';
  return 'PROCESSING';
}

async function listPayouts({ status, page = 1, limit = 25 } = {}) {
  const p = Math.max(1, Number(page) || 1);
  const l = Math.min(100, Math.max(10, Number(limit) || 25));

  // Pull a generous window and filter by derived state in memory: state is not
  // a column, and payout volume is small next to trips.
  // ponytail: in-memory state filter over the newest 1000; add a status column if volume outgrows it.
  const rows = await prisma.walletTransaction.findMany({
    where: { type: 'WITHDRAWAL' },
    orderBy: { createdAt: 'desc' },
    take: 1000,
    include: { driver: { select: { id: true, name: true, phone: true, walletBalancePesewas: true } } },
  });
  const refs = rows.map((r) => r.paystackRef).filter(Boolean);
  const reversals = refs.length
    ? await prisma.walletTransaction.findMany({
        where: { type: 'WITHDRAWAL_REVERSAL', paystackRef: { in: refs.map((r) => `${r}_reversal`) } },
        select: { paystackRef: true, description: true, createdAt: true },
      })
    : [];
  const reversalByRef = new Map(reversals.map((r) => [r.paystackRef.replace(/_reversal$/, ''), r]));

  const now = Date.now();
  const all = rows.map((r) => {
    const rev = r.paystackRef ? reversalByRef.get(r.paystackRef) : null;
    const state = stateOf(r, rev);
    const ageHours = Math.round(((now - r.createdAt.getTime()) / 3_600_000) * 10) / 10;
    return {
      id: r.id,
      reference: r.paystackRef,
      amountPesewas: r.amountPesewas,
      state,
      stale: state === 'PROCESSING' && ageHours >= STALE_HOURS,
      ageHours,
      createdAt: r.createdAt,
      failureNote: rev?.description ?? null,
      driver: r.driver,
    };
  });

  const filtered = status ? all.filter((x) => x.state === status || (status === 'STALE' && x.stale)) : all;
  const sum = (xs) => xs.reduce((n, x) => n + x.amountPesewas, 0);
  return {
    payouts: filtered.slice((p - 1) * l, p * l),
    total: filtered.length,
    page: p,
    totalPages: Math.max(1, Math.ceil(filtered.length / l)),
    summary: {
      paidPesewas: sum(all.filter((x) => x.state === 'PAID')),
      processingPesewas: sum(all.filter((x) => x.state === 'PROCESSING')),
      processingCount: all.filter((x) => x.state === 'PROCESSING').length,
      staleCount: all.filter((x) => x.stale).length,
      failedCount: all.filter((x) => x.state === 'FAILED').length,
    },
  };
}

module.exports = { listPayouts, stateOf, STALE_HOURS };

if (require.main === module) {
  // Self-check of the one piece of logic here: the derived state.
  const assert = require('node:assert');
  assert.strictEqual(stateOf({ description: 'Withdrawal completed' }, null), 'PAID');
  assert.strictEqual(stateOf({ description: 'Withdrawal to MoMo' }, null), 'PROCESSING');
  assert.strictEqual(stateOf({ description: 'Withdrawal completed' }, { description: 'x' }), 'FAILED');
  console.log('payouts.service self-check ok');
  process.exit(0);
}
