import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useScreenFocus } from '../../effects/screenFocus';
import { afterTransition, isTransitioning } from './transitionClock';

/**
 * SMOOTHSCREEN — THE ONE COMPONENT THAT MAKES A SCREEN FEEL BUTTER-SMOOTH.
 *
 * Wrap a screen's body in this and the screen stops competing with its own
 * navigation transition. Read `transitionClock.ts` first: this is the consumer
 * of that clock, and the whole design rests on the observation that the native
 * push is already smooth — it is the JS work landing on top of it that is not.
 *
 * ── WHAT IT ACTUALLY DOES ───────────────────────────────────────────────────
 *
 *  1. HOLDS THE HEAVY TREE BACK. Children do not mount until the transition has
 *     finished and `InteractionManager` says the thread is clear. During the
 *     push the screen shows `placeholder` — a skeleton that costs nothing —
 *     so the transition gets the whole frame budget it was designed for.
 *
 *  2. FADES, NEVER SLIDES. When the content does arrive it crosses in on
 *     opacity alone. A translate here would be a SECOND arrival animation
 *     describing the same event as the native slide, which is the "it jumps"
 *     half of the report. Opacity composites on the UI thread and cannot
 *     fight a transform it does not own.
 *
 *  3. REMEMBERS THAT IT HAS BEEN HERE BEFORE. `firstAppearance` is true only
 *     for the very first arrival. Coming BACK to a screen (a pop) skips the
 *     deferral and the fade entirely — the tree is already mounted and already
 *     correct, and re-animating it is precisely what made returning to the
 *     rider home look like it snapped into place.
 *
 *  4. TELLS ITS DESCENDANTS. `useSmoothScreen()` exposes both flags, so list
 *     items can stagger on first view and appear instantly on every view
 *     after, and expensive queries can stay disabled until `settled`.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────
 * It does not throttle, debounce, or lower quality. Nothing is degraded and no
 * effect is turned off — that is `usePerformanceTier`'s job and it is a
 * separate axis. This only ever moves work in TIME.
 *
 * It also never holds content for longer than `maxHoldMs`. A screen whose
 * interactions never settle (a live map streaming fixes, a socket that will not
 * quiet down) must still show up, so the hold is a best-effort head start with
 * a hard ceiling, not a gate.
 */

export interface SmoothScreenState {
  /** The transition is over and the thread is clear. Heavy work may start. */
  settled: boolean;
  /** True only for the first arrival at this screen. False after a pop back. */
  firstAppearance: boolean;
}

const SmoothScreenContext = createContext<SmoothScreenState>({
  settled: true,
  firstAppearance: true,
});

/**
 * "Is my screen finished arriving, and is this the first time?"
 *
 * Safe outside a `SmoothScreen`: the default says settled, so a component that
 * has not been wrapped behaves exactly as it did before.
 */
export function useSmoothScreen(): SmoothScreenState {
  return useContext(SmoothScreenContext);
}

/** Just the boolean, for gating a query's `enabled` or a map's mount. */
export function useSettled(): boolean {
  return useContext(SmoothScreenContext).settled;
}

export interface SmoothScreenProps {
  children: ReactNode;
  /**
   * Drawn while the transition runs. Keep it CHEAP — a skeleton, a header, a
   * flat fill. Anything expensive here defeats the point.
   */
  placeholder?: ReactNode;
  /**
   * Skip the hold. For screens that are already light (a confirmation, a
   * form) where a skeleton would be a downgrade, but that still want the
   * `firstAppearance` bookkeeping for their list staggers.
   */
  eager?: boolean;
  /**
   * Extra settling time past the transition, for screens that mount something
   * genuinely enormous (a map, a 60-row list). Rarely needed.
   */
  warmupMs?: number;
  /** Hard ceiling on the hold. The content shows up regardless after this. */
  maxHoldMs?: number;
  style?: StyleProp<ViewStyle>;
  /** Fade duration once content mounts. */
  fadeMs?: number;
}

export function SmoothScreen({
  children,
  placeholder = null,
  eager = false,
  warmupMs = 0,
  maxHoldMs = 900,
  style,
  fadeMs = 190,
}: SmoothScreenProps) {
  const reducedMotion = useReducedMotion();
  const focused = useScreenFocus();

  /**
   * A screen that mounts while nothing is transitioning was not pushed — it is
   * the app's first screen, a tab swap, or a re-render. There is nothing to
   * stay out of the way of, so do not make the user wait for a fade.
   */
  const bornDuringTransition = useRef(isTransitioning()).current;
  const shouldHold = !eager && !reducedMotion && bornDuringTransition;

  const [settled, setSettled] = useState(!shouldHold);

  /**
   * FIRST APPEARANCE, TRACKED IN A REF AND MIRRORED INTO STATE.
   *
   * It flips on the first BLUR, not on the second focus: by the time a pop has
   * brought this screen back, its children are already re-rendering and need to
   * know they must not animate. Learning that one commit late is what produced
   * the flash.
   */
  const seenRef = useRef(false);
  const [firstAppearance, setFirstAppearance] = useState(true);
  useEffect(() => {
    if (!focused) {
      if (!seenRef.current) {
        seenRef.current = true;
        setFirstAppearance(false);
      }
    }
  }, [focused]);

  const opacity = useSharedValue(shouldHold ? 0 : 1);

  useEffect(() => {
    if (!shouldHold) return;

    let done = false;
    let warmTimer: ReturnType<typeof setTimeout> | null = null;
    const reveal = () => {
      if (done) return;
      done = true;
      setSettled(true);
    };

    // The normal path: wait out the transition, let the thread drain, then add
    // whatever warm-up the screen asked for.
    const cancelAfter = afterTransition(() => {
      if (warmupMs > 0) {
        warmTimer = setTimeout(reveal, warmupMs);
      } else {
        reveal();
      }
    });

    // The ceiling. See the header: a screen that never settles must still show.
    const ceiling = setTimeout(reveal, maxHoldMs);

    return () => {
      done = true;
      cancelAfter();
      if (warmTimer) clearTimeout(warmTimer);
      clearTimeout(ceiling);
    };
  }, [shouldHold, warmupMs, maxHoldMs]);

  useEffect(() => {
    if (!settled) return;
    opacity.value = reducedMotion
      ? 1
      : withTiming(1, { duration: fadeMs, easing: Easing.out(Easing.quad) });
    return () => cancelAnimation(opacity);
  }, [settled, reducedMotion, fadeMs, opacity]);

  const contentStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const value = useMemo<SmoothScreenState>(
    () => ({ settled, firstAppearance }),
    [settled, firstAppearance],
  );

  return (
    <SmoothScreenContext.Provider value={value}>
      <View style={[styles.root, style]}>
        {!settled && placeholder != null ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {placeholder}
          </View>
        ) : null}
        {settled ? (
          <Animated.View style={[styles.root, contentStyle]}>{children}</Animated.View>
        ) : null}
      </View>
    </SmoothScreenContext.Provider>
  );
}

/**
 * DEFER A SUBTREE WITHOUT DEFERRING THE SCREEN.
 *
 * For the one heavy thing on an otherwise light screen — the map on a booking
 * page, the chart on Earnings. The rest of the screen paints immediately and
 * this fills in behind it.
 */
export function SmoothDefer({
  children,
  placeholder = null,
  delayMs = 0,
}: {
  children: ReactNode;
  placeholder?: ReactNode;
  delayMs?: number;
}) {
  const { settled } = useSmoothScreen();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!settled) return;
    if (delayMs <= 0) {
      setReady(true);
      return;
    }
    const t = setTimeout(() => setReady(true), delayMs);
    return () => clearTimeout(t);
  }, [settled, delayMs]);

  return <>{ready ? children : placeholder}</>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});

export default SmoothScreen;
