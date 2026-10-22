import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Stack, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  interpolate,
  Extrapolation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
  cancelAnimation,
} from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { fonts, withOpacity } from '@eyego/config';
import { usePerformanceTier } from '@eyego/ui';
import { Model3D, minibus } from '@eyego/maps';
import { useColors } from '../../utils/useColors';
import { Grain } from '../../components/intro/Grain';
import { registerAuthExit, AUTH_SHEET } from '../../components/intro/authScene';

/**
 * ── THE SIGN-IN SCENE ───────────────────────────────────────────────────────
 *
 * ONE persistent scene for phone → code → profile: a deep gradient, the EyeGo
 * mark in the corner, the 3D minibus as the hero, and a sheet that holds the
 * screens. Moving between them swaps only the sheet's content (a fade inside a
 * transparent stack); the scene never rebuilds. Per step the van shifts 24 pt
 * left and grows 4 % so the scene feels alive, and the sheet re-fits its height.
 *
 * Arrival (one shared clock, overlapping): the wordmark comes in from the very
 * spot the splash left it — the centre — and settles small in the corner; the
 * van slides in from the right and decelerates; the sheet rises (a spring with
 * no visible overshoot); the screen inside reveals itself.
 *
 * Keyboard: the sheet rides it up; the van shrinks to ~60 %, drifts up and
 * dims, so on a small Android phone the field and the button stay in view.
 * Success: see authScene.ts — the form leaves, the sheet slides down and the
 * van glides out right before the app moves on. Reduce Motion: fades only.
 */

const SHEET_FOR: Record<string, number> = { phone: 0.5, otp: 0.52, register: 0.8 };
const STEP: Record<string, number> = { phone: 0, otp: 1, register: 2 };

export default function AuthLayout() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const reduced = useReducedMotion();
  const low = usePerformanceTier() === 'low';
  const segments = useSegments() as string[];
  const screen = String(segments[1] ?? 'phone');
  const frac = SHEET_FOR[screen] ?? 0.55;
  const step = STEP[screen] ?? 0;

  const arrive = useSharedValue(reduced ? 1 : 0);
  const leave = useSharedValue(0);
  const visible = useSharedValue(frac);
  const shift = useSharedValue(step);
  const float = useSharedValue(0);
  const kb = useReanimatedKeyboardAnimation();

  useEffect(() => {
    if (reduced) return;
    arrive.value = withTiming(1, { duration: 1400, easing: Easing.linear });
    float.value = withRepeat(withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(float);
  }, [arrive, float, reduced]);

  useEffect(() => {
    visible.value = withSpring(frac, { stiffness: 140, damping: 20, mass: 1 });
    shift.value = withSpring(step, { stiffness: 140, damping: 22, mass: 1 });
  }, [frac, step, visible, shift]);

  // Success: the scene leaves, then the app moves on.
  useEffect(() => {
    registerAuthExit((then) => {
      if (reduced) return then();
      leave.value = withTiming(1, { duration: 520, easing: Easing.bezier(0.4, 0, 0.2, 1) });
      setTimeout(then, 540);
    });
    return () => registerAuthExit(null);
  }, [leave, reduced]);

  const sheetH = H * 0.9;
  const heroSize = Math.min(W * 0.78, H * 0.36);

  // ── Wordmark: from the splash's centre to the corner ──
  const markStyle = useAnimatedStyle(() => {
    const k = interpolate(arrive.value, [0, 0.45], [0, 1], Extrapolation.CLAMP);
    const e = SOFT_W(k);
    return {
      opacity: interpolate(arrive.value, [0, 0.08], [0, 1], Extrapolation.CLAMP) * (1 - leave.value),
      transform: [
        { translateX: (1 - e) * (W / 2 - 92) },
        { translateY: (1 - e) * (H / 2 - insets.top - 34) },
        { scale: 1 + (1 - e) * 0.6 },
      ],
    };
  });

  // ── The van ──
  const heroStyle = useAnimatedStyle(() => {
    const k = interpolate(arrive.value, [0.14, 0.72], [0, 1], Extrapolation.CLAMP);
    const e = SOFT_W(k);
    const key = kb.progress.value;
    return {
      opacity: (reduced ? 1 : interpolate(k, [0, 0.25], [0, 1], Extrapolation.CLAMP)) * (1 - key * 0.35) * (1 - leave.value),
      transform: [
        { translateX: (1 - e) * W * 0.45 - shift.value * 24 + leave.value * W * 0.7 },
        { translateY: -key * heroSize * 0.28 + (float.value - 0.5) * 8 },
        { scale: (0.96 + e * 0.04) * (1 + shift.value * 0.04) * (1 - key * 0.4) },
      ],
    };
  });

  // ── The sheet ──
  const sheetStyle = useAnimatedStyle(() => {
    const k = interpolate(arrive.value, [0.25, 0.75], [0, 1], Extrapolation.CLAMP);
    const rest = H - visible.value * H;
    const lifted = Math.max(insets.top + 64, rest - Math.abs(kb.height.value));
    const enter = (1 - SOFT_W(k)) * H * 0.6;
    return { transform: [{ translateY: lifted + enter + leave.value * H * 0.7 }] };
  });
  const contentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(arrive.value, [0.5, 0.75], [0, 1], Extrapolation.CLAMP) * (1 - leave.value * 1.6),
  }));

  const hero = useMemo(() => minibus({ accent: colors.primary }), [colors.primary]);

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#0B1410', '#070809', '#050506']} style={StyleSheet.absoluteFill} />
      <View style={[styles.aura, { backgroundColor: withOpacity(colors.primary, 0.07), width: W * 1.2, height: W * 1.2, left: -W * 0.1, top: H * 0.06 }]} />
      <Grain />

      <Animated.View style={[styles.mark, { top: insets.top + 14 }, markStyle]} pointerEvents="none">
        <View style={[styles.eye, { borderColor: colors.primary }]}>
          <View style={[styles.iris, { backgroundColor: colors.primary }]} />
        </View>
        <Animated.Text style={styles.wordmark}>EYEGO</Animated.Text>
      </Animated.View>

      <Animated.View
        style={[styles.hero, { top: insets.top + 64, width: heroSize, height: heroSize, left: W - heroSize * 0.92 }, heroStyle]}
        pointerEvents="none"
      >
        {/* The headlight glow on the ground under it. */}
        {!low ? <View style={[styles.groundGlow, { backgroundColor: withOpacity(colors.primary, 0.18), width: heroSize * 0.8, left: heroSize * 0.1 }]} /> : null}
        <Model3D model={hero} heading={248} pitch={52} size={heroSize} />
      </Animated.View>

      <Animated.View style={[styles.sheet, { height: sheetH }, sheetStyle]}>
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: AUTH_SHEET.fill }]} />
        <View style={styles.sheetLight} pointerEvents="none" />
        <Animated.View style={[{ flex: 1 }, contentStyle]}>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: 'transparent' },
              animation: 'fade',
            }}
          />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/** Soft ease-out as a worklet (the Easing helper is not callable inside styles). */
function SOFT_W(t: number): number {
  'worklet';
  return 1 - Math.pow(1 - t, 3);
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#050506' },
  aura: { position: 'absolute', borderRadius: 9999 },
  mark: { position: 'absolute', left: 20, flexDirection: 'row', alignItems: 'center', gap: 8 },
  eye: { width: 22, height: 14, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  iris: { width: 6, height: 6, borderRadius: 3 },
  wordmark: { fontFamily: fonts.displaySemiBold, fontSize: 13, letterSpacing: 4, color: '#F4F6F8' },
  hero: { position: 'absolute' },
  groundGlow: { position: 'absolute', bottom: '18%', height: 26, borderRadius: 13 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    overflow: 'hidden',
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: AUTH_SHEET.border,
  },
  sheetLight: { position: 'absolute', top: 0, left: 28, right: 28, height: 1, backgroundColor: 'rgba(255,255,255,0.18)' },
});
