'use strict';

const env = require('../../config/env');

/**
 * Haversine distance between two lat/lng points in kilometres.
 * Exported so other modules can reuse it without re-implementing.
 */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Calculate fare for a trip.
 * All fare logic is server-side to prevent tampering.
 *
 * `seatCount` is the number of seats the driver made available for this trip
 * (trip.maxSeats).  Dividing by this fixed value keeps the per-person price
 * stable regardless of how many seats have been booked so far.
 *
 * Pass `storedBaseFare` and `storedPerKmRate` (from trip.baseFare / trip.perKmRate)
 * when computing the fare for an *existing* trip so that rates locked in at
 * creation time are used — not whatever the env currently says.
 */
function calculateFare({
  tier,
  distanceKm,
  seatCount,
  doorstepPickup = false,
  heavyLoad = false,
  surgeMultiplier = 1.0,
  storedBaseFare,
  storedPerKmRate,
}) {
  const rates = {
    ECO: [env.ECO_BASE_FARE, env.ECO_PER_KM_RATE],
    COMFORT: [env.COMFORT_BASE_FARE, env.COMFORT_PER_KM_RATE],
    PREMIUM: [env.PREMIUM_BASE_FARE, env.PREMIUM_PER_KM_RATE],
  };
  // Normalize aliases (e.g. the driver app's 'ECONOMY' tier value) to the
  // canonical rate-table keys instead of silently falling back to ECO for
  // any unrecognized string, which masked tier mismatches.
  const normalizedTier = tier === 'COMFORT' ? 'COMFORT' : tier === 'PREMIUM' ? 'PREMIUM' : 'ECO';
  const [tierBaseFare, tierPerKmRate] = rates[normalizedTier];
  const baseFare = storedBaseFare != null ? storedBaseFare : tierBaseFare;
  const perKmRate = storedPerKmRate != null ? storedPerKmRate : tierPerKmRate;

  const doorstepSurcharge = doorstepPickup ? env.DOORSTEP_SURCHARGE : 0;
  const heavyLoadSurcharge = heavyLoad ? env.HEAVY_LOAD_SURCHARGE : 0;

  // ── The whole pricing model, in two lines ────────────────────────────────
  // The TRIP costs what the distance says it costs; a SEAT costs that divided by
  // the seats the driver put on sale. Nothing else varies it, which is what makes
  // the same trip quote the same number in the driver app, the rider app, the
  // booking charge and the receipt.
  const totalTripCost = (baseFare + perKmRate * distanceKm) * surgeMultiplier + doorstepSurcharge + heavyLoadSurcharge;
  const seats = Math.max(seatCount, 1);
  const farePerPerson = totalTripCost / seats;

  // Floor: one small platform-wide minimum, NOT the tier's base fare.
  //
  // Tying the floor to `tierBaseFare` (the previous behaviour) quietly broke the
  // model above: on a shared 14-seater almost every urban trip lands under the
  // tier base once divided by the seats, so the floor — not the distance — set
  // the price, and two trips of very different lengths cost exactly the same. It
  // is also how a ~₵350 trip over 8 seats stopped reading as ₵43.75/seat.
  // The floor is scaled by the tier's own position in the rate table (ECO's base
  // fare is the unit), so ECO < COMFORT < PREMIUM still holds on the short trips
  // where the floor binds — without the floor being large enough to flatten the
  // distance component the way `tierBaseFare` did.
  const tierFloorMultiplier = env.ECO_BASE_FARE > 0 ? tierBaseFare / env.ECO_BASE_FARE : 1;
  const minFarePerSeat = round(env.MIN_FARE_PER_SEAT * tierFloorMultiplier);
  const finalFare = Math.max(farePerPerson, minFarePerSeat);

  return {
    // Re-derived from the (possibly floored) per-seat fare so the total shown to
    // the driver is always exactly seats × what each rider pays.
    totalTripCost: round(finalFare * seats),
    farePerPerson: round(finalFare),
    commissionPerSeat: round(finalFare * env.PLATFORM_COMMISSION),
    driverEarningsPerSeat: round(finalFare * (1 - env.PLATFORM_COMMISSION)),
    // Echoed back so clients can show a breakdown without recomputing anything —
    // a client that recomputes is a client that can disagree.
    distanceKm: round(distanceKm),
    seatCount: seats,
    baseFare,
    perKmRate,
    surgeMultiplier,
    commissionRate: env.PLATFORM_COMMISSION,
    minFarePerSeat,
    floorApplied: farePerPerson < minFarePerSeat,
  };
}

/**
 * Estimate fare for display purposes (e.g. search results, trip creation preview).
 * Uses the driver-set seat count as the denominator so the displayed price
 * matches exactly what a rider will be charged when they book.
 */
function estimateFare({
  tier,
  distanceKm,
  doorstepPickup = false,
  heavyLoad = false,
  surgeMultiplier = 1.0,
  storedBaseFare,
  storedPerKmRate,
  availableSeats = 4,
}) {
  return calculateFare({
    tier,
    distanceKm,
    seatCount: availableSeats,
    doorstepPickup,
    heavyLoad,
    surgeMultiplier,
    storedBaseFare,
    storedPerKmRate,
  });
}

/**
 * Calculate a discounted fare for a rider who boards en-route at a virtual stop.
 * The discount is proportional to the remaining distance from the stop to the
 * route's destination.
 *
 * @param {number} fullFarePerSeat  - Full per-seat fare for the trip
 * @param {number} stopLat          - Virtual stop latitude
 * @param {number} stopLng          - Virtual stop longitude
 * @param {number} destLat          - Route destination latitude
 * @param {number} destLng          - Route destination longitude
 * @param {number} totalRouteKm     - Total route distance in km
 * @returns {{ farePerSeat: number, ratio: number }}
 */
function calculateEnRouteFare({ fullFarePerSeat, stopLat, stopLng, destLat, destLng, totalRouteKm }) {
  const remainingKm = haversineKm(stopLat, stopLng, destLat, destLng);
  const ratio = totalRouteKm > 0 ? Math.min(remainingKm / totalRouteKm, 1.0) : 1.0;
  return {
    farePerSeat: round(fullFarePerSeat * ratio),
    ratio: round(ratio),
  };
}

// Distance (km) a driver has to add to their route to divert through `viaLat/viaLng`
// on the way from `fromLat/fromLng` to `toLat/toLng` — the standard "insert a waypoint"
// detour cost: distance via the waypoint minus the direct distance.
function detourKm({ fromLat, fromLng, viaLat, viaLng, toLat, toLng }) {
  const viaDistance = haversineKm(fromLat, fromLng, viaLat, viaLng) + haversineKm(viaLat, viaLng, toLat, toLng);
  const directDistance = haversineKm(fromLat, fromLng, toLat, toLng);
  return Math.max(0, viaDistance - directDistance);
}

/**
 * Surcharge for a group-hub joiner whose own pickup point isn't the trip's main
 * pickup (e.g. friends booked via invite link scattered across town). Free for
 * small, reasonable detours — only a genuinely large diversion adds to the fare.
 */
function calculateDeviationSurcharge({ extraKm, perKmRate, freeKm = env.FREE_DEVIATION_KM }) {
  if (extraKm <= freeKm) return 0;
  return round((extraKm - freeKm) * perKmRate);
}

function round(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { calculateFare, estimateFare, calculateEnRouteFare, haversineKm, detourKm, calculateDeviationSurcharge };
