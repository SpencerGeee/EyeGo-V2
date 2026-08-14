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
/**
 * Admin-set manual override (POST /v1/admin/surge/:zoneId). Acts as a FLOOR:
 * the returned multiplier is max(auto, manual), so an admin can force surge
 * up during an event but auto-surge can still exceed it. zoneId 'global'
 * applies everywhere; a '{lat}:{lng}' zoneId (2-dp grid) targets one cell.
 */
async function getManualOverride(gridKey) {
  const [zone, global] = await Promise.all([
    redis.get(`surge:manual:${gridKey.replace('surge:', '')}`).catch(() => null),
    redis.get('surge:manual:global').catch(() => null),
  ]);
  const values = [zone, global].map((v) => parseFloat(v)).filter((v) => Number.isFinite(v));
  return values.length ? Math.max(...values) : 1.0;
}

async function getSurgeMultiplier(lat, lng) {
  const gridKey = getGridKey(lat, lng);
  const cacheKey = `${gridKey}:multiplier`;
  const manual = await getManualOverride(gridKey);

  // Check cache
  const cached = await redis.get(cacheKey);
  if (cached) {
    return Math.max(parseFloat(cached), manual);
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

  // Cache the new multiplier and EMA (auto value only — the manual floor is
  // applied at read time so clearing the override takes effect immediately)
  await redis.set(cacheKey, multiplier.toString(), 'EX', CACHE_TTL);
  await redis.set(`${gridKey}:ema`, multiplier.toString(), 'EX', WINDOW_MS / 1000);

  return Math.max(multiplier, manual);
}

/**
 * THE ZONE DIRECTORY.
 *
 * A "zone" was never a row anywhere — it is a 2-decimal-place lat/lng grid cell
 * that comes into existence the first time a driver pings inside it or a rider
 * asks for a fare from it (`getGridKey`). So there was nothing to list, and the
 * admin console said so out loud: "The API exposes no endpoint listing zone ids,
 * so you need to know the id you are pasting."
 *
 * That is still true of Postgres and always will be. It is NOT true of Redis,
 * which is where the cells actually live — every active one has at least one of
 * `surge:{lat}:{lng}:supply`, `:demand`, `:multiplier` or `:ema`, and every
 * manual override has `surge:manual:{zoneId}`. Enumerating those IS the
 * directory, and it is the honest one: a cell with no traffic and no override
 * has no pricing behaviour to configure.
 *
 * SCAN, never KEYS: this runs against the same Redis that holds the dispatch
 * pool and the money locks, and KEYS blocks the server for the length of the
 * keyspace.
 */
async function scanKeys(match, { count = 500, cap = 5000 } = {}) {
  const found = new Set();
  let cursor = '0';
  do {
    // eslint-disable-next-line no-await-in-loop
    const [next, batch] = await redis.scan(cursor, 'MATCH', match, 'COUNT', count);
    cursor = next;
    for (const k of batch) found.add(k);
    if (found.size >= cap) break;
  } while (cursor !== '0');
  return [...found];
}

/** `surge:5.61:-0.19:supply` → `5.61:-0.19`. Null for anything else. */
function zoneIdFromKey(key) {
  const m = /^surge:(-?\d+(?:\.\d+)?):(-?\d+(?:\.\d+)?)(?::(?:supply|demand|multiplier|ema))?$/.exec(key);
  return m ? `${m[1]}:${m[2]}` : null;
}

/**
 * Every zone the pricing engine currently knows about, with the numbers that
 * decide its multiplier. `global` is always present — it is a real, settable
 * zone id even though no grid cell produces it.
 */
async function listZones() {
  const now = Date.now();
  const [gridKeys, manualKeys] = await Promise.all([
    scanKeys('surge:*'),
    scanKeys('surge:manual:*'),
  ]);

  const zoneIds = new Set();
  for (const key of gridKeys) {
    const id = zoneIdFromKey(key);
    if (id) zoneIds.add(id);
  }
  const manualById = new Map();
  for (const key of manualKeys) {
    const id = key.slice('surge:manual:'.length);
    if (id) {
      manualById.set(id, null);
      if (id !== 'global') zoneIds.add(id);
    }
  }

  // One pipeline for the whole directory rather than 5 round trips per zone.
  const ids = [...zoneIds].sort();
  const pipeline = redis.pipeline();
  for (const id of ids) {
    const gridKey = `surge:${id}`;
    pipeline.zcount(`${gridKey}:supply`, now - WINDOW_MS, '+inf');
    pipeline.zcount(`${gridKey}:demand`, now - WINDOW_MS, '+inf');
    pipeline.get(`${gridKey}:multiplier`);
    pipeline.get(`surge:manual:${id}`);
    pipeline.ttl(`surge:manual:${id}`);
  }
  pipeline.get('surge:manual:global');
  pipeline.ttl('surge:manual:global');
  const raw = await pipeline.exec();

  const at = (i) => (raw?.[i]?.[0] ? null : raw?.[i]?.[1]);
  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };

  const zones = ids.map((id, idx) => {
    const base = idx * 5;
    const [latStr, lngStr] = id.split(':');
    const manual = num(at(base + 3));
    const manualTtl = at(base + 4);
    return {
      zoneId: id,
      // Present for grid cells, null for any ad-hoc id an operator typed in.
      lat: Number.isFinite(parseFloat(latStr)) ? parseFloat(latStr) : null,
      lng: Number.isFinite(parseFloat(lngStr)) ? parseFloat(lngStr) : null,
      supplyCount: Number(at(base)) || 0,
      demandCount: Number(at(base + 1)) || 0,
      // The AUTO value only. The effective multiplier a rider is quoted is
      // max(auto, manual, globalManual) — computed below so the console shows
      // the same number the fare path would.
      autoMultiplier: num(at(base + 2)) ?? 1,
      manualMultiplier: manual,
      manualExpiresInSeconds: manual != null && Number(manualTtl) > 0 ? Number(manualTtl) : null,
    };
  });

  const globalManual = num(at(ids.length * 5));
  const globalTtl = at(ids.length * 5 + 1);

  for (const z of zones) {
    z.effectiveMultiplier = Math.max(
      z.autoMultiplier,
      z.manualMultiplier ?? 1,
      globalManual ?? 1,
    );
  }

  return {
    // Sorted by the thing an operator is looking for: where pricing is hottest.
    zones: zones.sort((a, b) => b.effectiveMultiplier - a.effectiveMultiplier),
    global: {
      zoneId: 'global',
      manualMultiplier: globalManual,
      expiresInSeconds: globalManual != null && Number(globalTtl) > 0 ? Number(globalTtl) : null,
    },
    /** So the console can explain what an id means without hardcoding it. */
    gridPrecision: {
      decimalPlaces: 2,
      approxCellMetres: 1100,
      note: 'A zone id is `{lat}:{lng}` rounded to 2dp, or the literal `global`.',
    },
    windowMs: WINDOW_MS,
  };
}

/**
 * The zone id a coordinate falls in — so the console can offer "surge the area
 * around this pin" instead of asking an operator to round decimals by hand.
 */
function zoneIdForCoords(lat, lng) {
  return getGridKey(lat, lng).replace('surge:', '');
}

module.exports = {
  recordSupply,
  recordDemand,
  getSurgeMultiplier,
  listZones,
  zoneIdForCoords,
};
