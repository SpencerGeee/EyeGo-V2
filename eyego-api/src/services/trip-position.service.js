/**
 * How far along its own road a bus is, as a 0..1 ratio of the route.
 *
 * The driver's live fix projected onto the trip's polyline — the same
 * projection the fare uses for drop-offs (bookings.service `resolveDropoff`),
 * so "is my stop still ahead of the bus" and "what share of the road do I pay
 * for" are measured on one ruler. 0 before the bus has left, or with no fix /
 * no road, which is the conservative answer: nothing has been passed.
 */
const { projectOntoPolyline } = require('../utils/geo');

const DEPARTED = new Set(['DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'IN_PROGRESS']);

function busRatioFor(trip, routeLine) {
  const lat = trip?.driver?.currentLat;
  const lng = trip?.driver?.currentLng;
  if (!DEPARTED.has(trip?.status) || !routeLine || !Number.isFinite(lat) || !Number.isFinite(lng)) return 0;
  const p = projectOntoPolyline(lat, lng, routeLine);
  return p && p.totalM > 0 ? Math.min(1, Math.max(0, p.alongM / p.totalM)) : 0;
}

/** Metres of road behind a 0..1 ratio, for margins expressed in metres. */
function routeLengthM(routeLine) {
  if (!routeLine) return 0;
  const end = routeLine[routeLine.length - 1];
  const p = projectOntoPolyline(end[1], end[0], routeLine);
  return p?.totalM ?? 0;
}

module.exports = { busRatioFor, routeLengthM, DEPARTED };
