'use strict';

const redis = require('../../config/redis');

const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_TTL = 60; // 60 seconds

/**
 * Get grid key for a given lat/lng.
 * Rounds to 2 decimal places (approx 1.1km x 1.1km).
 */
function getGridKey(lat, lng) {
  const rLat = Math.round(lat * 100) / 100;
  const rLng = Math.round(lng * 100) / 100;
  return `surge:${rLat}:${rLng}`;
}

/**
 * Record a driver ping (supply).
 */
async function recordSupply(lat, lng, driverId) {
  const gridKey = getGridKey(lat, lng);
  const supplyKey = `${gridKey}:supply`;
  const now = Date.now();
  
  await redis.zadd(supplyKey, now, driverId);
  await redis.zremrangebyscore(supplyKey, '-inf', now - WINDOW_MS);
}

/**
 * Record a passenger fare estimate request (demand).
 */
async function recordDemand(lat, lng, passengerId) {
  const gridKey = getGridKey(lat, lng);
  const demandKey = `${gridKey}:demand`;
  const now = Date.now();
  
  await redis.zadd(demandKey, now, passengerId);
  await redis.zremrangebyscore(demandKey, '-inf', now - WINDOW_MS);
}

/**
 * Calculate surge multiplier for a given location.
 */
async function getSurgeMultiplier(lat, lng) {
  const gridKey = getGridKey(lat, lng);
  const cacheKey = `${gridKey}:multiplier`;
  
  // Check cache
  const cached = await redis.get(cacheKey);
  if (cached) {
    return parseFloat(cached);
  }

  const supplyKey = `${gridKey}:supply`;
  const demandKey = `${gridKey}:demand`;
  const now = Date.now();

  // Clean up old entries
  await redis.zremrangebyscore(supplyKey, '-inf', now - WINDOW_MS);
  await redis.zremrangebyscore(demandKey, '-inf', now - WINDOW_MS);

  // Count active supply and demand
  const supplyCount = await redis.zcount(supplyKey, '-inf', '+inf');
  const demandCount = await redis.zcount(demandKey, '-inf', '+inf');

  // Calculate raw multiplier
  // multiplier = 1 + 0.25 * Math.log(demand / supply)
  // If supply is 0, treat it as 1 to avoid Infinity, but only if there is demand.
  let rawMultiplier = 1.0;
  if (demandCount > 0) {
    const effectiveSupply = Math.max(supplyCount, 1);
    rawMultiplier = 1 + 0.25 * Math.log(demandCount / effectiveSupply);
  }

  // Cap between 1.0x and 3.0x
  let multiplier = Math.max(1.0, Math.min(3.0, rawMultiplier));

  // Apply EMA smoothing (0.7 old, 0.3 new)
  const oldMultiplierStr = await redis.get(`${gridKey}:ema`);
  const oldMultiplier = oldMultiplierStr ? parseFloat(oldMultiplierStr) : 1.0;
  
  multiplier = 0.7 * oldMultiplier + 0.3 * multiplier;
  
  // Round to 2 decimal places
  multiplier = Math.round(multiplier * 100) / 100;

  // Cache the new multiplier and EMA
  await redis.set(cacheKey, multiplier.toString(), 'EX', CACHE_TTL);
  await redis.set(`${gridKey}:ema`, multiplier.toString(), 'EX', WINDOW_MS / 1000);

  return multiplier;
}

module.exports = {
  recordSupply,
  recordDemand,
  getSurgeMultiplier,
};
