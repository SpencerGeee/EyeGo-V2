import React, { useEffect } from 'react';
import { View, StyleSheet, Dimensions, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { useThemedColors } from '../ColorsContext';
import { usePerformanceTier } from './usePerformanceTier';

interface BlobConfig {
  color: string;
  size: number;
  top: number;
  left: number;
  driftX: number;
  driftY: number;
  durationMs: number;
}

interface AppBackgroundProps {
  style?: ViewStyle;
}

/**
 * Lightweight stand-in for the LightPillar web sample: instead of a
 * continuous full-screen WebGL raymarch shader (heavy on every device, the
 * single worst thing for low-end phones), a handful of large soft blurred
 * gradient blobs drift/pulse slowly via worklet-driven Reanimated. Mounted
 * once in the root layout so every "bare background" screen inherits it.
 */
export function AppBackground({ style }: AppBackgroundProps) {
  const colors = useThemedColors();
  const tier = usePerformanceTier();
  const { width, height } = Dimensions.get('window');

  const blobs: BlobConfig[] =
    tier === 'low'
      ? [
          {
            color: colors.glowPrimary,
            size: width * 1.1,
            top: -height * 0.05,
            left: -width * 0.3,
            driftX: 0,
            driftY: 0,
            durationMs: 0,
          },
        ]
      : [
          {
            color: colors.glowPrimary,
            size: width * 0.9,
            top: -height * 0.05,
            left: -width * 0.25,
            driftX: 24,
            driftY: 18,
            durationMs: 18000,
          },
          {
            color: colors.glowSecondary,
            size: width * 0.8,
            top: height * 0.35,
            left: width * 0.4,
            driftX: -20,
            driftY: 26,
            durationMs: 22000,
          },
          {
            color: `${colors.tierRoyal}26`,
            size: width * 0.7,
            top: height * 0.7,
            left: -width * 0.2,
            driftX: 18,
            driftY: -22,
            durationMs: 20000,
          },
        ];

  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        styles.container,
        { backgroundColor: colors.backgroundDeep },
        style,
      ]}
    >
      {blobs.map((blob, i) => (
        <Blob key={i} {...blob} />
      ))}
    </View>
  );
}

function Blob({ color, size, top, left, driftX, driftY, durationMs }: BlobConfig) {
  const progress = useSharedValue(0);

  useEffect(() => {
    if (durationMs > 0) {
      progress.value = withRepeat(
        withTiming(1, { duration: durationMs, easing: Easing.inOut(Easing.sin) }),
        -1,
        true
      );
    }
  }, [progress, durationMs]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: progress.value * driftX },
      { translateY: progress.value * driftY },
    ],
    opacity: 0.7 + progress.value * 0.2,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', width: size, height: size, top, left }, animStyle]}
    >
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id="blobGradient" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={color} stopOpacity={0.85} />
            <Stop offset="60%" stopColor={color} stopOpacity={0.4} />
            <Stop offset="100%" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill="url(#blobGradient)" />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    zIndex: -1,
  },
});
