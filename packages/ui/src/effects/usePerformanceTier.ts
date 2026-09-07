import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

/**
 * 'high' — run everything.
 * 'mid'  — the ambient shader keeps running, but cheaper: fewer raymarch
 *          pixels, a slower clock, no noise. Glow rings and glass stay.
 * 'low'  — no shader canvas at all; static gradient, static rings, no blur.
 */
export type PerformanceTier = 'high' | 'mid' | 'low';

let cachedTier: PerformanceTier | null = null;
const listeners = new Set<(t: PerformanceTier) => void>();

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
 * The tier is a hardware-capability signal, and it is now MEASURED rather than
 * guessed. See `startProbe`.
 */
function staticTier(): PerformanceTier {
  if (Platform.OS === 'android') {
    // Coarse, but decisive where it fires: older Android API levels correlate
    // strongly with older/lower-end hardware, and those devices cannot carry a
    // full-screen raymarch at any setting. Measured probing still runs on top
    // of this — it can lower the tier further, never raise it.
    const apiLevel =
      typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
    if (Number.isFinite(apiLevel) && apiLevel < 31) return 'low';
  }
  return 'high';
}

/**
 * ── WHY THIS IS MEASURED AND NOT A MODEL LOOKUP ─────────────────────────────
 *
 * BUGFIX ("the performance on my friend's iPhone was super bad and laggy… I
 * need the app working optimally on all devices").
 *
 * This function previously returned 'high' for EVERY iOS device, because the
 * only degradation rule it had was an Android API-level check. An iPhone 12
 * (A14, 2020) was therefore handed exactly the same budget as the newest
 * hardware: the full-resolution raymarch pixel budget, the 30fps shader clock,
 * full noise, and every glow ring rotating. Worse, both `AppBackground` and
 * `LightPillarBackground` branch on `tier === 'high'` to pick a cheaper "mid"
 * setting — a branch no device could ever reach, because 'mid' did not exist.
 *
 * A model lookup table would need `expo-device`, which is a new native module:
 * a new store build before the fix reaches anybody, and a table that is wrong
 * for every handset released after it was written. Measuring the frame budget
 * answers the question we actually care about — "is THIS phone keeping up?" —
 * ships over the air, and ages correctly.
 *
 * The probe is deliberately timid:
 *   - it runs ONCE per app session, and latches;
 *   - it waits for the app to settle first, so launch work (splash, hydration,
 *     the first map tiles) is not mistaken for a slow device;
 *   - it only ever LOWERS the tier. A phone cannot probe its way up past the
 *     static ceiling, so an Android device pinned to 'low' stays there;
 *   - it discards the samples either side of a background/foreground flip,
 *     because a suspended app produces enormous frame gaps that mean nothing.
 */
const PROBE_SETTLE_MS = 4000;
const PROBE_SAMPLES = 90;
const PROBE_WARMUP = 12;
/** Above this p75 frame time the device is visibly missing frames. */
const MID_THRESHOLD_MS = 20.5;
/** Above this it is not merely dropping frames, it is stuttering. */
const LOW_THRESHOLD_MS = 34;

let probeStarted = false;

function publish(tier: PerformanceTier) {
  if (cachedTier === tier) return;
  cachedTier = tier;
  listeners.forEach((notify) => notify(tier));
}

function startProbe(ceiling: PerformanceTier) {
  if (probeStarted) return;
  probeStarted = true;
  // Nothing to learn: 'low' is already the floor.
  if (ceiling === 'low') return;
  if (typeof requestAnimationFrame !== 'function') return;

  const begin = () => {
    const deltas: number[] = [];
    let last = 0;
    let frames = 0;
    let aborted = false;

    // A backgrounded app stops producing frames; the gap on return would read
    // as a catastrophically slow device. Abandon the run rather than trust it.
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') aborted = true;
    });

    const finish = () => {
      sub.remove();
      if (aborted || deltas.length < 20) return;
      const sorted = [...deltas].sort((a, b) => a - b);
      const p75 = sorted[Math.floor(sorted.length * 0.75)];
      if (!Number.isFinite(p75)) return;
      if (p75 >= LOW_THRESHOLD_MS) publish('low');
      else if (p75 >= MID_THRESHOLD_MS) publish('mid');
      // Below both thresholds the device keeps the ceiling it already had.
    };

    const step = (t: number) => {
      if (aborted) {
        finish();
        return;
      }
      if (last > 0) {
        frames += 1;
        // Skip the warm-up frames: the first few after a settle still carry
        // the tail of whatever work triggered the settle callback.
        if (frames > PROBE_WARMUP) deltas.push(t - last);
      }
      last = t;
      if (deltas.length >= PROBE_SAMPLES) {
        finish();
        return;
      }
      requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
  };

  // A plain timer, not `InteractionManager`: the work that actually distorts a
  // launch-time measurement here is asynchronous (auth hydration, the first
  // socket connect, the first map tiles) and never registers as an
  // interaction, so waiting on interactions would return too early and
  // `runAfterInteractions` is deprecated besides. The warm-up frames and the
  // p75 below absorb whatever is still in flight.
  setTimeout(begin, PROBE_SETTLE_MS);
}

function computeTier(): PerformanceTier {
  if (cachedTier) return cachedTier;
  const tier = staticTier();
  cachedTier = tier;
  startProbe(tier);
  return tier;
}

/**
 * The device's current capability tier. Consumers should drop ambient motion,
 * shader cost, glow intensity and blur as this falls.
 *
 * This subscribes rather than latching in a `useMemo`: the measured probe
 * resolves a few seconds after launch, and a component that read the tier once
 * at mount would keep the launch-time guess for the rest of the session — the
 * shader would never actually get cheaper on the phone that needed it to.
 */
export function usePerformanceTier(): PerformanceTier {
  const [tier, setTier] = useState<PerformanceTier>(computeTier);

  useEffect(() => {
    listeners.add(setTier);
    // The probe may have resolved between this component's render and its
    // effect firing.
    if (cachedTier && cachedTier !== tier) setTier(cachedTier);
    return () => {
      listeners.delete(setTier);
    };
  }, [tier]);

  return tier;
}

/** Test seam — force a tier and notify every consumer. */
export function __setPerformanceTierForTest(tier: PerformanceTier | null) {
  probeStarted = true;
  if (tier == null) {
    cachedTier = null;
    return;
  }
  publish(tier);
}
