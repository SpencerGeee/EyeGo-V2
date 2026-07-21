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
import { LightPillarBackground } from './LightPillarBackground';

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
  /** Pass the current theme's dark/light state so the shader can tone down
   *  in light mode. Defaults to dark (existing behaviour). */
  isDark?: boolean;
  /** When paused, the shader stops updating (frozen frame / no-op interval).
   *  Set when an opaque detailPush screen covers the background entirely —
   *  saves 30fps GPU fill cycles the user can't see. */
  paused?: boolean;
}

/**
 * Lightweight stand-in for the LightPillar web sample: instead of a
 * continuous full-screen WebGL raymarch shader (heavy on every device, the
 * single worst thing for low-end phones), a handful of large soft blurred
 * gradient blobs drift/pulse slowly via worklet-driven Reanimated. Mounted
 * once in the root layout so every "bare background" screen inherits it.
 */
export function AppBackground({ style, variant = 'animated', isDark = true, paused = false }: AppBackgroundProps) {
  const colors = useThemedColors();
  const tier = usePerformanceTier();
  const { width, height } = Dimensions.get('window');

  const animated = variant === 'animated' && tier !== 'low' && !paused;

  // Light mode: lower opacity than dark (a full-strength wash reads as too
  // loud on a white surface) but NOT down to a near-invisible tint — the
  // wave needs to still read as a wave, just lighter, not vanish entirely.
  const ambientOpacity = isDark ? 0.85 : 0.4;

  // Mid/high tiers get the real GPU shader (Skia "LightPillar" port) —
  // a vertical rotating light beam in the app's brand color, continuously
  // alive. The SVG blob field below survives as the low-tier / fallback path.
  //
  // Light mode previously hardcoded topColor to flat gray ('#e0e0e0') instead
  // of the theme's own `colors.primary` — on dark backgrounds the wave reads
  // as brand green (rider) / brand blue (driver), but in light mode it lost
  // that color entirely and just looked like a plain white background with
  // no aesthetic. Using `colors.primary` in both modes keeps the same brand
  // wave color; only intensity/opacity drop for a lighter, white-appropriate
  // version of the same effect instead of disappearing.
  //
  // `baseColor` is the theme's own background — the shader composites its
  // glow ON TOP of this instead of varying alpha, so the "empty" side of the
  // composition renders as this theme's actual surface color (near-black in
  // dark mode, matching the previous look exactly; near-white in light mode,
  // instead of fading to a barely-visible transparent wash). `bottomColor`
  // no longer needs a light-mode override (that was compensating for the old
  // alpha-fade approach) — it stays the on-brand deep gradient color in both
  // themes, so the glow itself is identical between modes; only the base it
  // sits on changes.
  if (tier !== 'low') {
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
        <LightPillarBackground
          topColor={colors.primary}
          bottomColor={colors.onPrimaryFixedVariant}
          animated={animated}
          intensity={isDark ? 1.0 : 0.55}
          rotationSpeed={tier === 'high' ? 0.4 : 0.25}
          glowAmount={tier === 'high' ? 0.006 : 0.004}
          pillarWidth={3.0}
          pillarHeight={0.4}
          noiseIntensity={isDark ? (tier === 'high' ? 0.5 : 0.3) : 0}
          opacity={ambientOpacity}
          baseColor={colors.backgroundDeep}
        />
      </View>
    );
  }

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
