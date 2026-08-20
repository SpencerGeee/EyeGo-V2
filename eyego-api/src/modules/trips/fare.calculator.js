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
/**
 * ── GROUP / SHARED PRICING ────────────────────────────────
 *
 * THE SAME CARD AS AN ON-DEMAND RIDE, PAID BY A PARTY INSTEAD OF A PERSON.
 *
 * This used to be a two-part model of its own — a flat tier base plus a per-km
 * rate for the whole vehicle, divided by the seats on sale — while on-demand
 * moved to the operator's five-part card. Two cards meant two answers: the same
 * road, the same car and the same driver priced differently depending on which
 * screen the rider came in through, and only one of them had a time component,
 * so on the group side a crawl through Accra traffic cost what a clear run cost.
 *
 * So the metered ride is now computed EXACTLY as calculateRideFare computes
 * it — same tier start, per-km, per-minute, wait-per-minute, same surge, same
 * minimum, same extras-after-the-floor rule — and only then does the group part
 * begin:
 *
 *   vehicle = the on-demand ride fare for this journey
 *   vehicle = vehicle × (1 + uplift × (seats - 1))     ← sub-linear in party size
 *   seat    = max(vehicle / seats, group seat minimum)
 *   seat   += booking fee (% of seat) + platform fee (flat, per booking)
 *
 * WHY THE UPLIFT, AND WHY IT IS SUB-LINEAR. A second passenger in the same car
 * costs the driver almost nothing extra, so charging them a second full fare
 * would be indefensible. But dividing ONE fare by six would hand the driver the
 * same money for a fuller, slower, harder trip, which is how a shared product
 * quietly becomes the one no driver wants. At the default 0.35:
 *
 *   seats  vehicle ×   each rider pays   driver receives
 *     1       1.00      1.00 × solo        1.00 × solo    ← identical to on-demand
 *     2       1.35      0.68 × solo        1.35 × solo
 *     4       2.05      0.51 × solo        2.05 × solo
 *     6       2.75      0.46 × solo        2.75 × solo
 *
 * — so a group is meaningfully cheaper per head than riding alone, the trip is
 * worth more to the driver the fuller it is, and a party of one is priced by
 * precisely the same arithmetic as hailing a car. The rate card itself is not
 * discounted anywhere: the tier minimum, the booking fee and the platform fee
 * are the on-demand ones, which is what keeps the two products comparable.
 *
 * The fee treatment matches on-demand for the reasons written up there: the
 * minimum floors the RIDE (not the fees), extras are added after the floor so
 * ticking "heavy cargo" always moves the price, and commission comes off the
 * ride only so the platform never commissions its own fees.
 */
function calculateFare({
  tier,
  distanceKm,
  seatCount,
  /** Road duration from the routing engine. Absent = priced on distance alone,
   *  which under-charges rather than inventing minutes nobody sat through. */
  durationMin = 0,
  /** Minutes waited at the pickup past the free allowance. */
  waitMin = 0,
  doorstepPickup = false,
  /**
   * Extra ROAD kilometres the driver drives to collect this rider from their own
   * point instead of the trip's pickup. Only meaningful with doorstepPickup.
   * Absent/unmeasurable falls back to the flat surcharge.
   */
  doorstepDetourKm = null,
  heavyLoad = false,
  surgeMultiplier = 1.0,
  /**
   * PRICE LOCK. A trip that has already been created keeps the rates it was
   * created with, so a live booking cannot be re-priced by an operator retuning
   * the card mid-trip. They map onto the card's first two terms — the start
   * fare and the per-km rate — which is what those columns have always held.
   */
  storedBaseFarePesewas,
  storedPerKmRatePesewas,
}) {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new Error(`distanceKm must be a non-negative number, got ${distanceKm}`);
  }

  const card = RIDE_CARD[normalizeTier(tier)];
  const startPesewas = storedBaseFarePesewas != null ? storedBaseFarePesewas : cfg(card.start);
  const perKmPesewas = storedPerKmRatePesewas != null ? storedPerKmRatePesewas : cfg(card.perKm);
  const perMinPesewas = cfg(card.perMin);
  const waitPerMinPesewas = cfg(card.waitPerMin);
  const minFarePesewas = cfg(card.min);
  assertPesewas(startPesewas, 'startPesewas');
  assertPesewas(perKmPesewas, 'perKmPesewas');
  assertPesewas(perMinPesewas, 'perMinPesewas');
  assertPesewas(waitPerMinPesewas, 'waitPerMinPesewas');
  assertPesewas(minFarePesewas, 'minFarePesewas');

  const minutes = Number.isFinite(durationMin) && durationMin > 0 ? durationMin : 0;
  const waiting = Number.isFinite(waitMin) && waitMin > 0 ? waitMin : 0;
  const seats = Math.max(Math.trunc(seatCount) || 1, 1);

  const distanceComponentPesewas = Math.round(perKmPesewas * distanceKm);
  const timeComponentPesewas = Math.round(perMinPesewas * minutes);
  const waitComponentPesewas = Math.round(waitPerMinPesewas * waiting);

  const metered =
    startPesewas + distanceComponentPesewas + timeComponentPesewas + waitComponentPesewas;
  const surged = Math.round(metered * surgeMultiplier);
  const flooredRidePesewas = Math.max(surged, minFarePesewas);

  /**
   * Door pickup, priced by the diversion it actually causes.
   *
   * One flat number charged the same for a 200 m nudge as for a 3 km detour —
   * overcharging the rider on the short one and paying the driver nothing for
   * the fuel and time on the long one. max(min, km × rate) keeps a floor under
   * trivial detours (the driver still stops, waits and pulls out again, which
   * costs something even at zero distance) while a real diversion scales.
   *
   * The flat surcharge survives as the fallback: when the detour cannot be
   * measured, pricing it at zero would be a free ride for the one option that
   * costs the driver most.
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

  // The whole-vehicle ride, extras included — the same figure an on-demand
  // rider would pay for this journey before fees.
  const soloRidePesewas = flooredRidePesewas + doorstepSurcharge + heavyLoadSurcharge;

  const uplift = Math.max(cfg('RIDE_GROUP_SEAT_UPLIFT') ?? 0, 0);
  const groupMultiplier = 1 + uplift * (seats - 1);
  const vehicleRidePesewas = Math.round(soloRidePesewas * groupMultiplier);

  // A seat is never worth less than this, however large the van. Without it a
  // short hop on a fifteen-seater divides down to a few pesewas a head.
  const groupMinPerSeatPesewas = seats > 1 ? cfg('RIDE_GROUP_MIN_FARE_PER_SEAT_PESEWAS') : 0;
  const ridePerSeatPesewas = Math.max(
    Math.round(vehicleRidePesewas / seats),
    groupMinPerSeatPesewas,
  );

  // Fees are per BOOKING, exactly as on-demand: each rider is buying their own
  // seat, so each pays the booking percentage on their own share and the flat
  // platform fee once.
  const bookingFeeRate = cfg('RIDE_BOOKING_FEE_RATE');
  const bookingFeePesewas = percentOf(ridePerSeatPesewas, bookingFeeRate);
  const platformFeePesewas = cfg('RIDE_PLATFORM_FEE_PESEWAS');
  assertPesewas(platformFeePesewas, 'platformFeePesewas');

  const finalFare = ridePerSeatPesewas + bookingFeePesewas + platformFeePesewas;

  // Commission is taken from the per-seat RIDE and the driver gets the
  // REMAINDER, not an independently-rounded 85%. Rounding both sides separately
  // can leave the two halves failing to add back up, which is precisely how a
  // ledger stops balancing. The fees are the platform's own revenue and are not
  // commissioned again.
  const commissionPerSeatPesewas = percentOf(ridePerSeatPesewas, cfg('PLATFORM_COMMISSION'));

  return {
    // Re-derived from the per-seat fare so the total shown to the driver is
    // always exactly seats × what each rider pays.
    totalTripCostPesewas: finalFare * seats,
    farePerPersonPesewas: finalFare,
    commissionPerSeatPesewas,
    driverEarningsPerSeatPesewas: ridePerSeatPesewas - commissionPerSeatPesewas,

    // ── The breakdown, so no client has to recompute anything ──
    ridePesewas: ridePerSeatPesewas,
    startFarePesewas: startPesewas,
    distanceComponentPesewas,
    timeComponentPesewas,
    waitComponentPesewas,
    bookingFeePesewas,
    bookingFeeRate,
    platformFeePesewas,
    minFarePesewas,
    floorApplied: surged < minFarePesewas,
    groupMultiplier,
    groupSeatUplift: uplift,
    /** What one of these riders would have paid alone — the saving, made visible. */
    soloRidePesewas,

    // ── Echoed inputs and the legacy keys callers still read ──
    distanceKm: Math.round(distanceKm * 100) / 100,
    durationMin: Math.round(minutes * 10) / 10,
    waitMin: Math.round(waiting * 10) / 10,
    seatCount: seats,
    baseFarePesewas: startPesewas,
    perKmRatePesewas: perKmPesewas,
    surgeMultiplier,
    commissionRate: cfg('PLATFORM_COMMISSION'),
    minFarePerSeatPesewas: groupMinPerSeatPesewas,
    surchargePerSeatPesewas: Math.round((doorstepSurcharge + heavyLoadSurcharge) / seats),
    doorstepSurchargePesewas: doorstepSurcharge,
    doorstepDetourKm: Number.isFinite(doorstepDetourKm) ? doorstepDetourKm : null,
    heavyLoadSurchargePesewas: heavyLoadSurcharge,
  };
}

/**
 * ── ON-DEMAND PRICING ───────────────────────────────────────────────────────
 *
 * `calculateFare` above prices a SHARED trip: a whole minibus, divided by the
 * seats on sale. An on-demand ride is one rider hiring one car, and it is
 * quoted with `seatCount: 1`, so it was landing the vehicle rate (₵30 start,
 * ₵11/km) on a single passenger — a two-part card that has no time component at
 * all, so a 4 km crawl through Accra traffic and a 4 km clear run cost the same.
 *
 * This is the operator's on-demand card, and it is the standard five-part one:
 *
 *   ride   = start + per-km × km + per-min × minutes + wait/min × waiting
 *   ride   = ride × surge
 *   ride   = max(ride, tier minimum)          ← the "minimum price"
 *   ride  += door pickup + heavy cargo        ← extras, never eaten by the floor
 *   total  = ride + booking fee (% of ride) + platform fee (flat)
 *
 * ORDER MATTERS, and each step is deliberate:
 *
 *  - The MINIMUM is a floor on the RIDE, applied before the fees. A minimum
 *    that included the fees would mean the operator's "₵20 minimum" was really
 *    ₵18.13 of ride, and the tier cards would stop reading as what they say.
 *  - EXTRAS are added after the floor for exactly the reason documented in
 *    `calculateFare`: a floor that swallows an explicit surcharge makes ticking
 *    "heavy cargo" change the price by nothing.
 *  - The BOOKING FEE is a percentage of what the ride actually came to, extras
 *    included, which is what a percentage fee means everywhere else.
 *  - COMMISSION is taken from the ride, NOT from the fees. The booking fee and
 *    the platform fee are the platform's own revenue; taking a further 15% of
 *    them would be the platform commissioning itself, and it would quietly make
 *    the driver's share of a ride smaller every time a fee went up.
 */
const RIDE_CARD = {
  ECO: {
    min: 'RIDE_ECO_MIN_FARE_PESEWAS',
    start: 'RIDE_ECO_START_FARE_PESEWAS',
    perKm: 'RIDE_ECO_PER_KM_PESEWAS',
    perMin: 'RIDE_ECO_PER_MIN_PESEWAS',
    waitPerMin: 'RIDE_ECO_WAIT_PER_MIN_PESEWAS',
  },
  COMFORT: {
    min: 'RIDE_COMFORT_MIN_FARE_PESEWAS',
    start: 'RIDE_COMFORT_START_FARE_PESEWAS',
    perKm: 'RIDE_COMFORT_PER_KM_PESEWAS',
    perMin: 'RIDE_COMFORT_PER_MIN_PESEWAS',
    waitPerMin: 'RIDE_COMFORT_WAIT_PER_MIN_PESEWAS',
  },
  PREMIUM: {
    min: 'RIDE_PREMIUM_MIN_FARE_PESEWAS',
    start: 'RIDE_PREMIUM_START_FARE_PESEWAS',
    perKm: 'RIDE_PREMIUM_PER_KM_PESEWAS',
    perMin: 'RIDE_PREMIUM_PER_MIN_PESEWAS',
    waitPerMin: 'RIDE_PREMIUM_WAIT_PER_MIN_PESEWAS',
  },
};

/** The driver app sends 'ECONOMY'; the wire value is 'ECO'. Anything else is ECO. */
function normalizeTier(tier) {
  if (tier === 'COMFORT') return 'COMFORT';
  if (tier === 'PREMIUM') return 'PREMIUM';
  return 'ECO';
}

function calculateRideFare({
  tier,
  distanceKm,
  /** Road duration from the routing engine. Absent = priced on distance alone,
   *  which under-charges rather than inventing minutes the rider did not sit. */
  durationMin = 0,
  /** Minutes the driver waited at the pickup past the free allowance. Zero at
   *  quote time — this is what the trip's final reconciliation charges. */
  waitMin = 0,
  doorstepPickup = false,
  doorstepDetourKm = null,
  heavyLoad = false,
  surgeMultiplier = 1.0,
}) {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new Error(`distanceKm must be a non-negative number, got ${distanceKm}`);
  }
  const card = RIDE_CARD[normalizeTier(tier)];
  const startPesewas = cfg(card.start);
  const perKmPesewas = cfg(card.perKm);
  const perMinPesewas = cfg(card.perMin);
  const waitPerMinPesewas = cfg(card.waitPerMin);
  const minFarePesewas = cfg(card.min);
  assertPesewas(startPesewas, 'startPesewas');
  assertPesewas(perKmPesewas, 'perKmPesewas');
  assertPesewas(perMinPesewas, 'perMinPesewas');
  assertPesewas(waitPerMinPesewas, 'waitPerMinPesewas');
  assertPesewas(minFarePesewas, 'minFarePesewas');

  const minutes = Number.isFinite(durationMin) && durationMin > 0 ? durationMin : 0;
  const waiting = Number.isFinite(waitMin) && waitMin > 0 ? waitMin : 0;

  const distanceComponentPesewas = Math.round(perKmPesewas * distanceKm);
  const timeComponentPesewas = Math.round(perMinPesewas * minutes);
  const waitComponentPesewas = Math.round(waitPerMinPesewas * waiting);

  const metered =
    startPesewas + distanceComponentPesewas + timeComponentPesewas + waitComponentPesewas;
  const surged = Math.round(metered * surgeMultiplier);
  const flooredRidePesewas = Math.max(surged, minFarePesewas);

  // Same shape as `calculateFare` — a measured detour is priced by the km it
  // actually costs, and the flat figure is the fallback for an unmeasurable one.
  const doorstepSurchargePesewas = !doorstepPickup
    ? 0
    : Number.isFinite(doorstepDetourKm) && doorstepDetourKm >= 0
      ? Math.max(
          cfg('DOORSTEP_MIN_FEE_PESEWAS'),
          Math.round(cfg('DOORSTEP_PER_KM_PESEWAS') * doorstepDetourKm),
        )
      : cfg('DOORSTEP_SURCHARGE_PESEWAS');
  const heavyLoadSurchargePesewas = heavyLoad ? cfg('HEAVY_LOAD_SURCHARGE_PESEWAS') : 0;

  const ridePesewas =
    flooredRidePesewas + doorstepSurchargePesewas + heavyLoadSurchargePesewas;

  const bookingFeeRate = cfg('RIDE_BOOKING_FEE_RATE');
  const bookingFeePesewas = percentOf(ridePesewas, bookingFeeRate);
  const platformFeePesewas = cfg('RIDE_PLATFORM_FEE_PESEWAS');
  assertPesewas(platformFeePesewas, 'platformFeePesewas');

  const totalPesewas = ridePesewas + bookingFeePesewas + platformFeePesewas;

  // Commission comes off the RIDE only — see the header note.
  const commissionPesewas = percentOf(ridePesewas, cfg('PLATFORM_COMMISSION'));

  return {
    // ── The two numbers every caller actually uses ──────────────────────────
    // Named identically to `calculateFare`'s so the quote service, the booking
    // writer and the receipt keep reading the same keys. An on-demand ride is
    // one seat, so per-person and total are the same figure.
    farePerPersonPesewas: totalPesewas,
    totalTripCostPesewas: totalPesewas,
    commissionPerSeatPesewas: commissionPesewas,
    driverEarningsPerSeatPesewas: ridePesewas - commissionPesewas,

    // ── The breakdown, so the rider's fare sheet never has to recompute ─────
    ridePesewas,
    startFarePesewas: startPesewas,
    distanceComponentPesewas,
    timeComponentPesewas,
    waitComponentPesewas,
    bookingFeePesewas,
    bookingFeeRate,
    platformFeePesewas,
    minFarePesewas,
    floorApplied: surged < minFarePesewas,
    doorstepSurchargePesewas,
    doorstepDetourKm: Number.isFinite(doorstepDetourKm) ? doorstepDetourKm : null,
    heavyLoadSurchargePesewas,
    surchargePerSeatPesewas: doorstepSurchargePesewas + heavyLoadSurchargePesewas,

    // ── Echoed inputs ──────────────────────────────────────────────────────
    distanceKm: Math.round(distanceKm * 100) / 100,
    durationMin: Math.round(minutes * 10) / 10,
    waitMin: Math.round(waiting * 10) / 10,
    seatCount: 1,
    surgeMultiplier,
    commissionRate: cfg('PLATFORM_COMMISSION'),
    // Kept so rows written from this result still populate the columns the
    // shared-trip path fills. `perKmRatePesewas` is the on-demand per-km rate,
    // which is what a receipt for THIS ride should quote.
    baseFarePesewas: startPesewas,
    perKmRatePesewas: perKmPesewas,
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

module.exports = {
  calculateFare,
  calculateRideFare,
  estimateFare,
  calculateEnRouteFare,
  haversineKm,
  detourKm,
  calculateDeviationSurcharge,
  /**
   * Exported so the tier can be normalised where it is STORED, not only where it
   * is priced. `Trip.tier` was written straight from the request body, and the
   * driver app's create-trip screen sends `'ECONOMY'` — a UI id, not the wire
   * value — so those rows disagreed with every `Vehicle.tier` in the database.
   */
  normalizeTier,
};
