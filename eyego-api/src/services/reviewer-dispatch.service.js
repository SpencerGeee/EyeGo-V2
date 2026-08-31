'use strict';

const prisma = require('../config/database');
const logger = require('../utils/logger');

/**
 * ── THE APP-REVIEW DRIVER ───────────────────────────────────────────────────
 *
 * Apple reviews from Cupertino. Google reviews from wherever their reviewer
 * happens to sit. Neither has an EyeGo driver within several thousand miles, so
 * a reviewer who installs the rider app, requests a ride and waits gets
 * "no drivers available" — and files, accurately, that they were unable to
 * evaluate the app's core functionality. It is the single most common rejection
 * reason for a ride-hailing submission, and no amount of review notes fixes it,
 * because the reviewer is told to test the app, not to read about it.
 *
 * So a flagged account gets a driver. A real row in the database, assigned to
 * the real trip, driven through the REAL state machine by the same functions a
 * human driver's taps call — `acceptRide`, `startEnRoute`, `markArrived`,
 * `startTrip`, `completeTrip`. Nothing here bypasses a transition, forges a
 * socket frame or writes a status directly.
 *
 * That last point is the whole design. A demo mode that fakes its frames is a
 * second implementation of the trip lifecycle: it drifts, it hides bugs the
 * real path has, and worst of all it can pass review while the real product is
 * broken. Driving the real path means a reviewer's trip exercises dispatch,
 * transitions, notifications and the fare calculation exactly as a rider's
 * does, and if any of it is broken the demo breaks too — which is the correct
 * and useful outcome.
 *
 * ── WHAT IS FAKED, AND WHAT IS NOT ──────────────────────────────────────────
 *
 * Faked: WHO accepts (a seeded driver rather than a real one), WHERE they are
 * (a canned position near the pickup), and WHEN each step happens (a timer
 * rather than a human tapping).
 *
 * Not faked: the trip row, the transitions, the events, the socket frames, the
 * push notifications, the fare. Payment is forced down the sandbox path by the
 * payment provider seam, not by anything here.
 *
 * ── SAFETY ──────────────────────────────────────────────────────────────────
 *
 * `isReviewer` is settable only from the admin console. There is no endpoint a
 * user can call to grant it to themselves, and nothing in this file reads a
 * request header or body — the flag is read from the User row that owns the
 * trip. A reviewer account is created deliberately, for a submission, and
 * disabled after it.
 */

/** The seeded driver's stable identity. Created on demand, reused forever. */
const REVIEWER_DRIVER_PHONE = '+233000000001';
const REVIEWER_DRIVER_NAME = 'EyeGo Review Driver';
const REVIEWER_VEHICLE_PLATE = 'GR-0000-00';

/**
 * How long each leg takes. Short enough that a reviewer does not give up and
 * long enough that the screens are legible — they need to SEE the driver
 * accept, approach and arrive, not watch a trip teleport to completed.
 */
const STEP_MS = {
  accept: 3_000,
  enRoute: 4_000,
  arrived: 8_000,
  start: 6_000,
  complete: 20_000,
};

/** Is the trip's rider a flagged app-review account? */
async function isReviewerTrip(tripId) {
  // `requesterId`, not `riderId` — the User who asked for the ride. A trip
  // created by a driver has none, and cannot be a reviewer's.
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { requester: { select: { isReviewer: true } } },
  });
  return trip?.requester?.isReviewer === true;
}

async function isReviewerUser(userId) {
  if (!userId) return false;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isReviewer: true },
  });
  return user?.isReviewer === true;
}

/**
 * The seeded driver, created on first use.
 *
 * Status ACTIVE so every gate that asks treats it as a real approved driver —
 * see `Driver.status` being a free-form String whose approved value is 'ACTIVE'
 * and not 'APPROVED'. It is NOT put into the Redis supply index: it must never
 * be matched to a real rider's request, and the only way it is ever assigned is
 * the explicit `acceptRide` call below.
 */
async function ensureReviewerDriver() {
  // Driver is its OWN identity — it carries `phone` and `name` directly and has
  // no `userId`. A driver is not a User row, which is also why driver consent
  // is recorded on Driver rather than on User.
  const existing = await prisma.driver.findUnique({
    where: { phone: REVIEWER_DRIVER_PHONE },
    select: { id: true },
  });
  if (existing) return existing;

  const driver = await prisma.driver.create({
    data: {
      phone: REVIEWER_DRIVER_PHONE,
      name: REVIEWER_DRIVER_NAME,
      // 'ACTIVE' is the approved value — not 'APPROVED'. `status` is a
      // free-form String column and every gate compares against this exact
      // string, so the wrong one here is a driver that silently never works.
      status: 'ACTIVE',
      isOnline: false,
      vehicles: {
        create: {
          plateNumber: REVIEWER_VEHICLE_PLATE,
          make: 'Toyota',
          model: 'Corolla',
          year: 2022,
          seaterCount: 4,
          tier: 'ECO',
          colour: 'White',
          isVerified: true,
          isActive: true,
        },
      },
    },
    select: { id: true },
  });

  logger.info(`[reviewer] seeded app-review driver ${driver.id}`);
  return driver;
}

/** Sleep that cannot keep the process alive on shutdown. */
function wait(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof t.unref === 'function') t.unref();
  });
}

/**
 * Walk a reviewer's trip from requested to completed.
 *
 * Every step is wrapped: a transition that is no longer legal — because the
 * reviewer cancelled, or the request expired — ends the script quietly rather
 * than throwing into a background timer. A reviewer who cancels mid-trip must
 * see a cancelled trip, not a driver who carries on regardless.
 */
async function runScriptedTrip(tripId) {
  const rides = require('../modules/rides/rides.service');
  const driver = await ensureReviewerDriver();

  const step = async (label, fn) => {
    try {
      await fn();
      return true;
    } catch (err) {
      logger.info(`[reviewer] trip ${tripId} script stopped at ${label}: ${err.message}`);
      return false;
    }
  };

  logger.info(`[reviewer] scripted dispatch starting for trip ${tripId}`);

  await wait(STEP_MS.accept);
  if (!(await step('accept', () => rides.acceptRide(driver.id, tripId)))) return;

  await wait(STEP_MS.enRoute);
  if (!(await step('en-route', () => rides.startEnRoute(driver.id, tripId)))) return;

  await wait(STEP_MS.arrived);
  if (!(await step('arrived', () => rides.markArrived(driver.id, tripId)))) return;

  await wait(STEP_MS.start);
  if (!(await step('start', () => rides.startTrip(driver.id, tripId)))) return;

  await wait(STEP_MS.complete);
  if (!(await step('complete', () => rides.completeTrip(driver.id, tripId)))) return;

  logger.info(`[reviewer] scripted trip ${tripId} completed`);
}

/**
 * Start the script, detached.
 *
 * Mirrors how the real cascade is kicked off — after the response, never inside
 * it — so a reviewer's request returns as fast as anybody else's.
 */
function startScriptedDispatch(tripId) {
  setImmediate(() => {
    runScriptedTrip(tripId).catch((err) => {
      logger.error(`[reviewer] scripted dispatch failed for ${tripId}: ${err.message}`);
    });
  });
}

module.exports = {
  isReviewerTrip,
  isReviewerUser,
  ensureReviewerDriver,
  runScriptedTrip,
  startScriptedDispatch,
  REVIEWER_DRIVER_PHONE,
};
