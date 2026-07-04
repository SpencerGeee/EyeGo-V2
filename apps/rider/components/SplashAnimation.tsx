import React, { useCallback, useEffect } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withDelay,
  withTiming,
  Easing,
  runOnJS,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Stop, Circle } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import * as SplashScreen from 'expo-splash-screen';
import { fonts, colors, withOpacity, springs } from '@eyego/config';
import { Text, LensSheen } from '@eyego/ui';

const PRIMARY = colors.primary;
const BG = colors.backgroundDeep;

// Master timeline (ms). Entrance staggers off these, then the whole surface
// cross-fades out and hands control back to the router.
const T_WORDMARK = 420;
const T_MICROCOPY = 760;
const T_FADE_OUT = 2000;
const FADE_MS = 350;

interface Props {
  onComplete: () => void;
}

/**
 * EyeGo rider splash — green "Onyx" adaptation of the design-system v3 mockup.
 * Pure Reanimated (Moti 0.28 misbehaves on Reanimated 4, moti#391), JS-only
 * so it ships over-the-air. The first painted pixel is BG (#0A0A0B), identical
 * to app.json's native splash colour, so the native→JS handoff is seamless.
 */
export function SplashAnimation({ onComplete }: Props) {
  // Surface + element drivers.
  const surface = useSharedValue(1);
  const glowPulse = useSharedValue(0);
  const logoIn = useSharedValue(0);
  const ringPulse = useSharedValue(0);
  const wordmarkIn = useSharedValue(0);
  const microIn = useSharedValue(0);

  // Hand the native splash off to us: cross-fade rather than hard-cut. Both
  // surfaces are the same colour, so this only smooths sub-pixel timing.
  const handoff = useCallback(() => {
    SplashScreen.setOptions?.({ fade: true, duration: 200 });
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  useEffect(() => {
    // Entrance choreography.
    logoIn.value = withTiming(1, springs.entrance);
    wordmarkIn.value = withDelay(T_WORDMARK, withTiming(1, springs.entrance));
    microIn.value = withDelay(T_MICROCOPY, withTiming(1, { duration: 300 }));

    // Ambient loops.
    glowPulse.value = withRepeat(
      withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
    ringPulse.value = withRepeat(
      withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );

    // Exit: fade the whole surface, then release the router.
    const t = setTimeout(() => {
      surface.value = withTiming(0, { duration: FADE_MS, easing: Easing.in(Easing.quad) }, (done) => {
        if (done) runOnJS(onComplete)();
      });
    }, T_FADE_OUT);
    return () => clearTimeout(t);
  }, [onComplete]);

  const surfaceStyle = useAnimatedStyle(() => ({ opacity: surface.value }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.55 + glowPulse.value * 0.35,
    transform: [{ scale: 0.92 + glowPulse.value * 0.16 }],
  }));

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoIn.value,
    transform: [{ scale: 0.6 + logoIn.value * 0.4 }],
  }));

  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.35 + ringPulse.value * 0.45,
    transform: [{ scale: 0.98 + ringPulse.value * 0.08 }],
  }));

  const wordmarkStyle = useAnimatedStyle(() => ({
    opacity: wordmarkIn.value,
    transform: [{ translateY: (1 - wordmarkIn.value) * 18 }],
  }));

  const microStyle = useAnimatedStyle(() => ({ opacity: microIn.value }));

  return (
    <Animated.View style={[styles.container, surfaceStyle]} pointerEvents="none" onLayout={handoff}>
      {/* Ambient radial glow — pulses scale + opacity behind the mark. */}
      <Animated.View style={[styles.ambient, glowStyle]}>
        <Svg width={360} height={360} viewBox="0 0 360 360">
          <Defs>
            <RadialGradient id="splashGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={PRIMARY} stopOpacity={0.28} />
              <Stop offset="55%" stopColor={PRIMARY} stopOpacity={0.08} />
              <Stop offset="100%" stopColor={PRIMARY} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={180} cy={180} r={180} fill="url(#splashGlow)" />
        </Svg>
      </Animated.View>

      {/* Logo mark + thin breathing glow ring. */}
      <Animated.View style={[styles.logoWrapper, logoStyle]}>
        <Animated.View style={[styles.glowRing, ringStyle]} />
        <Image source={require('../assets/splash-icon.png')} style={styles.logo} resizeMode="contain" />
      </Animated.View>

      {/* Wordmark with a single sheen sweep across the glyphs. */}
      <Animated.View style={[styles.wordmarkRow, wordmarkStyle]}>
        <Text style={styles.wordmark}>EyeGo</Text>
        <LensSheen style={styles.wordmarkSheen} bandWidth={90} durationMs={2600} />
      </Animated.View>

      {/* Mono microcopy + animated dots + indeterminate progress bar. */}
      <Animated.View style={[styles.footer, microStyle]}>
        <View style={styles.microRow}>
          <Text style={styles.microcopy}>STARTING ENGINE</Text>
          <Dots />
        </View>
        <ProgressBar />
      </Animated.View>
    </Animated.View>
  );
}

/** Three JetBrains-Mono dots pulsing in sequence. */
function Dot({ index, driver }: { index: number; driver: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const phase = (driver.value - index + 3) % 3;
    return { opacity: phase < 1 ? 0.3 + (1 - phase) * 0.7 : 0.3 };
  });
  return <Animated.Text style={[styles.microcopy, style]}>.</Animated.Text>;
}

function Dots() {
  const d = useSharedValue(0);
  useEffect(() => {
    d.value = withRepeat(withTiming(3, { duration: 1200, easing: Easing.linear }), -1, false);
  }, []);
  return (
    <View style={styles.dotsRow}>
      <Dot index={0} driver={d} />
      <Dot index={1} driver={d} />
      <Dot index={2} driver={d} />
    </View>
  );
}

/** Indeterminate glowing bar — a green gradient segment translating L→R. */
function ProgressBar() {
  const x = useSharedValue(0);
  useEffect(() => {
    x.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.cubic) }),
        withTiming(0, { duration: 0 })
      ),
      -1,
      false
    );
  }, []);
  const segStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -SEG_W + x.value * (BAR_W + SEG_W) }],
  }));
  return (
    <View style={styles.progressTrack}>
      <Animated.View style={[styles.progressSeg, segStyle]}>
        <LinearGradient
          colors={['transparent', PRIMARY, 'transparent']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFillObject}
        />
      </Animated.View>
    </View>
  );
}

const BAR_W = 120;
const SEG_W = 44;

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    gap: 20,
  },
  ambient: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 100,
    height: 100,
  },
  glowRing: {
    position: 'absolute',
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 1,
    borderColor: withOpacity(PRIMARY, 0.5),
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
  },
  logo: { width: 80, height: 80 },
  wordmarkRow: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: 8,
  },
  wordmark: {
    fontFamily: fonts.displayBold,
    fontSize: 36,
    lineHeight: 44,
    color: colors.onSurface,
    letterSpacing: -1,
  },
  wordmarkSheen: {
    borderRadius: 8,
  },
  footer: {
    position: 'absolute',
    bottom: 96,
    alignItems: 'center',
    gap: 16,
  },
  microRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  microcopy: {
    fontFamily: fonts.labelCaps,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 2,
    color: withOpacity(colors.onSurface, 0.55),
  },
  dotsRow: {
    flexDirection: 'row',
    width: 18,
  },
  progressTrack: {
    width: BAR_W,
    height: 2,
    borderRadius: 1,
    backgroundColor: withOpacity(colors.onSurface, 0.1),
    overflow: 'hidden',
  },
  progressSeg: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: SEG_W,
  },
});
