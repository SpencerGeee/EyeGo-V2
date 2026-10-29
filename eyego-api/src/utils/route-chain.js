/**
 * A bus route as an ordered chain — origin, its virtual stops by sequence,
 * destination — used by search to answer "does this bus pass me, in my
 * direction, and is it still behind my stop?" without a Directions call per
 * candidate trip.
 *
 * ponytail: the chain is straight lines between stops, so ratios are close to
 * but not exactly the road's. Search only ESTIMATES with it; bookSeat measures
 * the real road before it sells anything. Store per-stop road ratios on
 * VirtualStop if search and booking ever disagree visibly.
 */
const { projectOntoPolyline } = require('./geo');

function chainFor(route) {
  if (!route) return null;
  const stops = [...(route.virtualStops ?? [])].sort((a, b) => a.sequence - b.sequence);
  const points = [
    { id: null, name: route.originName, lat: route.originLat, lng: route.originLng },
    ...stops.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng })),
    { id: null, name: route.destinationName, lat: route.destLat, lng: route.destLng },
  ].filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (points.length < 2) return null;
  return { points, line: points.map((p) => [p.lng, p.lat]) };
}

/** Where a point sits on the chain: { ratio, offKm } or null. */
function placeOnChain(chain, lat, lng) {
  if (!chain || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const p = projectOntoPolyline(lat, lng, chain.line);
  if (!p || !(p.totalM > 0)) return null;
  return { ratio: Math.min(1, Math.max(0, p.alongM / p.totalM)), offKm: p.distanceM / 1000, lengthKm: p.totalM / 1000 };
}

/** The stop on the chain nearest a ratio, at or after `minRatio`. */
function nearestStop(chain, ratio, { after = -1 } = {}) {
  if (!chain) return null;
  const n = chain.points.length;
  let best = null;
  chain.points.forEach((pt, i) => {
    if (!pt.id) return;
    const r = placeOnChain(chain, pt.lat, pt.lng)?.ratio ?? i / (n - 1);
    if (r <= after) return;
    const d = Math.abs(r - ratio);
    if (!best || d < best.d) best = { stop: pt, ratio: r, d };
  });
  return best ? { id: best.stop.id, name: best.stop.name, ratio: best.ratio } : null;
}

module.exports = { chainFor, placeOnChain, nearestStop };
