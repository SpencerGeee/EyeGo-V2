/**
 * Behaviour tests for the map's two pure cores: the puck interpolator and the
 * camera policy.
 *
 * WHY node:test AND NOT JEST. No frontend workspace in this monorepo has a
 * jest runner installed, so the earlier version of this file — written in
 * jest's `describe/test/expect` — was never executed by anything. It looked
 * like coverage and was decoration. Node 22 ships a test runner and TypeScript
 * type-stripping in the box, so these assertions now actually run, with no new
 * dependency to install and nothing to configure:
 *
 *     yarn test:maps
 *
 * Everything under test here is deliberately free of React and of
 * MapLibre — that is the whole reason the maths was extracted out of the
 * components. If an import ever pulls native code in, this file stops running
 * and that is the signal.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PuckInterpolator,
  bearingBetween,
  lerpBearing,
  normaliseBearing,
  shortestDelta,
  metresBetween,
  MIN_INTERP_MS,
} from '../puck.ts';
import {
  boundsFor,
  isUsableCoord,
  overviewKey,
  paddingKeyOf,
  planCamera,
  paddingForSheet,
  shouldAutoResume,
  shouldReleaseToUser,
  MIN_BOUNDS_SPAN_DEG,
  OVERVIEW_REFIT_TOLERANCE_DEG,
  RESUME_AFTER_MS,
  NAV_PITCH,
  type Coord,
} from '../camera.ts';

/** jest's `toBeCloseTo` semantics: equal to within half a unit at `digits`. */
function close(actual: number, expected: number, digits = 2) {
  const tolerance = Math.pow(10, -digits) / 2;
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}
const gt = (a: number, b: number) => assert.ok(a > b, `expected ${a} > ${b}`);
const lt = (a: number, b: number) => assert.ok(a < b, `expected ${a} < ${b}`);
const gte = (a: number, b: number) => assert.ok(a >= b, `expected ${a} >= ${b}`);

describe('bearing maths — the spinning-car bug', () => {
  test('shortest delta takes the short way round the wrap point', () => {
    // The whole bug: naive interpolation from 359 to 1 sweeps -358 degrees and
    // the marker spins on its axis.
    assert.equal(shortestDelta(359, 1), 2);
    assert.equal(shortestDelta(1, 359), -2);
    // The half-turn is ambiguous by definition; the contract picks
    // anticlockwise. Asserted so a change of direction is a deliberate one.
    assert.equal(shortestDelta(0, 180), -180);
    assert.equal(shortestDelta(10, 10), 0);
  });

  test('interpolating across north never sweeps the long way', () => {
    // Halfway from 350 to 10 is 0, not 180.
    close(lerpBearing(350, 10, 0.5), 0, 5);
  });

  test('bearings are always normalised into [0, 360)', () => {
    assert.equal(normaliseBearing(-90), 270);
    assert.equal(normaliseBearing(450), 90);
    gte(lerpBearing(350, 10, 1), 0);
    lt(lerpBearing(350, 10, 1), 360);
  });

  test('bearing between two points points the right way', () => {
    // Due north and due east from a point in Accra.
    close(bearingBetween(5.6, -0.19, 5.7, -0.19), 0, 0);
    close(bearingBetween(5.6, -0.19, 5.6, -0.09), 90, 0);
  });
});

describe('puck interpolation', () => {
  const base = { latitude: 5.6, longitude: -0.19 };

  test('there is no puck before the first fix', () => {
    const p = new PuckInterpolator();
    assert.equal(p.at(Date.now()), null);
    assert.equal(p.hasFix, false);
  });

  test('the first fix places the puck exactly, with no animation from nowhere', () => {
    const p = new PuckInterpolator();
    p.push({ ...base, heading: 90, speed: 10, at: 1000 });
    const s = p.at(1000)!;
    close(s.latitude, base.latitude, 6);
    close(s.longitude, base.longitude, 6);
  });

  test('the puck moves gradually between fixes instead of teleporting', () => {
    const p = new PuckInterpolator();
    p.push({ ...base, heading: 0, speed: 10, at: 0 });
    p.push({ latitude: 5.7, longitude: -0.19, heading: 0, speed: 10, at: 1000 });

    const early = p.at(1000 + MIN_INTERP_MS * 0.2)!;
    const late = p.at(1000 + MIN_INTERP_MS * 0.9)!;

    // Strictly between the two fixes, and strictly progressing.
    gt(early.latitude, 5.6);
    lt(early.latitude, 5.7);
    gt(late.latitude, early.latitude);
  });

  test('the puck settles on the newest fix and stops', () => {
    const p = new PuckInterpolator();
    p.push({ ...base, heading: 0, speed: 10, at: 0 });
    p.push({ latitude: 5.7, longitude: -0.19, heading: 0, speed: 10, at: 1000 });

    // Long after the animation window — it must sit still, not drift onwards.
    const settled = p.at(1_000_000)!;
    close(settled.latitude, 5.7, 6);
    assert.equal(settled.moving, false);
  });

  test('a stationary vehicle does not spin', () => {
    const p = new PuckInterpolator();
    p.push({ ...base, heading: 90, speed: 10, at: 0 });
    const before = p.at(0)!.bearing;

    // Parked: speed below the floor, heading reported as noise.
    p.push({ ...base, heading: 271, speed: 0.05, at: 2000 });
    const after = p.at(1_000_000)!.bearing;

    close(after, before, 5);
  });

  test('a heading is derived from travel when the platform reports none', () => {
    const p = new PuckInterpolator();
    p.push({ ...base, heading: null, speed: null, at: 0 });
    // ~1.1 km due north — well past the scatter threshold.
    p.push({ latitude: 5.61, longitude: -0.19, heading: null, speed: null, at: 2000 });
    close(p.at(1_000_000)!.bearing, 0, 0);
  });

  test('reset clears the puck', () => {
    const p = new PuckInterpolator();
    p.push({ ...base, heading: 0, speed: 5, at: 0 });
    p.reset();
    assert.equal(p.at(1000), null);
  });
});

describe('camera policy', () => {
  const padding = { paddingTop: 100, paddingBottom: 400, paddingLeft: 32, paddingRight: 32 };
  const accra: Coord = [-0.19, 5.6];
  const tema: Coord = [-0.01, 5.67];

  test('a released camera is never moved', () => {
    const plan = planCamera('free', { center: accra, fit: [accra, tema] }, padding);
    assert.equal(plan.kind, 'none');
  });

  test('follow points at the target and keeps north up', () => {
    const plan = planCamera('follow', { center: accra, bearing: 137 }, padding);
    assert.equal(plan.kind, 'setCamera');
    assert.deepEqual(plan.centerCoordinate, accra);
    // A rider watching a car approach should not have the world rotate.
    assert.equal(plan.heading, 0);
    assert.equal(plan.pitch, 0);
  });

  test('followCourse rotates to the direction of travel and tilts', () => {
    const plan = planCamera('followCourse', { center: accra, bearing: 137 }, padding);
    assert.equal(plan.heading, 137);
    assert.equal(plan.pitch, NAV_PITCH);
  });

  test('overview frames everything that matters', () => {
    const plan = planCamera('overview', { fit: [accra, tema] }, padding);
    assert.equal(plan.kind, 'fitBounds');
    gt(plan.bounds!.ne[0], plan.bounds!.sw[0]);
    gt(plan.bounds!.ne[1], plan.bounds!.sw[1]);
  });

  test('nothing usable to frame means the camera does nothing', () => {
    assert.equal(planCamera('overview', { fit: [] }, padding).kind, 'none');
    assert.equal(planCamera('follow', { center: null }, padding).kind, 'none');
  });

  test('a garbage coordinate can never reach the native camera', () => {
    assert.equal(isUsableCoord([NaN, 5.6]), false);
    assert.equal(isUsableCoord([Infinity, 5.6]), false);
    assert.equal(isUsableCoord([200, 5.6]), false);
    assert.equal(isUsableCoord([-0.19, 95]), false);
    assert.equal(isUsableCoord([-0.19, 5.6]), true);

    assert.equal(planCamera('follow', { center: [NaN, 5.6] as Coord }, padding).kind, 'none');
  });
});

describe('bounds — the documented cause of the map SIGABRT', () => {
  test('a single point still produces a real box', () => {
    // fitBounds on a zero-area box makes MapLibre compute an infinite zoom and
    // abort the process. One point must still yield something inflated.
    const b = boundsFor([[-0.19, 5.6]])!;
    gte(b.ne[0] - b.sw[0], MIN_BOUNDS_SPAN_DEG * 0.99);
    gte(b.ne[1] - b.sw[1], MIN_BOUNDS_SPAN_DEG * 0.99);
  });

  test('two identical points still produce a real box', () => {
    const b = boundsFor([[-0.19, 5.6], [-0.19, 5.6]])!;
    gt(b.ne[0], b.sw[0]);
    gt(b.ne[1], b.sw[1]);
  });

  test('unusable coordinates are dropped rather than poisoning the box', () => {
    const b = boundsFor([[NaN, 5.6] as unknown as Coord, [-0.19, 5.6], [-0.01, 5.67]])!;
    assert.equal(Number.isFinite(b.ne[0]), true);
    assert.equal(Number.isFinite(b.sw[1]), true);
  });

  test('nothing usable yields null, so the caller does nothing at all', () => {
    assert.equal(boundsFor([]), null);
    assert.equal(boundsFor([[NaN, NaN] as unknown as Coord]), null);
  });
});

describe('who owns the camera', () => {
  test('only a genuine gesture takes the camera', () => {
    // MapLibre reports the moves this module itself commands; treating those as
    // user intent makes following cancel itself on the first frame.
    assert.equal(shouldReleaseToUser({ isUserInteraction: true }), true);
    assert.equal(shouldReleaseToUser({ properties: { isUserInteraction: true } }), true);
    assert.equal(shouldReleaseToUser({ isUserInteraction: false }), false);
    assert.equal(shouldReleaseToUser({}), false);
  });

  test('the camera comes back on its own, but not immediately', () => {
    const t = 1_000_000;
    assert.equal(shouldAutoResume(t, t + 1_000), false);
    assert.equal(shouldAutoResume(t, t + RESUME_AFTER_MS), true);
    // Never released → never auto-resumes.
    assert.equal(shouldAutoResume(null, t), false);
  });
});

describe('sheet-aware padding', () => {
  test('the subject is kept above the bottom sheet', () => {
    const p = paddingForSheet({ screenHeight: 800, sheetFraction: 0.44, safeTop: 47 });
    gt(p.paddingBottom!, 300);
    gt(p.paddingTop!, 47);
  });

  test('an absurd sheet fraction cannot consume the whole viewport', () => {
    const p = paddingForSheet({ screenHeight: 800, sheetFraction: 5, safeTop: 47 });
    lt(p.paddingBottom!, 800);
    const nan = paddingForSheet({ screenHeight: 800, sheetFraction: NaN, safeTop: 47 });
    assert.equal(Number.isFinite(nan.paddingBottom!), true);
  });
});

/**
 * The frame-loop dedupe. This is the regression guard for "the map feels
 * disjointed": `overview` folds the live interpolated driver position into its
 * fit set, so keying the re-frame on the exact bounding box meant no two
 * consecutive animation frames ever matched and a 600 ms `fitBounds` was
 * restarted sixty times a second.
 */
describe('overview re-frame key', () => {
  const pad = { paddingTop: 71, paddingBottom: 376, paddingLeft: 32, paddingRight: 32 };
  const box = (dLng: number) => ({
    ne: [-0.18 + dLng, 5.61] as Coord,
    sw: [-0.20 + dLng, 5.59] as Coord,
  });

  test('a puck creeping within tolerance does not re-frame', () => {
    // A tenth of the grid — roughly what one animation frame of a car at
    // 50 km/h actually moves.
    const nudge = OVERVIEW_REFIT_TOLERANCE_DEG / 10;
    assert.equal(overviewKey(box(0), pad), overviewKey(box(nudge), pad));
  });

  test('a move worth watching does re-frame', () => {
    assert.notEqual(overviewKey(box(0), pad), overviewKey(box(0.01), pad));
  });

  test('the same box under a different sheet is a different frame', () => {
    // The old key was bounds-only, so a stage change that grew the sheet over
    // an unchanged pickup/dropoff pair was suppressed and the subject stayed
    // hidden behind the panel.
    const taller = { ...pad, paddingBottom: 496 };
    assert.notEqual(overviewKey(box(0), pad), overviewKey(box(0), taller));
  });

  test('the padding key separates a stage change from a driver moving', () => {
    // This is what lets the frame loop pre-empt an in-flight animation for the
    // first and make the second wait.
    const taller = { ...pad, paddingBottom: 496 };
    assert.equal(paddingKeyOf(pad), paddingKeyOf({ ...pad }));
    assert.notEqual(paddingKeyOf(pad), paddingKeyOf(taller));
    // A missing edge is zero, not undefined — otherwise every partial padding
    // object would read as a fresh stage.
    assert.equal(paddingKeyOf({}), paddingKeyOf({ paddingTop: 0 }));
  });
});

describe('distance helper', () => {
  test('metresBetween is sane over a short hop', () => {
    // ~1.1 km per 0.01 degree of latitude.
    gt(metresBetween(5.6, -0.19, 5.61, -0.19), 1000);
    lt(metresBetween(5.6, -0.19, 5.61, -0.19), 1200);
    assert.equal(metresBetween(5.6, -0.19, 5.6, -0.19), 0);
  });
});
