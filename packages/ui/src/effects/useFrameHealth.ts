import { useCallback, useEffect, useRef, useState } from 'react';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';

/**
 * ── MEASURE THE SMOOTHNESS INSTEAD OF ASSERTING IT ──────────────────────────
 *
 * Every optimisation in this codebase so far has been verified by reading
 * source: a prop is present, a loop is gated, a spring has the right damping.
 * That proves the fix is still spelled correctly. It does not prove a single
 * frame landed on time, on a real handset, on the screen the user complained
 * about — and "it looks smooth in the code" is exactly the claim that was wrong
 * about the driver app for four rounds.
 *
 * This is the instrument. It runs ON THE UI THREAD via `useFrameCallback`,
 * which is the thread that actually drops frames, and reports what the phone
 * really did.
 *
 * ── WHAT THE NUMBERS MEAN ──────────────────────────────────────────────────
 *
 * `p50` is the typical frame. `p95` is the one the user notices — a stutter is
 * perceived at the tail, not the average, which is why a "60fps average" screen
 * can still feel bad. `worst` is the single longest hitch. `dropped` counts
 * frames that missed the display's budget outright.
 *
 * The budget is derived from the device's OWN refresh rate rather than assumed
 * to be 60Hz: a 120Hz iPhone has an 8.3ms budget, and grading it against 16.7ms
 * would call a visibly janky screen perfect.
 *
 * ── WHY IT IS SAFE TO SHIP ─────────────────────────────────────────────────
 *
 * The frame callback does arithmetic on two numbers and nothing else — no
 * allocation, no bridge crossing, no logging. It reports to JS only when
 * `stop()` is called. It is still off by default (`enabled: false`) so it costs
 * nothing until something asks for it.
 */
export interface FrameHealth {
  /** Frames observed. */
  frames: number;
  /** Median frame interval, ms. */
  p50: number;
  /** 95th-percentile frame interval, ms — where a stutter is actually felt. */
  p95: number;
  /** Longest single frame, ms. */
  worst: number;
  /** Frames that missed the device's own budget. */
  dropped: number;
  /** Share of frames that missed, 0-1. */
  droppedRatio: number;
  /** The budget used for grading, ms (from the device's real refresh rate). */
  budgetMs: number;
}

const EMPTY: FrameHealth = {
  frames: 0, p50: 0, p95: 0, worst: 0, dropped: 0, droppedRatio: 0, budgetMs: 16.7,
};

/** Keep the sample bounded — a long session must not grow an array forever. */
const MAX_SAMPLES = 600;

function summarise(samples: number[], budgetMs: number): FrameHealth {
  if (samples.length === 0) return { ...EMPTY, budgetMs };
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  // A frame is "dropped" once it overruns the budget by more than a little —
  // 1.5x, so ordinary scheduling noise is not reported as jank.
  const dropped = samples.filter((d) => d > budgetMs * 1.5).length;
  return {
    frames: samples.length,
    p50: Math.round(at(0.5) * 10) / 10,
    p95: Math.round(at(0.95) * 10) / 10,
    worst: Math.round(sorted[sorted.length - 1] * 10) / 10,
    dropped,
    droppedRatio: dropped / samples.length,
    budgetMs: Math.round(budgetMs * 10) / 10,
  };
}

/**
 * Measure real frame intervals on the UI thread.
 *
 * @param enabled start measuring immediately. Off by default so this costs
 *        nothing unless something asks.
 * @returns the last summary, plus `start`/`stop`/`reset`.
 */
export function useFrameHealth(enabled = false) {
  const [running, setRunning] = useState(enabled);
  const [health, setHealth] = useState<FrameHealth>(EMPTY);

  const samples = useSharedValue<number[]>([]);
  const last = useSharedValue(0);
  /**
   * The device's real budget. Measured rather than assumed: a 120Hz panel has
   * an 8.3ms budget and grading it at 16.7 would score a janky screen perfect.
   * Seeded at 60Hz and lowered by what the phone actually delivers.
   */
  const budget = useSharedValue(16.7);
  const budgetRef = useRef(16.7);

  const publish = useCallback((s: number[], b: number) => {
    budgetRef.current = b;
    setHealth(summarise(s, b));
  }, []);

  useFrameCallback((frame) => {
    'worklet';
    const t = frame.timestamp;
    if (last.value > 0) {
      const dt = t - last.value;
      // Ignore the impossible: a backgrounded app or a debugger pause produces
      // multi-second gaps that are not frames and would poison the tail.
      if (dt > 0 && dt < 2000) {
        // Learn the panel's real cadence from the fastest frames it delivers.
        if (dt > 4 && dt < budget.value) budget.value = Math.max(7.5, dt);
        const next = samples.value.length >= MAX_SAMPLES
          ? samples.value.slice(-(MAX_SAMPLES - 1))
          : samples.value.slice();
        next.push(dt);
        samples.value = next;
      }
    }
    last.value = t;
  }, running);

  const start = useCallback(() => {
    samples.value = [];
    last.value = 0;
    /**
     * A short settle before the first sample, or the measurement is dominated
     * by the mount it was started on rather than by the interaction being
     * judged. A plain timer rather than `InteractionManager` for the same
     * reason as the tier probe: the work that distorts a fresh screen here is
     * asynchronous (queries, sockets, first map tiles) and never registers as
     * an interaction.
     */
    setTimeout(() => setRunning(true), 400);
  }, [samples, last]);

  const stop = useCallback(() => {
    setRunning(false);
    publish(samples.value, budget.value);
  }, [samples, budget, publish]);

  const reset = useCallback(() => {
    samples.value = [];
    last.value = 0;
    setHealth(EMPTY);
  }, [samples, last]);

  // Publish a rolling summary while running, so a caller can watch it live
  // without having to stop. Deliberately 1 Hz: this is the only JS-thread work
  // the instrument does, and it must not itself become the jank.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => publish(samples.value, budget.value), 1000);
    return () => clearInterval(t);
  }, [running, samples, budget, publish]);

  return { health, running, start, stop, reset };
}

/**
 * A one-line verdict, for a log line or a dev overlay.
 *
 * Graded on p95 and the dropped ratio rather than on the average, because the
 * average is what makes a stuttering screen look fine on paper.
 */
export function gradeFrameHealth(h: FrameHealth): 'smooth' | 'occasional' | 'janky' | 'no data' {
  if (h.frames < 30) return 'no data';
  if (h.droppedRatio > 0.05 || h.p95 > h.budgetMs * 2) return 'janky';
  if (h.droppedRatio > 0.01 || h.p95 > h.budgetMs * 1.5) return 'occasional';
  return 'smooth';
}
