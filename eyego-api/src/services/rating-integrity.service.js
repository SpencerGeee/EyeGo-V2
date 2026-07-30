'use strict';

const prisma = require('../config/database');
const logger = require('../utils/logger');

/**
 * Rating integrity — keeps a handful of riders who rate every driver badly from
 * dragging down honest drivers' averages.
 *
 * Why: a driver reported that some riders give 1–2 stars on every trip no matter
 * how the ride went, and that the incumbent apps detect and discount those
 * raters. Nothing here punishes the rider (their ratings are still stored, still
 * visible to admin, and still count for their own record) — the ratings are just
 * excluded from the *aggregate* a driver is judged by, because a rater whose
 * score carries no information about the ride carries no information about the
 * driver either.
 *
 * Who gets excluded, and only when all of these hold:
 *   • they have rated at least MIN_RATINGS trips — below that, "always rates low"
 *     cannot be distinguished from "had two bad rides", and we must not silence a
 *     genuine complaint;
 *   • their own average is at or below MAX_AVG_STARS;
 *   • at least LOW_SHARE of their ratings are ≤ LOW_STAR_THRESHOLD, i.e. the low
 *     scores are their default rather than an occasional bad trip;
 *   • their average sits at least MIN_DEVIATION stars below the platform average,
 *     so a genuinely poor era of service platform-wide can't mass-exclude riders.
 *
 * The exclusion set is small and changes slowly, so it is computed in one grouped
 * query and cached in-process for CACHE_TTL_MS. Per-process caching is fine at
 * one API instance; if this ever scales horizontally the cache should move to
 * Redis (same caveat as the dispatch cascade's timers).
 */

const MIN_RATINGS = 5;
const MAX_AVG_STARS = 2.2;
const LOW_STAR_THRESHOLD = 2;
const LOW_SHARE = 0.8;
const MIN_DEVIATION = 1.5;
const CACHE_TTL_MS = 15 * 60 * 1000;

let cache = { ids: new Set(), computedAt: 0 };

/** Rider ids whose ratings must not count toward any driver's average. */
async function getExcludedRaterIds({ force = false } = {}) {
  if (!force && Date.now() - cache.computedAt < CACHE_TTL_MS) return cache.ids;

  try {
    const [byRater, platform] = await Promise.all([
      prisma.driverRating.groupBy({
        by: ['userId'],
        _avg: { stars: true },
        _count: { stars: true },
      }),
      prisma.driverRating.aggregate({ _avg: { stars: true } }),
    ]);

    const platformAvg = platform._avg.stars ?? 5;
    const suspects = byRater.filter(
      (r) =>
        (r._count.stars ?? 0) >= MIN_RATINGS &&
        (r._avg.stars ?? 5) <= MAX_AVG_STARS &&
        (r._avg.stars ?? 5) <= platformAvg - MIN_DEVIATION,
    );

    const excluded = new Set();
    if (suspects.length) {
      // Second pass on the shortlist only: the share test needs the individual
      // rows, and pulling them for every rater on the platform would not scale.
      const suspectIds = suspects.map((r) => r.userId);
      const rows = await prisma.driverRating.findMany({
        where: { userId: { in: suspectIds } },
        select: { userId: true, stars: true },
      });
      const tally = new Map();
      for (const row of rows) {
        const t = tally.get(row.userId) ?? { total: 0, low: 0 };
        t.total += 1;
        if (row.stars <= LOW_STAR_THRESHOLD) t.low += 1;
        tally.set(row.userId, t);
      }
      for (const [userId, t] of tally) {
        if (t.total >= MIN_RATINGS && t.low / t.total >= LOW_SHARE) excluded.add(userId);
      }
    }

    cache = { ids: excluded, computedAt: Date.now() };
    if (excluded.size) {
      logger.info('Rating integrity: excluding chronic low-raters from driver averages', {
        raters: excluded.size,
        platformAvg: Number(platformAvg.toFixed(2)),
      });
    }
    return excluded;
  } catch (err) {
    // A failure here must never break a profile load — fall back to counting
    // everyone, which is the previous behaviour.
    logger.warn('Rating integrity: exclusion pass failed, counting all raters', { error: err.message });
    return cache.ids;
  }
}

/**
 * Prisma `where` fragment that drops excluded raters. Spread it into any
 * DriverRating query that feeds a driver-facing or rider-facing average.
 */
async function ratingWhere(extra = {}) {
  const excluded = await getExcludedRaterIds();
  if (!excluded.size) return extra;
  return { ...extra, userId: { notIn: [...excluded] } };
}

/**
 * The single way to read a driver's rating. Returns nulls rather than a
 * fabricated 5.0 when a driver has no countable ratings yet — callers decide how
 * to present "not rated".
 */
async function getDriverRating(driverId) {
  const where = await ratingWhere({ driverId });
  const agg = await prisma.driverRating.aggregate({
    where,
    _avg: { stars: true },
    _count: { stars: true },
  });
  return {
    rating: agg._avg.stars ?? null,
    ratingCount: agg._count.stars ?? 0,
  };
}

/** Same, for many drivers at once (dispatch scoring, admin lists). */
async function getDriverRatings(driverIds) {
  if (!driverIds?.length) return new Map();
  const where = await ratingWhere({ driverId: { in: driverIds } });
  const rows = await prisma.driverRating.groupBy({
    by: ['driverId'],
    where,
    _avg: { stars: true },
    _count: { stars: true },
  });
  return new Map(rows.map((r) => [r.driverId, { rating: r._avg.stars ?? null, ratingCount: r._count.stars ?? 0 }]));
}

module.exports = {
  getExcludedRaterIds,
  ratingWhere,
  getDriverRating,
  getDriverRatings,
  // Exported for tests/tuning.
  THRESHOLDS: { MIN_RATINGS, MAX_AVG_STARS, LOW_STAR_THRESHOLD, LOW_SHARE, MIN_DEVIATION },
};
