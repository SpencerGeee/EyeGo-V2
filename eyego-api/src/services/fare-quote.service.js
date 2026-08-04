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
const SECRET = env.JWT_SECRET || process.env.JWT_SECRET;
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
    q.amount,
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

  const distanceKm = await roadDistanceKm(pickupLat, pickupLng, dropoffLat, dropoffLng);
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
  // total are the same number. Taking `farePerPerson` (not `totalTripCost`)
  // keeps this identical to the one fare formula every other surface uses.
  const amount = fare.farePerPerson;
  if (!Number.isFinite(amount) || amount <= 0) {
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
    amount,
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
    amount,
    currency: 'GHS',
    distanceKm,
    surgeMultiplier,
    breakdown: fare,
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

/** Peek without redeeming — for showing the rider what they are about to pay. */
async function readQuote(quoteId) {
  const raw = await redis.get(quoteKey(quoteId)).catch(() => null);
  return raw ? JSON.parse(raw) : null;
}

module.exports = { createQuote, redeemQuote, readQuote, QUOTE_TTL_SECONDS };
