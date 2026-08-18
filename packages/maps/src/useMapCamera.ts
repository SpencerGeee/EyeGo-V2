import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type CameraMode,
  type CameraPadding,
  type CameraTarget,
  type Coord,
  overviewKey,
  paddingKeyOf,
  planCamera,
  shouldAutoResume,
  shouldReleaseToUser,
} from './camera';
import { PuckInterpolator, type PuckSample, type PuckState } from './puck';

/**
 * The one camera binding both apps use.
 *
 * `camera.ts` decides WHAT the camera should do and `puck.ts` decides where the
 * vehicle is; this wires them to a real MapLibre camera ref and a frame loop.
 * Screens declare a mode and a target and are done — no screen calls
 * `setCamera` directly any more, which is what makes the rider and driver maps
 * behave identically.
 *
 * ── THE FRAME LOOP ──────────────────────────────────────────────────────────
 * The puck is advanced on `requestAnimationFrame`, not on React state. Driving
 * a marker through `setState` at 60 Hz re-renders the whole screen sixty times a
 * second to move one icon; on a mid-range Android that is most of the frame
 * budget. State is published at a much lower rate for anything that needs to
 * *read* the position, while the camera itself is driven imperatively.
 */

export interface UseMapCameraArgs {
  /** What the current trip stage wants. The user can still override to `free`. */
  mode: CameraMode;
  /** Coordinates that must stay framed in `overview`. */
  fit?: Coord[] | null;
  /** Follow target when there is no live puck (e.g. framing a fixed pickup). */
  center?: Coord | null;
  /**
   * Either a fixed padding, or a getter the frame loop calls every tick.
   *
   * The getter form is what interlocks the camera with a morphing bottom sheet:
   * the sheet publishes its top edge as a Reanimated shared value, and a shared
   * value is readable synchronously from the JS thread — so the loop can sample
   * the sheet's real, mid-spring position without a single React render. Pass
   * `() => paddingForSheetTop({ sheetTop: metrics.top.value, ... })`.
   *
   * The getter runs at 60 Hz. Keep it arithmetic — no allocation beyond the
   * padding object itself, no store reads.
   */
  padding: CameraPadding | (() => CameraPadding);
  /** Publish rate for `puck` state, in ms. The camera itself updates every frame. */
  publishEveryMs?: number;
  /** Set false to stop the frame loop entirely (screen not visible). */
  active?: boolean;
  /**
   * Add the live interpolated puck to the `overview` fit set.
   *
   * The caller cannot do this itself without a cycle: the puck is produced by
   * this hook, so a `fit` computed from it would have to be passed back into
   * the hook that made it. The frame loop already holds the smoothed position,
   * so it folds it in here — which is also what keeps the frame from jittering,
   * since it uses the interpolated value rather than the last sampled one.
   */
  fitIncludesPuck?: boolean;
}

export interface MapCamera {
  /** Attach to the map's `<Camera ref>`. */
  cameraRef: React.MutableRefObject<any>;
  /** The mode actually in force — `free` whenever the user has taken over. */
  activeMode: CameraMode;
  /** True while the user owns the camera; drives the recenter affordance. */
  released: boolean;
  /** Smoothed vehicle position, republished at `publishEveryMs`. */
  puck: PuckState | null;
  /** Feed a GPS fix (from a socket, a location subscription, anything). */
  pushSample: (sample: PuckSample) => void;
  /** Give the camera back to the stage. Wire to the recenter button. */
  recenter: () => void;
  /**
   * Hand the camera to the user NOW. Wire to the map's `onUserGesture`, which
   * fires on the first frame of a pan rather than when it settles.
   */
  release: () => void;
  /** Wire to the map's `onRegionIsChanging` / `onRegionDidChange`. */
  onRegionChange: (event: unknown) => void;
  /** Drop puck state — call when the trip ends or the driver is reassigned. */
  resetPuck: () => void;
}

export function useMapCamera(args: UseMapCameraArgs): MapCamera {
  const {
    mode, fit, center, padding,
    publishEveryMs = 400, active = true, fitIncludesPuck = false,
  } = args;

  const cameraRef = useRef<any>(null);
  const interpolatorRef = useRef(new PuckInterpolator());
  const lastOverviewKeyRef = useRef('');
  /** Timestamp the in-flight `fitBounds` animation is expected to land at. */
  const fitSettlesAtRef = useRef(0);
  /** The sheet padding the last re-frame was issued for. */
  const lastPaddingKeyRef = useRef('');
  const [puck, setPuck] = useState<PuckState | null>(null);

  // `released` is the user override. Kept in a ref as well as state because the
  // frame loop reads it every tick and must not re-subscribe to do so.
  const releasedAtRef = useRef<number | null>(null);
  const [released, setReleased] = useState(false);

  // The latest requested target, read by the frame loop without re-arming it.
  const targetRef = useRef<CameraTarget>({});
  targetRef.current = {
    center: puck ? ([puck.longitude, puck.latitude] as Coord) : center ?? null,
    bearing: puck?.bearing ?? null,
    fit: fit ?? null,
  };
  const modeRef = useRef<CameraMode>(mode);
  modeRef.current = mode;
  const paddingRef = useRef<CameraPadding | (() => CameraPadding)>(padding);
  paddingRef.current = padding;
  const fitIncludesPuckRef = useRef(fitIncludesPuck);
  fitIncludesPuckRef.current = fitIncludesPuck;

  const release = useCallback(() => {
    if (releasedAtRef.current != null) {
      // Already released — just extend the window, so a user who keeps panning
      // is not yanked back mid-gesture.
      releasedAtRef.current = Date.now();
      return;
    }
    releasedAtRef.current = Date.now();
    setReleased(true);
  }, []);

  const recenter = useCallback(() => {
    releasedAtRef.current = null;
    setReleased(false);
    /**
     * FORGET WHERE WE THINK THE CAMERA IS.
     *
     * BUGFIX ("i tap the gps button on the top right and it does nothing — it's
     * supposed to snap back to the route").
     *
     * `applyPlan` will not re-issue a `fitBounds` whose quantised bounds+padding
     * key matches the last one it issued, because in `overview` the same box is
     * recomputed every single frame and re-fitting it forever means the map never
     * settles. That memo is correct for the follow loop and exactly wrong here:
     * a user pan moves the CAMERA without moving the BOUNDS, so on the frame
     * after recenter the key is unchanged, `applyPlan` returns early, and the map
     * stays precisely where the user dragged it. The chip cleared the override,
     * the loop agreed there was nothing to do, and the tap looked inert.
     *
     * Clearing the memo is what makes the very next frame re-frame. Also clears
     * the settle deadline so the re-frame is not made to queue behind a follow
     * animation the user has just overruled by asking for this.
     */
    lastOverviewKeyRef.current = '';
    lastPaddingKeyRef.current = '';
    fitSettlesAtRef.current = 0;
  }, []);

  /**
   * A GESTURE HAS TO RELEASE THE CAMERA WHILE IT IS STILL HAPPENING.
   *
   * BUGFIX ("the driver map feels rigid and less smooth than the rider map when
   * panning").
   *
   * This was wired only to `onRegionDidChange`, which fires when a gesture has
   * SETTLED. For the whole duration of a pan, therefore, `releasedAtRef` was
   * still null, `effectiveMode` was still `followCourse`, and the frame loop
   * below went on commanding the camera back to the puck sixty times a second
   * with `animationDuration: 0` — fighting the finger for every frame of the
   * drag and only conceding once the finger came off. That is the entire
   * difference in feel between the two apps: the rider's `overview` mode is
   * memoised on a quantised bounds key and issues nothing during a pan, so it
   * never fought back and never felt rigid.
   *
   * Bind this to `onRegionWillChange` and `onRegionIsChanging` as well as
   * `onRegionDidChange`. `shouldReleaseToUser` still filters out the moves this
   * hook itself caused, which is what stops the camera cancelling its own
   * following on the first frame, and `release()` extends the window on every
   * subsequent call so the 12-second auto-resume is measured from the END of
   * the gesture rather than its start.
   */
  const onRegionChange = useCallback(
    (event: unknown) => {
      if (shouldReleaseToUser(event as any)) release();
    },
    [release],
  );

  const pushSample = useCallback((sample: PuckSample) => {
    interpolatorRef.current.push(sample);
  }, []);

  const resetPuck = useCallback(() => {
    interpolatorRef.current.reset();
    setPuck(null);
  }, []);

  useEffect(() => {
    if (!active) return undefined;

    let raf = 0;
    let lastPublish = 0;

    const tick = () => {
      const now = Date.now();

      // Hand the camera back once the user has stopped looking around.
      if (shouldAutoResume(releasedAtRef.current, now)) {
        releasedAtRef.current = null;
        setReleased(false);
      }

      const state = interpolatorRef.current.at(now);

      // Republish at a human rate. The camera below still moves every frame —
      // this is only for React consumers (marker components, readouts), and
      // publishing those at 60 Hz is what makes a cheap phone drop frames.
      if (state && now - lastPublish >= publishEveryMs) {
        lastPublish = now;
        setPuck(state);
      }

      const effectiveMode: CameraMode =
        releasedAtRef.current != null ? 'free' : modeRef.current;

      const liveFit = state && fitIncludesPuckRef.current
        ? [...(targetRef.current.fit ?? []), [state.longitude, state.latitude] as Coord]
        : targetRef.current.fit;

      // Sampled per frame so a sheet that is mid-spring is framed where it
      // actually is, not where it is going to end up.
      const paddingNow =
        typeof paddingRef.current === 'function' ? paddingRef.current() : paddingRef.current;

      const plan = planCamera(
        effectiveMode,
        {
          // Prefer the live interpolated position over the last published one:
          // the camera should track the smooth value, not the sampled one.
          center: state ? ([state.longitude, state.latitude] as Coord) : targetRef.current.center,
          bearing: state?.bearing ?? targetRef.current.bearing,
          fit: liveFit,
        },
        paddingNow,
        // The camera is re-commanded every frame while following, so each move
        // must be near-instant — a 450 ms animation restarted 60 times a second
        // never arrives anywhere and the map crawls.
        { animationDuration: effectiveMode === 'overview' ? 600 : 0 },
      );

      applyPlan(
        cameraRef.current, plan, effectiveMode,
        lastOverviewKeyRef, fitSettlesAtRef, lastPaddingKeyRef,
      );

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, publishEveryMs]);

  const activeMode: CameraMode = released ? 'free' : mode;

  return useMemo(
    () => ({
      cameraRef,
      activeMode,
      released,
      puck,
      pushSample,
      recenter,
      onRegionChange,
      release,
      resetPuck,
    }),
    [activeMode, released, puck, pushSample, recenter, onRegionChange, release, resetPuck],
  );
}

/**
 * `overview` is a discrete re-frame, not a continuous one: re-fitting the same
 * bounds every frame restarts the animation forever and the map never settles.
 * Fit once per change of intent instead.
 *
 * TWO guards are needed and the old code had half of one.
 *
 *   1. `overviewKey` quantises the box to a ~55 m grid and folds in the padding.
 *      The old key was the exact bounds, stringified — and `overview` includes
 *      the live interpolated puck, which moves a fraction of a metre every
 *      frame, so no two consecutive frames ever produced the same string.
 *   2. Even with a quantised key, a driver crossing a grid line at speed can
 *      produce a new key several frames running. `fitBounds` is therefore never
 *      issued while the previous one is still animating; the newest intent is
 *      simply picked up on the frame after it lands. One clean 600 ms move at a
 *      time, rather than a restart cascade that never arrives anywhere.
 *
 * That second guard applies to the DRIVER MOVING, and only to that. A padding
 * change is the bottom sheet resizing for a new stage, which the rider just
 * caused and is watching happen — making it queue behind an in-flight follow
 * would leave the pickup pin under the panel for up to 600 ms. So a change of
 * padding pre-empts, and a change of bounds waits its turn.
 *
 * All three memos live in per-hook refs rather than at module scope —
 * module-level variables would be shared by every map in the process, so the
 * rider's overview would suppress the driver's.
 */
function applyPlan(
  cameraRef: any,
  plan: ReturnType<typeof planCamera>,
  mode: CameraMode,
  lastOverviewKeyRef: React.MutableRefObject<string>,
  fitSettlesAtRef: React.MutableRefObject<number>,
  lastPaddingKeyRef: React.MutableRefObject<string>,
): void {
  if (!cameraRef || plan.kind === 'none') return;

  if (plan.kind === 'fitBounds' && plan.bounds) {
    const padding = plan.padding ?? {};
    const key = overviewKey(plan.bounds, padding);
    if (key === lastOverviewKeyRef.current) return;

    const paddingKey = paddingKeyOf(padding);
    const stageChanged = paddingKey !== lastPaddingKeyRef.current;
    const now = Date.now();
    if (!stageChanged && now < fitSettlesAtRef.current) return;

    /**
     * A padding change used to mean "the sheet snapped to a new stage height",
     * which happened once and deserved a 600 ms ease. With the padding sampled
     * from the sheet's live top edge it now means "the sheet is mid-spring",
     * and it fires ~25 times across one transition. Animating each of those
     * over 600 ms restarts the camera before it has arrived anywhere: the map
     * crawls, exactly as the follow path does when it is re-commanded every
     * frame with a duration.
     *
     * So a padding-driven re-frame is issued INSTANTLY and the sheet's own
     * spring becomes the only easing on screen — which is what makes the pins
     * and the panel move as one object rather than as two things that happen
     * to be animating. The first fit of a surface keeps its ease: there is no
     * sheet motion to track yet, only an empty map arriving at its subject.
     */
    const firstFit = lastPaddingKeyRef.current === '';
    const duration = stageChanged && !firstFit ? 0 : plan.animationDuration ?? 0;

    lastOverviewKeyRef.current = key;
    lastPaddingKeyRef.current = paddingKey;
    fitSettlesAtRef.current = now + duration;
    cameraRef.fitBounds?.([plan.bounds.ne, plan.bounds.sw], plan.padding, duration);
    return;
  }

  if (mode !== 'overview') {
    lastOverviewKeyRef.current = '';
    lastPaddingKeyRef.current = '';
    fitSettlesAtRef.current = 0;
  }

  if (plan.kind === 'setCamera') {
    cameraRef.setCamera?.({
      centerCoordinate: plan.centerCoordinate,
      zoomLevel: plan.zoomLevel,
      heading: plan.heading,
      pitch: plan.pitch,
      animationDuration: plan.animationDuration,
      padding: plan.padding,
    });
  }
}
