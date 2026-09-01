'use strict';

const prisma = require('../config/database');
const logger = require('../utils/logger');

/**
 * ── THE FUNNEL ──────────────────────────────────────────────────────────────
 *
 * What share of ride requests found a driver, how long matching took, who
 * cancelled and why.
 *
 * `Trip` cannot answer those. It records what a trip IS now, not what happened
 * to it on the way — and the most important population is the one that leaves
 * almost no trace: a request that nobody accepted. It ends up CANCELLED or
 * EXPIRED, indistinguishable from a rider who changed their mind. If matching
 * quietly drops from 90% to 40%, nothing in the schema goes red. That is the
 * failure this exists to make visible, and it is the one that does not throw.
 *
 * ── WHY NOT AN SDK ──────────────────────────────────────────────────────────
 *
 * Every event worth counting already crosses this API. Recording it here costs
 * a row; a third-party SDK in both apps would have to be declared as data
 * sharing on the Play Data Safety form and Apple's privacy labels, add bundle
 * weight, and upload events over mobile data the rider is paying for.
 *
 * ── HOW IT IS WIRED ─────────────────────────────────────────────────────────
 *
 * From `publishCommitted` in trip-state.service — the single funnel every
 * status change from every code path already passes through. The same reasoning
 * that put notifications there: anything hooked into individual service
 * functions ends up recording some paths and not others, and a funnel with
 * holes is worse than no funnel because it looks like data.
 *
 * Never awaited, never throws. An analytics write must not be able to fail a
 * trip.
 */

const EVENT = {
  REQUESTED: 'RIDE_REQUESTED',
  MATCHED: 'RIDE_MATCHED',
  ACCEPTED: 'RIDE_ACCEPTED',
  CANCELLED: 'RIDE_CANCELLED',
  COMPLETED: 'RIDE_COMPLETED',
  NO_DRIVERS: 'RIDE_NO_DRIVERS',
  DRIVER_ONLINE: 'DRIVER_ONLINE',
  DRIVER_OFFLINE: 'DRIVER_OFFLINE',
};

const EVENT_TYPES = Object.values(EVENT);

/**
 * Which trip status means which funnel step.
 *
 * Statuses not listed here are real and meaningful to the trip; they are simply
 * not funnel steps. Recording every one would make "requests that matched"
 * require knowing which of eleven statuses counted, which is how a funnel stops
 * being read.
 */
const EVENT_FOR_STATUS = {
  REQUESTED: EVENT.REQUESTED,
  DRIVER_ASSIGNED: EVENT.MATCHED,
  DRIVER_EN_ROUTE: EVENT.ACCEPTED,
  COMPLETED: EVENT.COMPLETED,
  CANCELLED: EVENT.CANCELLED,
  NO_DRIVERS_FOUND: EVENT.NO_DRIVERS,
  EXPIRED: EVENT.NO_DRIVERS,
};

/**
 * Record one event. Fire-and-forget by construction.
 *
 * Returns nothing on purpose: a caller that could await this would eventually
 * be written to await it, and then a slow analytics insert is on the path of a
 * driver's Accept tap.
 */
function record({ type, tripId, userId, driverId, reason, elapsedMs, meta } = {}) {
  if (!EVENT_TYPES.includes(type)) {
    logger.warn(`[analytics] refusing unknown event type ${type}`);
    return;
  }

  prisma.analyticsEvent
    .create({
      data: {
        type,
        tripId: tripId ?? null,
        userId: userId ?? null,
        driverId: driverId ?? null,
        reason: reason ? String(reason).slice(0, 200) : null,
        elapsedMs: Number.isFinite(elapsedMs) ? Math.max(0, Math.round(elapsedMs)) : null,
        meta: meta ? JSON.stringify(meta).slice(0, 2000) : null,
      },
    })
    .catch((err) => logger.warn(`[analytics] insert failed for ${type}: ${err.message}`));
}

/**
 * Called for every committed transition.
 *
 * `elapsedMs` is measured from the trip's creation, which is when the rider
 * asked. That makes "time to match" answerable with one column rather than a
 * self-join back to the REQUESTED row per trip.
 */
function recordTransition(trip, event) {
  try {
    const type = EVENT_FOR_STATUS[trip?.status];
    if (!type) return;

    const createdAt = trip.createdAt ? new Date(trip.createdAt).getTime() : null;
    const elapsedMs = createdAt ? Date.now() - createdAt : null;

    record({
      type,
      tripId: trip.id,
      userId: trip.requesterId ?? null,
      driverId: trip.driverId ?? null,
      // `event.reason` where the transition carried one — a cancellation says
      // who cancelled and why, which is the whole value of the CANCELLED row.
      reason: event?.reason ?? event?.type ?? null,
      elapsedMs,
    });
  } catch (err) {
    logger.warn(`[analytics] recordTransition failed: ${err.message}`);
  }
}

/**
 * The funnel over a window, as the admin console reads it.
 *
 * Rates, not counts. A count answers "how busy were we"; the operator's
 * question is "what fraction of people who wanted a ride got one", and that
 * ratio is the number that moves before anyone complains.
 */
async function funnel({ since, until } = {}) {
  const from = since ? new Date(since) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const to = until ? new Date(until) : new Date();

  const rows = await prisma.analyticsEvent.groupBy({
    by: ['type'],
    where: { at: { gte: from, lte: to } },
    _count: { _all: true },
  });

  const count = (t) => rows.find((r) => r.type === t)?._count?._all ?? 0;

  const requested = count(EVENT.REQUESTED);
  const matched = count(EVENT.MATCHED);
  const completed = count(EVENT.COMPLETED);
  const cancelled = count(EVENT.CANCELLED);
  const noDrivers = count(EVENT.NO_DRIVERS);

  // Time to match, over the same window. Averaged in SQL rather than pulled
  // into memory — this table grows without bound until the retention sweep.
  const timing = await prisma.analyticsEvent.aggregate({
    where: { type: EVENT.MATCHED, at: { gte: from, lte: to }, elapsedMs: { not: null } },
    _avg: { elapsedMs: true },
    _max: { elapsedMs: true },
  });

  const rate = (n, d) => (d > 0 ? Number((n / d).toFixed(4)) : null);

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    counts: { requested, matched, accepted: count(EVENT.ACCEPTED), completed, cancelled, noDrivers },
    rates: {
      // The headline. A request that found a driver.
      matchRate: rate(matched, requested),
      // Of those matched, how many actually ended in a ride.
      completionRate: rate(completed, matched),
      cancellationRate: rate(cancelled, requested),
      noDriverRate: rate(noDrivers, requested),
    },
    timeToMatchMs: {
      mean: timing._avg.elapsedMs != null ? Math.round(timing._avg.elapsedMs) : null,
      worst: timing._max.elapsedMs ?? null,
    },
  };
}

/** Daily counts per type, for the console's chart. */
async function daily({ days = 14 } = {}) {
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  // Raw SQL: Prisma's groupBy cannot group by a date truncation, and pulling
  // every row back to bucket it in JavaScript is exactly what this table will
  // grow too large for.
  return prisma.$queryRaw`
    SELECT date_trunc('day', "at") AS day, "type", count(*)::int AS n
    FROM "AnalyticsEvent"
    WHERE "at" >= ${from}
    GROUP BY 1, 2
    ORDER BY 1 ASC
  `;
}

/**
 * Delete events older than the retention window.
 *
 * The funnel is a rate over a window; a row from four months ago contributes to
 * no question anyone asks, and this table is the fastest-growing one on the
 * platform. Also the honest answer to a data-protection question about how long
 * behavioural data is kept.
 */
async function pruneOlderThan(days = 90) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const { count } = await prisma.analyticsEvent.deleteMany({ where: { at: { lt: cutoff } } });
  if (count > 0) logger.info(`[analytics] pruned ${count} events older than ${days} days`);
  return count;
}

module.exports = {
  EVENT,
  EVENT_TYPES,
  EVENT_FOR_STATUS,
  record,
  recordTransition,
  funnel,
  daily,
  pruneOlderThan,
};
