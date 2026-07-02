import { useMemo } from 'react';
import { Platform } from 'react-native';

export type PerformanceTier = 'high' | 'low';

let cachedTier: PerformanceTier | null = null;

function computeTier(): PerformanceTier {
  if (cachedTier) return cachedTier;

  let tier: PerformanceTier = 'high';
  if (Platform.OS === 'android') {
    // Coarse v1 heuristic, no new native dependency: older Android API
    // levels correlate strongly with older/lower-end hardware. Good enough
    // to gate ambient background motion and glow intensity; revisit with a
    // real RAM/CPU signal (e.g. expo-device) if this proves too coarse.
    const apiLevel = typeof Platform.Version === 'number'
      ? Platform.Version
      : parseInt(String(Platform.Version), 10);
    if (Number.isFinite(apiLevel) && apiLevel < 31) {
      tier = 'low';
    }
  }

  cachedTier = tier;
  return tier;
}

/** 'low' on older/likely-weaker Android devices — consumers should drop
 * ambient motion, glow intensity, and chromatic hints on this tier. */
export function usePerformanceTier(): PerformanceTier {
  return useMemo(() => computeTier(), []);
}
