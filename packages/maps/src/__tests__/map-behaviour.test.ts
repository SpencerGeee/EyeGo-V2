import {
  PuckInterpolator,
  bearingBetween,
  lerpBearing,
  normaliseBearing,
  shortestDelta,
  metresBetween,
  MIN_INTERP_MS,
} from '../puck';
import {
  boundsFor,
  isUsableCoord,
  planCamera,
  paddingForSheet,
  shouldAutoResume,
  shouldReleaseToUser,
  MIN_BOUNDS_SPAN_DEG,
  RESUME_AFTER_MS,
  NAV_PITCH,
  type Coord,
} from '../camera';

describe('bearing maths — the spinning-car bug', () => {
  test('shortest delta takes the short way round the wrap point', () => {
    // The whole bug: naive interpolation from 359 to 1 sweeps -358 degrees and
    // the marker spins on its axis.
    expect(shortestDelta(359, 1)).toBe(2);
    expect(shortestDelta(1, 359)).toBe(-2);
    expect(shortestDelta(0, 180)).toBe(180);
    expect(shortestDelta(10, 10)).toBe(0);
  });

  test('interpolating across north never sweeps the long way', () => {
    const mid = lerpBearing(350, 10, 0.5);
    // Halfway from 350 to 10 is 0, not 180.
    expect(mid).toBeCloseTo(0, 5);
  });

  test('bearings are always normalised into [0, 360)', () => {
    expect(normaliseBearing(-90)).toBe(270);
    expect(normaliseBearing(450)).toBe(90);
    expect(lerpBearing(350, 10, 1)).toBeGreaterThanOrEqual(0);
    expect(lerpBearing(350, 10, 1)).toBeLessThan(360);
  });

  test('bearing between two points points the right way', () => {
    // Due north and due east from a point in Accra.
    expect(bearingBetween(5.6, -0.19, 5.7, -0.19)).toBeCloseTo(0, 0);
    expect(bearingBetween(5.6, -0.19, 5.6, -0.09)).toBeCloseTo(90, 0);
  });
});

describe('puck interpolation', () => {
  const base = { latitude: 5.6, longitude: -0.19 };

  test('there is no puck before the first fix', () => {
    const p = new PuckInterpolator();
    expect(p.at(Date.now())).toBeNull();
    expect(p.hasFix).toBe(false);
  });

  test('the first fix places the puck exactly, with no animation from nowhere', () => {
    const p = new PuckInterpolator();
    p.push({ ...base, heading: 90, speed: 10, at: 1000 });
    const s = p.at(1000)!;
    expect(s.latitude).toBeCloseTo(base.latitude, 6);
    expect(s.longitude).toBeCloseTo(base.longitude, 6);
  });

  test('the puck moves gradually between fixes instead of teleporting', () => {
    const p = new PuckInterpolator();
    p.push({ ...base, heading: 0, speed: 10, at: 0 });
    p.push({ latitude: 5.7, longitude: -0.19, heading: 0, speed: 10, at: 1000 });

    const early = p.at(1000 + MIN_INTERP_MS * 0.2)!;
    const late = p.at(1000 + MIN_INTERP_MS * 0.9)!;

    // Strictly between the two fixes, and strictly progressing.
    expect(early.latitude).toBeGreaterThan(5.6);
    expect(early.latitude).toBeLessThan(5.7);
    expect(late.latitude).toBeGreaterThan(early.latitude);
  });

  test('the puck settles on the newest fix and stops', () => {
    const p = new PuckInterpolator();
    p.push({ ...base, heading: 0, speed: 10, at: 0 });
    p.push({ latitude: 5.7, longitude: -0.19, heading: 0, speed: 10, at: 1000 });

    // Long after the animation window — it must sit still, not drift onwards.
    const settled = p.at(1_000_000)!;
    expect(settled.latitude).toBeCloseTo(5.7, 6);
    expect(settled.moving).toBe(false);
  });

  test('a stationary vehicle does not spin', () => {
    const p = new PuckInterpolator();
    p.push({ ...base, heading: 90, speed: 10, at: 0 });
    const before = p.at(0)!.bearing;

    // Parked: speed below the floor, heading reported as noise.
    p.push({ ...base, heading: 271, speed: 0.05, at: 2000 });
    const after = p.at(1_000_000)!.bearing;

    expect(after).toBeCloseTo(before, 5);
  });

  test('a heading is derived from travel when the platform reports none', () => {
    const p = new PuckInterpolator();
    p.push({ ...base, heading: null, speed: null, at: 0 });
    // ~1.1 km due north — well past the scatter threshold.
    p.push({ latitude: 5.61, longitude: -0.19, heading: null, speed: null, at: 2000 });
    expect(p.at(1_000_000)!.bearing).toBeCloseTo(0, 0);
  });

  test('reset clears the puck', () => {
    const p = new PuckInterpolator();
    p.push({ ...base, heading: 0, speed: 5, at: 0 });
    p.reset();
    expect(p.at(1000)).toBeNull();
  });
});

describe('camera policy', () => {
  const padding = { paddingTop: 100, paddingBottom: 400, paddingLeft: 32, paddingRight: 32 };
  const accra: Coord = [-0.19, 5.6];
  const tema: Coord = [-0.01, 5.67];

  test('a released camera is never moved', () => {
    const plan = planCamera('free', { center: accra, fit: [accra, tema] }, padding);
    expect(plan.kind).toBe('none');
  });

  test('follow points at the target and keeps north up', () => {
    const plan = planCamera('follow', { center: accra, bearing: 137 }, padding);
    expect(plan.kind).toBe('setCamera');
    expect(plan.centerCoordinate).toEqual(accra);
    // A rider watching a car approach should not have the world rotate.
    expect(plan.heading).toBe(0);
    expect(plan.pitch).toBe(0);
  });

  test('followCourse rotates to the direction of travel and tilts', () => {
    const plan = planCamera('followCourse', { center: accra, bearing: 137 }, padding);
    expect(plan.heading).toBe(137);
    expect(plan.pitch).toBe(NAV_PITCH);
  });

  test('overview frames everything that matters', () => {
    const plan = planCamera('overview', { fit: [accra, tema] }, padding);
    expect(plan.kind).toBe('fitBounds');
    expect(plan.bounds!.ne[0]).toBeGreaterThan(plan.bounds!.sw[0]);
    expect(plan.bounds!.ne[1]).toBeGreaterThan(plan.bounds!.sw[1]);
  });

  test('nothing usable to frame means the camera does nothing', () => {
    expect(planCamera('overview', { fit: [] }, padding).kind).toBe('none');
    expect(planCamera('follow', { center: null }, padding).kind).toBe('none');
  });

  test('a garbage coordinate can never reach the native camera', () => {
    expect(isUsableCoord([NaN, 5.6])).toBe(false);
    expect(isUsableCoord([Infinity, 5.6])).toBe(false);
    expect(isUsableCoord([200, 5.6])).toBe(false);
    expect(isUsableCoord([-0.19, 95])).toBe(false);
    expect(isUsableCoord([-0.19, 5.6])).toBe(true);

    expect(planCamera('follow', { center: [NaN, 5.6] as Coord }, padding).kind).toBe('none');
  });
});

describe('bounds — the documented cause of the map SIGABRT', () => {
  test('a single point still produces a real box', () => {
    // fitBounds on a zero-area box makes MapLibre compute an infinite zoom and
    // abort the process. One point must still yield something inflated.
    const b = boundsFor([[-0.19, 5.6]])!;
    expect(b.ne[0] - b.sw[0]).toBeGreaterThanOrEqual(MIN_BOUNDS_SPAN_DEG * 0.99);
    expect(b.ne[1] - b.sw[1]).toBeGreaterThanOrEqual(MIN_BOUNDS_SPAN_DEG * 0.99);
  });

  test('two identical points still produce a real box', () => {
    const b = boundsFor([[-0.19, 5.6], [-0.19, 5.6]])!;
    expect(b.ne[0]).toBeGreaterThan(b.sw[0]);
    expect(b.ne[1]).toBeGreaterThan(b.sw[1]);
  });

  test('unusable coordinates are dropped rather than poisoning the box', () => {
    const b = boundsFor([[NaN, 5.6] as unknown as Coord, [-0.19, 5.6], [-0.01, 5.67]])!;
    expect(Number.isFinite(b.ne[0])).toBe(true);
    expect(Number.isFinite(b.sw[1])).toBe(true);
  });

  test('nothing usable yields null, so the caller does nothing at all', () => {
    expect(boundsFor([])).toBeNull();
    expect(boundsFor([[NaN, NaN] as unknown as Coord])).toBeNull();
  });
});

describe('who owns the camera', () => {
  test('only a genuine gesture takes the camera', () => {
    // MapLibre reports the moves this module itself commands; treating those as
    // user intent makes following cancel itself on the first frame.
    expect(shouldReleaseToUser({ isUserInteraction: true })).toBe(true);
    expect(shouldReleaseToUser({ properties: { isUserInteraction: true } })).toBe(true);
    expect(shouldReleaseToUser({ isUserInteraction: false })).toBe(false);
    expect(shouldReleaseToUser({})).toBe(false);
  });

  test('the camera comes back on its own, but not immediately', () => {
    const t = 1_000_000;
    expect(shouldAutoResume(t, t + 1_000)).toBe(false);
    expect(shouldAutoResume(t, t + RESUME_AFTER_MS)).toBe(true);
    // Never released → never auto-resumes.
    expect(shouldAutoResume(null, t)).toBe(false);
  });
});

describe('sheet-aware padding', () => {
  test('the subject is kept above the bottom sheet', () => {
    const p = paddingForSheet({ screenHeight: 800, sheetFraction: 0.44, safeTop: 47 });
    expect(p.paddingBottom).toBeGreaterThan(300);
    expect(p.paddingTop).toBeGreaterThan(47);
  });

  test('an absurd sheet fraction cannot consume the whole viewport', () => {
    const p = paddingForSheet({ screenHeight: 800, sheetFraction: 5, safeTop: 47 });
    expect(p.paddingBottom!).toBeLessThan(800);
    const nan = paddingForSheet({ screenHeight: 800, sheetFraction: NaN, safeTop: 47 });
    expect(Number.isFinite(nan.paddingBottom!)).toBe(true);
  });
});

describe('distance helper', () => {
  test('metresBetween is sane over a short hop', () => {
    // ~1.1 km per 0.01 degree of latitude.
    expect(metresBetween(5.6, -0.19, 5.61, -0.19)).toBeGreaterThan(1000);
    expect(metresBetween(5.6, -0.19, 5.61, -0.19)).toBeLessThan(1200);
    expect(metresBetween(5.6, -0.19, 5.6, -0.19)).toBe(0);
  });
});
