import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, StyleSheet, View, useWindowDimensions, Pressable as RNPressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import Animated, {
  Easing,
  FadeIn,
  interpolate,
  interpolateColor,
  Extrapolation,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { fonts, spacing, withOpacity } from '@eyego/config';
import { Text, Button, usePerformanceTier } from '@eyego/ui';
import { useAuthStore } from '../../stores/auth.store';
import { useColors, type Colors } from '../../utils/useColors';
import { consumeReturnTo } from '../../utils/returnTo';
import { SLIDES } from '../../components/intro/slides';
import { ParticleHero } from '../../components/intro/ParticleHero';
import { BlurWordText, EASE_IN_SOFT } from '../../components/intro/BlurWordText';
import { Grain } from '../../components/intro/Grain';

/**
 * ── ONBOARDING — SIX SLIDES, ONE PARTICLE FIELD ─────────────────────────────
 *
 * The chrome never moves; only the hero and the words change. One shared
 * value, `progress` (the pager position, 0…5), drives everything — the
 * particle morph, the dots, the glow — so a finger halfway between pages shows
 * a half-dissolved hero and autoplay is nothing but a scroll.
 *
 *   hero        ParticleHero — dissolve into a swirling cloud, re-form
 *   words       BlurWordText — word by word, reserved height (no reflow)
 *   dots        width + colour interpolated straight off `progress`
 *   autoplay    3.2 s a page until the first touch, then never again this
 *               session; paused in the background; stops on the last page
 *   first run   black → the cloud forms out of the centre while the card rises
 *
 * Reduce Motion: no particles, no autoplay, a calm fade per slide. Low-end
 * (measured tier): 480 particles, no bloom.
 */

const AUTOPLAY_MS = 3200;
const IN = Easing.bezier(...EASE_IN_SOFT);

export default function OnboardingScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const reduced = useReducedMotion();
  const tier = usePerformanceTier();
  const low = tier === 'low';

  const accents = useMemo(() => SLIDES.map((s) => colors[s.accent] as string), [colors]);
  const progress = useSharedValue(0);
  const intro = useSharedValue(reduced ? 1 : 0);
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<Animated.ScrollView>(null);
  const touched = useRef(false);

  // First run: the cloud forms out of the centre while the card rises.
  useEffect(() => {
    if (reduced) return;
    intro.value = withDelay(350, withTiming(1, { duration: 1250, easing: IN }));
  }, [intro, reduced]);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      progress.value = e.contentOffset.x / Math.max(1, W);
    },
  });

  const settle = useCallback(
    (x: number) => {
      const i = Math.round(x / Math.max(1, W));
      if (i !== index) {
        void Haptics.selectionAsync().catch(() => {});
        AccessibilityInfo.announceForAccessibility?.(`Page ${i + 1} of ${SLIDES.length}. ${SLIDES[i].title}`);
      }
      setIndex(i);
    },
    [index, W],
  );

  // Autoplay — until the rider touches the pager, then never again.
  const [appActive, setAppActive] = useState(true);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (reduced || touched.current || !appActive || index >= SLIDES.length - 1) return;
    const t = setTimeout(() => {
      if (touched.current) return;
      scrollRef.current?.scrollTo({ x: (index + 1) * W, animated: true });
    }, index === 0 ? AUTOPLAY_MS + 900 : AUTOPLAY_MS);
    return () => clearTimeout(t);
  }, [index, reduced, appActive, W]);

  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const leave = useCallback(async () => {
    await SecureStore.setItemAsync('eyego_onboarded', 'true').catch(() => {});
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // Signed out → the sign-in scene (phone + code serves both new and
    // returning riders). A rider who just set up an account goes on to where
    // they were headed (see utils/returnTo).
    router.replace((isLoggedIn ? consumeReturnTo() ?? '/(tabs)/home' : '/(auth)/phone') as Href);
  }, [router, isLoggedIn]);

  // ── Card entrance (first load only) ──
  const cardStyle = useAnimatedStyle(() => ({
    opacity: interpolate(intro.value, [0.2, 0.8], [0, 1], Extrapolation.CLAMP),
    transform: [{ translateY: interpolate(intro.value, [0, 1], [40, 0], Extrapolation.CLAMP) }],
  }));
  const logoStyle = useAnimatedStyle(() => ({ opacity: interpolate(intro.value, [0, 0.35], [0, 1], Extrapolation.CLAMP) }));
  // The atmosphere behind the hero takes the slide's colour.
  const auraStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, accents.map((_, i) => i), accents),
  }));

  const heroH = Math.max(240, H * 0.5 - insets.top);
  const slide = SLIDES[index];

  return (
    <View style={styles.root}>
      {/* Atmosphere: a hue that follows the slide, a top vignette, the grain. */}
      <Animated.View style={[styles.aura, { width: W * 1.4, height: W * 1.4, left: -W * 0.2, top: insets.top + heroH * 0.5 - W * 0.7 }, auraStyle]} />
      <LinearGradient colors={['rgba(0,0,0,0.75)', 'transparent']} style={styles.vignette} pointerEvents="none" />
      <Grain />

      <Animated.View style={[styles.logoRow, { paddingTop: insets.top + spacing.sm }, logoStyle]}>
        <Text style={styles.wordmark}>EYEGO</Text>
      </Animated.View>

      <View style={{ height: heroH }} pointerEvents="none">
        {reduced ? (
          <ReducedHero index={index} accent={accents[index]} />
        ) : (
          <ParticleHero progress={progress} intro={intro} width={W} height={heroH} accents={accents} low={low} />
        )}
      </View>

      {/* The pager: transparent pages over the hero — only its position matters. */}
      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onTouchStart={() => { touched.current = true; }}
        onMomentumScrollEnd={(e) => settle(e.nativeEvent.contentOffset.x)}
        style={StyleSheet.absoluteFill}
        accessibilityLabel="Introduction"
      >
        {SLIDES.map((s, i) => (
          <View key={i} style={{ width: W, height: H }} />
        ))}
      </Animated.ScrollView>

      <Animated.View style={[styles.cardWrap, { paddingBottom: insets.bottom + spacing.md }, cardStyle]} pointerEvents="box-none">
        <View style={styles.card}>
          <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255,255,255,0.04)' }]} />
          <LinearGradient colors={['rgba(255,255,255,0.12)', 'rgba(255,255,255,0.03)']} style={styles.cardEdge} pointerEvents="none" />
          <View style={styles.topLight} pointerEvents="none" />

          <Dots progress={progress} colors={colors} />

          <View style={styles.titleBox}>
            <BlurWordText text={slide.title} textKey={index} style={styles.title} reduced={reduced} />
          </View>
          <View style={styles.subBox}>
            <BlurWordText text={slide.subtitle} textKey={index} style={styles.subtitle} reduced={reduced} baseDelay={120} />
          </View>

          <View style={styles.ctas}>
            <Button label="Get started" onPress={leave} accessibilityLabel="Get started — create your account" />
            <Button label="I already have an account" variant="secondary" onPress={leave} />
          </View>
          <RNPressable
            onPress={() => router.push('/profile/terms' as Href)}
            accessibilityRole="link"
            accessibilityLabel="Read the Terms of Service"
            hitSlop={8}
          >
            <Text style={styles.legal}>
              By continuing, you agree to the <Text style={[styles.legal, { color: colors.onSurface }]}>Terms of Service</Text>
            </Text>
          </RNPressable>
        </View>
      </Animated.View>
    </View>
  );
}

/** Six dots; the active one stretches into a glowing pill, straight off `progress`. */
function Dots({ progress, colors }: { progress: SharedValue<number>; colors: Colors }) {
  return (
    <View style={{ flexDirection: 'row', alignSelf: 'center', gap: 6, marginBottom: spacing.lg }} accessibilityElementsHidden>
      {SLIDES.map((_, i) => (
        <Dot key={i} i={i} progress={progress} on={colors.primary} off={withOpacity(colors.onSurface, 0.22)} />
      ))}
    </View>
  );
}

function Dot({ i, progress, on, off }: { i: number; progress: SharedValue<number>; on: string; off: string }) {
  const style = useAnimatedStyle(() => {
    const k = interpolate(progress.value, [i - 1, i, i + 1], [0, 1, 0], Extrapolation.CLAMP);
    return {
      width: 6 + k * 16,
      backgroundColor: interpolateColor(k, [0, 1], [off, on]),
      shadowOpacity: k * 0.8,
    };
  });
  return <Animated.View style={[{ height: 6, borderRadius: 3, shadowColor: on, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } }, style]} />;
}

/** Reduce Motion: one calm icon per slide, cross-faded. */
function ReducedHero({ index, accent }: { index: number; accent: string }) {
  const icons = ['bus-outline', 'layers-outline', 'cut-outline', 'wallet-outline', 'location-outline', 'eye-outline'] as const;
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View key={index} entering={FadeIn.duration(150)}>
        <Ionicons name={icons[index]} size={120} color={accent} />
      </Animated.View>
      <View style={{ width: 180, height: 18, borderRadius: 9, backgroundColor: withOpacity(accent, 0.18), marginTop: 18 }} />
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: '#050506' },
    aura: { position: 'absolute', borderRadius: 9999, opacity: 0.09 },
    vignette: { position: 'absolute', left: 0, right: 0, top: 0, height: 160 },
    logoRow: { alignItems: 'center' },
    wordmark: { fontFamily: fonts.displaySemiBold, fontSize: 15, letterSpacing: 6, color: colors.onSurface },
    cardWrap: { position: 'absolute', left: spacing.md, right: spacing.md, bottom: 0 },
    card: {
      borderRadius: 32,
      overflow: 'hidden',
      padding: spacing.xl,
      paddingTop: spacing.lg,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.08)',
      shadowColor: colors.primary,
      shadowOpacity: 0.1,
      shadowRadius: 40,
      shadowOffset: { width: 0, height: -10 },
    },
    cardEdge: { ...StyleSheet.absoluteFillObject, opacity: 0.35 },
    topLight: { position: 'absolute', top: 0, left: 24, right: 24, height: 1, backgroundColor: 'rgba(255,255,255,0.22)' },
    titleBox: { minHeight: 76, justifyContent: 'center' },
    title: { fontFamily: fonts.displayBold, fontSize: 29, lineHeight: 32, letterSpacing: -0.5, color: colors.onSurface, textAlign: 'center' },
    subBox: { minHeight: 46, marginTop: spacing.sm, justifyContent: 'flex-start' },
    subtitle: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, color: withOpacity(colors.onSurface, 0.62), textAlign: 'center' },
    ctas: { gap: spacing.md, marginTop: spacing.xl },
    legal: { fontFamily: fonts.regular, fontSize: 11.5, color: withOpacity(colors.onSurface, 0.45), textAlign: 'center', marginTop: spacing.md },
  });
