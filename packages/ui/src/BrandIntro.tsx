import React, { useEffect } from 'react';
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
import { fonts } from '@eyego/config';

/**
 * ── THE LAUNCH (G5) — one intro for both apps ───────────────────────────────
 *
 * Black, then the wordmark: EYEGO in wide caps, fading in with a 4 % scale-up
 * while its tracking tightens. A thin streak of the app's colour sweeps right to
 * left through it, the letters brighten as it passes, an optional sub-label
 * settles under it, and the surface lifts — under two seconds in all.
 *
 * NO SKIA AT LAUNCH: Reanimated + SVG only. A Skia canvas on the very first
 * frame is a GPU surface created while the activity is still starting, and
 * torn down if the user backs out at once — the Android open-then-close crash
 * was in exactly that window. `onFirstFrame` fires on first layout, so the
 * native splash is hidden only once this has painted its matching background.
 */
const T_WORD = 120;
const T_STREAK = 520;
const STREAK_MS = 720;
const T_OUT = 1450;
const OUT_MS = 380;
const BAND = 220;
const TRACK = 9.6;

export function BrandIntro({
  accent,
  aura,
  background,
  label,
  onFirstFrame,
  onComplete,
}: {
  accent: string;
  /** Centre tint of the radial aura, faded into `background`. */
  aura: string;
  background: string;
  /** Small caps under the wordmark, e.g. "DRIVER". */
  label?: string;
  onFirstFrame?: () => void;
  onComplete: () => void;
}) {
  const { width: W } = useWindowDimensions();
  const word = useSharedValue(0);
  const streak = useSharedValue(0);
  const surface = useSharedValue(1);

  useEffect(() => {
    const soft = Easing.bezier(0.22, 1, 0.36, 1);
    const sweep = Easing.bezier(0.4, 0, 0.2, 1);
    word.value = withDelay(T_WORD, withTiming(1, { duration: 600, easing: soft }));
    streak.value = withDelay(T_STREAK, withTiming(1, { duration: STREAK_MS, easing: sweep }));
    surface.value = withDelay(
      T_OUT,
      withTiming(0, { duration: OUT_MS, easing: sweep }, (done) => {
        if (done) runOnJS(onComplete)();
      }),
    );
  }, [onComplete, word, streak, surface]);

  const surfaceStyle = useAnimatedStyle(() => ({ opacity: surface.value }));
  const wordStyle = useAnimatedStyle(() => ({
    opacity: word.value,
    letterSpacing: interpolate(word.value, [0, 1], [TRACK + 1.2, TRACK]),
    transform: [{ scale: 0.96 + word.value * 0.04 }],
  }));
  const flashStyle = useAnimatedStyle(() => ({
    opacity: interpolate(streak.value, [0.3, 0.5, 0.75], [0, 0.85, 0], Extrapolation.CLAMP),
  }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(streak.value, [0.55, 1], [0, 0.7], Extrapolation.CLAMP),
    transform: [{ translateY: interpolate(streak.value, [0.55, 1], [6, 0], Extrapolation.CLAMP) }],
  }));
  const streakStyle = useAnimatedStyle(() => ({
    opacity: interpolate(streak.value, [0, 0.08, 0.9, 1], [0, 1, 1, 0]),
    transform: [{ translateX: W + 40 - streak.value * (W + BAND + 80) }],
  }));

  return (
    <Animated.View
      style={[styles.container, { backgroundColor: background }, surfaceStyle]}
      pointerEvents="none"
      onLayout={onFirstFrame}
    >
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <RadialGradient id="launchAura" cx="50%" cy="50%" r="55%">
            <Stop offset="0%" stopColor={aura} stopOpacity={1} />
            <Stop offset="100%" stopColor={background} stopOpacity={1} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#launchAura)" />
      </Svg>

      <View style={styles.center}>
        <Animated.Text style={[styles.wordmark, wordStyle]}>EYEGO</Animated.Text>
        <Animated.Text style={[styles.wordmark, styles.flash, { textShadowColor: accent }, flashStyle]}>EYEGO</Animated.Text>
        {label ? <Animated.Text style={[styles.label, { color: accent }, labelStyle]}>{label}</Animated.Text> : null}
      </View>

      <Animated.View style={[styles.streak, { width: BAND }, streakStyle]}>
        <LinearGradient colors={['transparent', `${accent}55`, 'transparent']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.glow} />
        <LinearGradient
          colors={['transparent', accent, '#F2F7FF', accent, 'transparent']}
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
  container: { ...StyleSheet.absoluteFillObject, zIndex: 9999, justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  wordmark: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 24,
    lineHeight: 30,
    color: '#F4F6F8',
    letterSpacing: TRACK,
    // Tracking pads the trailing edge too; nudge so the word is optically centred.
    paddingLeft: TRACK,
  },
  flash: { position: 'absolute', top: 0, color: '#FFFFFF', textShadowRadius: 14 },
  label: { fontFamily: fonts.displaySemiBold, fontSize: 11, lineHeight: 14, letterSpacing: 6, paddingLeft: 6, marginTop: 10 },
  streak: { position: 'absolute', top: '50%', left: 0, height: 40, marginTop: -20, justifyContent: 'center' },
  glow: { position: 'absolute', left: 0, right: 0, height: 40, borderRadius: 20 },
  core: { height: 2, borderRadius: 1 },
});
