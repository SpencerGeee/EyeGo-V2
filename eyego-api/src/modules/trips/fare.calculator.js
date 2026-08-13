'use strict';

const env = require('../../config/env');
const settings = require('../../config/settings');
const { assertPesewas, percentOf } = require('../../utils/money');

/**
 * Every commercial number here is read through `settings.get()`, not straight off
 * `env`, so an admin can change a fare, the commission or the floor from the
 * console and the very next quote uses it — no deploy, no restart, no app-store
 * release. `settings.get()` is a synchronous cache read backed by the env value,
 * so this stays as cheap as it was and behaves identically when no override
 * exists. See src/config/settings.js.
 */
const cfg = (key) => {
  const value = settings.get(key);
  // Belt and braces: if a key were ever removed from the registry, fall back to
  // env rather than pricing a ride at `undefined`.
  return value === undefined ? env[key] : value;
};

/**
 * FARE IS COMPUTED IN INTEGER PESEWAS, END TO END.
 *
 * Every amount in and out of this file is an integer number of pesewas
 * (1 GH₵ = 100). Nothing here rounds to two decimals, because there are no
 * decimals: `Math.round` lands on a whole pesewa and that is the smallest unit
 * that exists. See ../../utils/money.js.
 *
 * The output keys carry the `Pesewas` suffix for the same reason the columns
 * do — a caller that was not updated gets `undefined` and fails loudly, rather
 * than reading a number that is silently 100× off.
 */

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
 * Pass `storedBaseFarePesewas` and `storedPerKmRatePesewas` (from
 * trip.baseFarePesewas / trip.perKmRatePesewas) when computing the fare for an
 * *existing* trip so that rates locked in at creation time are used — not
 * whatever the env currently says.
 */
function calculateFare({
  tier,
  distanceKm,
  seatCount,
  doorstepPickup = false,
  /**
   * Extra ROAD kilometres the driver drives to collect this rider from their own
   * point instead of the trip's pickup. Only meaningful with `doorstepPickup`.
   *
   * Absent/unmeasurable falls back to the flat surcharge — see
   * `doorstepFeePesewas` below.
   */
  doorstepDetourKm = null,
  heavyLoad = false,
  surgeMultiplier = 1.0,
  storedBaseFarePesewas,
  storedPerKmRatePesewas,
}) {
  const rates = {
    ECO: [cfg('ECO_BASE_FARE_PESEWAS'), cfg('ECO_PER_KM_RATE_PESEWAS')],
    COMFORT: [cfg('COMFORT_BASE_FARE_PESEWAS'), cfg('COMFORT_PER_KM_RATE_PESEWAS')],
    PREMIUM: [cfg('PREMIUM_BASE_FARE_PESEWAS'), cfg('PREMIUM_PER_KM_RATE_PESEWAS')],
  };
  // Normalize aliases (e.g. the driver app's 'ECONOMY' tier value) to the
  // canonical rate-table keys instead of silently falling back to ECO for
  // any unrecognized string, which masked tier mismatches.
  const normalizedTier = tier === 'COMFORT' ? 'COMFORT' : tier === 'PREMIUM' ? 'PREMIUM' : 'ECO';
  const [tierBaseFare, tierPerKmRate] = rates[normalizedTier];
  const baseFarePesewas = storedBaseFarePesewas != null ? storedBaseFarePesewas : tierBaseFare;
  const perKmRatePesewas = storedPerKmRatePesewas != null ? storedPerKmRatePesewas : tierPerKmRate;

  assertPesewas(baseFarePesewas, 'baseFarePesewas');
  assertPesewas(perKmRatePesewas, 'perKmRatePesewas');
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new Error(`distanceKm must be a non-negative number, got ${distanceKm}`);
  }

  /**
   * Door pickup, priced by the diversion it actually causes.
   *
   * One flat number charged the same for a 200 m nudge as for a 3 km detour —
   * overcharging the rider on the short one and paying the driver nothing for
   * the fuel and time on the long one. `max(min, km × rate)` keeps a floor
   * under trivial detours (the driver still stops, waits and pulls out again,
   * which costs something even at zero distance) while a real diversion scales.
   *
   * The flat surcharge survives as the fallback: when the detour cannot be
   * measured, pricing it at zero would be a free ride for the one option that
   * costs the driver most, and refusing the booking outright over a missing
   * route is worse than charging the old number.
   */
  const doorstepSurcharge = !doorstepPickup
    ? 0
    : Number.isFinite(doorstepDetourKm) && doorstepDetourKm >= 0
      ? Math.max(
          cfg('DOORSTEP_MIN_FEE_PESEWAS'),
          Math.round(cfg('DOORSTEP_PER_KM_PESEWAS') * doorstepDetourKm),
        )
      : cfg('DOORSTEP_SURCHARGE_PESEWAS');
  const heavyLoadSurcharge = heavyLoad ? cfg('HEAVY_LOAD_SURCHARGE_PESEWAS') : 0;

  // ── The whole pricing model, in two lines ────────────────────────────────
  // The TRIP costs what the distance says it costs; a SEAT costs that divided by
  // the seats the driver put on sale. Nothing else varies it, which is what makes
  // the same trip quote the same number in the driver app, the rider app, the
  // booking charge and the receipt.
  //
  // `perKmRatePesewas * distanceKm` is the one genuinely fractional term — distance is
  // a real measurement, not a currency — so it is rounded to the pesewa the
  // moment it becomes money and stays integral from there on.
  const distanceComponent = Math.round(perKmRatePesewas * distanceKm);
  const baseTripCostPesewas = Math.round((baseFarePesewas + distanceComponent) * surgeMultiplier);
  const seats = Math.max(Math.trunc(seatCount) || 1, 1);
  const farePerPersonPesewas = Math.round(baseTripCostPesewas / seats);

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
  const tierFloorMultiplier =
    cfg('ECO_BASE_FARE_PESEWAS') > 0 ? tierBaseFare / cfg('ECO_BASE_FARE_PESEWAS') : 1;
  const minFarePerSeatPesewas = Math.round(cfg('MIN_FARE_PER_SEAT_PESEWAS') * tierFloorMultiplier);
  /**
   * THE FLOOR APPLIES TO THE RIDE, NOT TO THE SURCHARGES.
   *
   * BUGFIX ("ticking heavy cargo doesn't add its price to the total"). The
   * surcharges used to be folded into the trip cost BEFORE the division and the
   * floor, so on a shared van they were divided by the seat count and then, when
   * the floor bound — which on a 12-seater it almost always does — thrown away
   * entirely by `Math.max`. A GH₵8 cargo charge spread over twelve seats is 67
   * pesewas per seat, far below the floor, so the floor won and the price did not
   * move by a single pesewa no matter how heavy the load.
   *
   * The floor exists to stop the DISTANCE component pricing a ride at nothing. It
   * has no business swallowing an explicit extra charge, so the extras are added
   * after it and the total is re-derived from the result.
   */
  const surchargePerSeatPesewas = Math.round((doorstepSurcharge + heavyLoadSurcharge) / seats);
  const finalFare = Math.max(farePerPersonPesewas, minFarePerSeatPesewas) + surchargePerSeatPesewas;

  // Commission is taken from the per-seat fare and the driver gets the
  // REMAINDER, not an independently-rounded 85%. Rounding both sides
  // separately can leave the two halves failing to add back up to the fare by
  // a pesewa, which is precisely how a ledger stops balancing.
  const commissionPerSeatPesewas = percentOf(finalFare, cfg('PLATFORM_COMMISSION'));

  return {
    // Re-derived from the (possibly floored) per-seat fare so the total shown to
    // the driver is always exactly seats × what each rider pays.
    totalTripCostPesewas: finalFare * seats,
    farePerPersonPesewas: finalFare,
    commissionPerSeatPesewas,
    driverEarningsPerSeatPesewas: finalFare - commissionPerSeatPesewas,
    // Echoed back so clients can show a breakdown without recomputing anything —
    // a client that recomputes is a client that can disagree.
    distanceKm: Math.round(distanceKm * 100) / 100,
    seatCount: seats,
    baseFarePesewas,
    perKmRatePesewas,
    surgeMultiplier,
    commissionRate: cfg('PLATFORM_COMMISSION'),
    minFarePerSeatPesewas,
    floorApplied: farePerPersonPesewas < minFarePerSeatPesewas,
    // The extras, as a per-seat figure, so a caller can show `finalFare` minus
    // this as the clean unit price without re-deriving either.
    surchargePerSeatPesewas,
    // Surfaced so the rider's price breakdown can name the extras instead of
    // showing a total that is larger than its own visible line items.
    doorstepSurchargePesewas: doorstepSurcharge,
    doorstepDetourKm: Number.isFinite(doorstepDetourKm) ? doorstepDetourKm : null,
    heavyLoadSurchargePesewas: heavyLoadSurcharge,
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
  storedBaseFarePesewas,
  storedPerKmRatePesewas,
  availableSeats = 4,
}) {
  return calculateFare({
    tier,
    distanceKm,
    seatCount: availableSeats,
    doorstepPickup,
    heavyLoad,
    surgeMultiplier,
    storedBaseFarePesewas,
    storedPerKmRatePesewas,
  });
}

/**
 * Calculate a discounted fare for a rider who boards en-route at a virtual stop.
 * The discount is proportional to the remaining distance from the stop to the
 * route's destination.
 *
 * @param {number} fullFarePerSeatPesewas - Full per-seat fare for the trip
 * @param {number} stopLat          - Virtual stop latitude
 * @param {number} stopLng          - Virtual stop longitude
 * @param {number} destLat          - Route destination latitude
 * @param {number} destLng          - Route destination longitude
 * @param {number} totalRouteKm     - Total route distance in km
 * @returns {{ farePerSeatPesewas: number, ratio: number }}
 */
function calculateEnRouteFare({
  fullFarePerSeatPesewas,
  stopLat,
  stopLng,
  destLat,
  destLng,
  totalRouteKm,
}) {
  assertPesewas(fullFarePerSeatPesewas, 'fullFarePerSeatPesewas');
  const remainingKm = haversineKm(stopLat, stopLng, destLat, destLng);
  const ratio = totalRouteKm > 0 ? Math.min(remainingKm / totalRouteKm, 1.0) : 1.0;
  return {
    farePerSeatPesewas: Math.round(fullFarePerSeatPesewas * ratio),
    // The ratio is stored alongside the fare so a receipt can explain the
    // discount; it is a proportion, not money, so it keeps its decimals.
    ratio: Math.round(ratio * 10000) / 10000,
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
function calculateDeviationSurcharge({
  extraKm,
  perKmRatePesewas,
  freeKm = cfg('FREE_DEVIATION_KM'),
}) {
  assertPesewas(perKmRatePesewas, 'perKmRatePesewas');
  if (!(extraKm > freeKm)) return 0;
  return Math.round((extraKm - freeKm) * perKmRatePesewas);
}

module.exports = { calculateFare, estimateFare, calculateEnRouteFare, haversineKm, detourKm, calculateDeviationSurcharge };
