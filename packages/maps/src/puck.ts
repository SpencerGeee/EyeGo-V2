/**
 * The driver puck: turning a trickle of GPS samples into continuous motion.
 *
 * ── THE PROBLEM ─────────────────────────────────────────────────────────────
 * A phone reports its position every 2–5 seconds, and each report can be tens
 * of metres from the last. Bound straight to a marker, that reads as a car
 * teleporting down the road in discrete hops — which is exactly what both apps
 * do today, and it is the single loudest reason the map does not feel like
 * Uber's. Uber, Bolt and Yango all render the puck at display refresh rate and
 * treat the GPS fix as a *destination to walk towards*, not a place to jump to.
 *
 * ── WHAT THIS DOES ──────────────────────────────────────────────────────────
 * Given a stream of samples, it produces a position and bearing for any instant
 * between them:
 *
 *   1. INTERPOLATE, DON'T SNAP. Each new fix starts a short animation from
 *      wherever the puck currently is to where the fix says it is, over roughly
 *      the observed sample interval. The puck is therefore always slightly
 *      behind the truth and always moving, which is what "smooth" means here.
 *
 *   2. SHORTEST-ANGLE BEARING. Heading is circular: interpolating 359° → 1°
 *      naively sweeps 358° the wrong way and the car spins on its axis at the
 *      top of every minute. Rotation always takes the short way round.
 *
 *   3. GPS GIVES COURSE, NOT FACING. A phone's `heading` is the direction of
 *      TRAVEL, and while stationary it is noise — a parked car whose marker
 *      spins is a phone reporting garbage. Below a walking-pace threshold the
 *      last good bearing is held.
 *
 *   4. STALE MEANS STOP, NOT DRIFT. If no fix arrives for a while, the puck
 *      settles at the last known point rather than extrapolating into a
 *      building. Dead reckoning past a couple of seconds invents a position,
 *      and an invented position on a safety-critical map is worse than an old
 *      one.
 *
 * Pure functions, no React and no map library, so the behaviour is testable
 * without a device.
 */

export interface PuckSample {
  latitude: number;
  longitude: number;
  /** Degrees clockwise from north. Null/undefined when unknown. */
  heading?: number | null;
  /** Metres per second, when the platform reports it. */
  speed?: number | null;
  /** Client clock, ms. */
  at: number;
}

export interface PuckState {
  latitude: number;
  longitude: number;
  bearing: number;
  /** True when we are between fixes and still animating towards the newest one. */
  moving: boolean;
}

/**
 * Below this speed the reported heading is noise, so the last good bearing is
 * held. 0.7 m/s is a slow walk — well under any moving vehicle.
 */
export const HEADING_SPEED_FLOOR_MPS = 0.7;

/** Animation never runs shorter than this, or a burst of fixes looks jittery. */
export const MIN_INTERP_MS = 250;

/**
 * …and never longer than this. A long gap between fixes should leave the puck
 * sitting still at the last known point, not gliding for ten seconds towards a
 * position that is already out of date.
 */
export const MAX_INTERP_MS = 3_000;

/** Normalise any angle to [0, 360). */
export function normaliseBearing(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

/**
 * Signed shortest angular distance from `from` to `to`, in [-180, 180).
 *
 * This is the whole fix for the spinning-car bug: `shortestDelta(359, 1)` is
 * `+2`, not `-358`.
 *
 * The exact half-turn is genuinely ambiguous — a U-turn is 180 degrees whether
 * the marker rotates clockwise or anticlockwise — and this returns `-180`, i.e.
 * anticlockwise. Stated because the range endpoint is easy to get wrong when
 * reading the modulo, not because either direction is more correct.
 */
export function shortestDelta(from: number, to: number): number {
  const diff = (normaliseBearing(to) - normaliseBearing(from) + 540) % 360;
  return diff - 180;
}

/** Interpolate a bearing the short way round. */
export function lerpBearing(from: number, to: number, t: number): number {
  return normaliseBearing(from + shortestDelta(from, to) * clamp01(t));
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Ease-out cubic.
 *
 * Linear interpolation makes the puck start and stop abruptly at each fix,
 * which reads as a stutter at exactly the sample rate. Easing out means it
 * arrives gently and the seam between one fix and the next is invisible.
 */
function easeOut(t: number): number {
  const c = clamp01(t);
  return 1 - Math.pow(1 - c, 3);
}

/**
 * Great-circle bearing from one point to another, in degrees.
 *
 * The fallback when the platform reports no heading: two consecutive fixes far
 * enough apart tell you which way the vehicle is pointing, and that is more
 * reliable than a compass in a car anyway (the phone rotates in the cradle;
 * the car does not).
 */
export function bearingBetween(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number {
  const φ1 = (fromLat * Math.PI) / 180;
  const φ2 = (toLat * Math.PI) / 180;
  const Δλ = ((toLng - fromLng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return normaliseBearing((Math.atan2(y, x) * 180) / Math.PI);
}

/** Metres between two coordinates. */
export function metresBetween(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number {
  const R = 6_371_000;
  const φ1 = (fromLat * Math.PI) / 180;
  const φ2 = (toLat * Math.PI) / 180;
  const Δφ = ((toLat - fromLat) * Math.PI) / 180;
  const Δλ = ((toLng - fromLng) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Driving along the road ──────────────────────────────────────────────────

/** A fix farther than this from the route is off it (a detour, a bad fix). */
export const ROAD_SNAP_M = 40;

interface Road {
  /** [lng, lat], as the server sends it. */
  coords: [number, number][];
  /** Metres from the start to each vertex. */
  cum: number[];
  total: number;
}

function measureRoad(coords: [number, number][]): Road {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + metresBetween(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]));
  }
  return { coords, cum, total: cum[cum.length - 1] };
}

/** Nearest point on the road: metres along it, and metres off it. */
function snapToRoad(road: Road, lat: number, lng: number): { along: number; off: number } {
  const k = Math.cos((lat * Math.PI) / 180);
  const M = (Math.PI / 180) * 6_371_000;
  let best = { along: 0, off: Infinity };
  for (let i = 1; i < road.coords.length; i++) {
    const [aLng, aLat] = road.coords[i - 1];
    const [bLng, bLat] = road.coords[i];
    const ax = (aLng - lng) * k, ay = aLat - lat;
    const dx = (bLng - aLng) * k, dy = bLat - aLat;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? clamp01(-(ax * dx + ay * dy) / len2) : 0;
    const off = Math.hypot(ax + t * dx, ay + t * dy) * M;
    if (off < best.off) best = { along: road.cum[i - 1] + t * (road.cum[i] - road.cum[i - 1]), off };
  }
  return best;
}

function roadPointAt(road: Road, along: number): { latitude: number; longitude: number } {
  const d = Math.min(Math.max(along, 0), road.total);
  let i = 1;
  while (i < road.cum.length - 1 && road.cum[i] < d) i++;
  const seg = road.cum[i] - road.cum[i - 1] || 1;
  const t = (d - road.cum[i - 1]) / seg;
  const [aLng, aLat] = road.coords[i - 1];
  const [bLng, bLat] = road.coords[i];
  return { latitude: aLat + (bLat - aLat) * t, longitude: aLng + (bLng - aLng) * t };
}

/** The road's direction at a point, read across ±6 m so a corner is a sweep, not a snap. */
function roadBearingAt(road: Road, along: number, fallback: number): number {
  const a = roadPointAt(road, along - 6);
  const b = roadPointAt(road, along + 6);
  return metresBetween(a.latitude, a.longitude, b.latitude, b.longitude) > 1
    ? bearingBetween(a.latitude, a.longitude, b.latitude, b.longitude)
    : fallback;
}

/**
 * The interpolator.
 *
 * Feed it fixes with `push()`; ask it where the puck is with `at(now)`. It
 * holds no timers and does no rendering, so the caller decides the cadence —
 * a `requestAnimationFrame` loop on the rider map, a cheaper interval when the
 * app is backgrounded.
 */
export class PuckInterpolator {
  private from: PuckState | null = null;
  private to: PuckState | null = null;
  private startedAt = 0;
  private durationMs = MIN_INTERP_MS;
  private lastSampleAt = 0;
  /** Interval between the last two fixes, used to size the next animation. */
  private observedGapMs = 1_000;
  /**
   * DRIVE THE ROAD, NOT THE CHORD. BUGFIX ("the bus wasn't following the route
   * polyline"). Two fixes either side of a corner were joined by a straight
   * line, so the vehicle cut across the block. When both ends of a move lie on
   * the route, the move is made ALONG it. `road` is the line being driven;
   * `nextRoad` is the server's latest, adopted only when a fix leaves the old
   * one — a fresh geometry usually starts at the driver's newest fix, and
   * switching to it eagerly would hop the vehicle forward to its start.
   */
  private road: Road | null = null;
  private nextRoad: Road | null = null;
  private fromAlong: number | null = null;
  private toAlong: number | null = null;

  /** The route being driven, `[lng, lat]` (the server's line). Null clears it. */
  setRoute(coords: [number, number][] | null | undefined): void {
    const next = coords && coords.length > 1 ? measureRoad(coords) : null;
    if (!next) { this.road = this.nextRoad = null; this.fromAlong = this.toAlong = null; return; }
    if (!this.road) this.road = next;
    else this.nextRoad = next;
  }

  /** Both ends of this move on `road`, forwards (or a jitter's worth back)? */
  private along(road: Road, from: PuckState, to: PuckSample): [number, number] | null {
    const a = snapToRoad(road, from.latitude, from.longitude);
    const b = snapToRoad(road, to.latitude, to.longitude);
    if (a.off > ROAD_SNAP_M || b.off > ROAD_SNAP_M) return null;
    if (b.along < a.along - 25) return null; // a real reversal is not the road's
    return [a.along, Math.max(b.along, a.along)];
  }

  /** Feed a new GPS fix. */
  push(sample: PuckSample): void {
    const now = sample.at;

    // The bearing to animate towards, in preference order:
    //   1. a reported heading while actually moving,
    //   2. the direction between this fix and the last one,
    //   3. whatever we were already showing.
    const current = this.at(now);
    let nextBearing = current?.bearing ?? 0;

    const movingFastEnough =
      sample.speed == null || sample.speed >= HEADING_SPEED_FLOOR_MPS;

    if (sample.heading != null && Number.isFinite(sample.heading) && movingFastEnough) {
      nextBearing = normaliseBearing(sample.heading);
    } else if (current) {
      const travelled = metresBetween(
        current.latitude,
        current.longitude,
        sample.latitude,
        sample.longitude,
      );
      // Under ~5 m the direction between two fixes is mostly GPS scatter, not
      // travel, so it would make a stationary car twitch.
      if (travelled >= 5) {
        nextBearing = bearingBetween(
          current.latitude,
          current.longitude,
          sample.latitude,
          sample.longitude,
        );
      }
    }

    if (this.lastSampleAt > 0) {
      this.observedGapMs = Math.max(now - this.lastSampleAt, MIN_INTERP_MS);
    }
    this.lastSampleAt = now;

    this.from = current ?? {
      latitude: sample.latitude,
      longitude: sample.longitude,
      bearing: nextBearing,
      moving: false,
    };
    this.to = {
      latitude: sample.latitude,
      longitude: sample.longitude,
      bearing: nextBearing,
      moving: true,
    };
    this.startedAt = now;
    this.fromAlong = this.toAlong = null;
    if (current && this.road) {
      let span = this.along(this.road, current, sample);
      if (!span && this.nextRoad) {
        this.road = this.nextRoad;
        this.nextRoad = null;
        span = this.along(this.road, current, sample);
      }
      if (span) [this.fromAlong, this.toAlong] = span;
    }
    // Animate over roughly the gap we have been seeing, so the puck arrives
    // just as the next fix lands and motion looks continuous rather than
    // stop-start.
    this.durationMs = Math.min(Math.max(this.observedGapMs, MIN_INTERP_MS), MAX_INTERP_MS);
  }

  /** Where is the puck at `now`? Null until the first fix. */
  at(now: number): PuckState | null {
    if (!this.to) return null;
    if (!this.from) return this.to;

    const t = this.durationMs <= 0 ? 1 : (now - this.startedAt) / this.durationMs;
    if (this.road && this.fromAlong != null && this.toAlong != null) {
      const along = this.fromAlong + (this.toAlong - this.fromAlong) * easeOut(t);
      return {
        ...roadPointAt(this.road, along),
        bearing: roadBearingAt(this.road, along, this.to.bearing),
        moving: t < 1,
      };
    }
    if (t >= 1) return { ...this.to, moving: false };

    const e = easeOut(t);
    return {
      latitude: this.from.latitude + (this.to.latitude - this.from.latitude) * e,
      longitude: this.from.longitude + (this.to.longitude - this.from.longitude) * e,
      bearing: lerpBearing(this.from.bearing, this.to.bearing, e),
      moving: true,
    };
  }

  /** Drop all state — e.g. when the trip ends or the driver changes. */
  reset(): void {
    this.from = null;
    this.to = null;
    this.lastSampleAt = 0;
    this.fromAlong = this.toAlong = null;
  }

  /** True once at least one fix has been seen. */
  get hasFix(): boolean {
    return this.to != null;
  }
}
