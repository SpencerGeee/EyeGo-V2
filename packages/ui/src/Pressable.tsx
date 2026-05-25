import React, { useCallback } from 'react';
import {
  Pressable as RNPressable,
  PressableProps,
  ViewStyle,
  Platform,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

const AnimatedPressable = Animated.createAnimatedComponent(RNPressable);

interface EyeGoPressableProps extends PressableProps {
  style?: ViewStyle | ViewStyle[];
  haptic?: 'light' | 'medium' | 'heavy' | 'none';
  scaleOnPress?: number;
}

export function Pressable({
  onPress,
  haptic = 'light',
  scaleOnPress = 0.96,
  style,
  children,
  ...props
}: EyeGoPressableProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(scaleOnPress, { stiffness: 400, damping: 25 });
  }, [scale, scaleOnPress]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, { stiffness: 400, damping: 25 });
  }, [scale]);

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
