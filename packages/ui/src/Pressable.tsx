import React, { useCallback, useState } from 'react';
import {
  Pressable as RNPressable,
  PressableProps,
  ViewStyle,
  StyleProp,
  Platform,
  type GestureResponderEvent,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { springs, pressScale as pressScaleToken } from '@eyego/config';

const AnimatedPressable = Animated.createAnimatedComponent(RNPressable);

interface EyeGoPressableProps extends Omit<PressableProps, 'onPressIn' | 'onPressOut' | 'style'> {
  /**
   * Object, array, OR the React Native function form `({ pressed }) => style`.
   *
   * The function form used to be silently discarded here, and that is not a
   * cosmetic bug: a function inside a style array is not a valid style, so RN
   * flattened it away and the row lost EVERY declaration it owned — including
   * `flexDirection: 'row'`, its height and its padding. That is why the Set
   * your trip / Where To rows rendered as a bare column with the dot, the
   * label, the value and the trailing icon each on their own line, flush to
   * the card edge. Any screen written in the idiomatic `({ pressed }) => [...]`
   * style was laid out as if it had no style at all.
   *
   * Resolved against local pressed state below rather than handed to
   * `AnimatedPressable` as a function, because Reanimated only scans an
   * object/array `style` prop for shared values — passing the function through
   * would fix layout and break the press-scale animation instead.
   */
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean }) => StyleProp<ViewStyle>);
  haptic?: 'light' | 'medium' | 'heavy' | 'none';
  scaleOnPress?: number;
  /** Called in addition to the built-in press-scale animation (does not replace it). */
  onPressIn?: (e: GestureResponderEvent) => void;
  /** Called in addition to the built-in press-scale animation (does not replace it). */
  onPressOut?: (e: GestureResponderEvent) => void;
}

export function Pressable({
  onPress,
  onPressIn,
  onPressOut,
  haptic = 'light',
  scaleOnPress = pressScaleToken,
  style,
  children,
  ...props
}: EyeGoPressableProps) {
  const scale = useSharedValue(1);
  const isFnStyle = typeof style === 'function';
  // Only tracked when a function style actually needs it — an object style must
  // not pay for a re-render on every press.
  const [pressed, setPressed] = useState(false);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  /**
   * BOTH HALVES OF A PRESS ARE THE SAME SPRING.
   *
   * Press-in used to be a 100 ms `withTiming` and press-out a spring, which is
   * two different physical systems driving one property. It shows on exactly the
   * interaction people notice: tap and release quickly and the release spring
   * inherits a position the timing curve was still travelling through, with no
   * velocity to hand over, so the control kicks. One spring on both ends means
   * an interrupted press carries position AND velocity across and the scale
   * simply reverses.
   *
   * `springs.press` and NOT `MOTION_PROFILES.TACTILE_BUTTON`, despite the latter
   * being the role-named profile for this. TACTILE_BUTTON is ζ ≈ 0.78, and
   * motion.ts states the system's rule outright: everything spatial — sheets,
   * screens, maps, headers, lists, BUTTONS — is ζ = 1.0, and overshoot is
   * reserved for the single semantic category of "something just succeeded".
   * A press-scale that springs past its resting size breaks that invariant on
   * the most-repeated interaction in the app. The timing/spring mismatch was the
   * actual defect here; the damping ratio was already right.
   */
  const handlePressIn = useCallback(
    (e: GestureResponderEvent) => {
      scale.value = withSpring(scaleOnPress, springs.press);
      if (isFnStyle) setPressed(true);
      onPressIn?.(e);
    },
    [scale, scaleOnPress, onPressIn, isFnStyle]
  );

  const handlePressOut = useCallback(
    (e: GestureResponderEvent) => {
      scale.value = withSpring(1, springs.press);
      if (isFnStyle) setPressed(false);
      onPressOut?.(e);
    },
    [scale, onPressOut, isFnStyle]
  );

  const handlePress = useCallback(
    (e: Parameters<NonNullable<PressableProps['onPress']>>[0]) => {
      if (haptic !== 'none' && Platform.OS !== 'web') {
        Haptics.impactAsync(
          haptic === 'light'
            ? Haptics.ImpactFeedbackStyle.Light
            : haptic === 'medium'
            ? Haptics.ImpactFeedbackStyle.Medium
            : Haptics.ImpactFeedbackStyle.Heavy
        );
      }
      onPress?.(e);
    },
    [haptic, onPress]
  );

  const resolvedStyle = isFnStyle
    ? (style as (s: { pressed: boolean }) => StyleProp<ViewStyle>)({ pressed })
    : (style as StyleProp<ViewStyle>);

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[animatedStyle, resolvedStyle]}
      {...props}
    >
      {/* Cast: `PressableStateCallbackType` carries a `hovered` field in some
          RN type versions in this monorepo and not others, so spelling it out
          breaks one tsconfig or the other. `pressed` is the only field a native
          press state can meaningfully report. */}
      {typeof children === 'function'
        ? children({ pressed } as Parameters<Extract<PressableProps['children'], Function>>[0])
        : children}
    </AnimatedPressable>
  );
}
