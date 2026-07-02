import React, { useEffect } from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

interface LensSheenProps {
  style?: ViewStyle;
  bandWidth?: number;
  durationMs?: number;
}

/**
 * Cheap "light catching curved glass" highlight — a diagonal, semi-
 * transparent band that drifts slowly across a surface. Built to stand in
 * for the FluidGlass web sample's 3D refraction lens without a WebGL/
 * three.js stack: render as an absolute-fill child inside any card/panel.
 */
export function LensSheen({ style, bandWidth = 70, durationMs = 4200 }: LensSheenProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: durationMs, easing: Easing.linear }),
      -1,
      false
    );
  }, [progress, durationMs]);

  const sweepStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: -bandWidth * 2 + progress.value * bandWidth * 4 },
      { rotate: '20deg' },
    ],
  }));

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, styles.clip, style]}>
      <Animated.View style={[styles.band, { width: bandWidth }, sweepStyle]}>
        <LinearGradient
          colors={['transparent', 'rgba(255,255,255,0.16)', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFillObject}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
  },
  band: {
    position: 'absolute',
    top: -40,
    bottom: -40,
  },
});
