/**
 * ── THE SCHEDULED RIDE, WITHOUT WAITING FOR IT ──────────────────────────────
 *
 * "I always get to create the scheduled trip on the rider app but never get the
 * time to wait out and see how it behaves when the time gets close."
 *
 * Nobody can test this by hand. A scheduled ride does nothing at all until it
 * is within fifteen minutes of its pickup, and the interesting transitions are
 * an hour apart — so the one part of the product that runs unattended is the
 * part that has never been watched.
 *
 * It does not need waiting. `processScheduledRideIntents` is a pure function of
 * each intent's `scheduledAt` RELATIVE TO NOW, so moving the intent is the same
 * as moving the clock. This seeds intents at chosen offsets, runs the worker
 * directly, and asserts what it did — the whole lifecycle in about a second.
 *
 * Direct invocation rather than HTTP, for two reasons: the worker has no
 * endpoint (it runs on a server interval), and the server skips it entirely
 * under NODE_ENV=test. Same shape as h3-index.mjs.
 *
 *   node scripts/e2e/scheduled-rides.mjs
 *
 * Needs the database (docker compose postgres). Cleans up everything it makes.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { section, pass, fail, summary, info } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_ROOT = join(HERE, '..', '..', 'eyego-api');
const require = createRequire(join(API_ROOT, 'package.json'));

// The service reads env at require-time; load the API's .env the way it does.
require('dotenv').config({ path: join(API_ROOT, '.env') });

const prisma = require(join(API_ROOT, 'src/config/database'));
const tripsService = require(join(API_ROOT, 'src/modules/trips/trips.service'));

const MIN = 60 * 1000;
const TAG = `e2e-sched-${Date.now()}`;

const at = (offsetMs) => new Date(Date.now() + offsetMs);

async function seedUser() {
  return prisma.user.create({
    data: {
      phone: `+233900${String(Date.now()).slice(-6)}`,
      name: `${TAG}-rider`,
    },
  });
}

async function seedRoute() {
  return prisma.route.create({
    data: {
      name: `${TAG}-route`,
      originName: `${TAG}-origin`,
      destinationName: `${TAG}-dest`,
      originLat: 5.6037,
      originLng: -0.187,
      destLat: 5.65,
      destLng: -0.21,
      distanceKm: 8,
      isAdHoc: true,
    },
  });
}

const intentFor = (userId, routeId, whenMs) =>
  prisma.scheduledRideIntent.create({
    data: { userId, routeId, scheduledAt: at(whenMs), seatCount: 1, status: 'PENDING' },
  });

const statusOf = async (id) =>
  (await prisma.scheduledRideIntent.findUnique({ where: { id }, select: { status: true } }))?.status;

async function main() {
  section('scheduled rides — the whole lifecycle, no waiting');

  let user, route;
  const madeIntents = [];

  try {
    user = await seedUser();
    route = await seedRoute();
  } catch (e) {
    fail('seed a rider and a route', `could not reach the database: ${e.message}`);
    process.exit(summary());
  }

  try {
    /**
     * A ride booked for later must sit still.
     *
     * The worker's horizon is fifteen minutes. An intent an hour out is not its
     * business, and touching it early would dispatch a driver to a pickup
     * nobody is standing at yet.
     */
    const far = await intentFor(user.id, route.id, 60 * MIN);
    madeIntents.push(far.id);

    /**
     * Inside the horizon with no trip to join → handed to LIVE DISPATCH.
     *
     * `DISPATCHED` and `EXPIRED` mean opposite things and this worker used to
     * conflate them: every just-scheduled ride that did not immediately match
     * an existing trip — the common case — was marked EXPIRED, so the rider's
     * list showed nothing but expired rows for rides that were actively being
     * dispatched. That is the regression this check exists to hold shut.
     */
    const due = await intentFor(user.id, route.id, 5 * MIN);
    madeIntents.push(due.id);

    /**
     * Ninety minutes past its pickup with nobody matched → EXPIRED.
     *
     * The give-up threshold is an hour. Without it a stale intent is retried on
     * every tick forever, and a rider's list fills with rides that will never
     * happen.
     */
    const stale = await intentFor(user.id, route.id, -90 * MIN);
    madeIntents.push(stale.id);

    await tripsService.processScheduledRideIntents();

    await check('a ride booked an hour out is left alone', async () => {
      const s = await statusOf(far.id);
      if (s !== 'PENDING') {
        throw new Error(
          `an intent 60 min out became ${s}. The worker's horizon is 15 min; acting earlier ` +
            'sends a driver to a pickup nobody is standing at yet.',
        );
      }
      return 'still PENDING';
    });

    await check('a due ride with no trip to join is DISPATCHED, not EXPIRED', async () => {
      const s = await statusOf(due.id);
      if (s === 'EXPIRED') {
        throw new Error(
          'it was marked EXPIRED. DISPATCHED and EXPIRED are opposites: this ride is actively ' +
            "being offered to drivers, and calling it expired is what made the rider's " +
            'scheduled-rides list show nothing but dead rows.',
        );
      }
      if (s !== 'DISPATCHED') throw new Error(`expected DISPATCHED, got ${s}`);
      return 'handed to live dispatch';
    });

    await check('a ride 90 minutes stale is given up on', async () => {
      const s = await statusOf(stale.id);
      if (s !== 'EXPIRED') {
        throw new Error(
          `expected EXPIRED, got ${s}. Without the give-up threshold a stale intent is retried ` +
            'on every tick forever.',
        );
      }
      return 'EXPIRED';
    });

    /**
     * The worker must be idempotent.
     *
     * It runs on an interval, so every intent is seen repeatedly. A second pass
     * must not re-dispatch what it already handed off — that is how one rider
     * gets two drivers sent to them.
     */
    await check('a second sweep does not re-dispatch what it already handed off', async () => {
      const before = await statusOf(due.id);
      await tripsService.processScheduledRideIntents();
      const after = await statusOf(due.id);
      if (before !== after) {
        throw new Error(
          `status moved ${before} → ${after} on a second sweep with nothing else changed. ` +
            'The worker runs every tick; a non-idempotent pass double-dispatches.',
        );
      }
      return `stable at ${after}`;
    });
  } catch (e) {
    fail('drive the scheduled-ride worker', e.message);
  } finally {
    /**
     * Leave the database as we found it, whatever happened above.
     *
     * Order matters: the DUE intent really does hand off to live dispatch, so
     * this run creates a Trip and a TripRequest as a side effect — that is the
     * behaviour under test, not an accident. They reference the route and the
     * rider, so they have to go first or the deletes below fail on a foreign
     * key and the fixtures accumulate run after run.
     */
    try {
      if (madeIntents.length) {
        await prisma.scheduledRideIntent.deleteMany({ where: { id: { in: madeIntents } } });
      }
      if (user) {
        await prisma.tripRequest.deleteMany({ where: { userId: user.id } }).catch(() => {});
        await prisma.booking.deleteMany({ where: { userId: user.id } }).catch(() => {});
      }
      if (route) {
        await prisma.trip.deleteMany({ where: { routeId: route.id } }).catch(() => {});
        await prisma.route.deleteMany({ where: { id: route.id } });
      }
      if (user) await prisma.user.deleteMany({ where: { id: user.id } });
    } catch (e) {
      info(`cleanup left rows behind: ${e.message}`);
    }
    await prisma.$disconnect().catch(() => {});
  }

  process.exit(summary());
}

/** Local async check — lib's `check` is the async one; re-exported for clarity. */
async function check(what, fn) {
  try {
    const detail = await fn();
    pass(what, typeof detail === 'string' ? detail : '');
  } catch (e) {
    fail(what, e.message);
  }
}

main();
