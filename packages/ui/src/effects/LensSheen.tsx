import React, { useEffect } from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  cancelAnimation,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { staticLoopingLayerProps } from './hardwareTexture';
import { useLoopsActive } from './useLoopsActive';
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

  const loopsActive = useLoopsActive();

  useEffect(() => {
    // See useLoopsActive — a tab is never unmounted, so an ungated loop is
    // scoped to the session rather than to the time it is on screen.
    if (!loopsActive) {
      cancelAnimation(progress);
      return;
    }
    progress.value = withRepeat(
      withTiming(1, { duration: durationMs, easing: Easing.linear }),
      -1,
      false
    );
    // An infinite repeat survives unmount unless cancelled — see AppBackground.
    return () => cancelAnimation(progress);
  }, [progress, durationMs, loopsActive]);

  const sweepStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: -bandWidth * 2 + progress.value * bandWidth * 4 },
      { rotate: '20deg' },
    ],
  }));

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, styles.clip, style]}>
      {/* Looping sweep over fixed pixels — cacheable on both platforms. */}
      <Animated.View
        {...staticLoopingLayerProps}
        style={[styles.band, { width: bandWidth }, sweepStyle]}
      >
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
