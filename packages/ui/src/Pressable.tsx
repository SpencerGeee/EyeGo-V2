import React, { useCallback } from 'react';
import {
  Pressable as RNPressable,
  PressableProps,
  ViewStyle,
  Platform,
  type GestureResponderEvent,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { springs, pressScale as pressScaleToken } from '@eyego/config';

const AnimatedPressable = Animated.createAnimatedComponent(RNPressable);

interface EyeGoPressableProps extends Omit<PressableProps, 'onPressIn' | 'onPressOut'> {
  style?: ViewStyle | ViewStyle[];
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

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(
    (e: GestureResponderEvent) => {
      scale.value = withTiming(scaleOnPress, {
        duration: 100,
        easing: Easing.out(Easing.quad),
      });
      onPressIn?.(e);
    },
    [scale, scaleOnPress, onPressIn]
  );

  const handlePressOut = useCallback(
    (e: GestureResponderEvent) => {
      scale.value = withSpring(1, springs.press);
      onPressOut?.(e);
    },
    [scale, onPressOut]
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

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[animatedStyle, style as ViewStyle]}
      {...props}
    >
      {children}
    </AnimatedPressable>
  );
}
