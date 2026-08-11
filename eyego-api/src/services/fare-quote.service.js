'use strict';

const crypto = require('crypto');
const redis = require('../config/redis');
const env = require('../config/env');
const { AppError } = require('../utils/errors');
const { calculateFare } = require('../modules/trips/fare.calculator');
const { roadDistanceKm } = require('./mapbox.service');
const { getSurgeMultiplier } = require('../modules/trips/surge.service');

/**
 * Upfront pricing: the rider is quoted a price, and that exact price is what
 * they are charged.
 *
 * WHY A SIGNED QUOTE. Before this, the price shown on the request screen and
 * the price written to the booking were two independent computations that
 * happened to use the same inputs. Any drift between them — a surge tick, a
 * rounding difference, a client sending a stale distance — silently became a
 * charge the rider never agreed to, with nothing to point at afterwards.
 *
 * A quote is now a server-issued artefact:
 *
 *   quoteId   64 hex chars, HMAC of the priced inputs under a server secret.
 *             The client cannot mint one and cannot alter one.
 *   expiresAt short-lived. Prices move; a quote from twenty minutes ago is not
 *             a promise, so booking against it fails 409 FARE_EXPIRED rather
 *             than charging yesterday's surge.
 *   one-shot  redeemed atomically in Redis, so a replayed quote cannot buy two
 *             rides at one price.
 *
 * Changing the destination voids the quote — the priced inputs no longer match
 * the ride, and re-quoting is the honest answer.
 */

const QUOTE_TTL_SECONDS = parseInt(process.env.FARE_QUOTE_TTL_SECONDS, 10) || 120;

/**
 * The HMAC key.
 *
 * This read `env.JWT_SECRET`, which IS NOT A KEY IN THE ENV SCHEMA — the
 * schema defines `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`, and zod strips
 * anything it does not define. So `SECRET` was `undefined`, and
 * `crypto.createHmac('sha256', undefined)` throws a TypeError: EVERY call to
 * `createQuote` failed with a 500 before it priced anything, which meant no
 * rider could get as far as a fare on the request screen.
 *
 * Asserted at load rather than defaulted. A quote signed with a fallback
 * secret is a quote anyone can mint, and this file exists specifically to stop
 * a client naming its own price.
 */
const SECRET = env.JWT_ACCESS_SECRET;
if (!SECRET) {
  throw new Error(
    'fare-quote.service: JWT_ACCESS_SECRET is required to sign fare quotes. ' +
      'Without it a quote is unverifiable and a client could name its own price.',
  );
}
const quoteKey = (id) => `fare:quote:${id}`;

/** The exact fields the price depends on. Anything not here cannot change it. */
function canonicalInputs(q) {
  return JSON.stringify([
    q.userId,
    q.tier,
    Number(q.pickupLat).toFixed(5),
    Number(q.pickupLng).toFixed(5),
    Number(q.dropoffLat).toFixed(5),
    Number(q.dropoffLng).toFixed(5),
    q.seatCount,
    q.doorstepPickup ? 1 : 0,
    q.heavyLoad ? 1 : 0,
    q.distanceKm.toFixed(3),
    q.surgeMultiplier.toFixed(2),
    // An integer number of pesewas, so it signs as itself. When this was a
    // float the signed text was whatever `JSON.stringify` chose to print for
    // it, and a value that re-derived as 25.500000000000004 on the redeem side
    // would fail its own signature check for no visible reason.
    q.amountPesewas,
  ]);
}

function sign(inputs) {
  return crypto.createHmac('sha256', SECRET).update(inputs).digest('hex');
}

/**
 * Price a ride and issue a redeemable quote.
 *
 * Distance comes from the routing engine, not from the client and not from a
 * straight line — the rider is quoted for the road they will actually travel.
 */
async function createQuote({
  userId,
  tier = 'ECO',
  pickupLat,
  pickupLng,
  dropoffLat,
  dropoffLng,
  seatCount = 1,
  doorstepPickup = false,
  heavyLoad = false,
}) {
  if (![pickupLat, pickupLng, dropoffLat, dropoffLng].every(Number.isFinite)) {
    throw new AppError('Pickup and dropoff coordinates are required', 400, 'MISSING_COORDS');
  }

  // BUGFIX ("couldn't send request — could not measure the route for this
  // trip", on every single on-demand request). `roadDistanceKm` resolves to an
  // OBJECT — `{ distanceKm, durationMin, source }` — and has done since it
  // grew a straight-line fallback. This call assigned that object straight to
  // `distanceKm`, and `Number.isFinite({...})` is unconditionally false, so the
  // guard below fired on every quote no matter how good the route was. The
  // fallback path made it worse by guaranteeing the function never throws and
  // never returns a bad distance, so the failure could only ever be here.
  // Every other caller in the codebase already destructures `.distanceKm`.
  const route = await roadDistanceKm(pickupLat, pickupLng, dropoffLat, dropoffLng);
  const distanceKm = route?.distanceKm;
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
    throw new AppError('Could not measure the route for this trip', 422, 'ROUTE_UNAVAILABLE');
  }

  const surgeMultiplier = await getSurgeMultiplier(pickupLat, pickupLng).catch(() => 1.0);

  const fare = calculateFare({
    tier,
    distanceKm,
    // An on-demand ride is the whole car: the fare is not divided by seats.
    seatCount: 1,
    doorstepPickup,
    heavyLoad,
    surgeMultiplier,
  });

  // An on-demand ride is priced as one seat = the whole car, so per-person and
  // total are the same number. Taking `farePerPersonPesewas` (not `totalTripCostPesewas`)
  // keeps this identical to the one fare formula every other surface uses.
  const amountPesewas = fare.farePerPersonPesewas;
  if (!Number.isInteger(amountPesewas) || amountPesewas <= 0) {
    throw new AppError('Fare could not be calculated for this trip', 422, 'FARE_UNAVAILABLE');
  }

  const expiresAtMs = Date.now() + QUOTE_TTL_SECONDS * 1000;
  const priced = {
    userId,
    tier,
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
    seatCount,
    doorstepPickup,
    heavyLoad,
    distanceKm,
    surgeMultiplier,
    amountPesewas,
  };
  const quoteId = sign(canonicalInputs(priced));

  await redis.set(
    quoteKey(quoteId),
    JSON.stringify({ ...priced, expiresAtMs, breakdown: fare }),
    'EX',
    QUOTE_TTL_SECONDS,
  );

  return {
    quoteId,
    amountPesewas,
    currency: 'GHS',
    distanceKm,
    surgeMultiplier,
    breakdown: fare,
    durationMin: route?.durationMin ?? null,
    expiresAtServerMs: expiresAtMs,
    serverNowMs: Date.now(),
    expiresInSeconds: QUOTE_TTL_SECONDS,
  };
}

/**
 * Redeem a quote. Single use.
 *
 * `DEL` returning 1 is the atomic claim: two concurrent redemptions of the
 * same quote cannot both succeed, so a retried request cannot buy a second
 * ride at the same price.
 */
async function redeemQuote(quoteId, userId) {
  if (!quoteId || typeof quoteId !== 'string' || !/^[0-9a-f]{64}$/.test(quoteId)) {
    throw new AppError('Invalid fare quote', 422, 'INVALID_FARE_ID');
  }
  const raw = await redis.get(quoteKey(quoteId));
  if (!raw) {
    throw new AppError('This price has expired — please confirm the new fare.', 409, 'FARE_EXPIRED');
  }
  const quote = JSON.parse(raw);
  if (quote.userId !== userId) {
    throw new AppError('Invalid fare quote', 422, 'INVALID_FARE_ID');
  }
  // Re-verify the signature: a quote whose stored body was tampered with in
  // Redis will not re-derive its own id.
  if (sign(canonicalInputs(quote)) !== quoteId) {
    throw new AppError('Invalid fare quote', 422, 'INVALID_FARE_ID');
  }
  const claimed = await redis.del(quoteKey(quoteId));
  if (claimed !== 1) {
    throw new AppError('This price has already been used', 409, 'FARE_ALREADY_USED');
  }
  return quote;
}

/**
 * Un-redeem a quote whose ride did not happen.
 *
 * WHY THIS EXISTS. Redemption is destructive and it runs BEFORE the work it
 * pays for can fail. `requestRide` redeemed the quote, wrote the Trip, then
 * awaited dispatch — and when dispatch could not start, the rider got
 * "we could not start looking for a driver", tapped Confirm again, and the
 * retry sent the same quoteId at a key that no longer existed. The second
 * error was "this price has expired — please confirm the new fare", on a quote
 * that had another ninety seconds left and had never bought anything. The
 * rider could not get out of the loop, because every retry burned nothing and
 * still failed the same way.
 *
 * Restoring is safe precisely because the id is an HMAC of the priced inputs:
 * putting the same body back under the same key cannot mint a different price,
 * and the remaining TTL is carried from the original `expiresAtMs` so a
 * restore can never extend the window a rider was quoted.
 *
 * Returns false when the quote had already aged out anyway — the caller has
 * nothing to apologise for in that case, the price really did expire.
 */
async function restoreQuote(quoteId, quote) {
  if (!quoteId || !quote || !Number.isFinite(quote.expiresAtMs)) return false;
  const ttlSeconds = Math.ceil((quote.expiresAtMs - Date.now()) / 1000);
  if (ttlSeconds <= 0) return false;
  const written = await redis
    .set(quoteKey(quoteId), JSON.stringify(quote), 'EX', ttlSeconds)
    .catch(() => null);
  return written !== null;
}

/** Peek without redeeming — for showing the rider what they are about to pay. */
async function readQuote(quoteId) {
  const raw = await redis.get(quoteKey(quoteId)).catch(() => null);
  return raw ? JSON.parse(raw) : null;
}

module.exports = { createQuote, redeemQuote, restoreQuote, readQuote, QUOTE_TTL_SECONDS };
