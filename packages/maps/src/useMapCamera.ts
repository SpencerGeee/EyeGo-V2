import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type CameraMode,
  type CameraPadding,
  type CameraTarget,
  type Coord,
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
  padding: CameraPadding;
  /** Publish rate for `puck` state, in ms. The camera itself updates every frame. */
  publishEveryMs?: number;
  /** Set false to stop the frame loop entirely (screen not visible). */
  active?: boolean;
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
  /** Wire to the map's `onRegionIsChanging` / `onRegionDidChange`. */
  onRegionChange: (event: unknown) => void;
  /** Drop puck state — call when the trip ends or the driver is reassigned. */
  resetPuck: () => void;
}

export function useMapCamera(args: UseMapCameraArgs): MapCamera {
  const { mode, fit, center, padding, publishEveryMs = 400, active = true } = args;

  const cameraRef = useRef<any>(null);
  const interpolatorRef = useRef(new PuckInterpolator());
  const lastOverviewKeyRef = useRef('');
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
  const paddingRef = useRef<CameraPadding>(padding);
  paddingRef.current = padding;

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
  }, []);

  const onRegionChange = useCallback(
    (event: unknown) => {
      // Only a genuine gesture releases the camera. MapLibre fires this for the
      // moves this hook itself commands, and treating those as user intent
      // means the camera cancels its own following on the first frame.
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

      const plan = planCamera(
        effectiveMode,
        {
          // Prefer the live interpolated position over the last published one:
          // the camera should track the smooth value, not the sampled one.
          center: state ? ([state.longitude, state.latitude] as Coord) : targetRef.current.center,
          bearing: state?.bearing ?? targetRef.current.bearing,
          fit: targetRef.current.fit,
        },
        paddingRef.current,
        // The camera is re-commanded every frame while following, so each move
        // must be near-instant — a 450 ms animation restarted 60 times a second
        // never arrives anywhere and the map crawls.
        { animationDuration: effectiveMode === 'overview' ? 600 : 0 },
      );

      applyPlan(cameraRef.current, plan, effectiveMode, lastOverviewKeyRef);

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
      resetPuck,
    }),
    [activeMode, released, puck, pushSample, recenter, onRegionChange, resetPuck],
  );
}

/**
 * `overview` is a discrete re-frame, not a continuous one: re-fitting the same
 * bounds every frame restarts the animation forever and the map never settles.
 * Fit once per change of intent instead.
 *
 * The memo lives in a per-hook ref rather than at module scope — a module-level
 * variable would be shared by every map in the process, so the rider's overview
 * would suppress the driver's.
 */
function applyPlan(
  cameraRef: any,
  plan: ReturnType<typeof planCamera>,
  mode: CameraMode,
  lastOverviewKeyRef: React.MutableRefObject<string>,
): void {
  if (!cameraRef || plan.kind === 'none') return;

  if (plan.kind === 'fitBounds' && plan.bounds) {
    const key = `${plan.bounds.ne.join()}|${plan.bounds.sw.join()}`;
    if (key === lastOverviewKeyRef.current) return;
    lastOverviewKeyRef.current = key;
    cameraRef.fitBounds?.(
      [plan.bounds.ne, plan.bounds.sw],
      plan.padding,
      plan.animationDuration,
    );
    return;
  }

  if (mode !== 'overview') lastOverviewKeyRef.current = '';

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
