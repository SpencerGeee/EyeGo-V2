import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useScreenFocus } from './screenFocus';

/**
 * ── SHOULD A LOOPING ANIMATION BE RUNNING RIGHT NOW? ────────────────────────
 *
 * Gate every `withRepeat(..., -1)` on this. `false` means cancel the loop;
 * `true` means (re)start it.
 *
 * ── THE BUG THIS EXISTS FOR, WHICH NO PROFILER SCREENSHOT SHOWS ─────────────
 *
 * A stack unmounts what you navigate away from. A TAB NAVIGATOR DOES NOT — every
 * tab the user has ever opened stays mounted for the rest of the session. So an
 * infinite Reanimated loop on a tab is not scoped to the time that tab is on
 * screen; it is scoped to the time the APP is open.
 *
 * Open Home, Services and Activity once each and three screens' worth of pulses,
 * shimmers and rotating rings are running on the UI thread simultaneously,
 * forever, with two of the three invisible. Nothing about that is detectable by
 * reading a component: each one is individually correct, cancels on unmount, and
 * looks perfectly smooth in isolation. It only appears as "the app gets slower
 * the longer you use it", and as a phone that runs warm.
 *
 * `shaderSlot` already learned this lesson for the Skia background — this is the
 * same rule applied to every other loop in the system.
 *
 * ── AND A BACKGROUNDED APP ANIMATES NOTHING ────────────────────────────────
 *
 * iOS suspends most work when the app leaves the foreground, but the window
 * between "user switched apps" and "OS suspended us" is real, and on Android it
 * can be indefinite. A driver who tabs into the rider app on the same handset
 * should not be paying for the other app's shimmer.
 *
 * ── AND REDUCE MOTION MEANS REDUCE MOTION ──────────────────────────────────
 *
 * Only 15 of the 58 animated files in this repo checked `useReducedMotion`, so
 * a rider who has switched it on still got shimmers, sweeps, breathing rings
 * and a drifting background. Folding it in here fixes every gated loop at once
 * and matches Apple's rule: under reduce-motion, replace loops and springs with
 * something static, but KEEP the changes that carry meaning.
 *
 * That last clause is why this is a parameter rather than a blanket rule. A
 * decorative shimmer should simply stop. A *searching* pulse that stops reads
 * as a screen that has hung — the animation is the message — so those callers
 * pass `decorative: false` and keep running with motion reduced elsewhere.
 *
 * @param opts.decorative default true. False for a loop that carries meaning
 *        (a live-trip pulse, a search indicator) — it then ignores reduce-motion
 *        but is still gated on focus and foreground.
 * @returns true while this loop should be running.
 */
export function useLoopsActive(opts?: { decorative?: boolean }): boolean {
  const decorative = opts?.decorative ?? true;
  const focused = useScreenFocus();
  const reducedMotion = useReducedMotion();
  const [foreground, setForeground] = useState(() => AppState.currentState === 'active');

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setForeground(s === 'active'));
    return () => sub.remove();
  }, []);

  if (decorative && reducedMotion) return false;
  return focused && foreground;
}
