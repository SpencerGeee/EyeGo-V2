const prisma = require('../config/database');
const logger = require('../utils/logger');
const { getDirections, placeNameFor } = require('./mapbox.service');
const { haversineKm } = require('../modules/trips/fare.calculator');

/**
 * ── THE STOPS A PASSENGER MAY GET ON OR OFF AT ──────────────────────────────
 *
 * "it would make sense if someone would like to alight inbetween ... it should
 * work intelligently and shouldnt mean that the place youre alighting at would
 * be a bit far or a big detour for the trip so its not an inconvenience for the
 * riders."
 *
 * The way to guarantee that is not a tolerance check on a pin the rider drops —
 * it is to only ever offer points that lie ON the route the driver is already
 * driving. A stop derived from the polyline costs zero detour BY CONSTRUCTION,
 * so there is no threshold to tune and no way for a rider to inconvenience the
 * vehicle by choosing badly. There is nothing to reject, which is why this has
 * no rejection path.
 *
 * Fixed, admin-curated routes already have `VirtualStop` rows and always win —
 * a named lorry station is a better answer than anything derivable. This exists
 * for `isAdHoc` routes, which is most of them: a driver's "create trip from
 * here" and a rider's on-demand request both mint a Route with no stops at all,
 * so without this the feature would only work on the small curated set.
 *
 * WHY THEY ARE PERSISTED rather than computed per request: every downstream
 * consumer addresses a stop BY ID — the booking row, the fare ratio on the
 * receipt, the driver's stop list, the admin console. Deriving them on the fly
 * would mean an id that is not stable between two calls, and a receipt that
 * cannot say where the passenger got off.
 */

/** Roughly how far apart offered stops should be. */
const TARGET_SPACING_KM = 3.5;
/** Never offer a stop nearer than this to either end — it is not a real choice. */
const MIN_END_CLEARANCE_KM = 2;
/** More than this is a list, not a choice. */
const MAX_STOPS = 6;

/**
 * Walk a LineString and return points at roughly `spacingKm` intervals.
 *
 * Measured along the polyline rather than by straight-line distance from the
 * origin, so a route that doubles back does not place two "stops" on top of
 * each other.
 */
function sampleAlong(coordinates, spacingKm) {
  const out = [];
  let sinceLast = 0;

  for (let i = 1; i < coordinates.length; i += 1) {
    const [prevLng, prevLat] = coordinates[i - 1];
    const [lng, lat] = coordinates[i];
    sinceLast += haversineKm(prevLat, prevLng, lat, lng);
    if (sinceLast >= spacingKm) {
      out.push({ lat, lng });
      sinceLast = 0;
    }
  }

  return out;
}

/**
 * Derive and persist stops for a route that has none.
 *
 * Idempotent: a route that already has stops is left exactly as it is, so this
 * is safe to call on every read path as well as at creation.
 *
 * Never throws. A route with no stops is the status quo — the rider is offered
 * "ride to the end" only — and that is a far better outcome than failing to
 * create the trip because a geocoder was slow.
 */
async function ensureVirtualStops(routeId) {
  try {
    const route = await prisma.route.findUnique({
      where: { id: routeId },
      include: { virtualStops: { select: { id: true } } },
    });
    if (!route || route.virtualStops.length > 0) return;

    // Too short to have a meaningful middle: both ends would be inside the
    // clearance, so there is nothing to offer.
    if (!(route.distanceKm > MIN_END_CLEARANCE_KM * 2 + 1)) return;

    const directions = await getDirections(
      route.originLng,
      route.originLat,
      route.destLng,
      route.destLat,
    );
    const coordinates = directions?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 3) return;

    // Spacing widens on a long route so a 60km trip does not produce a stop
    // every 3.5km and then get truncated to the first six.
    const spacing = Math.max(TARGET_SPACING_KM, route.distanceKm / (MAX_STOPS + 1));

    const candidates = sampleAlong(coordinates, spacing)
      .filter(
        (p) =>
          haversineKm(p.lat, p.lng, route.originLat, route.originLng) >= MIN_END_CLEARANCE_KM &&
          haversineKm(p.lat, p.lng, route.destLat, route.destLng) >= MIN_END_CLEARANCE_KM,
      )
      .slice(0, MAX_STOPS);

    if (!candidates.length) return;

    /**
     * Named, not numbered. "Kaneshie First Light" is a place a rider can decide
     * about; "Stop 3" is not. A failed lookup falls back to a distance label
     * rather than dropping the stop — the point is still a valid place to get
     * off, it just has a duller name.
     */
    const named = await Promise.all(
      candidates.map(async (p, i) => {
        let name = null;
        try {
          // Redis-cached and tier-aware — see placeNameFor. Null for a point
          // nothing can name, which the fallback below handles.
          name = await placeNameFor(p.lat, p.lng);
        } catch {
          /* falls back below */
        }
        return {
          routeId,
          name: name ?? `${Math.round(haversineKm(route.originLat, route.originLng, p.lat, p.lng))} km in`,
          lat: p.lat,
          lng: p.lng,
          sequence: i + 1,
        };
      }),
    );

    await prisma.virtualStop.createMany({ data: named });
    logger.info('[stops] derived virtual stops', { routeId, count: named.length });
  } catch (err) {
    logger.warn('[stops] could not derive virtual stops', { routeId, error: err.message });
  }
}

module.exports = { ensureVirtualStops, MAX_STOPS };
