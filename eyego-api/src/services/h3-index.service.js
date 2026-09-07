'use strict';

const h3 = require('h3-js');
const logger = require('../utils/logger');

/**
 * ── THE HEX GRID ────────────────────────────────────────────────────────────
 *
 * One vocabulary for "where", shared by dispatch, surge and the heatmap.
 *
 * WHY A GRID AND NOT JUST A RADIUS. A circle drawn around a pickup is a fine
 * way to ask "who is near me" and a bad way to ask anything else. It has no
 * identity, so two overlapping circles cannot be compared, added, cached or
 * stored; every question about an AREA — how much demand is here, what the
 * surge is here, was this area short of drivers an hour ago — has to be
 * re-derived from raw points every time it is asked. That is why the heatmap
 * had its own ad-hoc bucketing and surge had another: three subsystems each
 * inventing a different answer to "which bit of the city is this".
 *
 * A cell id is a stable, comparable, cacheable name for a piece of ground. H3
 * is the grid Uber built for exactly this and then open-sourced.
 *
 * WHY HEXAGONS AND NOT SQUARES. Every neighbour of a hexagon shares an edge
 * and is the same distance away. A square grid has eight neighbours at two
 * different distances (edge and corner, 1 vs √2), so "one ring out" is not a
 * single distance and expanding a search by a ring biases it diagonally.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
 *
 * It does not rank drivers. `matcher.service` ranks by real road ETA from a
 * routing provider, and hex distance is strictly worse information than that:
 * two cells can be adjacent with a river, a railway or a one-way system
 * between them. H3's job here is to decide WHO IS A CANDIDATE — cheaply, and
 * with a stable name for the area — and then get out of the way.
 *
 * It is also additive. The Redis geo-set remains the source of coordinates and
 * the fallback for every lookup; nothing here is on the critical path alone.
 */

/**
 * Resolution 8: ~0.53 km edge, ~0.74 km² per cell.
 *
 * Chosen against Accra, not in the abstract. One cell is roughly a
 * neighbourhood block — small enough that surge in Osu does not leak into
 * Labadi, large enough that a cell usually contains more than one driver, so a
 * k-ring of 1 (7 cells, ~5 km²) is a realistic first sweep rather than an
 * empty one. Uber uses 7–9 for dispatch depending on density.
 */
const RESOLUTION = 8;

/** Average edge length, km. Reported for diagnostics; NOT used for sizing —
 *  see `STEP_KM` for why the obvious geometry is the wrong basis. */
const EDGE_KM = h3.getHexagonEdgeLengthAvg(RESOLUTION, 'km');

/** Somewhere in the middle of where we operate. Only used to calibrate. */
const CALIBRATION_POINT = { lat: 5.6037, lng: -0.187 };

/**
 * ── HOW FAR ONE RING ACTUALLY REACHES, MEASURED RATHER THAN DERIVED ─────────
 *
 * The textbook answer is that adjacent hexagons are `edge · √3` apart, so `k`
 * rings reach `k · edge · √3`. At resolution 8 that says ~0.92 km per ring.
 * The true worst-case figure here is nearer 0.62 km — about a third less — and
 * a sweep built on the textbook number under-covers its own radius by 35%.
 *
 * Two reasons, both structural:
 *
 *   1. `getHexagonEdgeLengthAvg` is a GLOBAL average. H3 cells are projected
 *      onto an icosahedron and vary substantially in size with position; the
 *      cells over Ghana are not the average cells.
 *   2. `gridDistance` counts CELLS along a grid path, and on a Class II grid
 *      that path is not a straight line on the sphere. Ring `k` is therefore
 *      closer to the origin, in the worst direction, than ideal packing
 *      predicts.
 *
 * Neither is worth modelling analytically when it can simply be measured. This
 * walks a real ring at the resolution and region in use and takes the WORST
 * (minimum) distance any cell in that ring sits from the origin — the direction
 * in which a sweep would come up short first.
 *
 * Measured once, at load, over one `gridDisk` call.
 */
function calibrateStepKm() {
  const K = 8;
  try {
    const origin = h3.latLngToCell(CALIBRATION_POINT.lat, CALIBRATION_POINT.lng, RESOLUTION);
    const [oLat, oLng] = h3.cellToLatLng(origin);
    const ring = h3.gridDiskDistances(origin, K)[K];
    if (!Array.isArray(ring) || ring.length === 0) throw new Error('empty ring');
    let worst = Infinity;
    for (const cell of ring) {
      const [lat, lng] = h3.cellToLatLng(cell);
      worst = Math.min(worst, haversineKm(oLat, oLng, lat, lng));
    }
    if (!Number.isFinite(worst) || worst <= 0) throw new Error(`bad measurement ${worst}`);
    return worst / K;
  } catch (err) {
    // A conservative constant, not the optimistic textbook one: if calibration
    // fails, over-covering costs a few extra Redis reads and under-covering
    // loses drivers.
    logger.warn(`h3 step calibration failed, using fallback: ${err.message}`);
    return 0.55;
  }
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Worst-case kilometres covered by one additional ring. */
const STEP_KM = calibrateStepKm();

/**
 * The most rings any single sweep may ask for.
 *
 * Cell counts grow as 3k²+3k+1, and every cell is a Redis key in the SUNION,
 * so this is a cost ceiling rather than a correctness one. 34 rings covers the
 * widest dispatch sweep (18 km) with room to spare and costs ~3.5k keys at the
 * very edge — a sweep that only runs when a search has already failed twice.
 */
const RING_CAP = 34;

/**
 * The cell containing a point, or null if the point is not real.
 *
 * Null rather than throwing: every caller here is on a dispatch or telemetry
 * path where a bad coordinate must degrade to "no cell" and let the existing
 * radius search answer, never take a request down.
 */
function cellFor(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  try {
    return h3.latLngToCell(lat, lng, RESOLUTION);
  } catch (err) {
    logger.debug(`h3 cellFor failed: ${err.message}`);
    return null;
  }
}

/**
 * How many rings out are needed to cover `radiusKm` from ANY point in the
 * origin cell.
 *
 * ── THE OFF-CENTRE TERM, WHICH IS EASY TO FORGET AND SILENT WHEN WRONG ──────
 *
 * This was `ceil(km / (2 · edge))`, reasoning that a k-ring reaches about `k`
 * cell diameters. That is true measured from the CENTRE of the origin cell —
 * and the pickup is never at the centre. It can sit anywhere in the cell,
 * including on a vertex, which is one full cell-radius (≈ one edge length, for
 * a hexagon) closer to the boundary in that direction.
 *
 * So the guaranteed coverage from an arbitrary query point is
 *
 *     edge · (2k − 1)          not          edge · 2k
 *
 * and solving `edge · (2k − 1) ≥ R` gives the `+1` below. The old formula
 * under-covered by up to one full cell in the worst direction: at a 1 km
 * radius it returned a single ring, which guarantees only ~0.53 km, and the
 * harness caught a driver 0.9 km away falling outside a 1 km sweep. Nothing
 * downstream could have detected that — an under-covering spatial index does
 * not fail, it just quietly returns fewer candidates than exist.
 *
 * Rounded UP and floored at 1 for the same reason. Capped because ring counts
 * grow as 3k²+3k+1, so a nonsense radius must not ask Redis for a million
 * cells; at the widest dispatch sweep (18 km) this is k=18, or 1027 cells.
 */
function ringsFor(radiusKm) {
  const km = Number(radiusKm);
  if (!Number.isFinite(km) || km <= 0) return 1;
  // `+1` is the off-centre margin: the query point can sit anywhere in the
  // origin cell, including a full cell-radius nearer the boundary in the
  // direction being measured.
  return Math.min(RING_CAP, Math.max(1, Math.ceil(km / STEP_KM) + 1));
}

/**
 * Every cell within `radiusKm` of a point, innermost first.
 *
 * Ordered by ring so a caller can widen progressively — ask the middle, then
 * the ring around it — instead of re-running a bigger circle from scratch and
 * re-examining everyone it already looked at.
 */
function cellsWithin(lat, lng, radiusKm) {
  const origin = cellFor(lat, lng);
  if (!origin) return [];
  const k = ringsFor(radiusKm);
  try {
    // `gridDiskDistances` groups by ring, which is what makes the widening
    // ordered. `gridDisk` alone returns an unordered set.
    const rings = h3.gridDiskDistances(origin, k);
    return rings.flat();
  } catch (err) {
    logger.debug(`h3 cellsWithin failed: ${err.message}`);
    return [origin];
  }
}

/**
 * The cells in each successive ring, as an array of arrays.
 *
 * `[[origin], [6 neighbours], [12 next out], …]`. Dispatch uses this to expand
 * a candidate search one ring at a time.
 */
function ringsWithin(lat, lng, radiusKm) {
  const origin = cellFor(lat, lng);
  if (!origin) return [];
  try {
    return h3.gridDiskDistances(origin, ringsFor(radiusKm));
  } catch (err) {
    logger.debug(`h3 ringsWithin failed: ${err.message}`);
    return [[origin]];
  }
}

/** The centre of a cell, for drawing it or measuring to it. */
function centreOf(cell) {
  try {
    const [lat, lng] = h3.cellToLatLng(cell);
    return { lat, lng };
  } catch {
    return null;
  }
}

/**
 * The cell's outline as `[lng, lat]` pairs — GeoJSON order, ready to render.
 *
 * SEVEN points, not six: a GeoJSON LinearRing must be closed, so the first
 * vertex is repeated as the last. That is correct and required by the spec —
 * dropping the duplicate to "fix the hexagon" produces a ring Mapbox and
 * MapLibre will refuse to fill.
 */
function boundaryOf(cell) {
  try {
    return h3.cellToBoundary(cell, true);
  } catch {
    return null;
  }
}

/**
 * Grid distance in cells between two cells, or null if they are incomparable.
 *
 * The inputs are validated rather than left to `gridDistance` to reject: it
 * does not reliably throw on a malformed index, so a junk pair could come back
 * as a plausible-looking number. A distance that is wrong is worse than one
 * that is absent — the caller can branch on null.
 */
function cellDistance(a, b) {
  if (!isCell(a) || !isCell(b)) return null;
  try {
    const d = h3.gridDistance(a, b);
    return Number.isFinite(d) && d >= 0 ? d : null;
  } catch {
    return null;
  }
}

/** True if `cell` is a well-formed H3 index — cheap input validation. */
function isCell(cell) {
  try {
    return typeof cell === 'string' && h3.isValidCell(cell);
  } catch {
    return false;
  }
}

module.exports = {
  RESOLUTION,
  EDGE_KM,
  STEP_KM,
  RING_CAP,
  cellFor,
  ringsFor,
  cellsWithin,
  ringsWithin,
  centreOf,
  boundaryOf,
  cellDistance,
  isCell,
};
