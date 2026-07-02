import React, { useEffect } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolateColor,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { animation } from '@eyego/config';
import { Pressable } from './Pressable';
import { useThemedColors } from './ColorsContext';

type RadioSize = 'sm' | 'md';

interface RadioProps {
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  size?: RadioSize;
  style?: ViewStyle;
  /** Overrides the default green primary accent — e.g. colors.statusError
   * for a destructive/cancel-reason selection. */
  accentColor?: string;
}

const SIZES: Record<RadioSize, { outer: number; border: number; dot: number }> = {
  sm: { outer: 20, border: 2, dot: 10 },
  md: { outer: 24, border: 2, dot: 12 },
};

/**
 * Single-select radio circle with an animated gradient-filled tick-in.
 * Replaces the hand-rolled border-circle-plus-inner-dot pattern that was
 * duplicated across every ride-selection screen.
 */
export function Radio({ selected, onPress, disabled = false, size = 'md', style, accentColor }: RadioProps) {
  const colors = useThemedColors();
  const { outer, border, dot } = SIZES[size];
  const progress = useSharedValue(selected ? 1 : 0);
  const accent = accentColor ?? colors.primary;
  const gradientColors: readonly [string, string] = accentColor
    ? [accentColor, accentColor]
    : [colors.primary, colors.secondary];

  useEffect(() => {
    progress.value = withSpring(selected ? 1 : 0, animation.premiumSpring);
  }, [selected, progress]);

  const borderStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(progress.value, [0, 1], [colors.outline, accent]),
  }));

  const dotStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: progress.value }],
  }));

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      haptic="light"
      scaleOnPress={0.88}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      style={[
        {
          width: outer,
          height: outer,
          borderRadius: outer / 2,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ] as ViewStyle[]}
    >
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: outer,
            height: outer,
            borderRadius: outer / 2,
            borderWidth: border,
          },
          borderStyle,
        ]}
      />
      <Animated.View
        style={[
          { width: dot, height: dot, borderRadius: dot / 2, overflow: 'hidden' },
          dotStyle,
        ]}
      >
        <LinearGradient
          colors={gradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
      </Animated.View>
    </Pressable>
  );
}
