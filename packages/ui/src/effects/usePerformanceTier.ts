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
/**
 * ── WHY ONE WINDOW WAS NOT ENOUGH ───────────────────────────────────────────
 *
 * BUGFIX ("the device performance tier is flawed and doesn't accurately work";
 * "the only thing that does the 3D is the ride types"). The probe sampled the
 * JS thread ONCE, four seconds after the first component asked — which is the
 * middle of launch on every phone: auth hydration, the first socket connect,
 * the first map tiles and the splash all land on the JS thread then. A fast
 * iPhone measured busy, latched 'low' for the whole session, and every gated
 * effect (the 3D page turns, the hero-bus flights) silently switched off while
 * the ungated ones (the ride-type models) kept working — exactly the report.
 *
 * Now: three windows spread over the first half-minute, and the device is
 * judged by its BEST window. A phone that is merely busy for a moment has at
 * least one quiet window and keeps its tier; a phone that is genuinely slow is
 * slow in all three. Nothing is published until all three are in, so the tier
 * no longer flips mid-launch either.
 *
 * The measured verdict is also kept APART from the static ceiling. The Android
 * API-level rule exists for full-screen shaders; it says nothing about whether
 * a phone can tilt a card, which is a transform the GPU does for free. The 3D
 * flow asks `useMeasuredPerformanceTier`, which only the probe can lower.
 */
const PROBE_WINDOWS_AT_MS = [6_000, 16_000, 30_000];
const PROBE_SAMPLES = 60;
const PROBE_WARMUP = 10;
/** A window interrupted by backgrounding is retried this much later, this many times. */
const PROBE_RETRY_MS = 10_000;
const PROBE_MAX_RETRIES = 4;
/** Above this p75 frame time the device is visibly missing frames. */
const MID_THRESHOLD_MS = 20.5;
/** Above this it is not merely dropping frames, it is stuttering. */
const LOW_THRESHOLD_MS = 34;

let probeStarted = false;
let ceilingTier: PerformanceTier = 'high';
let measuredTier: PerformanceTier = 'high';
const measuredListeners = new Set<(t: PerformanceTier) => void>();
const RANK: Record<PerformanceTier, number> = { low: 0, mid: 1, high: 2 };
const lower = (a: PerformanceTier, b: PerformanceTier) => (RANK[a] <= RANK[b] ? a : b);

function publish(tier: PerformanceTier) {
  if (cachedTier === tier) return;
  cachedTier = tier;
  listeners.forEach((notify) => notify(tier));
}

/** One window of frame deltas → its p75, or null when the window was spoiled. */
function sampleWindow(done: (p75: number | null) => void) {
  const deltas: number[] = [];
  let last = 0;
  let frames = 0;
  let aborted = false;
  // A backgrounded app stops producing frames; the gap on return would read
  // as a catastrophically slow device. Abandon the window rather than trust it.
  const sub = AppState.addEventListener('change', (s) => {
    if (s !== 'active') aborted = true;
  });
  const finish = () => {
    sub.remove();
    if (aborted || deltas.length < 20) return done(null);
    const sorted = [...deltas].sort((a, b) => a - b);
    const p75 = sorted[Math.floor(sorted.length * 0.75)];
    done(Number.isFinite(p75) ? p75 : null);
  };
  const step = (t: number) => {
    if (aborted) return finish();
    if (last > 0) {
      frames += 1;
      if (frames > PROBE_WARMUP) deltas.push(t - last);
    }
    last = t;
    if (deltas.length >= PROBE_SAMPLES) return finish();
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function startProbe() {
  if (probeStarted) return;
  probeStarted = true;
  if (typeof requestAnimationFrame !== 'function') return;

  const results: number[] = [];
  let retries = 0;
  const conclude = () => {
    const best = Math.min(...results);
    measuredTier = best >= LOW_THRESHOLD_MS ? 'low' : best >= MID_THRESHOLD_MS ? 'mid' : 'high';
    measuredListeners.forEach((notify) => notify(measuredTier));
    publish(lower(ceilingTier, measuredTier));
  };
  const run = (i: number, delay: number) => {
    setTimeout(() => sampleWindow((p75) => {
      if (p75 == null) {
        if (retries++ < PROBE_MAX_RETRIES) run(i, PROBE_RETRY_MS);
        else if (results.length) conclude();
        return;
      }
      results.push(p75);
      if (i + 1 < PROBE_WINDOWS_AT_MS.length) run(i + 1, PROBE_WINDOWS_AT_MS[i + 1] - PROBE_WINDOWS_AT_MS[i]);
      else conclude();
    }), delay);
  };
  // A plain timer, not `InteractionManager`: the work that distorts a launch
  // measurement (hydration, sockets, tiles) never registers as an interaction.
  run(0, PROBE_WINDOWS_AT_MS[0]);
}

function computeTier(): PerformanceTier {
  if (cachedTier) return cachedTier;
  ceilingTier = staticTier();
  cachedTier = ceilingTier;
  startProbe();
  return cachedTier;
}

/**
 * The probe's verdict alone, without the static shader ceiling — 'high' until
 * three windows say otherwise. For cheap transform-only motion (the 3D flow).
 */
export function useMeasuredPerformanceTier(): PerformanceTier {
  computeTier();
  const [tier, setTier] = useState<PerformanceTier>(measuredTier);
  useEffect(() => {
    measuredListeners.add(setTier);
    if (measuredTier !== tier) setTier(measuredTier);
    return () => {
      measuredListeners.delete(setTier);
    };
  }, [tier]);
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
    measuredTier = 'high';
    return;
  }
  measuredTier = tier;
  measuredListeners.forEach((notify) => notify(tier));
  publish(tier);
}
