/**
 * Operator-priced corridors (client 2026-10-29, D5). A trip is on a corridor
 * when BOTH of its ends sit within the corridor's radius of the corridor's own
 * ends, in the same direction — Kasoa → Shiashie is not Shiashie → Kasoa.
 * Several matches: the tightest fit (smallest summed end distance) wins.
 */
const { haversineKm } = require('../modules/trips/fare.calculator');

function pickCorridor(corridors, route) {
  if (!route) return null;
  let best = null;
  for (const c of corridors ?? []) {
    if (c.isActive === false) continue;
    const a = haversineKm(route.originLat, route.originLng, c.originLat, c.originLng);
    const b = haversineKm(route.destLat, route.destLng, c.destLat, c.destLng);
    const r = c.radiusKm ?? 2;
    if (!(a <= r && b <= r)) continue;
    if (!best || a + b < best.fit) best = { corridor: c, fit: a + b };
  }
  return best?.corridor ?? null;
}

/** The corridor a new trip on `route` is pinned to, or null. Small table. */
async function corridorFor(db, route) {
  const corridors = await db.corridor.findMany({ where: { isActive: true } });
  return pickCorridor(corridors, route);
}

module.exports = { pickCorridor, corridorFor };
