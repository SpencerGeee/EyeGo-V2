'use strict';

const prisma = require('./../config/database');
const logger = require('../utils/logger');
const supply = require('./supply-index.service');
const publisher = require('./trip-events.publisher');
const tripState = require('./trip-state.service');

/**
 * "Is the driver on this live trip still reporting?"
 *
 * THE GAP THIS CLOSES. Presence is a Redis key with a 90 s TTL, refreshed by
 * every location ping and by the driver app's 25 s parked heartbeat. When it
 * expires, the driver falls out of `supply:drivers:geo` and stops being offered
 * new work — which is correct, and is the whole of what expiry did.
 *
 * It did nothing for the trip they were ALREADY ON. A driver whose battery dies
 * mid-ride left the rider on a tracking screen showing a puck frozen at the last
 * reported position, an ETA counting down against a route nobody is driving, and
 * no indication that any of it had stopped being true. `trip-health` notices at
 * 180 minutes and writes a log line. The rider has been sitting there for hours.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not reassign. `IN_PROGRESS →
 * REASSIGNING` is not in the transition table on purpose: sending a second
 * driver to somebody already in a moving vehicle is not a recovery. It does not
 * cancel either — the ride may well be proceeding perfectly with a dead phone in
 * the cupholder, and cancelling it would fabricate a failure. The only honest
 * thing available is to say what is true: we have lost the live signal. The
 * rider can then call the driver, or escalate through SOS, which is what they
 * would have done half an hour ago had anybody told them.
 */

/**
 * How long after presence expiry before the rider is told.
 *
 * Above the 90 s TTL, not below it: a tunnel, a lift, or a carrier handover
 * routinely costs a driver their presence key for a few seconds, and crying
 * "lost" every time would train riders to ignore the one that matters.
 */
const LINK_LOST_AFTER_MS = 120_000;

/** How often to look. Well under the delay above, so the delay is the delay. */
const CHECK_INTERVAL_MS = 30_000;

/** tripId → true, for trips we have already warned about. */
const warned = new Map();

async function check() {
  const trips = await prisma.trip.findMany({
    where: {
      status: { in: [...tripState.ACTIVE_STATUSES] },
      driverId: { not: null },
    },
    select: { id: true, driverId: true, updatedAt: true },
  });

  if (trips.length === 0) {
    warned.clear();
    return { watched: 0, lost: 0, restored: 0 };
  }

  const driverIds = [...new Set(trips.map((t) => t.driverId))];
  const present = await supply.whichArePresent(driverIds);

  /**
   * FAIL QUIET, NOT LOUD.
   *
   * `whichArePresent` swallows a Redis error and answers with an empty set, so
   * "Redis is down" and "nobody is present" arrive here looking identical. Acted
   * on literally, one dropped connection would tell every rider on every live
   * trip at once that they had lost their driver — mass panic, in the one moment
   * the system is least able to explain itself.
   *
   * Every driver in the fleet losing presence in the same 30 s window is not a
   * thing that happens; a Redis blip is. When the answer is a total wipe-out,
   * assume the probe and skip the pass. The cost of being wrong is one missed
   * cycle, thirty seconds late.
   */
  if (present.size === 0 && driverIds.length > 1) {
    logger.warn(
      `Driver link watch: presence probe returned nothing for all ${driverIds.length} ` +
        'drivers on live trips. Treating as a probe failure, not a fleet-wide outage.',
    );
    return { watched: trips.length, lost: 0, restored: 0, skipped: true };
  }

  let lost = 0;
  let restored = 0;

  for (const trip of trips) {
    const isPresent = present.has(trip.driverId);
    const wasWarned = warned.get(trip.id) === true;

    if (isPresent) {
      if (wasWarned) {
        warned.delete(trip.id);
        restored += 1;
        publisher.publishDriverLink(trip.id, { lost: false });
        logger.info('Driver link restored', { tripId: trip.id, driverId: trip.driverId });
      }
      continue;
    }

    if (wasWarned) continue;

    // Presence is gone. `updatedAt` is the last time anything moved this trip
    // forward, which is the closest thing to "when we last heard from them"
    // that survives a restart — the in-memory map above does not.
    const silentForMs = Date.now() - trip.updatedAt.getTime();
    if (silentForMs < LINK_LOST_AFTER_MS) continue;

    warned.set(trip.id, true);
    lost += 1;
    publisher.publishDriverLink(trip.id, { lost: true, lastSeenMs: trip.updatedAt.getTime() });
    // An alarm in minutes, not the 180 the stuck-trip sweep waits for. Someone
    // is in a vehicle we have lost contact with; ops should see that today.
    logger.error(
      `ALARM: driver ${trip.driverId} has no presence on live trip ${trip.id} ` +
        `(silent ${Math.round(silentForMs / 60_000)}min). Rider has been told the ` +
        'live signal is lost; the ride itself may be fine.',
    );
  }

  // Trips that ended keep their entry forever otherwise.
  const liveIds = new Set(trips.map((t) => t.id));
  for (const id of warned.keys()) if (!liveIds.has(id)) warned.delete(id);

  return { watched: trips.length, lost, restored };
}

let timer = null;

function start() {
  if (timer) return;
  timer = setInterval(() => {
    check().catch((err) => logger.warn(`Driver link watch failed: ${err.message}`));
  }, CHECK_INTERVAL_MS);
  if (timer.unref) timer.unref();
  logger.info(`Driver link watch started (every ${CHECK_INTERVAL_MS}ms)`);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  warned.clear();
}

module.exports = { check, start, stop, LINK_LOST_AFTER_MS };
