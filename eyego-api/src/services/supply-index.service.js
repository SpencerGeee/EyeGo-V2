'use strict';

const redis = require('../config/redis');
const logger = require('../utils/logger');

/**
 * The driver supply index — where the free cars are, right now.
 *
 * WHAT THIS REPLACES. Every dispatch decision used to run
 * `prisma.driver.findMany(availableDriverWhere())` — a full table scan of
 * drivers on the transactional database, on the hottest path in the product,
 * followed by a haversine sort in Node. Redis held a `drivers:online` geo-set
 * but it was explicitly used as "a ranking hint only, never the membership
 * list", because it was unreliable: a driver whose ping hadn't landed was
 * simply absent, and an id-intersection turned that absence into exclusion.
 *
 * That distrust was the right call for an index nothing maintained properly.
 * The fix is to maintain it properly:
 *
 *   - Position is written on every location ping AND on go-online, so a driver
 *     is in the index from the moment they are eligible, not from their first
 *     ping.
 *   - Presence is a separate key with a TTL. A dead phone falls out of the
 *     pool by expiry instead of requiring an explicit `goOffline` that a
 *     force-quit app never sends. This is what stops offers being cascaded to
 *     drivers who left an hour ago.
 *   - Postgres is still consulted, but as the AUTHORITY on eligibility
 *     (approved / online / not busy) over the small candidate set Redis
 *     returns — not as the search index. Geo narrows, SQL confirms.
 */

/** Geo set of driver positions. */
const GEO_KEY = 'supply:drivers:geo';
/** Per-driver presence key; absence means "not currently dispatchable". */
const presenceKey = (driverId) => `supply:presence:${driverId}`;
/** Per-driver tier, so a candidate sweep can filter without hitting Postgres. */
const metaKey = (driverId) => `supply:meta:${driverId}`;

/**
 * How long a position is trusted without a refresh. The driver app pings
 * every few seconds while online; 90s tolerates a tunnel without keeping a
 * driver who closed the app in the pool.
 */
const PRESENCE_TTL_SECONDS = parseInt(process.env.SUPPLY_PRESENCE_TTL_SECONDS, 10) || 90;

/**
 * Record/refresh a driver's position and presence.
 * Called from the location ping handler and from go-online.
 */
async function upsertDriver(driverId, lat, lng, meta = {}) {
  if (!driverId || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  try {
    const pipeline = redis.pipeline();
    pipeline.geoadd(GEO_KEY, lng, lat, driverId);
    pipeline.set(presenceKey(driverId), '1', 'EX', PRESENCE_TTL_SECONDS);
    if (meta.tier || meta.seats) {
      pipeline.set(
        metaKey(driverId),
        JSON.stringify({ tier: meta.tier ?? null, seats: meta.seats ?? null }),
        'EX',
        PRESENCE_TTL_SECONDS * 4,
      );
    }
    await pipeline.exec();
    return true;
  } catch (err) {
    logger.warn(`supply-index upsert failed for ${driverId}: ${err.message}`);
    return false;
  }
}

/** Remove a driver from the pool immediately (go-offline, ban, trip accepted). */
async function removeDriver(driverId) {
  if (!driverId) return;
  try {
    await redis.pipeline().zrem(GEO_KEY, driverId).del(presenceKey(driverId)).exec();
  } catch (err) {
    logger.warn(`supply-index remove failed for ${driverId}: ${err.message}`);
  }
}

/**
 * Driver ids within `radiusKm` of a point, nearest first, with their distance.
 *
 * Returns `[]` — not "everyone" — when Redis has nothing nearby. The caller is
 * expected to widen the radius, which is a real answer; the old code's
 * fall-back-to-full-table-scan turned an empty local supply into a
 * nationwide broadcast.
 */
async function nearbyDrivers(lat, lng, radiusKm, limit = 50, { withCoords = false } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  let raw;
  try {
    // Argument order is fixed by the GEOSEARCH grammar:
    // ... BYRADIUS r unit [ASC|DESC] [COUNT n] [WITHCOORD] [WITHDIST].
    const args = [
      GEO_KEY, 'FROMLONLAT', lng, lat, 'BYRADIUS', radiusKm, 'km', 'ASC', 'COUNT', limit,
    ];
    if (withCoords) args.push('WITHCOORD');
    args.push('WITHDIST');
    raw = await redis.geosearch(...args);
  } catch (err) {
    logger.warn(`supply-index geosearch failed: ${err.message}`);
    return [];
  }
  if (!Array.isArray(raw) || raw.length === 0) return [];

  // Reply shape is [member, dist, [lng, lat]] with both modifiers. Redis fixes
  // that order itself (distance, hash, coordinates) regardless of the order the
  // modifiers were written, so the coordinate pair is located by shape — the only
  // nested array in the entry — rather than by a hard-coded index.
  //
  // The pair is ALWAYS [lng, lat], never [lat, lng]. Reading it backwards is the
  // classic way a driver on top of you gets plotted hundreds of km away, so the
  // unpacking happens exactly once, here, and callers only ever see named
  // `lat`/`lng` fields.
  const candidates = raw.map((entry) => {
    if (!Array.isArray(entry)) return { driverId: entry, distanceKm: null, lat: null, lng: null };
    const coords = withCoords ? entry.slice(1).find((v) => Array.isArray(v)) : null;
    return {
      driverId: entry[0],
      distanceKm: Number(entry[1]),
      lng: coords ? Number(coords[0]) : null,
      lat: coords ? Number(coords[1]) : null,
    };
  });

  // A stale geo entry outlives its presence key — the position is still in the
  // sorted set but the driver has gone quiet. Presence is the liveness test.
  const presence = await redis
    .mget(candidates.map((c) => presenceKey(c.driverId)))
    .catch(() => candidates.map(() => '1'));

  const live = [];
  const dead = [];
  candidates.forEach((c, i) => {
    if (presence[i]) live.push(c);
    else dead.push(c.driverId);
  });

  // Opportunistic cleanup so the set does not grow without bound.
  if (dead.length) redis.zrem(GEO_KEY, ...dead).catch(() => {});

  return live;
}

/** How many dispatchable drivers are near a point — powers surge and heatmaps. */
async function countNearby(lat, lng, radiusKm) {
  const drivers = await nearbyDrivers(lat, lng, radiusKm, 200);
  return drivers.length;
}

/**
 * How many positions the index holds at all, ignoring geography.
 *
 * Purely diagnostic, and it earns its keep: "nobody nearby" and "nobody at all"
 * look identical from `nearbyDrivers`, and they have completely different fixes
 * (widen the radius vs. work out why no driver app is pinging). Dispatch logs
 * this whenever a search comes back empty. Includes entries whose presence key
 * has expired — that gap is itself the signal that pings stopped.
 */
async function poolSize() {
  try {
    return await redis.zcard(GEO_KEY);
  } catch {
    return -1;
  }
}

module.exports = {
  GEO_KEY,
  PRESENCE_TTL_SECONDS,
  upsertDriver,
  removeDriver,
  nearbyDrivers,
  countNearby,
  poolSize,
};
