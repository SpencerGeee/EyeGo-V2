'use strict';

const redis = require('../config/redis');
const logger = require('../utils/logger');
const h3 = require('./h3-index.service');

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
 * Drivers currently inside one H3 cell — see h3-index.service.
 *
 * Maintained ALONGSIDE the geo-set, never instead of it. The geo-set stays the
 * source of coordinates and distances; these sets exist so an area has a name
 * that surge, the heatmap and a widening candidate sweep can all agree on, and
 * so a sweep can expand by RING (a fixed step outward in every direction)
 * rather than by re-running a bigger circle and re-examining everybody it has
 * already seen.
 */
const cellKey = (cell) => `supply:h3:${cell}`;
/** Which cell we last filed a driver under, so a move can unfile them. */
const driverCellKey = (driverId) => `supply:h3:of:${driverId}`;

/**
 * How long a position is trusted without a refresh. The driver app pings
 * every few seconds while online; 90s tolerates a tunnel without keeping a
 * driver who closed the app in the pool.
 */
const PRESENCE_TTL_SECONDS = parseInt(process.env.SUPPLY_PRESENCE_TTL_SECONDS, 10) || 90;

/**
 * Record/refresh a driver's position and presence.
 * Called from the location ping handler and from go-online.
 *
 * Returns `{ ok, rejoined }`. `rejoined` is true when this call put the driver
 * back into the pool after an ABSENCE — a phone that was backgrounded past the
 * presence TTL, a tunnel, an app the OS suspended while its human was in the
 * other app on the same handset. That transition is the one moment a parked
 * search should be re-run immediately rather than waiting out its next sweep,
 * and it is the only cheap way to know it happened: the steady-state ping must
 * not pay for a trip scan every few seconds.
 */
async function upsertDriver(driverId, lat, lng, meta = {}) {
  if (!driverId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, rejoined: false };
  }
  try {
    /**
     * The cell this ping puts them in. Read BEFORE the pipeline so the previous
     * cell can be cleaned up in the same round trip — a driver who has moved
     * must not be left listed in the block they drove out of, which is how a
     * hex index rots into a set of ghosts.
     */
    const cell = h3.cellFor(lat, lng);
    const prevCell = cell ? await redis.get(driverCellKey(driverId)).catch(() => null) : null;

    const pipeline = redis.pipeline();
    pipeline.exists(presenceKey(driverId));
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
    if (cell) {
      if (prevCell && prevCell !== cell) pipeline.srem(cellKey(prevCell), driverId);
      pipeline.sadd(cellKey(cell), driverId);
      // Cells expire on the same clock as presence (with slack): a process that
      // dies mid-shift must not leave a driver filed here forever, and the next
      // ping re-adds them anyway.
      pipeline.expire(cellKey(cell), PRESENCE_TTL_SECONDS * 4);
      pipeline.set(driverCellKey(driverId), cell, 'EX', PRESENCE_TTL_SECONDS * 4);
    }
    const results = await pipeline.exec();
    // ioredis pipeline replies are [err, value] pairs, in command order.
    const wasPresent = results?.[0]?.[1] === 1;
    return { ok: true, rejoined: !wasPresent };
  } catch (err) {
    logger.warn(`supply-index upsert failed for ${driverId}: ${err.message}`);
    return { ok: false, rejoined: false };
  }
}

/**
 * One driver's live position, or null.
 *
 * The `Driver.currentLat/currentLng` columns are a COLD copy — the socket
 * persists them at most every 15 s or 60 m of movement (see
 * DB_PERSIST_INTERVAL_MS in driver.socket.js), and they are null for a driver
 * who has never had a fix written. Anything that needs "where is this driver
 * right now" should ask the index, which every ping refreshes.
 */
async function driverPosition(driverId) {
  if (!driverId) return null;
  try {
    const [pos] = await redis.geopos(GEO_KEY, driverId);
    if (!pos) return null;
    const lng = Number(pos[0]);
    const lat = Number(pos[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch (err) {
    logger.warn(`supply-index geopos failed for ${driverId}: ${err.message}`);
    return null;
  }
}

/** Remove a driver from the pool immediately (go-offline, ban, trip accepted). */
async function removeDriver(driverId) {
  if (!driverId) return;
  try {
    // The cell membership has to go with them. Leaving it behind is how the hex
    // index starts reporting supply that went offline an hour ago — and unlike
    // the geo-set, which `nearbyDrivers` prunes opportunistically against
    // presence, a stale cell entry is only ever noticed by whatever trusts it.
    const cell = await redis.get(driverCellKey(driverId)).catch(() => null);
    const p = redis.pipeline().zrem(GEO_KEY, driverId).del(presenceKey(driverId));
    if (cell) p.srem(cellKey(cell), driverId);
    p.del(driverCellKey(driverId));
    await p.exec();
  } catch (err) {
    logger.warn(`supply-index remove failed for ${driverId}: ${err.message}`);
  }
}

/**
 * Live drivers in a set of H3 cells, as a plain id set.
 *
 * The cheap half of a candidate sweep: it answers "who is in this area" with
 * set reads and no geo maths, and it is exact about the area because the area
 * has a name. It does NOT return distances — that is `nearbyDrivers`' job, and
 * ranking is `matcher.service`'s. Presence is still the liveness test, because
 * a cell set can outlive the driver in it.
 *
 * @param {string[]} cells
 * @returns {Promise<string[]>} driver ids, de-duplicated
 */
async function driversInCells(cells) {
  const list = (cells || []).filter((c) => h3.isCell(c));
  if (list.length === 0) return [];
  let ids;
  try {
    ids = await redis.sunion(...list.map(cellKey));
  } catch (err) {
    logger.warn(`supply-index sunion failed: ${err.message}`);
    return [];
  }
  if (!Array.isArray(ids) || ids.length === 0) return [];

  const presence = await redis
    .mget(ids.map((id) => presenceKey(id)))
    .catch(() => ids.map(() => '1'));

  const live = [];
  const dead = [];
  ids.forEach((id, i) => (presence[i] ? live.push(id) : dead.push(id)));

  // Opportunistic cleanup, matching what `nearbyDrivers` does for the geo-set.
  if (dead.length) {
    Promise.all(
      dead.map(async (id) => {
        const cell = await redis.get(driverCellKey(id)).catch(() => null);
        if (cell) redis.srem(cellKey(cell), id).catch(() => {});
      }),
    ).catch(() => {});
  }

  return live;
}

/**
 * How many live drivers sit in each of these cells.
 *
 * The supply half of a supply-and-demand picture, keyed by an id the demand
 * side can use too — which is the whole reason the grid exists. Used by the
 * heatmap and by surge, which previously each bucketed points their own way and
 * could not be compared with one another.
 *
 * @param {string[]} cells
 * @returns {Promise<Map<string, number>>} cell id → live driver count
 */
async function supplyByCell(cells) {
  const out = new Map();
  const list = (cells || []).filter((c) => h3.isCell(c));
  if (list.length === 0) return out;
  try {
    const pipeline = redis.pipeline();
    list.forEach((c) => pipeline.smembers(cellKey(c)));
    const res = await pipeline.exec();
    // One presence read for every driver across every cell, rather than one per
    // cell: the same driver cannot be in two cells, so the ids are disjoint.
    const perCell = list.map((c, i) => [c, (res?.[i]?.[1] ?? [])]);
    const allIds = perCell.flatMap(([, ids]) => ids);
    if (allIds.length === 0) {
      list.forEach((c) => out.set(c, 0));
      return out;
    }
    const presence = await redis.mget(allIds.map((id) => presenceKey(id))).catch(() => allIds.map(() => '1'));
    const livingIds = new Set(allIds.filter((_, i) => presence[i]));
    perCell.forEach(([c, ids]) => out.set(c, ids.filter((id) => livingIds.has(id)).length));
    return out;
  } catch (err) {
    logger.warn(`supply-index supplyByCell failed: ${err.message}`);
    return out;
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

/**
 * Are these drivers in the pool right now? One round trip, exact answer.
 *
 * The admin dispatch board used to work this out by GEOSEARCHing a 25 km circle
 * around each driver's POSTGRES coordinates and looking for them in the result.
 * That is the cold copy — written at most every 15 s or 60 m of movement, and
 * null for a driver who has never persisted a fix — so a driver who was pinging
 * perfectly well showed up as "online but not pinging" whenever their row was
 * stale, empty, or their live position had drifted out of a circle drawn around
 * an old one. An operator reading that panel concluded dispatch was broken when
 * it was not, which is precisely the wrong call to make during an incident.
 *
 * Presence is a key with a TTL. Ask it.
 *
 * @param {string[]} driverIds
 * @returns {Promise<Set<string>>} the subset that is currently dispatchable
 */
async function whichArePresent(driverIds) {
  const ids = (driverIds || []).filter(Boolean);
  if (ids.length === 0) return new Set();
  try {
    const values = await redis.mget(ids.map(presenceKey));
    const live = new Set();
    ids.forEach((id, i) => { if (values[i]) live.add(id); });
    return live;
  } catch (err) {
    logger.warn(`supply-index presence probe failed: ${err.message}`);
    return new Set();
  }
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
  driverPosition,
  removeDriver,
  nearbyDrivers,
  driversInCells,
  supplyByCell,
  whichArePresent,
  countNearby,
  poolSize,
};
