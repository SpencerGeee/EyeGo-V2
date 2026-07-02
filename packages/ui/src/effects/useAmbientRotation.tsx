import React, { createContext, useContext, useEffect, useMemo } from 'react';
import {
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';

/**
 * One shared rotation clock (0-360, linear, infinite) that every
 * GradientGlowBorder instance reads from via useDerivedValue, instead of
 * each instance running its own withRepeat timer. Keeps N simultaneous
 * glow rings to the cost of a single animation.
 */
const AmbientRotationContext = createContext<SharedValue<number> | null>(null);

const AMBIENT_DURATION_MS = 12000;

export function AmbientRotationProvider({ children }: { children: React.ReactNode }) {
  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: AMBIENT_DURATION_MS, easing: Easing.linear }),
      -1,
      false
    );
  }, [rotation]);

  return (
    <AmbientRotationContext.Provider value={rotation}>
      {children}
    </AmbientRotationContext.Provider>
  );
}

/**
 * Returns the shared ambient rotation clock. Falls back to a local,
 * independent clock if no AmbientRotationProvider is mounted above —
 * so a stray usage never crashes, it just loses the "one timer" perf win.
 */
export function useAmbientRotation(): SharedValue<number> {
  const ctx = useContext(AmbientRotationContext);
  // eslint-disable-next-line react-hooks/rules-of-hooks -- ctx presence is stable per app tree, not per render
  const fallback = useSharedValue(0);

  useEffect(() => {
    if (!ctx) {
      fallback.value = withRepeat(
        withTiming(360, { duration: AMBIENT_DURATION_MS, easing: Easing.linear }),
        -1,
        false
      );
    }
  }, [ctx, fallback]);

  return useMemo(() => ctx ?? fallback, [ctx, fallback]);
}
