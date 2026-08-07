import { useCallback, useMemo } from 'react';
import { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { springs, pressScale } from '@eyego/config';

/**
 * The press-down scale, once, for every touchable in both apps.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * "the bounciness isnt nice and it makes it feel like a blob."
 *
 * `Motion.tsx` fixed the springs nobody chose — Moti's implicit default. It
 * could not fix the springs people DID choose, and those turned out to be the
 * loud ones. Every screen that wanted a press effect hand-rolled it, and the
 * numbers drifted into a range no platform animation ever uses:
 *
 *     seat.tsx        stiffness 800, damping 12  → ζ 0.21  (~52 % overshoot)
 *     rate-tip.tsx    stiffness 500, damping 12  → ζ 0.27
 *     activity.tsx    stiffness 700, damping 15  → ζ 0.28
 *     tab bar         stiffness 600, damping 15  → ζ 0.31
 *
 * ζ (damping ratio) = damping / (2·√(stiffness·mass)). Below 1 the spring
 * overshoots and comes back; at ζ ≈ 0.25 it crosses its target four times
 * before settling. Scale is the one property where that is unmissable, because
 * an overshooting scale makes the element visibly inflate past its own size —
 * which is precisely what "a blob" describes. Nothing in iOS does this. UIKit's
 * own highlight is a critically damped 0.97, and it is over in a third of a
 * second.
 *
 * So the numbers are not a per-screen decision any more. They are `springs.press`
 * (ζ = 1.00, zero overshoot) and `pressScale` (0.97), and a screen gets them by
 * calling this rather than by typing a stiffness.
 *
 * ```tsx
 * const press = usePressScale();
 * <Pressable {...press.handlers}>
 *   <Animated.View style={[styles.card, press.style]}>…</Animated.View>
 * </Pressable>
 * ```
 *
 * @see packages/config/src/motion.ts for the tokens and their derivation.
 */
export function usePressScale(options?: {
  /**
   * Override the resting-to-pressed scale. Only pass this when the element is
   * large enough that 0.97 is invisible on it (a full-width hero card, a map
   * overlay) — not as a matter of taste. The spring is not overridable.
   */
  scale?: number;
  /** Skip the animation entirely, e.g. for a disabled control. */
  disabled?: boolean;
}) {
  const target = options?.scale ?? pressScale;
  const disabled = options?.disabled ?? false;
  const value = useSharedValue(1);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: value.value }] }));

  const onPressIn = useCallback(() => {
    if (disabled) return;
    value.value = withSpring(target, springs.press);
  }, [disabled, target, value]);

  const onPressOut = useCallback(() => {
    if (disabled) return;
    value.value = withSpring(1, springs.press);
  }, [disabled, value]);

  // Spread straight onto a Pressable. Grouped rather than returned loose so a
  // call site cannot wire up the press-in and forget the press-out — which
  // leaves the element stuck at 97 % and reads as a rendering bug.
  const handlers = useMemo(() => ({ onPressIn, onPressOut }), [onPressIn, onPressOut]);

  return { style, handlers, onPressIn, onPressOut };
}
