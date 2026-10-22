import React, { useCallback, useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  Extrapolation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Stop, Rect } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import * as SplashScreen from 'expo-splash-screen';
import { fonts, colors } from '@eyego/config';
import { Grain } from './intro/Grain';

/**
 * ── THE LAUNCH ──────────────────────────────────────────────────────────────
 *
 * Black, then the wordmark: EYEGO in wide caps, fading in with a 4 % scale-up
 * while its tracking tightens. A thin green streak of light then sweeps right
 * to left through it, a soft glow trailing it, and the letters brighten as it
 * passes. A beat's hold, and the surface lifts — under two seconds in all.
 *
 * The first painted pixel is the same near-black as the native splash, so the
 * native → JS hand-off cannot flash. Whatever sits beneath (onboarding's cloud
 * forming, or the sign-in scene whose logo rises from this exact spot to the
 * corner) takes over as this fades, so the launch reads as one motion.
 */

const BG = '#050506';
const GREEN = colors.primary;
const T_WORD = 120;
const T_STREAK = 520;
const STREAK_MS = 720;
const T_OUT = 1450;
const OUT_MS = 380;

export function SplashAnimation({ onComplete }: { onComplete: () => void }) {
  const { width: W } = useWindowDimensions();
  const word = useSharedValue(0);
  const streak = useSharedValue(0);
  const surface = useSharedValue(1);

  const handoff = useCallback(() => {
    SplashScreen.setOptions?.({ fade: true, duration: 200 });
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  useEffect(() => {
    const soft = Easing.bezier(0.22, 1, 0.36, 1);
    word.value = withDelay(T_WORD, withTiming(1, { duration: 600, easing: soft }));
    streak.value = withDelay(T_STREAK, withTiming(1, { duration: STREAK_MS, easing: Easing.bezier(0.4, 0, 0.2, 1) }));
    surface.value = withDelay(
      T_OUT,
      withTiming(0, { duration: OUT_MS, easing: Easing.bezier(0.4, 0, 0.2, 1) }, (done) => {
        if (done) runOnJS(onComplete)();
      }),
    );
  }, [onComplete, word, streak, surface]);

  const surfaceStyle = useAnimatedStyle(() => ({ opacity: surface.value }));
  const wordStyle = useAnimatedStyle(() => ({
    opacity: word.value,
    letterSpacing: interpolate(word.value, [0, 1], [10.8, 9.6]),
    transform: [{ scale: 0.96 + word.value * 0.04 }],
  }));
  // The letters catch the light as the streak crosses the middle.
  const flashStyle = useAnimatedStyle(() => ({
    opacity: interpolate(streak.value, [0.3, 0.5, 0.75], [0, 0.85, 0], Extrapolation.CLAMP),
    letterSpacing: 9.6,
  }));
  const BAND = 220;
  const streakStyle = useAnimatedStyle(() => ({
    opacity: interpolate(streak.value, [0, 0.08, 0.9, 1], [0, 1, 1, 0]),
    transform: [{ translateX: W + 40 - streak.value * (W + BAND + 80) }],
  }));

  return (
    <Animated.View style={[styles.container, surfaceStyle]} pointerEvents="none" onLayout={handoff}>
      {/* Near-black into a faint green-tinted charcoal at the centre. */}
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <RadialGradient id="launchAura" cx="50%" cy="50%" r="55%">
            <Stop offset="0%" stopColor="#0E1A13" stopOpacity={1} />
            <Stop offset="100%" stopColor={BG} stopOpacity={1} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#launchAura)" />
      </Svg>
      <Grain />

      <View style={styles.center}>
        <Animated.Text style={[styles.wordmark, wordStyle]}>EYEGO</Animated.Text>
        <Animated.Text style={[styles.wordmark, styles.flash, flashStyle]}>EYEGO</Animated.Text>
      </View>

      {/* The streak: a soft glow band, and a thin bright core through it. */}
      <Animated.View style={[styles.streak, { width: BAND }, streakStyle]}>
        <LinearGradient
          colors={['transparent', `${GREEN}55`, 'transparent']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.glow}
        />
        <LinearGradient
          colors={['transparent', GREEN, '#E9FFF0', GREEN, 'transparent']}
          locations={[0, 0.35, 0.5, 0.65, 1]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.core}
        />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, backgroundColor: BG, zIndex: 9999, justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  wordmark: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 24,
    lineHeight: 30,
    color: '#F4F6F8',
    // Tracking pads the trailing edge too; nudge so the word is optically centred.
    paddingLeft: 9.6,
  },
  flash: { position: 'absolute', color: '#FFFFFF', textShadowColor: GREEN, textShadowRadius: 14 },
  streak: { position: 'absolute', top: '50%', left: 0, height: 40, marginTop: -20, justifyContent: 'center' },
  glow: { position: 'absolute', left: 0, right: 0, height: 40, borderRadius: 20 },
  core: { height: 2, borderRadius: 1 },
});
