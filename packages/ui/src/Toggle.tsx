import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
  interpolateColor,
  useDerivedValue,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';
import { animation } from '@eyego/config';
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
const RING_SIZE = KNOB_SIZE + 14;
const PARTICLE_ANGLES = [-55, -28, 0, 28, 55, 80];
const KNOB_CENTER_ON_X = KNOB_ON + KNOB_SIZE / 2;
const KNOB_CENTER_Y = TRACK_HEIGHT / 2;

export function Toggle({ value, onValueChange, tint = 'eco', disabled = false }: ToggleProps) {
  const colors = useThemedColors();
  const activeColor = tint === 'driver' ? '#FF6B00' : colors.primary;
  const progress = useSharedValue(value ? 1 : 0);
  const ringPulse = useSharedValue(0);
  const particleProgress = useSharedValue(0);
  const wasOn = useRef(value);

  useEffect(() => {
    progress.value = withSpring(value ? 1 : 0, animation.premiumSpring);

    if (value && !wasOn.current) {
      ringPulse.value = withSequence(
        withTiming(1, { duration: 140, easing: Easing.out(Easing.cubic) }),
        withTiming(0, { duration: 480, easing: Easing.out(Easing.cubic) })
      );
      particleProgress.value = 0;
      particleProgress.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) });
    }
    wasOn.current = value;
  }, [value, progress, ringPulse, particleProgress]);

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

  const ringStyle = useAnimatedStyle(() => ({
    opacity: ringPulse.value * 0.6,
    transform: [{ scale: 1 + ringPulse.value * 0.5 }],
  }));

  return (
    <View style={styles.wrapper}>
      <Pressable
        onPress={() => !disabled && onValueChange(!value)}
        accessibilityRole="switch"
        accessibilityState={{ checked: value, disabled }}
        style={[styles.track, { opacity: disabled ? 0.5 : 1 }]}
      >
        <Animated.View style={[styles.track, trackStyle, StyleSheet.absoluteFillObject]} />
        <Animated.View style={[styles.knob, knobStyle]} />
      </Pressable>

      {/* Unclipped overlay — ring pulse + particle burst render outside the
          track's overflow:hidden so they aren't cut off at the pill edge. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
        <Animated.View
          style={[
            styles.ring,
            ringStyle,
            {
              backgroundColor: activeColor,
              left: KNOB_CENTER_ON_X - RING_SIZE / 2,
              top: KNOB_CENTER_Y - RING_SIZE / 2,
            },
          ]}
        />
        {PARTICLE_ANGLES.map((angle) => (
          <Particle key={angle} angle={angle} progress={particleProgress} color={activeColor} />
        ))}
      </View>
    </View>
  );
}

function Particle({
  angle,
  progress,
  color,
}: {
  angle: number;
  progress: SharedValue<number>;
  color: string;
}) {
  const rad = (angle * Math.PI) / 180;
  const distance = 22;
  const dx = Math.cos(rad) * distance;
  const dy = Math.sin(rad) * distance;

  const style = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      opacity: p <= 0 ? 0 : 1 - p,
      transform: [
        { translateX: KNOB_CENTER_ON_X + dx * p },
        { translateY: KNOB_CENTER_Y + dy * p },
        { scale: 1 - p * 0.4 },
      ],
    };
  });

  return <Animated.View style={[styles.particle, { backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  wrapper: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
  },
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
  ring: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
  },
  particle: {
    position: 'absolute',
    width: 3.5,
    height: 3.5,
    borderRadius: 2,
    left: -1.75,
    top: -1.75,
  },
});
