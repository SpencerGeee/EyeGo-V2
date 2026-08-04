'use strict';

const prisma = require('../config/database');
const logger = require('../utils/logger');
const tripState = require('./trip-state.service');

/**
 * Stuck-trip alarms.
 *
 * WHY THIS EXISTS. The expiry sweep already writes off trips that are hours
 * dead. That is a cleanup, and by the time it fires the rider has long since
 * given up and the damage is done. What was missing is the layer above it:
 * noticing, in minutes rather than hours, that trips are getting STUCK — and
 * saying so somewhere a human will see.
 *
 * Every state here is one a trip should pass through in seconds or minutes. A
 * trip sitting in it for longer is a bug in something: dispatch not advancing,
 * a driver who accepted and vanished, a `ScheduledTask` worker that is not
 * running. Under the old architecture none of those were observable at all —
 * an in-memory cascade that died with a deploy left no trace anywhere, which
 * is precisely why "riders stuck on a spinner" was reported as a mystery
 * rather than as an alert.
 *
 * This deliberately does NOT auto-remediate. It reports. A trip stuck in
 * MATCHING for ten minutes might be a dead worker or might be a genuinely
 * empty market at 3am, and quietly cancelling the second case to fix the first
 * is how you lose riders without noticing.
 */

/** Status → how long a trip may sit in it before it counts as stuck (minutes). */
const STUCK_THRESHOLD_MINUTES = Object.freeze({
  // Should move to MATCHING within a second; sitting here means dispatch never started.
  REQUESTED: 2,
  // A full cascade is ~8 candidates × 20s ≈ 3 min, plus the widened sweep.
  MATCHING: 8,
  REASSIGNING: 8,
  // Accepted but never set off. The driver app is not sending, or the driver bailed.
  DRIVER_ASSIGNED: 15,
  // Longest plausible pickup leg in Accra traffic.
  DRIVER_EN_ROUTE: 45,
  // Waiting at the pickup. Past this the driver should have marked a no-show.
  ARRIVED_AT_PICKUP: 20,
  // Longest plausible journey.
  IN_PROGRESS: 180,
});

/** How often the check runs. */
const CHECK_INTERVAL_MS = parseInt(process.env.TRIP_HEALTH_INTERVAL_MS, 10) || 60_000;

function minutesAgo(m) {
  return new Date(Date.now() - m * 60_000);
}

/**
 * Find every trip that has been sitting in a live status longer than that
 * status allows.
 *
 * Keyed on `updatedAt`, which `applyTransition` touches on every transition —
 * so "how long has it been in this state" is exactly what we measure, rather
 * than "how old is the trip", which a long legitimate journey would trip over.
 */
async function findStuckTrips() {
  const clauses = Object.entries(STUCK_THRESHOLD_MINUTES).map(([status, minutes]) => ({
    status,
    updatedAt: { lt: minutesAgo(minutes) },
  }));

  return prisma.trip.findMany({
    where: { OR: clauses },
    select: {
      id: true,
      status: true,
      version: true,
      driverId: true,
      requesterId: true,
      updatedAt: true,
      createdAt: true,
      redispatchCount: true,
    },
    orderBy: { updatedAt: 'asc' },
    take: 100,
  });
}

/**
 * Are the durable timers actually firing?
 *
 * A backlog of overdue PENDING tasks means the ScheduledTask worker is dead or
 * wedged — which under the old `setTimeout` design was completely invisible,
 * and is the single failure most likely to strand riders. Worth its own alarm
 * because it explains a whole class of stuck trips at once.
 */
async function checkTaskWorkerHealth() {
  const overdue = await prisma.scheduledTask.count({
    where: { status: 'PENDING', runAt: { lt: minutesAgo(2) } },
  });
  const failed = await prisma.scheduledTask.count({ where: { status: 'FAILED' } });
  return { overdue, failed };
}

/** One health pass. Returns what it found so a caller can also expose it. */
async function check() {
  const [stuck, tasks] = await Promise.all([findStuckTrips(), checkTaskWorkerHealth()]);

  if (tasks.overdue > 0) {
    logger.error(
      `ALARM: ${tasks.overdue} scheduled task(s) overdue by >2min — the timer worker ` +
        'is not draining. Offer timeouts and request expiries are not firing, which ' +
        'will strand riders mid-search. Check startWorker() in server.js.',
    );
  }
  if (tasks.failed > 0) {
    logger.warn(`${tasks.failed} scheduled task(s) exhausted their retries and are parked FAILED.`);
  }

  if (stuck.length > 0) {
    const byStatus = stuck.reduce((acc, t) => {
      acc[t.status] = (acc[t.status] ?? 0) + 1;
      return acc;
    }, {});
    logger.error(
      `ALARM: ${stuck.length} stuck trip(s): ${JSON.stringify(byStatus)}. ` +
        `Oldest: ${stuck[0].id} in ${stuck[0].status} since ${stuck[0].updatedAt.toISOString()}.`,
    );
    for (const trip of stuck.slice(0, 10)) {
      logger.warn(
        `Stuck trip ${trip.id}: ${trip.status} v${trip.version} for ` +
          `${Math.round((Date.now() - trip.updatedAt.getTime()) / 60_000)}min ` +
          `(driver=${trip.driverId ?? 'none'}, redispatches=${trip.redispatchCount})`,
      );
    }
  }

  return { stuck, tasks };
}

/**
 * Read-only health snapshot for `/health` and the admin dashboard, so the
 * state of dispatch is inspectable without reading logs.
 */
async function snapshot() {
  const [liveCounts, tasks] = await Promise.all([
    prisma.trip.groupBy({
      by: ['status'],
      where: { status: { in: tripState.LIVE_STATUSES } },
      _count: true,
    }),
    checkTaskWorkerHealth(),
  ]);
  const stuck = await findStuckTrips();

  return {
    live: Object.fromEntries(liveCounts.map((r) => [r.status, r._count])),
    stuck: stuck.length,
    stuckByStatus: stuck.reduce((acc, t) => {
      acc[t.status] = (acc[t.status] ?? 0) + 1;
      return acc;
    }, {}),
    scheduledTasks: tasks,
    healthy: stuck.length === 0 && tasks.overdue === 0,
    serverNowMs: Date.now(),
  };
}

let timer = null;

function start() {
  if (timer) return;
  timer = setInterval(() => {
    check().catch((err) => logger.warn(`Trip health check failed: ${err.message}`));
  }, CHECK_INTERVAL_MS);
  if (timer.unref) timer.unref();
  logger.info(`Trip health monitor started (every ${CHECK_INTERVAL_MS}ms)`);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { check, snapshot, findStuckTrips, start, stop, STUCK_THRESHOLD_MINUTES };
