/**
 * The map camera, as a state machine.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Camera control was written five times — once per screen — and each copy had
 * its own idea of zoom, pitch, padding, and when to stop following the driver.
 * Two consequences the user could feel:
 *
 *   - The apps did not agree with each other or with themselves. Moving between
 *     stages of one ride re-framed the map differently each time, which is most
 *     of what "the apps feel disjointed" means in practice.
 *   - Nobody owned the camera, so things fought over it. A driver ping would
 *     re-centre the map a second after the rider had deliberately panned away
 *     to look at something. There was no rule for who wins.
 *
 * Uber, Bolt and Yango all model this as a small state machine with exactly one
 * owner at a time, and a user gesture always wins until the user asks for the
 * camera back. That is what this is.
 *
 * ── THE MODES ───────────────────────────────────────────────────────────────
 *   overview      Frame everything that matters (pickup, dropoff, driver) with
 *                 padding for the sheet. Used while matching and while waiting.
 *   follow        Lock to a target, north-up. Used when a driver is en route to
 *                 the rider — the rider wants to read the street names.
 *   followCourse  Lock to a target and rotate to its direction of travel. The
 *                 navigation view; used by the driver in-trip, where "up" must
 *                 mean "ahead".
 *   free          The user has panned or zoomed. NOTHING moves the camera. A
 *                 recenter affordance appears, and after a while it returns to
 *                 whatever mode the stage asked for.
 *
 * The STAGE requests a mode; the USER can always override it to `free`; the
 * recenter button clears the override. There is no other way to move the
 * camera, which is what stops the fighting.
 */

export type CameraMode = 'overview' | 'follow' | 'followCourse' | 'free';

export interface LngLatTuple {
  0: number;
  1: number;
  length: 2;
  [Symbol.iterator](): IterableIterator<number>;
}

export type Coord = [number, number];

export interface CameraPadding {
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
}

export interface CameraTarget {
  /** Where to point in `follow` / `followCourse`. */
  center?: Coord | null;
  /** Direction of travel, for `followCourse`. */
  bearing?: number | null;
  /** Everything that must stay on screen in `overview`. */
  fit?: Coord[] | null;
}

export interface CameraPlan {
  kind: 'setCamera' | 'fitBounds' | 'none';
  centerCoordinate?: Coord;
  zoomLevel?: number;
  heading?: number;
  pitch?: number;
  animationDuration?: number;
  padding?: CameraPadding;
  bounds?: { ne: Coord; sw: Coord };
  /** Why this plan was produced — surfaced in logs, never to the user. */
  reason: string;
}

/** Zoom used when locked to a single target. Close enough to read a street. */
export const FOLLOW_ZOOM = 16.5;

/**
 * Pitch for the navigation view.
 *
 * Both apps had their own constant (the rider's tracking screen used 50°, the
 * driver's NavCamera its own default) so the two halves of one trip looked like
 * two products. One number now.
 */
export const NAV_PITCH = 50;

/** Flat for overview: a tilted map makes a fitted bounding box lie about what fits. */
export const OVERVIEW_PITCH = 0;

/**
 * How long a manual pan holds the camera before it drifts back to the stage's
 * mode. Long enough to read the map, short enough that a rider who panned by
 * accident is not stranded with a frozen camera for the rest of the trip.
 */
export const RESUME_AFTER_MS = 12_000;

/**
 * Minimum span of a fitted bounding box, in degrees (~110 m).
 *
 * NOT cosmetic. `fitBounds` on a degenerate box — which is what you get the
 * instant pickup and dropoff resolve to the same point, or when only one
 * coordinate is known — makes MapLibre compute an infinite zoom and abort the
 * process in `-[MLRNCamera _setInitialCamera]`. This is the documented cause of
 * the map SIGABRT, not NaN coordinates. Every box is padded to at least this.
 */
export const MIN_BOUNDS_SPAN_DEG = 0.001;

/** A coordinate MapLibre will not choke on. */
export function isUsableCoord(c: unknown): c is Coord {
  return (
    Array.isArray(c) &&
    c.length === 2 &&
    Number.isFinite(c[0]) &&
    Number.isFinite(c[1]) &&
    Math.abs(c[0]) <= 180 &&
    Math.abs(c[1]) <= 90
  );
}

/**
 * Bounding box around a set of points, guaranteed non-degenerate.
 *
 * Returns null when there is nothing usable to fit — the caller must then do
 * nothing rather than fit an empty box, which is the other half of the SIGABRT.
 */
export function boundsFor(coords: Coord[]): { ne: Coord; sw: Coord } | null {
  const usable = coords.filter(isUsableCoord);
  if (usable.length === 0) return null;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of usable) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }

  // Inflate anything too small to be a real box. One point, or two points a
  // metre apart, both land here.
  const padTo = (min: number, max: number): [number, number] => {
    if (max - min >= MIN_BOUNDS_SPAN_DEG) return [min, max];
    const mid = (min + max) / 2;
    return [mid - MIN_BOUNDS_SPAN_DEG / 2, mid + MIN_BOUNDS_SPAN_DEG / 2];
  };
  const [lo0, hi0] = padTo(minLng, maxLng);
  const [lo1, hi1] = padTo(minLat, maxLat);

  return { ne: [hi0, hi1], sw: [lo0, lo1] };
}

/**
 * How far a fitted box must move before it is worth re-framing, in degrees
 * (~55 m at Ghana's latitude).
 *
 * WHY THIS NUMBER EXISTS AT ALL. `overview` folds the live interpolated driver
 * position into its fit set, and that position changes by a fraction of a metre
 * on EVERY animation frame. Keyed on the exact box, no two consecutive frames
 * ever matched, so `fitBounds` was re-issued sixty times a second — each call
 * restarting a 600 ms ease from wherever the previous one had got to, roughly
 * 16 ms in. The camera therefore lived permanently in the first 3 % of an
 * easing curve: it crept, dragged behind the car, and never settled. That is
 * what "the map feels disjointed" is describing.
 *
 * Quantising to a grid means the puck can wander inside the current frame
 * without touching the camera, and only a move that genuinely changes what is
 * on screen commands a new one.
 */
export const OVERVIEW_REFIT_TOLERANCE_DEG = 0.0005;

/**
 * The identity of an overview frame — what must change before re-framing.
 *
 * Padding is part of it. The old key was bounds-only, so a stage change that
 * grew the bottom sheet (0.62 → 0.44 of the screen) but framed the same two
 * points produced an identical key and the re-frame was suppressed — leaving
 * the subject sitting behind the panel until the driver happened to move far
 * enough. Same points, different visible area, different frame.
 */
export function overviewKey(
  bounds: { ne: Coord; sw: Coord },
  padding: CameraPadding,
  toleranceDeg: number = OVERVIEW_REFIT_TOLERANCE_DEG,
): string {
  const snap = (n: number) => Math.round(n / toleranceDeg);
  const box = [...bounds.ne, ...bounds.sw].map(snap).join(',');
  return `${box}|${paddingKeyOf(padding)}`;
}

/**
 * The padding half of `overviewKey`, on its own.
 *
 * The frame loop needs to tell a padding change (the sheet resized for a new
 * stage — the rider caused it and is watching for it) apart from a bounds
 * change (the driver moved). The first pre-empts an in-flight camera animation;
 * the second waits for it.
 */
export function paddingKeyOf(padding: CameraPadding): string {
  return [
    padding.paddingTop ?? 0,
    padding.paddingBottom ?? 0,
    padding.paddingLeft ?? 0,
    padding.paddingRight ?? 0,
  ].join(',');
}

/**
 * Decide what the camera should do. Pure — no map, no refs, no side effects,
 * so the whole policy is testable and there is exactly one place to read it.
 */
export function planCamera(
  mode: CameraMode,
  target: CameraTarget,
  padding: CameraPadding,
  opts: { animationDuration?: number } = {},
): CameraPlan {
  const animationDuration = opts.animationDuration ?? 450;

  if (mode === 'free') {
    return { kind: 'none', reason: 'user has taken the camera' };
  }

  if (mode === 'overview') {
    const bounds = boundsFor(target.fit ?? []);
    if (!bounds) return { kind: 'none', reason: 'nothing usable to frame' };
    return {
      kind: 'fitBounds',
      bounds,
      padding,
      pitch: OVERVIEW_PITCH,
      heading: 0,
      animationDuration,
      reason: 'overview: frame the whole journey',
    };
  }

  if (!isUsableCoord(target.center)) {
    return { kind: 'none', reason: 'no usable target to follow' };
  }

  // `followCourse` rotates the MAP so the direction of travel is up. That is
  // the navigation convention and it is right for a driver — but it is
  // disorienting for a rider watching a car approach, which is why the rider
  // stages ask for plain `follow` and keep north up.
  const heading = mode === 'followCourse' && Number.isFinite(target.bearing ?? NaN)
    ? (target.bearing as number)
    : 0;

  return {
    kind: 'setCamera',
    centerCoordinate: target.center,
    zoomLevel: FOLLOW_ZOOM,
    heading,
    pitch: mode === 'followCourse' ? NAV_PITCH : OVERVIEW_PITCH,
    animationDuration,
    padding,
    reason: `${mode}: locked to target`,
  };
}

/**
 * Padding that keeps the subject in the *visible* part of the map.
 *
 * The bottom sheet covers the lower half of the screen, so a camera centred on
 * the viewport centres the driver behind the panel. Every screen was doing this
 * arithmetic itself, slightly differently.
 */
export function paddingForSheet(args: {
  screenHeight: number;
  /** Fraction of screen height the sheet currently covers. */
  sheetFraction: number;
  safeTop: number;
  /** Extra room at the top for a status banner, if one is showing. */
  topChrome?: number;
}): CameraPadding {
  const { screenHeight, sheetFraction, safeTop, topChrome = 0 } = args;
  return {
    paddingTop: safeTop + topChrome + 24,
    paddingBottom: Math.round(screenHeight * clampFraction(sheetFraction)) + 24,
    paddingLeft: 32,
    paddingRight: 32,
  };
}

function clampFraction(f: number): number {
  if (!Number.isFinite(f)) return 0;
  return f < 0 ? 0 : f > 0.85 ? 0.85 : f;
}

/**
 * How finely a moving sheet is allowed to re-frame the camera, in px.
 *
 * `paddingForSheet` takes a fraction that only changes when the stage does, so
 * it produces one re-frame per stage. `paddingForSheetTop` takes the sheet's
 * LIVE top edge, which moves every frame while the sheet springs — and the
 * frame loop treats any padding change as a reason to re-frame immediately.
 * Unquantised, that is sixty re-frames a second for half a second.
 *
 * Twelve px is below the threshold at which a shift in the framed area is
 * visible, and turns a 300 px sheet travel into ~25 re-frames rather than ~30
 * — each of which is an instant `fitBounds` (see `applyPlan`), so the visible
 * result is the map tracking the sheet continuously while the sheet's own
 * spring supplies all of the easing.
 */
export const SHEET_PADDING_QUANTUM = 12;

/**
 * Bottom padding derived from where the sheet's top edge ACTUALLY is, rather
 * than from a table of per-stage fractions.
 *
 * The fraction table was a reasonable approximation and wrong in the two cases
 * that matter: a sheet whose content is taller or shorter than the stage's
 * nominal fraction (a fare breakdown with three extra rows, a driver card with
 * no photo), and every moment DURING a stage change, when the real sheet is
 * somewhere between two fractions and the camera has already jumped to the
 * destination one. Reading the live edge makes the pins float up in lockstep
 * with the panel instead of arriving before it.
 */
export function paddingForSheetTop(args: {
  screenHeight: number;
  /** The sheet's top edge, in px from the top of the screen. */
  sheetTop: number;
  safeTop: number;
  /** Extra room at the top for a status banner, if one is showing. */
  topChrome?: number;
  quantum?: number;
}): CameraPadding {
  const {
    screenHeight,
    sheetTop,
    safeTop,
    topChrome = 0,
    quantum = SHEET_PADDING_QUANTUM,
  } = args;
  const covered = Number.isFinite(sheetTop) ? screenHeight - sheetTop : 0;
  const clamped = covered < 0 ? 0 : covered > screenHeight * 0.85 ? screenHeight * 0.85 : covered;
  const step = quantum > 0 ? quantum : 1;
  return {
    paddingTop: safeTop + topChrome + 24,
    paddingBottom: Math.round(clamped / step) * step + 24,
    paddingLeft: 32,
    paddingRight: 32,
  };
}

/**
 * Has the user taken the camera?
 *
 * MapLibre reports every region change, including the ones this module caused,
 * so "did the region change" is not the question — "was it the user" is.
 * `isUserInteraction` is the only trustworthy signal, and ignoring it is how a
 * self-inflicted camera move gets mistaken for a pan and cancels following.
 */
export function shouldReleaseToUser(event: {
  isUserInteraction?: boolean;
  properties?: { isUserInteraction?: boolean };
}): boolean {
  return Boolean(event?.isUserInteraction ?? event?.properties?.isUserInteraction);
}

/** Should a `free` camera hand control back to the stage yet? */
export function shouldAutoResume(releasedAt: number | null, now: number): boolean {
  return releasedAt != null && now - releasedAt >= RESUME_AFTER_MS;
}
