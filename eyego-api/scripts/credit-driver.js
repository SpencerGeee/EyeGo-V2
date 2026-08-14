#!/usr/bin/env node
'use strict';

/**
 * Credit a driver's wallet as a REAL top-up.
 *
 *   node scripts/credit-driver.js +233241234567 100
 *   node scripts/credit-driver.js +233241234567 100 --note "dev account seed"
 *
 * WHY THIS EXISTS. The payment gateway is not live, so there is no way to put
 * money into a wallet through the product. A dev driver therefore starts at
 * zero, cannot clear a negative balance, and cannot pass the
 * `DRIVER_REQUIRED_WALLET_TO_GO_ONLINE` gate — which makes half the driver app
 * untestable for a reason that has nothing to do with the driver app.
 *
 * WHAT IT IS NOT. It is not a direct balance write. It goes through
 * `wallet.service.creditTopUp`, the same function the Paystack webhook calls,
 * so the ledger row is indistinguishable in SHAPE from a real one: a TOP_UP
 * with `balanceBefore + amount === balanceAfter`, written in the same
 * transaction as the balance update. That matters because every earnings
 * report, chart bucket and reconciliation in the app reads the ledger, not the
 * balance column — a hand-written balance would show the money and then have
 * every screen disagree about where it came from.
 *
 * It IS distinguishable in ORIGIN: the reference is prefixed `sim_topup_` and
 * the description says so, so `SELECT … WHERE paystackRef LIKE 'sim_%'` finds
 * every cedi that was never actually collected.
 *
 * Refuses to run against a production database unless --force is passed, since
 * this invents money.
 */

const prisma = require('../src/config/database');
const wallet = require('../src/modules/wallet/wallet.service');
const { formatGhs, fromCedis } = require('../src/utils/money');
const { v4: uuidv4 } = require('uuid');

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--force') flags.force = true;
    else if (a === '--note') flags.note = argv[++i];
    else positional.push(a);
  }
  return { positional, flags };
}

/**
 * Phones are stored however they were registered. Matching on the last nine
 * digits finds the driver whether the row says `+233241234567`, `0241234567`
 * or `233241234567` — the three shapes this database actually contains.
 */
function phoneTail(raw) {
  const digits = String(raw).replace(/\D/g, '');
  return digits.slice(-9);
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [phoneArg, amountArg] = positional;

  if (!phoneArg || !amountArg) {
    console.error('Usage: node scripts/credit-driver.js <phone> <amountInCedis> [--note "..."] [--force]');
    console.error('   eg: node scripts/credit-driver.js +233241234567 100');
    process.exit(1);
  }

  const cedis = Number(amountArg);
  if (!Number.isFinite(cedis) || cedis <= 0) {
    console.error(`Amount must be a positive number of cedis; got "${amountArg}".`);
    process.exit(1);
  }
  const amountPesewas = fromCedis(cedis);

  const dbUrl = process.env.DATABASE_URL ?? '';
  const looksProduction =
    process.env.NODE_ENV === 'production' || /prod|production/i.test(dbUrl);
  if (looksProduction && !flags.force) {
    console.error(
      'This looks like a PRODUCTION database and this script invents money.\n' +
        'Re-run with --force if you genuinely mean to credit a live wallet.',
    );
    process.exit(1);
  }

  const tail = phoneTail(phoneArg);
  if (tail.length < 9) {
    console.error(`"${phoneArg}" does not look like a Ghanaian phone number.`);
    process.exit(1);
  }

  const candidates = await prisma.driver.findMany({
    where: { phone: { endsWith: tail } },
    select: { id: true, name: true, phone: true, status: true, walletBalancePesewas: true },
  });

  if (candidates.length === 0) {
    console.error(`No driver found whose phone ends with ${tail}.`);
    process.exit(1);
  }
  if (candidates.length > 1) {
    console.error(`${candidates.length} drivers match ${tail} — refusing to guess:`);
    for (const d of candidates) console.error(`  ${d.id}  ${d.phone}  ${d.name}`);
    process.exit(1);
  }

  const driver = candidates[0];
  const reference = `sim_topup_${uuidv4().replace(/-/g, '').slice(0, 16)}`;

  console.log(`Driver:  ${driver.name} (${driver.phone})`);
  console.log(`Status:  ${driver.status}`);
  console.log(`Before:  ${formatGhs(driver.walletBalancePesewas)}`);

  const tx = await wallet.creditTopUp(driver.id, reference, amountPesewas, {
    description: flags.note
      ? `Wallet top-up (simulated — ${flags.note})`
      : 'Wallet top-up (simulated — no payment gateway configured)',
  });

  console.log(`Credited: ${formatGhs(amountPesewas)}`);
  console.log(`After:    ${formatGhs(tx.balanceAfterPesewas)}`);
  console.log(`Ref:      ${reference}`);
}

main()
  .catch((err) => {
    console.error(err?.message ?? err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
