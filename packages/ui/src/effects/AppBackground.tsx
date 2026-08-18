import React, { useEffect } from 'react';
import { View, StyleSheet, Dimensions, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  cancelAnimation,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemedColors } from '../ColorsContext';
import { usePerformanceTier } from './usePerformanceTier';
import { LightPillarBackground } from './LightPillarBackground';
import { useShaderSlot } from './shaderSlot';

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
/** `#RRGGBB` + a 0-1 alpha as an 8-digit hex, tolerant of non-hex inputs. */
function withAlpha(hex: string, alpha: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  const byte = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${byte}`;
}

export function AppBackground({ style, variant = 'animated', isDark = true, paused = false }: AppBackgroundProps) {
  const colors = useThemedColors();
  const tier = usePerformanceTier();
  const ownsShader = useShaderSlot();
  const { width, height } = Dimensions.get('window');

  const animated = variant === 'animated' && tier !== 'low' && !paused;

  /**
   * THE WAVE HAS TO BE A WAVE IN BOTH THEMES.
   *
   * BUGFIX ("in light mode the wavy thing is very faint… the light mode is
   * completely done wrong, the aesthetic of the app is totally gone").
   *
   * Light mode was attenuated twice over — 0.4 opacity on top of a 0.55
   * intensity, so the pillar reached the screen at roughly a fifth of its dark
   * strength. That is not "a lighter version of the same effect", it is the
   * effect switched off and replaced with a faint green film, which is also what
   * made every card look washed out: the film sat over them too.
   *
   * The correct compensation for a white ground is smaller than it looks. A
   * mid-green at 20% over near-black is an obvious glow because the ground
   * contributes nothing; the same green at 20% over white is a pale grey,
   * because white contributes everything. So light mode needs MORE of the
   * colour, not less — the restraint belongs in the hue (the light theme's
   * `primary` is already the darker #1a7a3c, not the neon dark-mode green), not
   * in the opacity.
   */
  const ambientOpacity = isDark ? 0.85 : 0.72;

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
  /**
   * The brand wash. Used two ways, and it matters that it is the SAME one:
   *   - as the whole background for instances that don't own the shader slot;
   *   - as the FLOOR underneath the shader for the instance that does.
   *
   * BUGFIX ("the beginning of the search stage starts with a blacked-out
   * background which is supposed to be the Skia green"). A Skia `<Canvas>`
   * mounted on a newly-pushed screen does not paint on the commit that mounts
   * it — the first raymarched frame lands a few frames later. Until then the
   * only thing under it was `backgroundColor: colors.backgroundDeep`, i.e. flat
   * near-black. On the driver's create-trip that gap is invisible because the
   * route arrives on an opaque native slide; the rider's `/trip` arrives on a
   * morph with a 420ms fade, so the rider watches the background come up and
   * the gap IS the entrance. Same reason the fallback path exists at all — a
   * green floor is never wrong, so put it under the canvas too and the warm-up
   * frame reads as the brand gradient settling into the shader instead of as a
   * black screen.
   */
  const ambientFloor = (
    <LinearGradient
      colors={[
        // Same reasoning as `ambientOpacity`: a wash over white needs a
        // bigger alpha than the same wash over near-black to land with the
        // same weight. These were 0.14/0.16 and read as nothing at all.
        withAlpha(colors.primary, isDark ? 0.26 : 0.24),
        withAlpha(colors.onPrimaryFixedVariant, isDark ? 0.34 : 0.28),
        colors.backgroundDeep,
      ]}
      locations={[0, 0.45, 1]}
      start={{ x: 0.35, y: 0 }}
      end={{ x: 0.65, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
  );

  // Only ONE instance in the whole app paints a Skia canvas — see shaderSlot.ts.
  // Everything else paints the gradient below, which is the same brand
  // composition as a native view and costs nothing per frame.
  if (!ownsShader) {
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
        {ambientFloor}
      </View>
    );
  }

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
        {ambientFloor}
        <LightPillarBackground
          topColor={colors.primary}
          bottomColor={colors.onPrimaryFixedVariant}
          animated={animated}
          intensity={isDark ? 1.0 : 0.85}
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
      {ambientFloor}
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
    // PERF: a `-1` repeat is a UI-thread frame callback that outlives the
    // component unless it is cancelled. This background mounts on nearly every
    // screen, so without this every screen the user visited left a blob still
    // animating for the rest of the session.
    return () => cancelAnimation(progress);
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
