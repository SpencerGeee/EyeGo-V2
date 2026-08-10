'use strict';

const prisma = require('../config/database');
const logger = require('../utils/logger');
const supply = require('./supply-index.service');
const { etaMatrix } = require('./eta.service');
const { availableDriverWhere } = require('./driver-availability');
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

const MAX_CANDIDATES = parseInt(process.env.DISPATCH_MAX_CANDIDATES, 10) || 8;
/** Drivers pulled from the geo index before eligibility filtering. */
const GEO_FETCH_LIMIT = parseInt(process.env.DISPATCH_GEO_FETCH_LIMIT, 10) || 60;
/** A driver more than this far out by road is not worth offering. */
const MAX_PICKUP_ETA_SECONDS = parseInt(process.env.DISPATCH_MAX_PICKUP_ETA_SECONDS, 10) || 1500;

/**
 * Eligible, ranked drivers for one pickup point.
 *
 * @returns {Promise<Array<{id, fcmToken, currentLat, currentLng, distanceKm,
 *                          etaSeconds, etaDegraded}>>}
 */
async function rankCandidates({ pickupLat, pickupLng, radiusKm, excludeDriverId = null, tier = null, trip = null }) {
  if (!Number.isFinite(pickupLat) || !Number.isFinite(pickupLng)) return [];

  // 1. Geo narrows.
  const nearby = await supply.nearbyDrivers(pickupLat, pickupLng, radiusKm, GEO_FETCH_LIMIT);
  if (nearby.length === 0) return [];

  const distanceById = new Map(nearby.map((n) => [n.driverId, n.distanceKm]));
  const ids = nearby.map((n) => n.driverId).filter((id) => id !== excludeDriverId);
  if (ids.length === 0) return [];

  // 2. Postgres decides. `availableDriverWhere` is the single eligibility
  //    source (approved + online + not busy) and stays that way — this is a
  //    filter over ids, never a new hand-rolled where clause.
  const eligible = await prisma.driver.findMany({
    where: availableDriverWhere({ ids, excludeId: excludeDriverId }),
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
  if (eligible.length === 0) return [];

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
    const withDestination = pool.filter((d) => destinationMode.headingTowards(d, trip));
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
    pool.map((d) => ({ driverId: d.id, lat: d.currentLat, lng: d.currentLng })),
  );

  return pool
    .map((d) => {
      const eta = etas.get(d.id);
      return {
        ...d,
        vehicleId: d.vehicles[0]?.id ?? null,
        distanceKm: distanceById.get(d.id) ?? null,
        etaSeconds: eta?.seconds ?? null,
        etaDegraded: eta?.degraded ?? true,
      };
    })
    // A driver with no computable ETA is kept, ranked last — missing telemetry
    // must never cost a rider their ride, but it should not win either.
    .filter((d) => d.etaSeconds == null || d.etaSeconds <= MAX_PICKUP_ETA_SECONDS)
    .sort((a, b) => (a.etaSeconds ?? Number.MAX_SAFE_INTEGER) - (b.etaSeconds ?? Number.MAX_SAFE_INTEGER))
    .slice(0, MAX_CANDIDATES);
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

module.exports = { rankCandidates, solve, MAX_CANDIDATES, MAX_PICKUP_ETA_SECONDS };
