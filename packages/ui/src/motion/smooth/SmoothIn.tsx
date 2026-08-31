import React, { useEffect, type ReactNode } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated';

import { springs } from '@eyego/config';
import { useSmoothScreen } from './SmoothScreen';

/**
 * A LIST ITEM THAT ARRIVES ONCE.
 *
 * ── WHY NOT `entering={FadeIn.delay(i * 60)}` ───────────────────────────────
 * That is what both apps used, and it has two faults that together are most of
 * "it's laggy and it jumps back":
 *
 *  1. IT RUNS DURING THE PUSH. Reanimated layout animations start at mount,
 *     which on a pushed screen is the exact moment the native transition
 *     begins. Ten cards each running their own 200 ms fade, on the same thread
 *     that is building the screen, is ten animations' worth of work spent
 *     describing an arrival the navigator is ALREADY animating.
 *
 *  2. IT RUNS AGAIN. Any commit that recreates the element — a React Query
 *     refetch on focus, a store update, a re-key — replays the entrance. Open a
 *     trip card, come back, and the whole list fades in a second time as if it
 *     were new. The rider has seen these cards; re-introducing them is what
 *     reads as a jump.
 *
 * ── WHAT THIS DOES INSTEAD ──────────────────────────────────────────────────
 * It asks the screen. `SmoothScreen` knows whether this is the first arrival
 * and whether the transition has finished, so:
 *
 *   first arrival, settled  →  stagger in (the nice thing, at the right time)
 *   returning to the screen →  already there, no animation at all
 *   no SmoothScreen above   →  behaves like a plain fade, so it is safe to
 *                              drop into any screen mid-migration
 *
 * Opacity and a 10 pt rise, both compositor properties. `springs.standard` is
 * the token — never an inline `{ damping, stiffness }`; see config/motion.ts.
 */

export interface SmoothInProps {
  children: ReactNode;
  /** Position in the list. Drives the stagger. */
  index?: number;
  /** Milliseconds between neighbours. 45 ms reads as a cascade, not a queue. */
  stagger?: number;
  /** Distance the item rises from, in points. 0 for a pure fade. */
  rise?: number;
  /** Longest delay any item may take, so item 30 is not 1.4 s late. */
  maxDelay?: number;
  style?: StyleProp<ViewStyle>;
}

export function SmoothIn({
  children,
  index = 0,
  stagger = 45,
  rise = 10,
  maxDelay = 320,
  style,
}: SmoothInProps) {
  const { settled, firstAppearance } = useSmoothScreen();
  const reducedMotion = useReducedMotion();

  // Anything but a first, settled, motion-allowed arrival starts already there.
  const animate = settled && firstAppearance && !reducedMotion;
  const progress = useSharedValue(animate ? 0 : 1);

  useEffect(() => {
    if (!animate) {
      progress.value = 1;
      return;
    }
    const delay = Math.min(index * stagger, maxDelay);
    progress.value = withDelay(delay, withSpring(1, springs.standard));
    return () => cancelAnimation(progress);
    // `animate` flipping false→true is the one transition worth reacting to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: rise ? [{ translateY: (1 - progress.value) * rise }] : undefined,
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

/**
 * The same idea for a whole section rather than a row — no stagger, a slightly
 * longer fade, no rise. Use it for headings and hero cards so the section does
 * not pop in a frame before its contents.
 */
export function SmoothSection({
  children,
  delay = 0,
  style,
}: {
  children: ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { settled, firstAppearance } = useSmoothScreen();
  const reducedMotion = useReducedMotion();
  const animate = settled && firstAppearance && !reducedMotion;
  const progress = useSharedValue(animate ? 0 : 1);

  useEffect(() => {
    if (!animate) {
      progress.value = 1;
      return;
    }
    progress.value = withDelay(
      delay,
      withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic) }),
    );
    return () => cancelAnimation(progress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

export default SmoothIn;
