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
  /**
   * 'animated' (default) drifts the blobs — reserve it for the single
   * root-mounted instance. 'static' renders the same ambient field with no
   * reanimated loops: cheap enough to mount per pushed screen, which lets
   * opaque detail screens keep the ambient depth without transparency
   * (transparent pushed screens white-flash on iOS native-stack slides).
   */
  variant?: 'animated' | 'static';
}

/**
 * Lightweight stand-in for the LightPillar web sample: instead of a
 * continuous full-screen WebGL raymarch shader (heavy on every device, the
 * single worst thing for low-end phones), a handful of large soft blurred
 * gradient blobs drift/pulse slowly via worklet-driven Reanimated. Mounted
 * once in the root layout so every "bare background" screen inherits it.
 */
export function AppBackground({ style, variant = 'animated' }: AppBackgroundProps) {
  const colors = useThemedColors();
  const tier = usePerformanceTier();
  const { width, height } = Dimensions.get('window');

  const animated = variant === 'animated' && tier !== 'low';

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
            size: width * 1.05,
            top: -height * 0.08,
            left: -width * 0.3,
            driftX: 28,
            driftY: 20,
            durationMs: 18000,
          },
          {
            color: colors.glowSecondary,
            size: width * 0.95,
            top: height * 0.32,
            left: width * 0.35,
            driftX: -24,
            driftY: 30,
            durationMs: 22000,
          },
          {
            // Ties the ambient field to the premium blue/orange ring accent
            // used across glow inputs/buttons/cards, instead of the flat
            // purple wash — a warm counterweight to the two cool blobs above.
            color: `${colors.premiumOrange}30`,
            size: width * 0.8,
            top: height * 0.68,
            left: -width * 0.22,
            driftX: 20,
            driftY: -26,
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
        <Blob key={i} {...blob} durationMs={animated ? blob.durationMs : 0} />
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
    opacity: 0.85 + progress.value * 0.15,
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
