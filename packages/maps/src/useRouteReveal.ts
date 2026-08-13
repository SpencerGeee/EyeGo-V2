import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

type Coord = [number, number];

/**
 * Draws a route on rather than snapping it in.
 *
 * ── WHY NOT REANIMATED ───────────────────────────────────────────────────────
 * Everything else in these apps animates on the UI thread, and it should. This
 * cannot: `ShapeSource` takes its GeoJSON as a React prop, so the only way to
 * change what is drawn is to re-render with different coordinates. A shared value
 * has no path into a native prop that is not animatable, and MapLibre exposes no
 * animatable "reveal" on a line layer.
 *
 * The honest version is therefore a coordinate reveal driven from JS — and the
 * thing that makes it cheap is the FRAME BUDGET. A 200-point route revealed once
 * per display frame is ~50 prop updates and 50 native shape diffs in 800 ms, on
 * the same thread that is handling the driver's location stream. So this updates
 * a fixed ~24 times regardless of route length: visually continuous (42 ms apart,
 * under the ~50 ms at which motion starts to read as stepping) and an order of
 * magnitude less work.
 *
 * ── WHAT IT GUARANTEES ───────────────────────────────────────────────────────
 * - The final frame is always the WHOLE route, set exactly once. A reveal that
 *   ends a few coordinates short leaves a route that stops before the destination.
 * - A route that changes mid-reveal restarts from the new geometry rather than
 *   interpolating between two unrelated lines.
 * - Identical coordinates re-supplied (a re-render with the same route) do NOT
 *   re-animate. The line would otherwise redraw itself every time the ETA ticked.
 * - "Reduce Motion" gets the full route immediately.
 * - The timer is cancelled on unmount, so a backgrounded screen stops working.
 */
export function useRouteReveal(
  coordinates: Coord[] | null | undefined,
  options: { durationMs?: number; enabled?: boolean } = {},
): Coord[] | null {
  const { durationMs = 800, enabled = true } = options;

  // Identity of the route, not of the array. `path` is rebuilt by the trip store
  // on every ETA refresh, so comparing references would restart the reveal every
  // few seconds. First, last and length is enough to tell two routes apart, and
  // it is O(1).
  const signature = useMemo(() => {
    if (!coordinates || coordinates.length < 2) return null;
    const a = coordinates[0];
    const b = coordinates[coordinates.length - 1];
    return `${coordinates.length}:${a?.[0]},${a?.[1]}:${b?.[0]},${b?.[1]}`;
  }, [coordinates]);

  const [revealed, setRevealed] = useState<Coord[] | null>(coordinates ?? null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduceMotion = useRef(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (alive) reduceMotion.current = on;
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }

    if (!coordinates || coordinates.length < 2) {
      setRevealed(coordinates ?? null);
      return;
    }

    if (!enabled || reduceMotion.current) {
      setRevealed(coordinates);
      return;
    }

    const STEPS = 24;
    const interval = Math.max(16, Math.round(durationMs / STEPS));
    let step = 0;

    // Start at two points so the line exists from the first frame — starting at
    // zero makes the route appear to blink in.
    setRevealed(coordinates.slice(0, 2));

    const tick = () => {
      step += 1;
      const t = step / STEPS;
      // Ease-out cubic: leaves the pickup quickly, settles into the destination
      // rather than stopping dead. Matches the camera's own deceleration.
      const eased = 1 - Math.pow(1 - t, 3);
      const upto = Math.max(2, Math.min(coordinates.length, Math.round(eased * coordinates.length)));
      setRevealed(coordinates.slice(0, upto));

      if (step < STEPS) {
        timer.current = setTimeout(tick, interval);
      } else {
        timer.current = null;
        // The whole thing, exactly once, so no rounding can leave it short.
        setRevealed(coordinates);
      }
    };
    timer.current = setTimeout(tick, interval);

    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
    // Keyed on the route's identity, never on the array reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, enabled, durationMs]);

  return revealed;
}
