import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import {
  cancelAnimation,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';

/**
 * One shared rotation clock (0-360, linear, infinite) that every
 * GradientGlowBorder instance reads from, instead of each instance running its
 * own withRepeat timer. Keeps N simultaneous glow rings to the cost of a
 * single animation.
 *
 * PERFORMANCE (part of the "the apps feel dense, my phone gets sluggish"
 * report). Sharing the clock was only half the problem. The clock also never
 * stopped: it was started once at provider mount and ran for the entire life of
 * the process — through every screen with no rings on it, and through every
 * minute the app spent in the background. Each mounted ring rotates a
 * LinearGradient sized to 2.2× the card's diagonal, so an idle clock is not
 * idle at all; it is a full-layer recomposite per ring per frame, forever.
 *
 * Two gates now:
 *   • REFERENCE COUNT — the clock runs only while at least one ring is
 *     subscribed. A screen with no glow costs nothing.
 *   • APP STATE — it stops on background and resumes on foreground. A rotation
 *     nobody can see is pure battery.
 *
 * Both are invisible: the ring's angle is continuous across a pause, because
 * the shared value keeps its position and simply resumes from it.
 */
const AMBIENT_DURATION_MS = 12000;

interface AmbientClock {
  value: SharedValue<number>;
  /** Called by each consumer on mount/unmount to gate the timer. */
  retain: () => () => void;
}

const AmbientRotationContext = createContext<AmbientClock | null>(null);

/**
 * Resume the sweep from wherever it currently sits, so pausing and restarting
 * never produces a visible jump. The remaining duration is scaled to the
 * remaining arc — the angular speed stays constant across a pause.
 */
function spin(rotation: SharedValue<number>) {
  const from = rotation.value % 360;
  const remaining = ((360 - from) / 360) * AMBIENT_DURATION_MS;
  rotation.value = from;
  rotation.value = withTiming(360, { duration: remaining, easing: Easing.linear }, (finished) => {
    'worklet';
    if (!finished) return;
    rotation.value = 0;
    rotation.value = withRepeat(
      withTiming(360, { duration: AMBIENT_DURATION_MS, easing: Easing.linear }),
      -1,
      false,
    );
  });
}

export function AmbientRotationProvider({ children }: { children: React.ReactNode }) {
  const rotation = useSharedValue(0);
  const consumers = useRef(0);
  const running = useRef(false);
  const foreground = useRef(true);

  const sync = useRef(() => {
    const shouldRun = consumers.current > 0 && foreground.current;
    if (shouldRun === running.current) return;
    running.current = shouldRun;
    if (shouldRun) spin(rotation);
    else cancelAnimation(rotation);
  }).current;

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      foreground.current = state === 'active';
      sync();
    });
    return () => {
      sub.remove();
      cancelAnimation(rotation);
    };
  }, [rotation, sync]);

  const clock = useMemo<AmbientClock>(
    () => ({
      value: rotation,
      retain: () => {
        consumers.current += 1;
        sync();
        return () => {
          consumers.current = Math.max(0, consumers.current - 1);
          sync();
        };
      },
    }),
    [rotation, sync],
  );

  return (
    <AmbientRotationContext.Provider value={clock}>
      {children}
    </AmbientRotationContext.Provider>
  );
}

/**
 * Returns the shared ambient rotation clock and keeps it alive for as long as
 * the calling component is mounted.
 *
 * Falls back to a local, independent clock if no AmbientRotationProvider is
 * mounted above — so a stray usage never crashes, it just loses the "one timer"
 * win. The fallback is gated the same way.
 */
export function useAmbientRotation(): SharedValue<number> {
  const ctx = useContext(AmbientRotationContext);
  const fallback = useSharedValue(0);

  useEffect(() => {
    if (ctx) return ctx.retain();
    spin(fallback);
    return () => cancelAnimation(fallback);
  }, [ctx, fallback]);

  return useMemo(() => ctx?.value ?? fallback, [ctx, fallback]);
}
