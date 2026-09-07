/**
 * ── THE HEX GRID, PINNED ────────────────────────────────────────────────────
 *
 * `h3-index.service` is pure arithmetic over a coordinate: no database, no
 * Redis, no network. That makes it the one part of dispatch that can be tested
 * exactly rather than observed, so it is, and thoroughly — because the failure
 * mode of a spatial index is not a crash. It is a search that quietly covers
 * slightly the wrong ground and loses drivers who were in range, which looks
 * from the outside like "no drivers available" with a car around the corner.
 *
 * Runs with no stack, in milliseconds.
 *
 *   node scripts/e2e/h3-index.mjs
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { section, pass, fail, summary } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const API = join(HERE, '..', '..', 'eyego-api');
/**
 * Resolution is anchored at the API's own package.json, not at this file: that
 * is what puts `h3-js` (a dependency of the API, not of the harness) on the
 * search path. The service itself is loaded by ABSOLUTE path, because a
 * relative one would resolve against that anchor rather than against here.
 */
const require = createRequire(join(API, 'package.json'));

const h3svc = require(join(API, 'src', 'services', 'h3-index.service.js'));
const h3 = require('h3-js');

/** Synchronous check — see the note in ui-invariants.mjs for why not lib's. */
function check(what, fn) {
  try {
    const detail = fn();
    pass(what, typeof detail === 'string' ? detail : '');
    return true;
  } catch (e) {
    fail(what, e.message?.slice(0, 300));
    return false;
  }
}

const must = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

/** Accra: Independence Square. */
const ACCRA = { lat: 5.6037, lng: -0.187 };

function main() {
  section('1 · resolution and cell identity');

  check('resolution 8 — a neighbourhood block, not a city or a doorstep', () => {
    must(h3svc.RESOLUTION === 8, `resolution is ${h3svc.RESOLUTION}`);
    // ~0.53 km edge. If this drifts, every radius→ring conversion drifts with
    // it and sweeps silently change size.
    must(h3svc.EDGE_KM > 0.4 && h3svc.EDGE_KM < 0.7, `edge is ${h3svc.EDGE_KM} km`);
    return `res 8, edge ${h3svc.EDGE_KM.toFixed(3)} km`;
  });

  check('a real coordinate produces a valid cell', () => {
    const c = h3svc.cellFor(ACCRA.lat, ACCRA.lng);
    must(h3svc.isCell(c), `not a valid cell: ${c}`);
    return c;
  });

  check('a bad coordinate produces null, never a throw and never a cell', () => {
    for (const [lat, lng] of [[NaN, 1], [1, NaN], [undefined, undefined], [null, null], ['a', 'b'], [Infinity, 0]]) {
      const got = h3svc.cellFor(lat, lng);
      must(got === null, `cellFor(${lat}, ${lng}) returned ${got}`);
    }
    return 'all six rejected';
  });

  check('isCell rejects junk', () => {
    for (const bad of ['nonsense', '', null, undefined, 42, {}]) {
      must(!h3svc.isCell(bad), `isCell(${JSON.stringify(bad)}) was true`);
    }
    return 'rejected';
  });

  section('2 · radius → rings');

  check('a nonsense radius still yields a usable sweep', () => {
    must(h3svc.ringsFor(0) === 1, 'ringsFor(0) must floor at 1');
    must(h3svc.ringsFor(-5) === 1, 'ringsFor(-5) must floor at 1');
    must(h3svc.ringsFor(NaN) === 1, 'ringsFor(NaN) must floor at 1');
    must(h3svc.ringsFor(undefined) === 1, 'ringsFor(undefined) must floor at 1');
    return 'floors at 1';
  });

  check('a huge radius is capped — ring counts grow as 3k²+3k+1', () => {
    must(h3svc.ringsFor(99999) === h3svc.RING_CAP, `capped at ${h3svc.ringsFor(99999)}`);
    return `capped at ${h3svc.RING_CAP}`;
  });

  check('the ring step is MEASURED, and well below the textbook figure', () => {
    // The textbook answer (edge · √3) is ~0.92 km at res 8 and is wrong here by
    // about a third — see the note on STEP_KM. If this ever drifts back up
    // towards the ideal-packing number, the calibration has silently failed and
    // every sweep is under-covering again.
    const ideal = h3svc.EDGE_KM * Math.sqrt(3);
    must(h3svc.STEP_KM > 0.3, `step ${h3svc.STEP_KM} km is implausibly small`);
    must(
      h3svc.STEP_KM < ideal * 0.85,
      `step ${h3svc.STEP_KM.toFixed(3)} km is close to the ideal-packing ${ideal.toFixed(3)} km — ` +
        'calibration has probably fallen back to a constant or been replaced by the textbook formula.',
    );
    return `${h3svc.STEP_KM.toFixed(3)} km/ring (ideal packing would claim ${ideal.toFixed(3)})`;
  });

  check('rings grow monotonically with the radius', () => {
    let last = 0;
    for (const km of [1, 2, 5, 10, 18]) {
      const k = h3svc.ringsFor(km);
      must(k >= last, `ringsFor(${km})=${k} went backwards from ${last}`);
      last = k;
    }
    return 'monotonic';
  });

  section('3 · coverage — the failure that loses drivers');

  /**
   * The one that matters. `ringsFor` rounds UP deliberately: a sweep that
   * under-covers its own radius drops drivers who were genuinely in range, and
   * nothing downstream can tell that happened.
   */
  check('every point inside a radius is inside the sweep — across all of Ghana', () => {
    const R = 6371;
    /** Great-circle destination `km` from a point along `brg`. */
    const dest = (lat, lng, km, brg) => {
      const d = km / R;
      const b = (brg * Math.PI) / 180;
      const l1 = (lat * Math.PI) / 180;
      const g1 = (lng * Math.PI) / 180;
      const l2 = Math.asin(Math.sin(l1) * Math.cos(d) + Math.cos(l1) * Math.sin(d) * Math.cos(b));
      const g2 =
        g1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(l1), Math.cos(d) - Math.sin(l1) * Math.sin(l2));
      return [(l2 * 180) / Math.PI, (g2 * 180) / Math.PI];
    };

    /**
     * Origins spread over the whole country, not just Accra.
     *
     * H3 cells are projected onto an icosahedron and change size with position,
     * so a sweep calibrated in one place can under-cover in another. Testing a
     * single origin is how that gets missed — and it is exactly the class of
     * bug that produces "no drivers available" with a car around the corner,
     * in one city only.
     */
    const origins = [];
    for (let la = 5.0; la <= 9.0; la += 0.5) for (let lo = -2.5; lo <= 0.5; lo += 0.5) origins.push([la, lo]);

    // Every dispatch radius in play, at the very edge of the circle.
    for (const km of [0.5, 1, 2, 3, 5, 8, 12, 18]) {
      for (const [oLat, oLng] of origins) {
        const cells = new Set(h3svc.cellsWithin(oLat, oLng, km));
        for (let brg = 0; brg < 360; brg += 30) {
          const [lat, lng] = dest(oLat, oLng, km, brg);
          const cell = h3.latLngToCell(lat, lng, h3svc.RESOLUTION);
          must(
            cells.has(cell),
            `at (${oLat.toFixed(1)}, ${oLng.toFixed(1)}) a driver exactly ${km} km away on bearing ${brg}° ` +
              `is OUTSIDE the ${km} km sweep (k=${h3svc.ringsFor(km)}). The sweep under-covers its own ` +
              'radius, so dispatch silently loses candidates who were in range.',
          );
        }
      }
    }
    return `${origins.length} origins × 8 radii × 12 bearings all covered`;
  });

  check('the sweep widens with the radius and never shrinks', () => {
    let last = 0;
    for (const km of [1, 3, 6, 12]) {
      const n = h3svc.cellsWithin(ACCRA.lat, ACCRA.lng, km).length;
      must(n > last, `cellsWithin(${km}) = ${n}, not greater than ${last}`);
      last = n;
    }
    return `up to ${last} cells`;
  });

  check('the sweep is ordered innermost first, so widening is incremental', () => {
    const origin = h3svc.cellFor(ACCRA.lat, ACCRA.lng);
    const cells = h3svc.cellsWithin(ACCRA.lat, ACCRA.lng, 5);
    must(cells[0] === origin, 'the first cell is not the origin');
    // Ring distance must never decrease as the list is walked.
    let last = 0;
    for (const c of cells) {
      const d = h3.gridDistance(origin, c);
      must(d >= last, `cell at ring ${d} came after ring ${last}`);
      last = d;
    }
    return `${cells.length} cells, rings 0..${last}`;
  });

  check('bad coordinates yield an empty sweep, not a throw', () => {
    must(h3svc.cellsWithin(NaN, NaN, 5).length === 0, 'expected []');
    must(Array.isArray(h3svc.ringsWithin(NaN, NaN, 5)), 'ringsWithin must still return an array');
    return 'empty';
  });

  section('4 · ring structure');

  check('ring 0 is the origin alone, ring 1 is exactly 6 neighbours', () => {
    const origin = h3svc.cellFor(ACCRA.lat, ACCRA.lng);
    const rings = h3svc.ringsWithin(ACCRA.lat, ACCRA.lng, 2);
    must(rings[0].length === 1 && rings[0][0] === origin, 'ring 0 is not just the origin');
    // Six, because a hexagon has six edge-neighbours all at the same distance —
    // the property the grid was chosen for.
    must(rings[1].length === 6, `ring 1 has ${rings[1].length} cells, expected 6`);
    return 'hexagonal';
  });

  section('5 · geometry helpers');

  check('centreOf lands back inside the cell it came from', () => {
    const c = h3svc.cellFor(ACCRA.lat, ACCRA.lng);
    const ctr = h3svc.centreOf(c);
    must(ctr, 'centreOf returned null');
    must(h3svc.cellFor(ctr.lat, ctr.lng) === c, 'the centre of a cell is in a different cell');
    return 'round-trips';
  });

  check('boundaryOf is a CLOSED GeoJSON ring in [lng, lat] order', () => {
    const c = h3svc.cellFor(ACCRA.lat, ACCRA.lng);
    const b = h3svc.boundaryOf(c);
    must(Array.isArray(b), 'not an array');
    // Seven, not six: a LinearRing repeats its first vertex last. Trimming that
    // to "fix the hexagon" produces a ring MapLibre will not fill.
    must(b.length === 7, `${b.length} points, expected 7 (6 vertices + the closing repeat)`);
    must(JSON.stringify(b[0]) === JSON.stringify(b[6]), 'the ring is not closed');
    // [lng, lat]: reading these backwards is the classic way a hex lands in the
    // Gulf of Guinea. Accra is lng ≈ -0.19, lat ≈ 5.6.
    must(Math.abs(b[0][0] - ACCRA.lng) < 0.05, `first ordinate ${b[0][0]} is not a longitude near Accra`);
    must(Math.abs(b[0][1] - ACCRA.lat) < 0.05, `second ordinate ${b[0][1]} is not a latitude near Accra`);
    return 'closed, [lng, lat]';
  });

  check('cellDistance measures in rings', () => {
    const origin = h3svc.cellFor(ACCRA.lat, ACCRA.lng);
    const rings = h3svc.ringsWithin(ACCRA.lat, ACCRA.lng, 2);
    must(h3svc.cellDistance(origin, origin) === 0, 'distance to self is not 0');
    must(h3svc.cellDistance(origin, rings[1][0]) === 1, 'a neighbour is not 1 away');
    must(h3svc.cellDistance(origin, rings[2][0]) === 2, 'a second-ring cell is not 2 away');
    return 'rings';
  });

  check('cellDistance on junk returns null rather than throwing', () => {
    must(h3svc.cellDistance('nope', 'also-nope') === null, 'expected null');
    return 'null';
  });

  process.exit(summary());
}

main();
