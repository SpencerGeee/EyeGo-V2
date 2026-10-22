import { useCallback, useEffect, useRef } from 'react';
import { AccessibilityInfo } from 'react-native';
import { boundsFor, isUsableCoord, type Coord } from './camera';
import type { CameraRef } from './index';

/**
 * ── THE SHARE PAGE'S CAMERA, ON NATIVE ──────────────────────────────────────
 *
 * ("the map when you select a ride and when you book a seat is 2D and flat …
 * make it like the share-trip map on the browser"). The web page frames the
 * whole route tilted into the city — pitch 50, bearing −16, the buildings
 * standing up — and, while nothing is moving and nobody is touching it, turns
 * slowly around it. The app's route screens fitted flat and sat still.
 *
 * Same numbers as eyego-api/public/tracking (`overview`, the 2.2°/s turn), so
 * web and app look like one product. The orbit is back-to-back LINEAR camera
 * legs issued a beat before the previous one lands — the engine animates each
 * on its own thread — never a per-frame JS setCamera. Any touch stops it; it
 * resumes after a quiet spell. Reduce Motion: tilted, never turning.
 */

export const SHOWCASE_PITCH = 50;
export const SHOWCASE_BEARING = -16;
const LEG_MS = 8000;
const LEG_DEG = 18; // 2.25°/s
const IDLE_MS = 9000;

export interface ShowcaseOptions {
  /** Everything that must be in frame: the route, its ends, a vehicle. */
  coords: Coord[];
  /** Edge insets (top/right/bottom/left) — see the fitBounds padding contract. */
  padding: { top: number; bottom: number; left: number; right: number };
  /** Off while the screen is not the one being looked at. */
  enabled?: boolean;
  /** Turn slowly while idle. */
  orbit?: boolean;
}

export function useShowcaseCamera(
  cameraRef: React.RefObject<CameraRef | null>,
  { coords, padding, enabled = true, orbit = true }: ShowcaseOptions,
) {
  const touchedAt = useRef(0);
  const heading = useRef(SHOWCASE_BEARING);
  const reduce = useRef(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => { reduce.current = v; }).catch(() => {});
  }, []);

  const usable = coords.filter(isUsableCoord);
  const key = usable.map((c) => `${c[0].toFixed(5)},${c[1].toFixed(5)}`).join('|');
  const padKey = `${padding.top}|${padding.bottom}|${padding.left}|${padding.right}`;

  // Frame it tilted — and keep framing it until it takes (a fit issued before
  // MapLibre's first layout is dropped silently).
  useEffect(() => {
    if (!enabled || usable.length === 0) return;
    const box = boundsFor(usable);
    if (!box) return;
    heading.current = SHOWCASE_BEARING;
    const fit = (animated: boolean) =>
      cameraRef.current?.fitBounds([box.ne, box.sw], padding, animated, { pitch: SHOWCASE_PITCH, bearing: SHOWCASE_BEARING });
    fit(false);
    const t1 = setTimeout(() => fit(false), 260);
    const t2 = setTimeout(() => fit(true), 700);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, padKey, enabled]);

  // The slow turn.
  useEffect(() => {
    if (!enabled || !orbit || usable.length === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const quiet = Date.now() - touchedAt.current > IDLE_MS;
      if (quiet && !reduce.current) {
        heading.current = (heading.current + LEG_DEG) % 360;
        cameraRef.current?.setCamera({ heading: heading.current, pitch: SHOWCASE_PITCH, animationDuration: LEG_MS, easing: 'linear' });
        timer = setTimeout(tick, LEG_MS - 60);
      } else {
        timer = setTimeout(tick, 1500);
      }
    };
    // First leg only after the intro fit has landed and the rider has had a look.
    timer = setTimeout(tick, 3500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, orbit]);

  /** Hand to MapView's `onUserGesture`: a finger on the map stops the turn. */
  const touched = useCallback(() => {
    touchedAt.current = Date.now();
  }, []);
  return { touched };
}
