import React, { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolateColor,
  useDerivedValue,
} from 'react-native-reanimated';
import { useThemedColors } from './ColorsContext';

interface ToggleProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  tint?: 'eco' | 'driver';
  disabled?: boolean;
}

const TRACK_WIDTH = 52;
const TRACK_HEIGHT = 30;
const KNOB_SIZE = 22;
const KNOB_OFF = 4;
const KNOB_ON = TRACK_WIDTH - KNOB_SIZE - 4;

export function Toggle({ value, onValueChange, tint = 'eco', disabled = false }: ToggleProps) {
  const colors = useThemedColors();
  const activeColor = tint === 'driver' ? '#FF6B00' : colors.primary;
  const progress = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    progress.value = withSpring(value ? 1 : 0, { stiffness: 300, damping: 20 });
  }, [value, progress]);

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: KNOB_OFF + progress.value * (KNOB_ON - KNOB_OFF) }],
  }));

  const trackProgress = useDerivedValue(() => progress.value);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      trackProgress.value,
      [0, 1],
      [colors.surfaceContainerHigh, activeColor]
    ),
  }));

  return (
    <Pressable
      onPress={() => !disabled && onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      style={[styles.track, { opacity: disabled ? 0.5 : 1 }]}
    >
      <Animated.View style={[styles.track, trackStyle, StyleSheet.absoluteFillObject]} />
      <Animated.View style={[styles.knob, knobStyle]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  knob: {
    position: 'absolute',
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: KNOB_SIZE / 2,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
});
