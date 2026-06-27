'use strict';

const prisma = require('../../config/database');
const redis = require('../../config/redis');

// Bucket step in degrees: ~0.01° ≈ 1.1 km at Ghana's latitude.
// We divide the bounding box into cells of this size and count bookings
// per cell, then combine with supply from Redis GEOSEARCH.
const BUCKET_DEG = 0.01;

// How far back to consider booking demand (hours).
const DEMAND_LOOKBACK_HOURS = 24;

/**
 * Aggregate recent booking density around a centre point.
 *
 * Returns an array of cell objects:
 *   { lat, lng, weight (booking count per cell),
 *     driversNearby (estimated from Redis GEOSEARCH),
 *     demandSupplyRatio (bookings / max(1, driversNearby)) }
 *
 * @param {Object} opts
 * @param {number} opts.lat    Centre latitude
 * @param {number} opts.lng    Centre longitude
 * @param {number} [opts.radiusKm=5]  Search radius in km
 */
async function aggregateDemand({ lat, lng, radiusKm = 5 }) {
  // Approx degrees for the radius (1° ≈ 111 km)
  const degRadius = radiusKm / 111;

  const latMin = lat - degRadius;
  const latMax = lat + degRadius;
  const lngMin = lng - degRadius;
  const lngMax = lng + degRadius;

  // ── Demand: recent paid/confirmed bookings (last N hours) ──────────
  const since = new Date(Date.now() - DEMAND_LOOKBACK_HOURS * 60 * 60 * 1000);

  const bookings = await prisma.booking.findMany({
    where: {
      createdAt: { gte: since },
      status: { in: ['CONFIRMED', 'COMPLETED', 'PAID'] },
      trip: {
        route: {
          originLat: { gte: latMin, lte: latMax },
          originLng: { gte: lngMin, lte: lngMax },
        },
      },
    },
    select: {
      trip: {
        select: {
          route: { select: { originLat: true, originLng: true } },
        },
      },
    },
  });

  // Bucket into a JS grid
  const demandBuckets = new Map(); // key: `${latBucket},${lngBucket}` → count

  for (const b of bookings) {
    const oLat = b.trip?.route?.originLat;
    const oLng = b.trip?.route?.originLng;
    if (oLat == null || oLng == null) continue;

    const latKey = Math.round(oLat / BUCKET_DEG) * BUCKET_DEG;
    const lngKey = Math.round(oLng / BUCKET_DEG) * BUCKET_DEG;
    const key = `${latKey.toFixed(4)},${lngKey.toFixed(4)}`;

    demandBuckets.set(key, (demandBuckets.get(key) || 0) + 1);
  }

  // ── Supply: online drivers within radius from Redis ────────────────
  let onlineDrivers = [];
  try {
    onlineDrivers = await redis.georadius(
      'drivers:online',
      lng, lat,
      radiusKm,
      'km',
      'WITHCOORD',
    );
  } catch (_) {
    // Redis might be in-memory fallback — returns empty array
  }

  // Map online driver positions to the same grid
  const supplyBuckets = new Map(); // key → count
  for (const d of onlineDrivers) {
    // ioredis GEORADIUS 'WITHCOORD' returns: [member, [lng, lat]]
    const coordinates = Array.isArray(d) && d.length >= 2 ? d[1] : null;
    if (!coordinates) continue;
    const [dLng, dLat] = coordinates;

    const latKey = Math.round(dLat / BUCKET_DEG) * BUCKET_DEG;
    const lngKey = Math.round(dLng / BUCKET_DEG) * BUCKET_DEG;
    const key = `${latKey.toFixed(4)},${lngKey.toFixed(4)}`;

    supplyBuckets.set(key, (supplyBuckets.get(key) || 0) + 1);
  }

  // ── Combine into result cells ──────────────────────────────────────
  const allKeys = new Set([...demandBuckets.keys(), ...supplyBuckets.keys()]);
  const cells = [];

  for (const key of allKeys) {
    const [cellLat, cellLng] = key.split(',').map(Number);
    const demand = demandBuckets.get(key) || 0;
    const supply = supplyBuckets.get(key) || 0;
    const demandSupplyRatio = supply > 0 ? demand / supply : demand > 0 ? demand : 0;

    cells.push({
      lat: cellLat,
      lng: cellLng,
      weight: demand,
      driversNearby: supply,
      demandSupplyRatio: Math.round(demandSupplyRatio * 100) / 100,
    });
  }

  // Sort by weight descending (hottest areas first)
  cells.sort((a, b) => b.weight - a.weight);

  return cells;
}

module.exports = { aggregateDemand };
