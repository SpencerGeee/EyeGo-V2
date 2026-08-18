'use strict';

const prisma = require('../config/database');
const logger = require('../utils/logger');
const supply = require('./supply-index.service');
const { etaMatrix } = require('./eta.service');
const { availableDriverWhere, explainIneligible } = require('./driver-availability');
const { haversineMeters } = require('../utils/geo');
const destinationMode = require('./destination-mode.service');

/**
 * The matcher: given rides that need cars and cars that could take them,
 * decide who to offer what.
 *
 * DELIBERATELY BATCH-SHAPED. `solve(requests[], drivers[])` runs at batch size
 * one today — every request is dispatched the moment it arrives. It is written
 * as a batch anyway because every serious dispatch system converges on batching
 * (Lyft's ILP, DiDi's 2-second windows) and the refactor from "greedy per
 * request" to "optimise over a window" is a rewrite if the signature is
 * `matchOne(request)`, and a drop-in if it is `solve(requests, drivers)`.
 *
 * The current rule is greedy nearest-ETA-first with each driver claimable once
 * per batch. That is correct for batch=1 and is the right baseline for
 * anything better later.
 *
 * TWO-STAGE CANDIDATE LOOKUP. Redis GEO narrows to the cars actually near the
 * pickup; Postgres then confirms eligibility (approved, online, not already on
 * a trip) over that small set. Geo narrows, SQL decides. Neither is trusted to
 * do the other's job — which is the mistake the old code made in both
 * directions.
 */

// Read per call, not per process, so the console can retune dispatch without a
// restart. See src/config/settings.js.
const settings = require('../config/settings');
const maxCandidates = () => settings.get('DISPATCH_MAX_CANDIDATES') ?? 8;
/** Drivers pulled from the geo index before eligibility filtering. */
const GEO_FETCH_LIMIT = parseInt(process.env.DISPATCH_GEO_FETCH_LIMIT, 10) || 60;
/**
 * How stale `Driver.currentLat/Lng` may be and still be used to FIND a driver
 * when the geo index has nothing — see `coldPoolNearby`.
 *
 * Generous on purpose. That column is the cold copy, written at most every 15 s
 * or 60 m of movement, and it is only consulted on a path that would otherwise
 * dispatch to nobody at all. A position half an hour old makes for a poor ETA;
 * no position at all makes for a rider staring at a spinner while a driver sits
 * idle two streets away.
 */
const COLD_POSITION_MAX_AGE_MS = 30 * 60 * 1000;

/**
 * Eligible drivers near a pickup, found WITHOUT the geo index.
 *
 * Shaped exactly like `supply.nearbyDrivers(..., { withCoords: true })` so the
 * caller can splice it in and everything downstream is unchanged.
 */
async function coldPoolNearby({ pickupLat, pickupLng, radiusKm, excludeDriverId }) {
  const excluded = Array.isArray(excludeDriverId)
    ? excludeDriverId.filter(Boolean)
    : [excludeDriverId].filter(Boolean);
  try {
    const rows = await prisma.driver.findMany({
      // The SAME eligibility rule the geo path uses. This is a discovery
      // fallback, never a second set of rules — see driver-availability.js.
      where: {
        ...availableDriverWhere({ excludeId: excluded }),
        currentLat: { not: null },
        currentLng: { not: null },
        updatedAt: { gte: new Date(Date.now() - COLD_POSITION_MAX_AGE_MS) },
      },
      select: { id: true, currentLat: true, currentLng: true },
      // Bounded: this is a whole-table scan by definition (there is no spatial
      // index in Postgres here), and the radius filter below is what actually
      // decides. A fleet larger than this is a fleet whose Redis must be fixed.
      take: 500,
    });
    return rows
      .map((d) => ({
        driverId: d.id,
        lat: d.currentLat,
        lng: d.currentLng,
        distanceKm: haversineMeters(pickupLat, pickupLng, d.currentLat, d.currentLng) / 1000,
      }))
      .filter((d) => d.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, GEO_FETCH_LIMIT);
  } catch (err) {
    logger.warn(`coldPoolNearby failed: ${err.message}`);
    return [];
  }
}
const maxPickupEtaSeconds = () => settings.get('DISPATCH_MAX_PICKUP_ETA_SECONDS') ?? 1500;
/** A driver more than this far out by road is not worth offering. */


/**
 * Eligible, ranked drivers for one pickup point.
 *
 * @returns {Promise<Array<{id, fcmToken, currentLat, currentLng, distanceKm,
 *                          etaSeconds, etaDegraded}>>}
 */
async function rankCandidates({ tripId = null, pickupLat, pickupLng, radiusKm, excludeDriverId = null, tier = null, trip = null }) {
  /**
   * THE DISPATCH FUNNEL, WRITTEN DOWN.
   *
   * "The rider requested and no offer ever reached the driver phone" has now been
   * reported enough times to be treated as a logging defect as much as a logic
   * one: this function is where every candidate is lost, and it used to `return
   * []` from five different places without saying which. Every stage below
   * records its count and every drop records its reason, so the next occurrence
   * is answered from the log line instead of a guess.
   *
   * `logFunnel` is INFO on success and WARN when the funnel empties — an empty
   * funnel means a rider is watching a spinner, which is not routine.
   */
  const funnel = { tripId, radiusKm, tier: tier ?? null };
  const logFunnel = (stage, extra = {}) => {
    const line = { stage, ...funnel, ...extra };
    if (stage === 'ok' && (extra.candidates ?? 0) > 0) logger.info('Dispatch funnel', line);
    else logger.warn('Dispatch funnel — no candidates', line);
  };

  if (!Number.isFinite(pickupLat) || !Number.isFinite(pickupLng)) {
    logFunnel('bad_pickup_coords', { pickupLat, pickupLng });
    return [];
  }

  // 1. Geo narrows.
  //
  // `withCoords` is not cosmetic. Everything downstream — the pickup ETA, the
  // driver pin the rider watches during dispatch — used `Driver.currentLat/Lng`
  // from Postgres, and that column is written at most every 15 s or 60 m of
  // movement (see sockets/driver.socket.js DB_PERSIST_*), deliberately, because
  // it is the COLD copy. The geo index is written on every single fix. Ranking a
  // driver by a position up to a minute old, while holding their live one in
  // hand, is the "the location dispatch uses is inaccurate" complaint.
  let nearby = await supply.nearbyDrivers(pickupLat, pickupLng, radiusKm, GEO_FETCH_LIMIT, {
    withCoords: true,
  });
  if (nearby.length === 0) {
    // The supply index is what dispatch searches, and an empty answer has two
    // very different causes. `poolSize` separates them: 0 means nothing is
    // pinging at all (driver app not emitting `driver:location_update`, or every
    // presence key expired), non-zero means drivers ARE live but none within
    // `radiusKm` of this pickup.
    const poolSize = await supply.poolSize();
    logFunnel('geo_empty', { poolSize, pickupLat, pickupLng });

    /**
     * THE COLD POOL — REDIS IS NOT ALLOWED TO BE A SINGLE POINT OF FAILURE.
     *
     * BUGFIX ("when i order a ride on the rider app it doesn't show the
     * dispatch on the driver app"), and the last unexplained shape of a report
     * that has come back across several sweeps.
     *
     * The geo index was the ONLY door into dispatch. It is a Redis geo-set fed
     * by `driver:location_update` and guarded by a 90-second presence key, so
     * every one of these empties it while Postgres still holds an ACTIVE,
     * online, unbusy driver with a usable position:
     *
     *   - Redis restarted, failed over, or was flushed — the set is not durable;
     *   - the driver's socket dropped and has not re-emitted a fix, so the
     *     presence key aged out while their app still says "Online";
     *   - background location was denied or throttled by the OS, so the app
     *     emits nothing at all — a state that persists for a whole shift;
     *   - the driver went online over REST and no fix has landed yet.
     *
     * In every one of those the funnel logged `geo_empty`, returned nothing,
     * and the rider watched "no drivers available" with a driver idle nearby.
     *
     * So an empty index is now a reason to ask the database, not a reason to
     * give up. This widens DISCOVERY only: `availableDriverWhere` is still the
     * single eligibility rule and is applied below exactly as it is for a geo
     * hit, so nothing ineligible can enter through here. It also stays LOUD —
     * falling back means the supply index is broken, and that is worth fixing
     * even though the ride now goes out.
     */
    const cold = await coldPoolNearby({ pickupLat, pickupLng, radiusKm, excludeDriverId });
    if (cold.length === 0) return [];
    logger.warn('Dispatch fell back to cold positions — the supply index is empty', {
      tripId,
      poolSize,
      found: cold.length,
      radiusKm,
    });
    nearby = cold;
  }

  const distanceById = new Map(nearby.map((n) => [n.driverId, n.distanceKm]));
  // Live position per driver, straight from the index that answered the search.
  const livePosById = new Map(
    nearby
      .filter((n) => Number.isFinite(n.lat) && Number.isFinite(n.lng))
      .map((n) => [n.driverId, { lat: n.lat, lng: n.lng }]),
  );
  // The live fix wins; the DB column is the fallback for a driver the index
  // somehow has no coordinate for.
  const posFor = (d) => livePosById.get(d.id) ?? { lat: d.currentLat, lng: d.currentLng };
  // One or many. A redispatched trip excludes EVERY driver who has abandoned
  // it, so this accepts an array as well as a bare id.
  const excluded = new Set(
    (Array.isArray(excludeDriverId) ? excludeDriverId : [excludeDriverId]).filter(Boolean),
  );
  const ids = nearby.map((n) => n.driverId).filter((id) => !excluded.has(id));
  if (ids.length === 0) {
    logFunnel('only_excluded_driver_nearby', { geo: nearby.length, excluded: [...excluded] });
    return [];
  }

  // 2. Postgres decides. `availableDriverWhere` is the single eligibility
  //    source (approved + online + not busy) and stays that way — this is a
  //    filter over ids, never a new hand-rolled where clause.
  const eligible = await prisma.driver.findMany({
    where: availableDriverWhere({ ids, excludeId: [...excluded] }),
    select: {
      id: true,
      fcmToken: true,
      currentLat: true,
      currentLng: true,
      destinationLat: true,
      destinationLng: true,
      destinationExpiresAt: true,
      vehicles: { where: { isActive: true, isVerified: true }, select: { id: true, tier: true, seaterCount: true } },
    },
  });

  // Anything the geo index offered that Postgres rejected, with the reason. This
  // is the query that answers "there is a driver online right on top of me, why
  // did nobody get the offer" — the answer is almost always one of four things
  // and `explainIneligible` names which.
  if (eligible.length < ids.length) {
    const dropped = await explainIneligible(
      prisma,
      ids.filter((id) => !eligible.some((d) => d.id === id)),
    ).catch(() => []);
    logger.info('Dispatch dropped ineligible drivers', { tripId, dropped });
  }
  if (eligible.length === 0) {
    logFunnel('none_eligible', { geo: nearby.length, considered: ids.length });
    return [];
  }

  const tierMatched = tier
    ? eligible.filter((d) => d.vehicles.some((v) => v.tier === tier))
    : eligible;
  // A tier with no cars must not mean no ride at all; fall back to any car and
  // let pricing sort it out rather than showing "no drivers available".
  let pool = tierMatched.length > 0 ? tierMatched : eligible;

  // 2b. DESTINATION MODE. A driver heading home only wants rides that get them
  //     closer to it. Drivers with no destination set are unaffected — the
  //     predicate returns true for them — so this narrows nothing in the
  //     ordinary case.
  //
  //     Applied AFTER the tier fallback and BEFORE the ETA matrix, so a
  //     filtered-out driver never costs a Directions call. If it would empty
  //     the pool entirely, it is dropped: one driver's preference must not turn
  //     into a rider seeing "no drivers available" when there plainly are some.
  if (trip) {
    // Judged from the LIVE position too — "am I heading towards my destination"
    // answered from a minute-old fix is how a driver gets sent the wrong way.
    const withDestination = pool.filter((d) => {
      const pos = posFor(d);
      return destinationMode.headingTowards(
        { ...d, currentLat: pos.lat, currentLng: pos.lng },
        trip,
      );
    });
    if (withDestination.length > 0) {
      if (withDestination.length !== pool.length) {
        logger.info('Destination mode filtered candidates', {
          tripId: trip.id, from: pool.length, to: withDestination.length,
        });
      }
      pool = withDestination;
    }
  }

  // 3. Rank by ROAD ETA, not straight-line distance.
  const etas = await etaMatrix(
    { lat: pickupLat, lng: pickupLng },
    pool.map((d) => ({ driverId: d.id, ...posFor(d) })),
  );

  const ranked = pool
    .map((d) => {
      const eta = etas.get(d.id);
      const pos = posFor(d);
      return {
        ...d,
        // Overwrites the Postgres columns on the candidate object on purpose:
        // dispatch-cascade puts these straight into the rider's DISPATCH_PROGRESS
        // payload as the offered driver's pin, so the pin now sits where the car
        // actually is rather than where it last happened to be persisted.
        currentLat: pos.lat,
        currentLng: pos.lng,
        vehicleId: d.vehicles[0]?.id ?? null,
        distanceKm: distanceById.get(d.id) ?? null,
        etaSeconds: eta?.seconds ?? null,
        etaDegraded: eta?.degraded ?? true,
      };
    })
    // A driver with no computable ETA is kept, ranked last — missing telemetry
    // must never cost a rider their ride, but it should not win either.
    .filter((d) => d.etaSeconds == null || d.etaSeconds <= maxPickupEtaSeconds())
    .sort((a, b) => (a.etaSeconds ?? Number.MAX_SAFE_INTEGER) - (b.etaSeconds ?? Number.MAX_SAFE_INTEGER))
    .slice(0, maxCandidates());

  logFunnel('ok', {
    geo: nearby.length,
    eligible: eligible.length,
    afterTier: tierMatched.length,
    afterDestinationMode: pool.length,
    candidates: ranked.length,
    // The whole point of ranking by road ETA — if this is empty while `pool`
    // is not, everyone in range was further out than MAX_PICKUP_ETA_SECONDS.
    nearestEtaSeconds: ranked[0]?.etaSeconds ?? null,
    etaDegraded: ranked[0]?.etaDegraded ?? null,
  });

  return ranked;
}

/**
 * Assign candidate lists to a batch of requests.
 *
 * @param {Array<{tripId, pickupLat, pickupLng, radiusKm, tier, excludeDriverId}>} requests
 * @returns {Promise<Map<string, Array>>} tripId → ranked candidates
 */
async function solve(requests, { allowDriverReuse = false } = {}) {
  const result = new Map();
  const claimed = new Set();

  // Oldest-waiting first. With batch=1 this is a no-op; with a real window it
  // is the fairness rule that stops a rider being starved by newer requests.
  const ordered = [...requests].sort((a, b) => (a.waitingSince ?? 0) - (b.waitingSince ?? 0));

  for (const req of ordered) {
    let candidates = await rankCandidates(req).catch((err) => {
      logger.warn(`rankCandidates failed for ${req.tripId}: ${err.message}`);
      return [];
    });
    if (!allowDriverReuse) {
      candidates = candidates.filter((c) => !claimed.has(c.id));
      // Only the head of the list is reserved: the tail is a fallback chain
      // that only gets used if the head declines, by which point the other
      // request has resolved anyway.
      if (candidates[0]) claimed.add(candidates[0].id);
    }
    result.set(req.tripId, candidates);
  }
  return result;
}

// Exported as functions: these are runtime-tunable now, so a caller that
// captured the number would be holding a value an admin has since changed.
module.exports = { rankCandidates, solve, maxCandidates, maxPickupEtaSeconds };
