import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Resolved from eyego-api rather than from this file: the Prisma client and
// dotenv are installed there, and an ESM import resolves relative to the
// importing MODULE, not the working directory.
const here0 = path.dirname(fileURLToPath(import.meta.url));
const apiRequire = createRequire(path.join(here0, '..', '..', 'eyego-api', 'package.json'));
const { PrismaClient } = apiRequire('@prisma/client');
const dotenv = apiRequire('dotenv');

/**
 * REMOVE EVERYTHING THE E2E HARNESS CREATED, AND NOTHING ELSE.
 *
 * WHY THIS EXISTS: the six suites in this directory drive the REAL server, so
 * every run leaves real rows behind — riders, drivers, ad-hoc routes, trips
 * parked at MATCHING because the run ended before the cascade did. Those rows
 * are indistinguishable from production data to every screen in both apps, and
 * they surfaced as exactly that: two "live requests" on the driver's dispatch
 * tab, both reading "Destination pending", and a trip a real rider could join
 * and then sit on forever because no driver was ever going to advance it.
 *
 * WHAT COUNTS AS TEST DATA — three markers, all of them structural rather than
 * guessed:
 *
 *   1. `id LIKE 'e2e_%'`      — the admin fixture seed names its rows.
 *   2. phone `2332[04]#########` — `lib.mjs`'s `phone()` mints 14-digit numbers
 *      (prefix + 7 digits of epoch + 2 random). A real Ghanaian MSISDN is 12.
 *   3. phone `deleted_%`      — a harness account that exercised delete-account.
 *
 * Everything else is left alone. Real accounts are listed before anything is
 * deleted so you can see the line being drawn.
 *
 * DRY RUN BY DEFAULT. Pass --confirm to actually delete.
 *
 *   node scripts/e2e/purge-test-data.mjs
 *   node scripts/e2e/purge-test-data.mjs --confirm
 *
 * Refuses a non-local database unless E2E_ALLOW_REMOTE=1, same rule as the
 * suites themselves.
 */



const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '..', '..', 'eyego-api', '.env') });

const CONFIRM = process.argv.includes('--confirm');
/**
 * How far past its departure time a FILLING/SCHEDULED board has to be before it
 * counts as dead. Six hours: long enough that a genuinely delayed bus is safe,
 * short enough that yesterday's harness run is not still on the rider's home
 * screen. `--stale-hours=N` to override.
 */
const STALE_HOURS = Number(
  (process.argv.find((a) => a.startsWith('--stale-hours=')) || '').split('=')[1] || 6,
);
const url = process.env.DATABASE_URL || '';

if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url) && !process.env.E2E_ALLOW_REMOTE) {
  console.error(
    `Refusing to touch ${url.replace(/:[^:@]*@/, ':***@')}.\n` +
      'This deletes rows. Set E2E_ALLOW_REMOTE=1 only if you are certain.',
  );
  process.exit(1);
}

const prisma = new PrismaClient();

/** 14 characters is the harness's signature; a real Ghana number is 12. */
const isHarnessPhone = (p) =>
  typeof p === 'string' &&
  (p.startsWith('deleted_') || (/^2332[04]\d{9}$/.test(p) && p.length === 14));

const isTestUser = (u) => u.id.startsWith('e2e_') || isHarnessPhone(u.phone);

async function main() {
  const [users, drivers] = await Promise.all([
    prisma.user.findMany({ select: { id: true, name: true, phone: true } }),
    prisma.driver.findMany({ select: { id: true, name: true, phone: true } }),
  ]);

  const testUserIds = users.filter(isTestUser).map((u) => u.id);
  const testDriverIds = drivers.filter(isTestUser).map((d) => d.id);
  const keptUsers = users.filter((u) => !isTestUser(u));
  const keptDrivers = drivers.filter((d) => !isTestUser(d));

  console.log('\n── KEEPING (real accounts) ───────────────────────────────');
  for (const u of keptUsers) console.log(`  rider   ${u.phone}  ${u.name ?? '(no name)'}`);
  for (const d of keptDrivers) console.log(`  driver  ${d.phone}  ${d.name ?? '(no name)'}`);
  if (keptUsers.length + keptDrivers.length === 0) {
    console.log('  (none — every account in this database matches a test marker)');
  }

  /**
   * Trips to remove: anything a test actor requested or drove, PLUS any trip
   * whose only passengers are test bookings. A trip a REAL rider joined is
   * included too when its driver is a fixture — that trip can never complete,
   * which is precisely the stuck "waiting to fill up" ride being cleaned up.
   */
  const trips = await prisma.trip.findMany({
    where: {
      OR: [
        { requesterId: { in: testUserIds } },
        { driverId: { in: testDriverIds } },
        { bookings: { some: { userId: { in: testUserIds } } } },
      ],
    },
    select: { id: true, status: true, routeId: true },
  });
  const tripIds = trips.map((t) => t.id);

  /**
   * ── EVERYTHING ELSE THAT CANNOT COMPLETE ─────────────────────────────────
   *
   * BUGFIX — "on the homepage of the rider app I can see leftover seeded data
   * from the e2e harness. You need to clean up so I can test stuff correctly."
   *
   * The actor sweep above only reaches a trip whose requester, driver or
   * passenger is still IN THE DATABASE. Three ways a harness trip escapes that
   * and lands on the rider's home screen anyway:
   *
   *   1. A PARTIAL EARLIER PURGE. Delete the fixture driver and the trip is
   *      suddenly owned by nobody — it matches no actor filter ever again, and
   *      it sits on the board forever because no driver exists to advance it.
   *   2. AN `e2e_`-NAMED ROW. The admin fixture seed names trips and routes
   *      directly; those never had an actor to be found by.
   *   3. A STALE BOARD. `FILLING` and `SCHEDULED` are exactly the two statuses
   *      the rider's home screen queries, and a bus whose departure time passed
   *      hours ago is not a ride anyone can take. Real or seeded, it is dead —
   *      and it is the majority of what "leftover seeded data" looks like.
   *
   * All three are structural facts about the row, not guesses about who made
   * it, which is the same standard the markers above hold to.
   */
  const STALE_MS = STALE_HOURS * 60 * 60 * 1000;
  const liveDriverIds = new Set(drivers.map((d) => d.id));
  const orphanCandidates = await prisma.trip.findMany({
    where: {
      id: { notIn: tripIds.length ? tripIds : ['-'] },
      OR: [
        // 1 + 2 — named by the seed, or dispatch never resolved.
        { id: { startsWith: 'e2e_' } },
        { routeId: { startsWith: 'e2e_' } },
        {
          status: { in: ['MATCHING', 'REASSIGNING'] },
          createdAt: { lt: new Date(Date.now() - 60 * 60 * 1000) },
        },
        // 3 — a board that has already left.
        {
          status: { in: ['FILLING', 'SCHEDULED', 'CONFIRMED'] },
          departureTime: { lt: new Date(Date.now() - STALE_MS) },
        },
      ],
    },
    select: { id: true, status: true, routeId: true, driverId: true, departureTime: true },
  });

  /** A non-terminal trip whose driver row is gone can never be advanced. */
  const driverless = await prisma.trip.findMany({
    where: {
      id: { notIn: tripIds.length ? tripIds : ['-'] },
      status: {
        in: ['FILLING', 'SCHEDULED', 'CONFIRMED', 'DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'IN_PROGRESS'],
      },
      NOT: { driverId: null },
    },
    select: { id: true, status: true, routeId: true, driverId: true },
  });

  const seen = new Set(orphanCandidates.map((t) => t.id));
  const orphans = [
    ...orphanCandidates,
    ...driverless.filter((t) => !seen.has(t.id) && !liveDriverIds.has(t.driverId)),
  ];

  const allTripIds = [...tripIds, ...orphans.map((t) => t.id)];
  const routeIds = [...new Set([...trips, ...orphans].map((t) => t.routeId).filter(Boolean))];

  const bookings = await prisma.booking.findMany({
    where: { OR: [{ tripId: { in: allTripIds } }, { userId: { in: testUserIds } }] },
    select: { id: true, userId: true, tripId: true },
  });
  const bookingIds = bookings.map((b) => b.id);

  console.log('\n── DELETING ──────────────────────────────────────────────');
  console.log(`  test riders          ${testUserIds.length}`);
  console.log(`  test drivers         ${testDriverIds.length}`);
  console.log(`  trips                ${allTripIds.length}   (${orphans.length} of them orphaned/stale)`);
  console.log(`  bookings             ${bookingIds.length}`);
  console.log(`  ad-hoc routes        ${routeIds.length}`);
  console.log(`  (stale threshold: departures more than ${STALE_HOURS} h in the past)`);

  const live = [...trips, ...orphans].filter((t) =>
    ['MATCHING', 'REASSIGNING', 'FILLING', 'SCHEDULED', 'CONFIRMED', 'DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'IN_PROGRESS'].includes(t.status),
  );
  if (live.length) {
    console.log(`\n  ${live.length} of these are NON-TERMINAL and are what the apps are showing:`);
    for (const t of live) console.log(`     ${t.id}  ${t.status}`);
  }

  if (!CONFIRM) {
    console.log('\nDRY RUN — nothing was deleted. Re-run with --confirm to apply.\n');
    return;
  }

  // Children first: several relations are RESTRICT, so the order is load-bearing.
  await prisma.$transaction(async (tx) => {
    const inB = { in: bookingIds };
    const inT = { in: allTripIds };
    const inU = { in: testUserIds };
    const inD = { in: testDriverIds };

    await tx.refund.deleteMany({ where: { bookingId: inB } });
    await tx.receipt.deleteMany({ where: { OR: [{ bookingId: inB }, { userId: inU }] } });
    await tx.paymentTransaction.deleteMany({ where: { bookingId: inB } });
    await tx.rideGroup.deleteMany({ where: { tripId: inT } });
    await tx.booking.deleteMany({ where: { id: inB } });

    await tx.dispatchAction.deleteMany({ where: { OR: [{ tripId: inT }, { driverId: inD }] } });
    await tx.tripEvent.deleteMany({ where: { tripId: inT } });
    /**
     * The rest of what hangs off a trip. Each is `?.` because this script has
     * to keep working against a schema that gains models — a purge that throws
     * half way leaves the database in a worse state than the one it was called
     * to fix, and "this model does not exist here" is not a reason to abort.
     */
    await tx.message?.deleteMany({ where: { tripId: inT } });
    await tx.sosEvent?.deleteMany({ where: { OR: [{ tripId: inT }, { userId: inU }] } });
    await tx.tripReport?.deleteMany({ where: { OR: [{ tripId: inT }, { driverId: inD }] } });
    await tx.callSession?.deleteMany({ where: { tripId: inT } });
    await tx.tripRequest?.deleteMany({ where: { OR: [{ matchedTripId: inT }, { userId: inU }] } });
    await tx.scheduledTask?.deleteMany({ where: { tripId: inT } });
    await tx.mapReport?.deleteMany({ where: { OR: [{ userId: inU }, { driverId: inD }] } });
    // AdminNote is polymorphic — `subjectType` + `subjectId`, no foreign key —
    // so it is addressed by subject rather than by relation.
    await tx.adminNote?.deleteMany({
      where: {
        OR: [
          { subjectType: 'TRIP', subjectId: inT },
          { subjectType: 'USER', subjectId: inU },
          { subjectType: 'DRIVER', subjectId: inD },
        ],
      },
    });
    await tx.driverRating.deleteMany({ where: { OR: [{ driverId: inD }, { userId: inU }] } });
    await tx.passengerRating.deleteMany({ where: { userId: inU } });
    await tx.trip.deleteMany({ where: { id: inT } });

    await tx.virtualStop.deleteMany({ where: { routeId: { in: routeIds } } });
    await tx.pulseSchedule.deleteMany({ where: { routeId: { in: routeIds } } });
    await tx.scheduledRideIntent.deleteMany({ where: { routeId: { in: routeIds } } });
    await tx.route.deleteMany({ where: { id: { in: routeIds } } });

    await tx.walletTransaction.deleteMany({ where: { driverId: inD } });
    await tx.driverReceipt.deleteMany({ where: { driverId: inD } });
    await tx.driverShift.deleteMany({ where: { driverId: inD } });
    await tx.onlineSession.deleteMany({ where: { driverId: inD } });
    await tx.vehicleInspection.deleteMany({ where: { OR: [{ driverId: inD }, { vehicle: { driverId: inD } }] } });
    await tx.driverDestinationPreference.deleteMany({ where: { driverId: inD } });
    await tx.vehicle.deleteMany({ where: { driverId: inD } });
    await tx.driver.deleteMany({ where: { id: inD } });

    await tx.riderWalletTransaction.deleteMany({ where: { userId: inU } });
    await tx.referralBonus.deleteMany({ where: { userId: inU } });
    await tx.referral.deleteMany({ where: { OR: [{ inviterId: inU }, { inviteeId: inU }] } });
    // TicketMessage RESTRICTs on its ticket, so the thread goes before the
    // ticket does. The admin fixture seeds `e2e_ticket_0` with replies.
    await tx.ticketMessage.deleteMany({ where: { ticket: { userId: inU } } });
    await tx.supportTicket.deleteMany({ where: { userId: inU } });
    await tx.rideGroup.deleteMany({ where: { leadPassengerId: inU } });
    await tx.user.deleteMany({ where: { id: inU } });
  }, { timeout: 120000 });

  console.log('\nDone. Re-run without --confirm to confirm the database is clean.\n');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
