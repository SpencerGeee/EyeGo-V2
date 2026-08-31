#!/usr/bin/env node
/**
 * Create (or refresh) the two app-review accounts, and the scripted driver.
 *
 *     node scripts/seed-reviewer-accounts.mjs
 *     node scripts/seed-reviewer-accounts.mjs --revoke     # after the review
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Apple reviews from Cupertino and Google from wherever their reviewer sits.
 * Neither has an EyeGo driver within thousands of miles, so a reviewer who
 * installs the rider app, requests a ride and waits is shown "no drivers
 * available" — and files, correctly, that they could not evaluate the app's
 * core functionality. It is the most common rejection for a ride-hailing
 * submission and review notes do not fix it, because a reviewer is told to test
 * the app rather than to read about it.
 *
 * A flagged rider account gets a seeded driver that accepts, drives and
 * completes, through the REAL state machine. See
 * eyego-api/src/services/reviewer-dispatch.service.js.
 *
 * ── AFTER THE REVIEW ────────────────────────────────────────────────────────
 *
 * Run with --revoke. The flag is what routes a request away from real dispatch,
 * so an account that keeps it is an account that can never take a real ride.
 * Leaving it on is not a security hole — the scripted driver is never in the
 * dispatch pool and cannot be matched to anyone — but it is a live account that
 * behaves differently from every other, which is exactly the kind of thing that
 * is forgotten and then debugged for a day.
 *
 * ── PHONE NUMBERS ───────────────────────────────────────────────────────────
 *
 * Deliberately outside any real Ghanaian range so they cannot collide with a
 * genuine signup. The reviewer signs in with the OTP flow; give them the fixed
 * code in the App Review notes (see docs/go-live/06-app-review-notes.md).
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const REVOKE = process.argv.includes('--revoke');

/** Kept in step with reviewer-dispatch.service.js. */
const REVIEWER_DRIVER_PHONE = '+233000000001';

const RIDER = { phone: '+233000000002', name: 'App Review (Rider)' };
const DRIVER_LOGIN = { phone: '+233000000003', name: 'App Review (Driver)' };

async function main() {
  if (REVOKE) {
    const { count } = await prisma.user.updateMany({
      where: { phone: { in: [RIDER.phone] } },
      data: { isReviewer: false },
    });
    console.log(`Revoked the reviewer flag on ${count} account(s).`);
    console.log('The scripted driver and the review logins are left in place —');
    console.log('delete them by hand if you want them gone entirely.');
    return;
  }

  // ── The rider the reviewer signs in as ──────────────────────────────────
  const rider = await prisma.user.upsert({
    where: { phone: RIDER.phone },
    update: { isReviewer: true, isActive: true, isBanned: false },
    create: { phone: RIDER.phone, name: RIDER.name, isReviewer: true },
    select: { id: true, phone: true },
  });

  // ── A real driver login, so the DRIVER app can also be reviewed ─────────
  //
  // Separate from the scripted driver above. A reviewer opening the driver app
  // needs to sign in, see the dashboard and go online; they are not expected to
  // receive a real dispatch offer, and the review notes say so.
  const driverLogin = await prisma.driver.upsert({
    where: { phone: DRIVER_LOGIN.phone },
    update: { status: 'ACTIVE' },
    create: { phone: DRIVER_LOGIN.phone, name: DRIVER_LOGIN.name, status: 'ACTIVE' },
    select: { id: true, phone: true },
  });

  // ── The scripted driver ────────────────────────────────────────────────
  const scripted = await prisma.driver.findUnique({
    where: { phone: REVIEWER_DRIVER_PHONE },
    select: { id: true },
  });

  console.log('App-review accounts ready.\n');
  console.log(`  Rider login      ${rider.phone}      (isReviewer = true)`);
  console.log(`  Driver login     ${driverLogin.phone}`);
  console.log(
    `  Scripted driver  ${scripted ? 'seeded (' + scripted.id + ')' : 'not yet created — it is made on the first reviewer ride'}`,
  );
  console.log('\nPut these, and the OTP, in docs/go-live/06-app-review-notes.md.');
  console.log('Run with --revoke once both apps are approved.');
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
