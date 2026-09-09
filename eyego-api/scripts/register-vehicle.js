#!/usr/bin/env node
'use strict';

/**
 * Register a vehicle for an existing driver, for a test phone.
 *
 *   node scripts/register-vehicle.js +233500242059 \
 *     --make Toyota --model Hiace --year 2021 --seats 14 --tier ECO --colour White
 *
 *   node scripts/register-vehicle.js +233500242059 --seats 4 --tier ECO --no-verify
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * A driver can sign up, be approved and go online without ever finishing the
 * vehicle step, because the two are separate screens and only the first one is
 * enforced. That account then looks completely healthy — ACTIVE, online, in the
 * supply index — and fails at the last possible moment: `acceptDispatch` throws
 * `NO_VEHICLE`, "No active vehicle registered. Add a vehicle before accepting
 * trips." Handing a tester a phone in that state costs an afternoon.
 *
 * Doing it by hand through the driver app means re-running onboarding on the
 * device, which is exactly what you are trying to skip when you are seeding a
 * test handset.
 *
 * ── WHAT IT IS NOT ──────────────────────────────────────────────────────────
 *
 * It is not an INSERT. It calls `drivers.service.completeVerification`, the
 * same function the onboarding screen posts to, so the row it writes is
 * indistinguishable from one a real driver created: the same validation (tier,
 * seat bounds, year range), the same plate-collision check, and the same
 * retire-the-old-car-on-a-new-plate transaction. A hand-written row skips all
 * of that and is the reason "it works for the seeded driver" stops meaning
 * anything.
 *
 * ── --verify ────────────────────────────────────────────────────────────────
 *
 * On by default here, off in the product. `completeVerification` deliberately
 * leaves `isVerified` false so an operator approves the specific car, and
 * `matcher.service.js` only tier-matches on `{ isActive: true, isVerified:
 * true }`. An unverified test car is therefore not broken, but it is invisible
 * to the tier filter and only ever reaches a phone through the any-car
 * fallback — which is not the code path you think you are testing. Pass
 * `--no-verify` when the admin approval queue is what you are testing.
 *
 * Refuses to run against a production database unless --force is passed, since
 * it approves a vehicle nobody inspected.
 */

const prisma = require('../src/config/database');
const driversService = require('../src/modules/drivers/drivers.service');

const DEFAULTS = {
  make: 'Toyota',
  model: 'Hiace',
  year: 2021,
  seats: 14,
  tier: 'ECO',
  colour: 'White',
};

function parseArgs(argv) {
  const positional = [];
  const flags = { verify: true };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--force') flags.force = true;
    else if (a === '--no-verify') flags.verify = false;
    else if (a === '--make') flags.make = argv[++i];
    else if (a === '--model') flags.model = argv[++i];
    else if (a === '--year') flags.year = argv[++i];
    else if (a === '--seats') flags.seats = argv[++i];
    else if (a === '--tier') flags.tier = argv[++i];
    else if (a === '--colour' || a === '--color') flags.colour = argv[++i];
    else if (a === '--plate') flags.plate = argv[++i];
    else positional.push(a);
  }
  return { positional, flags };
}

/**
 * Phones are stored however they were registered — the driver app sends
 * `+233` + the nine digits typed, but this database also holds rows written by
 * seeds and by earlier builds. Matching on the last nine digits finds the
 * driver in every shape.
 */
function phoneTail(raw) {
  return String(raw).replace(/\D/g, '').slice(-9);
}

/**
 * A Ghanaian plate in the shape the fleet already uses: GT-1234-26. Random
 * rather than sequential because two testers seeding two handsets at the same
 * time must not collide, and `Vehicle.plateNumber` is globally unique.
 */
async function freePlate() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const serial = String(Math.floor(1000 + Math.random() * 9000));
    const year = String(new Date().getFullYear()).slice(-2);
    const plate = `GT-${serial}-${year}`;
    const taken = await prisma.vehicle.findUnique({ where: { plateNumber: plate }, select: { id: true } });
    if (!taken) return plate;
  }
  throw new Error('Could not find a free plate number after 20 tries — pass --plate explicitly.');
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [phoneArg] = positional;

  if (!phoneArg) {
    console.error('Usage: node scripts/register-vehicle.js <phone> [--make X] [--model Y] [--year N]');
    console.error('                                        [--seats N] [--tier ECO|COMFORT|PREMIUM]');
    console.error('                                        [--colour C] [--plate GT-1234-26] [--no-verify] [--force]');
    console.error('   eg: node scripts/register-vehicle.js +233500242059 --seats 14 --model Hiace');
    process.exit(1);
  }

  const dbUrl = process.env.DATABASE_URL ?? '';
  const looksProduction = process.env.NODE_ENV === 'production' || /prod|production/i.test(dbUrl);
  if (looksProduction && !flags.force) {
    console.error(
      'This looks like a PRODUCTION database, and this script registers a car\n' +
        'and marks it verified without anyone inspecting it.\n' +
        'Re-run with --force if you genuinely mean to.',
    );
    process.exit(1);
  }

  const tail = phoneTail(phoneArg);
  if (tail.length < 9) {
    console.error(`"${phoneArg}" does not look like a Ghanaian phone number.`);
    process.exit(1);
  }

  const matches = await prisma.driver.findMany({
    where: { phone: { endsWith: tail } },
    select: { id: true, phone: true, name: true, status: true },
  });

  if (matches.length === 0) {
    console.error(`No driver found for ${phoneArg}.`);
    console.error('The account is created on first OTP sign-in — have the phone sign in once, then re-run.');
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error(`${matches.length} drivers match ${phoneArg}: ${matches.map((d) => d.phone).join(', ')}.`);
    console.error('Pass the full stored number so there is no doubt which one you mean.');
    process.exit(1);
  }

  const driver = matches[0];
  const plate = flags.plate ? String(flags.plate).trim().toUpperCase() : await freePlate();

  const vehicle = {
    plateNumber: plate,
    make: flags.make ?? DEFAULTS.make,
    model: flags.model ?? DEFAULTS.model,
    year: Number(flags.year ?? DEFAULTS.year),
    seaterCount: Number(flags.seats ?? DEFAULTS.seats),
    tier: String(flags.tier ?? DEFAULTS.tier).toUpperCase(),
    colour: flags.colour ?? DEFAULTS.colour,
  };

  // The real endpoint. It validates, collision-checks the plate and retires any
  // car this driver had registered under a different one.
  await driversService.completeVerification(driver.id, { vehicle });

  if (flags.verify) {
    await prisma.vehicle.update({
      where: { plateNumber: vehicle.plateNumber },
      data: { isVerified: true },
    });
  }

  const saved = await prisma.vehicle.findUnique({
    where: { plateNumber: vehicle.plateNumber },
    select: {
      id: true, plateNumber: true, make: true, model: true, year: true,
      colour: true, tier: true, seaterCount: true, isActive: true, isVerified: true,
    },
  });

  console.log(`Vehicle registered for ${driver.name || '(no name)'} — ${driver.phone} (${driver.status}).\n`);
  console.log(`  ${saved.plateNumber}   ${saved.colour} ${saved.make} ${saved.model} ${saved.year}`);
  console.log(`  ${saved.tier}, ${saved.seaterCount} seats`);
  console.log(`  active: ${saved.isActive}   verified: ${saved.isVerified}`);
  if (!saved.isVerified) {
    console.log('\n  Unverified: matcher.service only tier-matches verified cars, so this');
    console.log('  driver reaches riders through the any-car fallback until an admin approves it.');
  }
  if (driver.status !== 'ACTIVE') {
    console.log(`\n  Heads up: status is ${driver.status}, not ACTIVE — goOnline() will refuse until it is.`);
  }
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
    // Requiring drivers.service pulls in the whole app: Redis holds an open
    // socket and the Firebase SDK its own timers, neither of which a one-shot
    // script has any way to close. Without this the work finishes, the summary
    // prints, and the process sits there forever looking like it hung.
    process.exit(process.exitCode ?? 0);
  });
