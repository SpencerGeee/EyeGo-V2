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
  const [tierBaseFare, tierPerKmRate] = rates[tier] ?? rates.ECO;
  const baseFare = storedBaseFare != null ? storedBaseFare : tierBaseFare;
  const perKmRate = storedPerKmRate != null ? storedPerKmRate : tierPerKmRate;

  const doorstepSurcharge = doorstepPickup ? env.DOORSTEP_SURCHARGE : 0;
  const heavyLoadSurcharge = heavyLoad ? env.HEAVY_LOAD_SURCHARGE : 0;

  const totalTripCost = (baseFare + perKmRate * distanceKm) * surgeMultiplier + doorstepSurcharge + heavyLoadSurcharge;
  const seats = Math.max(seatCount, 1);

  const farePerPerson = totalTripCost / seats;

  // Minimum viable fare floor: never charge less than 5 GHS per seat.
  // This prevents sub-economic pricing when env variables are misconfigured
  // or when distance is extremely short.
  const MIN_FARE_PER_PERSON = 5.0;
  const finalFare = Math.max(farePerPerson, MIN_FARE_PER_PERSON);

  return {
    totalTripCost: round(finalFare * seats), // re-derive from floor fare
    farePerPerson: round(finalFare),
    commissionPerSeat: round(finalFare * env.PLATFORM_COMMISSION),
    driverEarningsPerSeat: round(finalFare * (1 - env.PLATFORM_COMMISSION)),
    baseFare,
    perKmRate,
    surgeMultiplier,
    commissionRate: env.PLATFORM_COMMISSION,
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

function round(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { calculateFare, estimateFare, calculateEnRouteFare, haversineKm };
