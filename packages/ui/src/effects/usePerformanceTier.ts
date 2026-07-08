import { useMemo } from 'react';
import { Platform } from 'react-native';

export type PerformanceTier = 'high' | 'low';

let cachedTier: PerformanceTier | null = null;

/**
 * Module-level flag set externally from the app layout when iOS Low Power
 * Mode or Android Power Saver is active — forces the performance tier to
 * 'low' so every ambient effect, shader, and animation throttles down.
 * The rider app's _layout.tsx wires this via expo-battery's useLowPowerMode.
 */
let _lowPowerOverride = false;
export function setLowPowerMode(enabled: boolean) {
  _lowPowerOverride = enabled;
  // Bust the cached tier so next computeTier() picks up the change.
  cachedTier = null;
}

function computeTier(): PerformanceTier {
  if (_lowPowerOverride) return 'low';
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

/** 'low' on older/likely-weaker Android devices OR when Low Power Mode is
 * active — consumers should drop ambient motion, glow intensity, and
 * chromatic hints on this tier. */
export function usePerformanceTier(): PerformanceTier {
  return useMemo(() => computeTier(), []);
}
