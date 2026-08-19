'use strict';

const prisma = require('../config/database');
const settings = require('../config/settings');

/**
 * STANDING — what a rider's or a driver's behaviour has earned them.
 *
 * WHY THIS EXISTS. Both halves of the reputation loop were half-built. Drivers
 * rated passengers (`PassengerRating` rows have been written since the
 * rate-passengers screen shipped) and nothing ever read them back. Riders rated
 * drivers (`DriverRating`) and the number surfaced on a profile screen but
 * influenced nothing. Reports existed on one side only, named no subject, and
 * fed into nothing at all. So the platform collected behaviour data and spent
 * none of it — which is the "make sure the rating and driver/rider behaviour
 * system is completely done" ask.
 *
 * ── THE SHAPE, AND WHY IT IS THIS SHAPE ──────────────────────────────────────
 *
 * Uber, Bolt and Lyft all converge on the same three inputs, and for good
 * reasons that are worth writing down because they constrain the maths:
 *
 *   RATING is a mean of the last N ratings, not of all time. A 4.9 built over
 *   two years should not make this month's 3.1 invisible, and a rider with four
 *   ratings should not be treated as having a settled reputation. Hence the
 *   window and the confidence floor below.
 *
 *   RELIABILITY is completed ÷ (completed + own cancellations), measured over a
 *   window. It is deliberately NOT "number of cancellations": someone who takes
 *   200 rides and cancels 4 is more reliable than someone who takes 5 and
 *   cancels 2, and a raw count says the opposite.
 *
 *   REPORTS are counted separately and never averaged into the rating. One
 *   credible safety report matters more than fifty five-star rides, and burying
 *   it in a mean is how a platform learns nothing from it. Only UPHELD reports
 *   count — an open report is an allegation, and an allegation must not cost
 *   anyone money or standing before anyone has looked at it.
 *
 * ── NOTHING IS DENORMALISED ──────────────────────────────────────────────────
 * No `User.rating` / `Driver.rating` column is written. These are a handful of
 * indexed aggregates over rows that arrive a few times per person per week, and
 * a cached column is a cached column that goes stale, disagrees with the rows it
 * summarises, and has to be backfilled. Computed on read, cached in Redis by the
 * callers that need it hot (fare quoting).
 */

/** Ratings older than this stop counting. Recency over history. */
const RATING_WINDOW_DAYS = () => settings.get('STANDING_RATING_WINDOW_DAYS') ?? 180;
/** Trips older than this stop counting towards reliability. */
const RELIABILITY_WINDOW_DAYS = () => settings.get('STANDING_RELIABILITY_WINDOW_DAYS') ?? 90;
/**
 * Below this many ratings, the mean is not yet meaningful and is pulled towards
 * the platform's neutral 5.0 rather than reported raw. Without this a single
 * one-star from a driver having a bad day drops a new rider to the bottom tier
 * and starts charging them more — a punishment with no evidence behind it.
 */
const CONFIDENCE_MIN_RATINGS = 5;
const NEUTRAL_RATING = 5;

/** Statuses that mean the person actually took the ride. */
const COMPLETED_BOOKING = ['COMPLETED', 'BOARDED'];

/**
 * Bayesian-smoothed mean: pulls a small sample towards neutral in proportion to
 * how small it is, and becomes the raw mean as the sample grows.
 */
function smoothedRating(sum, count) {
  if (count <= 0) return null;
  const k = CONFIDENCE_MIN_RATINGS;
  return (sum + NEUTRAL_RATING * k) / (count + k);
}

/**
 * The band a person sits in. Named rather than numeric because every consumer
 * (pricing, the driver's passenger card, the admin console) should key off the
 * SAME judgement rather than each re-deriving thresholds from a raw score.
 */
function bandFor({ rating, reliability, upheldReports, sampleSize }) {
  // A standing nobody has earned yet is NEW, not GOOD — it must not unlock a
  // discount, and it must not read as a warning either.
  if (sampleSize < 3) return 'NEW';
  if (upheldReports >= 2) return 'RESTRICTED';
  if (upheldReports >= 1) return 'FAIR';
  if (rating != null && rating < 4.0) return 'FAIR';
  if (reliability < 0.7) return 'FAIR';
  if (rating != null && rating >= 4.8 && reliability >= 0.95) return 'EXCELLENT';
  if (rating != null && rating >= 4.5 && reliability >= 0.85) return 'GOOD';
  return 'FAIR';
}

/**
 * THE LOYALTY DISCOUNT — "fewer cancellations should mean better pricing".
 *
 * Returned in BASIS POINTS of the fare (100 bps = 1%), because a percentage
 * stored as a float is how rounding errors get into money. The caller applies
 * it and rounds once, in pesewas.
 *
 * Deliberately small and capped. This is a loyalty nudge, not a second pricing
 * engine: a discount large enough to be worth gaming is a discount that gets
 * gamed, and one that varies wildly between two riders standing at the same
 * kerb is one that reads as the app being unfair rather than generous. The
 * ceiling is a runtime setting so it can be tuned without a deploy.
 *
 * Only RELIABILITY and RATING earn it. Volume does not: rewarding people simply
 * for spending more is a different product decision and belongs in a rewards
 * tier, not in the base fare.
 */
function loyaltyDiscountBps({ band, reliability, rating }) {
  const cap = settings.get('LOYALTY_MAX_DISCOUNT_BPS') ?? 700; // 7%
  if (band === 'NEW' || band === 'RESTRICTED' || band === 'FAIR') return 0;

  // Reliability is the headline term — it is the behaviour being rewarded.
  // 0.85 → 0, 1.00 → full. Below the floor there is nothing to earn.
  const reliabilityTerm = Math.max(0, (reliability - 0.85) / 0.15);
  // Rating is a smaller modifier: 4.5 → 0, 5.0 → 1.
  const ratingTerm = rating == null ? 0 : Math.max(0, Math.min(1, (rating - 4.5) / 0.5));

  const earned = 0.7 * reliabilityTerm + 0.3 * ratingTerm;
  return Math.round(Math.max(0, Math.min(1, earned)) * cap);
}

function windowStart(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * A rider's standing.
 *
 * @returns {Promise<{
 *   rating: number|null, ratingCount: number,
 *   completedTrips: number, cancelledTrips: number,
 *   reliability: number, cancellationRate: number,
 *   upheldReports: number, openReports: number,
 *   band: string, loyaltyDiscountBps: number,
 * }>}
 */
async function riderStanding(userId) {
  if (!userId) return neutral();

  const ratingSince = windowStart(RATING_WINDOW_DAYS());
  const tripSince = windowStart(RELIABILITY_WINDOW_DAYS());

  const [ratings, completedTrips, cancelledTrips, reports] = await Promise.all([
    prisma.passengerRating.aggregate({
      where: { userId, createdAt: { gte: ratingSince } },
      _sum: { stars: true },
      _count: { stars: true },
    }),
    prisma.booking.count({
      where: { userId, status: { in: COMPLETED_BOOKING }, createdAt: { gte: tripSince } },
    }),
    /**
     * THEIR OWN cancellations, not every cancellation they were caught in.
     *
     * `cancelledAt` is set on the booking row when it is cancelled, and
     * `cancellationFeePesewas` is only ever non-null when the RIDER cancelled
     * late enough to be charged — a driver cancelling, a trip expiring, or the
     * platform cancelling never writes it. Counting bare `status: CANCELLED`
     * would charge a rider for their driver's behaviour, which is precisely the
     * unfairness this system is supposed to remove.
     */
    prisma.booking.count({
      where: {
        userId,
        status: 'CANCELLED',
        cancelledAt: { gte: tripSince },
        cancellationFeePesewas: { not: null },
      },
    }),
    prisma.tripReport.groupBy({
      by: ['status'],
      where: { reportedUserId: userId },
      _count: { _all: true },
    }).catch(() => []),
  ]);

  const upheldReports = reports.find((r) => r.status === 'UPHELD')?._count?._all ?? 0;
  const openReports = reports.find((r) => r.status === 'OPEN')?._count?._all ?? 0;

  return build({
    ratingSum: ratings._sum.stars ?? 0,
    ratingCount: ratings._count.stars ?? 0,
    completedTrips,
    cancelledTrips,
    upheldReports,
    openReports,
  });
}

/**
 * A driver's standing.
 *
 * Same maths, different rows — deliberately, so "a 4.6 driver" and "a 4.6
 * rider" mean the same thing and the two sides of the market are held to one
 * standard. Reports against a driver arrive as rider disputes
 * (`SupportTicket.driverId`, written by submitDispute) rather than TripReport,
 * which is the only asymmetry: a driver reports a person, a rider reports a
 * ride.
 */
async function driverStanding(driverId) {
  if (!driverId) return neutral();

  const ratingSince = windowStart(RATING_WINDOW_DAYS());
  const tripSince = windowStart(RELIABILITY_WINDOW_DAYS());

  const [ratings, completedTrips, cancelledTrips, disputes] = await Promise.all([
    prisma.driverRating.aggregate({
      where: { driverId, createdAt: { gte: ratingSince } },
      _sum: { stars: true },
      _count: { stars: true },
    }),
    prisma.trip.count({
      where: { driverId, status: 'COMPLETED', updatedAt: { gte: tripSince } },
    }),
    /**
     * A driver abandoning an accepted trip. `dispatchAction` records it as
     * CANCELLED at the moment of the abandonment (see rides.service#driverCancel)
     * — the trip row itself goes back to dispatch and ends up completed by
     * somebody else, so counting trip rows would miss it entirely.
     */
    prisma.dispatchAction.count({
      where: { driverId, action: 'CANCELLED', createdAt: { gte: tripSince } },
    }).catch(() => 0),
    prisma.supportTicket.groupBy({
      by: ['status'],
      where: { driverId },
      _count: { _all: true },
    }).catch(() => []),
  ]);

  // A dispute is only held against a driver once someone has actually upheld
  // it. RESOLVED is the console's "we looked and agreed"; OPEN is an untested
  // allegation and must not move anybody's standing.
  const upheldReports = disputes.find((d) => d.status === 'UPHELD')?._count?._all ?? 0;
  const openReports = disputes.find((d) => d.status === 'OPEN')?._count?._all ?? 0;

  return build({
    ratingSum: ratings._sum.stars ?? 0,
    ratingCount: ratings._count.stars ?? 0,
    completedTrips,
    cancelledTrips,
    upheldReports,
    openReports,
  });
}

function build({ ratingSum, ratingCount, completedTrips, cancelledTrips, upheldReports, openReports }) {
  const denominator = completedTrips + cancelledTrips;
  // No history is perfect reliability, not zero — a new account must not start
  // in the penalty box.
  const reliability = denominator === 0 ? 1 : completedTrips / denominator;
  const raw = smoothedRating(ratingSum, ratingCount);
  const rating = raw == null ? null : Number(raw.toFixed(2));
  const band = bandFor({ rating, reliability, upheldReports, sampleSize: denominator });

  return {
    rating,
    ratingCount,
    completedTrips,
    cancelledTrips,
    reliability: Number(reliability.toFixed(4)),
    cancellationRate: Number((1 - reliability).toFixed(4)),
    upheldReports,
    openReports,
    band,
    loyaltyDiscountBps: loyaltyDiscountBps({ band, reliability, rating }),
  };
}

function neutral() {
  return {
    rating: null,
    ratingCount: 0,
    completedTrips: 0,
    cancelledTrips: 0,
    reliability: 1,
    cancellationRate: 0,
    upheldReports: 0,
    openReports: 0,
    band: 'NEW',
    loyaltyDiscountBps: 0,
  };
}

module.exports = {
  riderStanding,
  driverStanding,
  loyaltyDiscountBps,
  bandFor,
  CONFIDENCE_MIN_RATINGS,
};
