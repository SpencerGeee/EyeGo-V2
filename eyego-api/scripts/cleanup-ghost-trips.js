#!/usr/bin/env node
'use strict';

/**
 * Clean up the wreckage left by the request-timeout bug.
 *
 * WHAT WENT WRONG. `POST /rides` used to run the whole dispatch funnel inside
 * the HTTP request — roughly fourteen seconds against a fifteen-second client
 * timeout. The rider was shown "we couldn't reach the server" for a trip that
 * had in fact been created, retried, and hit "you already have a ride in
 * progress" because they genuinely did. Each attempt left a trip behind.
 *
 * Those trips eventually EXPIRED on their own, but the terminal transition did
 * not touch their Booking rows, so the rider's activity list kept showing them
 * as "Confirmed" — and tapping one hit an endpoint that correctly refuses to
 * open a finished trip, giving "trip not found". Both causes are fixed in the
 * code (see rides.service.js and trip-state.service.js); this repairs the rows
 * that were written before the fix.
 *
 * SAFE BY DEFAULT. Runs as a dry run and prints what it would change. Pass
 * --apply to actually write. Never touches a trip that is still live, and never
 * touches a COMPLETED trip or its bookings.
 *
 *   node scripts/cleanup-ghost-trips.js            # report only
 *   node scripts/cleanup-ghost-trips.js --apply    # repair
 */

const prisma = require('../src/config/database');

const APPLY = process.argv.includes('--apply');

/** Statuses a trip can be in only if it is over. Mirrors TERMINAL_STATUSES. */
const TERMINAL = ['COMPLETED', 'CANCELLED', 'NO_DRIVERS_FOUND', 'EXPIRED', 'NO_SHOW'];
/** Booking statuses that are already settled one way or another. */
const SETTLED = ['CANCELLED', 'REFUNDED', 'EXPIRED', 'COMPLETED', 'NO_SHOW'];

/** How long a trip may sit in a pre-driver state before it is plainly abandoned. */
const STRANDED_MINUTES = 30;

async function main() {
  const strandedBefore = new Date(Date.now() - STRANDED_MINUTES * 60 * 1000);

  /**
   * 1. Bookings still holding a seat on a trip that is over.
   *
   * This is the one the rider sees: the activity list reads the BOOKING for its
   * badge, so a CONFIRMED booking on an EXPIRED trip reads as a live ride.
   */
  const orphanBookings = await prisma.booking.findMany({
    where: {
      status: { notIn: SETTLED },
      trip: { status: { in: TERMINAL.filter((s) => s !== 'COMPLETED') } },
    },
    select: {
      id: true,
      status: true,
      seatNumber: true,
      trip: { select: { id: true, shortId: true, status: true, updatedAt: true } },
    },
  });

  /**
   * 2. Trips stranded in a pre-driver state with nothing left to advance them.
   *
   * The durable expiry task is what normally ends these. A trip older than the
   * window that is still REQUESTED/MATCHING has lost its timer — the deploy that
   * dropped it, or the crash — and nothing will ever move it again.
   */
  const strandedTrips = await prisma.trip.findMany({
    where: {
      status: { in: ['REQUESTED', 'MATCHING', 'REASSIGNING'] },
      createdAt: { lt: strandedBefore },
    },
    select: { id: true, shortId: true, status: true, createdAt: true, requesterId: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`\n${APPLY ? 'REPAIRING' : 'DRY RUN — nothing will be written'}\n`);

  console.log(`Bookings alive on a dead trip: ${orphanBookings.length}`);
  for (const b of orphanBookings) {
    console.log(
      `  booking ${b.id} (${b.status}, seat ${b.seatNumber ?? '—'}) on trip ` +
        `${b.trip.shortId ?? b.trip.id} [${b.trip.status}]`,
    );
  }

  console.log(`\nTrips stranded > ${STRANDED_MINUTES}m with no driver: ${strandedTrips.length}`);
  for (const t of strandedTrips) {
    console.log(`  trip ${t.shortId ?? t.id} [${t.status}] created ${t.createdAt.toISOString()}`);
  }

  if (!APPLY) {
    console.log('\nRe-run with --apply to write these changes.\n');
    return;
  }

  // Settle the orphaned bookings. The seat is released by nulling `seatNumber`,
  // which is the invariant the rest of the system reads occupancy from — a dead
  // booking that keeps a numbered seat keeps that seat out of circulation.
  if (orphanBookings.length > 0) {
    const result = await prisma.booking.updateMany({
      where: { id: { in: orphanBookings.map((b) => b.id) } },
      data: { status: 'EXPIRED', seatNumber: null },
    });
    console.log(`\nSettled ${result.count} booking(s) as EXPIRED and released their seats.`);
  }

  // End the stranded trips through the real transition, so each one writes its
  // TripEvent and both apps are told rather than silently finding out.
  if (strandedTrips.length > 0) {
    const tripState = require('../src/services/trip-state.service');
    let ended = 0;
    for (const t of strandedTrips) {
      try {
        await tripState.applyTransition(t.id, tripState.TRIP_STATUS.EXPIRED, {
          actor: tripState.ACTOR.SYSTEM,
          payload: { reason: 'STRANDED_CLEANUP', strandedMinutes: STRANDED_MINUTES },
        });
        ended += 1;
      } catch (err) {
        console.warn(`  could not expire ${t.shortId ?? t.id}: ${err.message}`);
      }
    }
    console.log(`Expired ${ended} stranded trip(s).`);
  }

  console.log('\nDone.\n');
}

main()
  .catch((err) => {
    console.error('cleanup failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
    process.exit(process.exitCode ?? 0);
  });
