import { useMemo } from 'react';
import { Platform } from 'react-native';

export type PerformanceTier = 'high' | 'low';

let cachedTier: PerformanceTier | null = null;

/**
 * NOTE — iOS Low Power Mode deliberately does NOT feed into this tier.
 *
 * The rider app used to force 'low' whenever expo-battery reported Low Power
 * Mode, which is a much bigger hammer than it looks: 'low' disables the Skia
 * background shader, GradientGlowBorder's rotation, GlassSurface blur, the
 * Lightfall/LightPillar backgrounds and the morph animations all at once. The
 * result was an app that went flat and lifeless the moment a phone dipped
 * under 20% — while the driver app, which never wired this up, stayed smooth
 * on the same handset. iOS already throttles animation and refresh rate under
 * Low Power Mode on its own; doing it again in userland only cost fidelity.
 *
 * The tier is now purely a hardware-capability signal. If a battery-aware
 * degradation ever comes back it should be a separate, narrower flag that
 * gates only the full-screen GPU shader — not every visual affordance.
 */
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
