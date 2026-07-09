import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  Dimensions,
  Platform,
  Pressable,
  ViewToken,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView, MotiText } from 'moti';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withSequence,
  withTiming,
  interpolate,
  Extrapolation,
  type SharedValue,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import * as SecureStore from 'expo-secure-store';
import Svg, { Circle, Path, Rect, Line, G } from 'react-native-svg';
import { fonts, fontSizes, spacing, withOpacity } from '@eyego/config';
import {
  Text,
  GradientGlowBorder,
  type GradientGlowBorderHandle,
  PREMIUM_RING_COLORS,
  PREMIUM_RING_LOCATIONS,
} from '@eyego/ui';
import { useColors, Colors } from '../../utils/useColors';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface Slide {
  id: string;
  headline: string;
  tagline: string;
  subtext: string;
  accentColor: string;
  glowColor: string;
}

const SLIDES: Slide[] = [
  {
    id: '1',
    headline: 'High-Fidelity\nProfessional Transit',
    tagline: 'VERIFIED CARPOOLING',
    subtext: 'Step into security. Ride with verified professionals in premium carpools designed to fit your calendar.',
    accentColor: '#4BE277',
    glowColor: 'rgba(75, 226, 119, 0.25)',
  },
  {
    id: '2',
    headline: 'Ultra-Crisp\nReal-time Radar',
    tagline: 'PREMIUM MAPBOX TILES',
    subtext: 'Track your ride on custom dark vector tilemaps with down-to-the-millisecond tracking and live arrival ETA.',
    accentColor: '#4BE277',
    glowColor: 'rgba(75, 226, 119, 0.25)',
  },
  {
    id: '3',
    headline: 'Frictionless\nCash & MoMo Checkout',
    tagline: 'TRANSPARENT BILLING',
    subtext: 'Confirm bookings seamlessly. Pay in cash directly or checkout with a single tap. Transit, refined.',
    accentColor: '#4BE277',
    glowColor: 'rgba(75, 226, 119, 0.25)',
  },
];

function SlideIllustration({ slideId }: { slideId: string }) {
  if (slideId === '1') {
    return (
      <Svg width={140} height={140} viewBox="0 0 140 140">
        {/* Road */}
        <Rect x="10" y="90" width="120" height="8" rx="4" fill="rgba(255,255,255,0.08)" />
        {/* Car body */}
        <Rect x="28" y="68" width="84" height="30" rx="10" fill="#1a1a2e" stroke="#4BE277" strokeWidth="1.5" />
        {/* Car roof */}
        <Path d="M44 68 Q50 50 90 50 Q100 50 106 68Z" fill="#111120" stroke="#4BE277" strokeWidth="1.5" />
        {/* Windshield */}
        <Path d="M50 68 Q55 55 88 55 Q96 55 100 68Z" fill="rgba(75,226,119,0.12)" />
        {/* Wheels */}
        <Circle cx="50" cy="100" r="12" fill="#0d0d1a" stroke="#4BE277" strokeWidth="1.5" />
        <Circle cx="50" cy="100" r="5" fill="#4BE277" opacity="0.4" />
        <Circle cx="90" cy="100" r="12" fill="#0d0d1a" stroke="#4BE277" strokeWidth="1.5" />
        <Circle cx="90" cy="100" r="5" fill="#4BE277" opacity="0.4" />
        {/* Passengers */}
        <Circle cx="62" cy="62" r="6" fill="#4BE277" opacity="0.7" />
        <Circle cx="82" cy="62" r="6" fill="#4BE277" opacity="0.5" />
        {/* Origin pin */}
        <Circle cx="20" cy="40" r="7" fill="#4BE277" />
        <Path d="M20 47 L20 58" stroke="#4BE277" strokeWidth="1.5" strokeDasharray="3,2" />
        {/* Destination pin */}
        <Circle cx="120" cy="40" r="7" fill="rgba(75,226,119,0.4)" stroke="#4BE277" strokeWidth="1.5" />
        <Path d="M120 47 L120 58" stroke="#4BE277" strokeWidth="1.5" strokeDasharray="3,2" />
        {/* Route dots */}
        <Circle cx="50" cy="44" r="2" fill="#4BE277" opacity="0.4" />
        <Circle cx="70" cy="42" r="2" fill="#4BE277" opacity="0.5" />
        <Circle cx="90" cy="44" r="2" fill="#4BE277" opacity="0.4" />
      </Svg>
    );
  }
  if (slideId === '2') {
    return (
      <Svg width={140} height={140} viewBox="0 0 140 140">
        {/* Map grid lines */}
        <Line x1="20" y1="10" x2="20" y2="130" stroke="rgba(75,226,119,0.07)" strokeWidth="1" />
        <Line x1="45" y1="10" x2="45" y2="130" stroke="rgba(75,226,119,0.07)" strokeWidth="1" />
        <Line x1="70" y1="10" x2="70" y2="130" stroke="rgba(75,226,119,0.07)" strokeWidth="1" />
        <Line x1="95" y1="10" x2="95" y2="130" stroke="rgba(75,226,119,0.07)" strokeWidth="1" />
        <Line x1="120" y1="10" x2="120" y2="130" stroke="rgba(75,226,119,0.07)" strokeWidth="1" />
        <Line x1="10" y1="20" x2="130" y2="20" stroke="rgba(75,226,119,0.07)" strokeWidth="1" />
        <Line x1="10" y1="45" x2="130" y2="45" stroke="rgba(75,226,119,0.07)" strokeWidth="1" />
        <Line x1="10" y1="70" x2="130" y2="70" stroke="rgba(75,226,119,0.07)" strokeWidth="1" />
        <Line x1="10" y1="95" x2="130" y2="95" stroke="rgba(75,226,119,0.07)" strokeWidth="1" />
        <Line x1="10" y1="120" x2="130" y2="120" stroke="rgba(75,226,119,0.07)" strokeWidth="1" />
        {/* Route path */}
        <Path d="M25 110 Q40 80 60 70 Q80 60 95 45 Q110 30 115 25" stroke="#4BE277" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeDasharray="6,3" opacity="0.6" />
        {/* Origin marker */}
        <Circle cx="25" cy="110" r="5" fill="#4BE277" opacity="0.9" />
        {/* Pulse rings around current position */}
        <Circle cx="80" cy="58" r="18" fill="rgba(75,226,119,0.05)" stroke="#4BE277" strokeWidth="0.5" />
        <Circle cx="80" cy="58" r="12" fill="rgba(75,226,119,0.08)" stroke="#4BE277" strokeWidth="0.8" />
        <Circle cx="80" cy="58" r="7" fill="rgba(75,226,119,0.15)" stroke="#4BE277" strokeWidth="1" />
        <Circle cx="80" cy="58" r="4" fill="#4BE277" />
        {/* Destination pin */}
        <Circle cx="115" cy="10" r="4" fill="#4BE277" />
        {/* ETA chip */}
        <Rect x="90" y="72" width="38" height="18" rx="9" fill="rgba(75,226,119,0.15)" stroke="#4BE277" strokeWidth="1" />
        <Rect x="95" y="78" width="16" height="6" rx="3" fill="#4BE277" opacity="0.5" />
        <Rect x="114" y="78" width="10" height="6" rx="3" fill="#4BE277" opacity="0.3" />
      </Svg>
    );
  }
  // slideId === '3': Mobile payment
  return (
    <Svg width={140} height={140} viewBox="0 0 140 140">
      {/* Phone outline */}
      <Rect x="40" y="15" width="60" height="110" rx="12" fill="#111120" stroke="#4BE277" strokeWidth="1.5" />
      {/* Screen */}
      <Rect x="46" y="28" width="48" height="72" rx="6" fill="rgba(75,226,119,0.05)" />
      {/* Home bar */}
      <Rect x="58" y="118" width="24" height="4" rx="2" fill="#4BE277" opacity="0.4" />
      {/* Payment card on screen */}
      <Rect x="51" y="35" width="38" height="22" rx="5" fill="rgba(75,226,119,0.15)" stroke="#4BE277" strokeWidth="1" />
      <Circle cx="59" cy="44" r="5" fill="#4BE277" opacity="0.5" />
      <Rect x="67" y="41" width="16" height="3" rx="1.5" fill="#4BE277" opacity="0.4" />
      <Rect x="67" y="47" width="10" height="2" rx="1" fill="#4BE277" opacity="0.25" />
      {/* Amount display */}
      <Rect x="53" y="64" width="18" height="5" rx="2.5" fill="#4BE277" opacity="0.6" />
      <Rect x="74" y="64" width="12" height="5" rx="2.5" fill="#4BE277" opacity="0.3" />
      {/* Pay button */}
      <Rect x="51" y="76" width="38" height="14" rx="7" fill="#4BE277" opacity="0.9" />
      <Rect x="62" y="81" width="16" height="4" rx="2" fill="#050508" opacity="0.6" />
      {/* Tap ripple */}
      <Circle cx="110" cy="55" r="16" fill="none" stroke="#4BE277" strokeWidth="1" opacity="0.3" />
      <Circle cx="110" cy="55" r="10" fill="none" stroke="#4BE277" strokeWidth="1" opacity="0.5" />
      <Circle cx="110" cy="55" r="5" fill="#4BE277" opacity="0.6" />
      {/* MoMo label */}
      <Rect x="48" y="95" width="44" height="10" rx="5" fill="rgba(75,226,119,0.1)" stroke="#4BE277" strokeWidth="0.8" />
      <Rect x="56" y="98" width="12" height="4" rx="2" fill="#4BE277" opacity="0.5" />
      <Rect x="72" y="98" width="12" height="4" rx="2" fill="#4BE277" opacity="0.3" />
    </Svg>
  );
}

export default function OnboardingScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const flatListRef = useRef<FlatList>(null);
  const ctaRingRef = useRef<GradientGlowBorderHandle>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollX = useSharedValue(0);

  const renderSlide = useCallback(({ item, index }: { item: Slide; index: number }) => (
    <SlideItem slide={item} index={index} scrollX={scrollX} colors={colors} styles={styles} />
  ), [scrollX, colors, styles]);

  const handleDone = useCallback(async () => {
    await SecureStore.setItemAsync('eyego_onboarded', 'true');
    router.replace('/(tabs)/home');
  }, [router]);

  const handleNext = useCallback(() => {
    if (currentIndex < SLIDES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1, animated: true });
    } else {
      handleDone();
    }
  }, [currentIndex, handleDone]);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems[0]) {
        setCurrentIndex(viewableItems[0].index ?? 0);
      }
    },
    []
  );

  return (
    <SafeAreaView style={styles.safe}>
      {/* Top Header Row */}
      <MotiView
        from={{ opacity: 0, translateY: -6 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'spring', stiffness: 580, damping: 34, mass: 0.8 }}
        style={styles.headerRow}
      >
        <Image
          source={require('../../assets/logo.png')}
          style={styles.brandLogo}
          resizeMode="contain"
          accessibilityRole="image"
          accessibilityLabel="EyeGo"
        />
        <Pressable onPress={handleDone} hitSlop={16} accessibilityRole="button" accessibilityLabel="Skip onboarding">
          <Text variant="label" style={styles.skipButton}>Skip</Text>
        </Pressable>
      </MotiView>

      {/* Main Slides List */}
      <FlatList
        ref={flatListRef}
        data={SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ viewAreaCoveragePercentThreshold: 50 }}
        onScroll={(e) => {
          scrollX.value = e.nativeEvent.contentOffset.x;
        }}
        scrollEventThrottle={16}
        keyExtractor={(item) => item.id}
        renderItem={renderSlide}
        style={{ flex: 1 }}
      />

      {/* Footer Nav Bar */}
      <MotiView
        from={{ opacity: 0, translateY: 10 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'spring', stiffness: 580, damping: 34, mass: 0.8, delay: 110 }}
        style={styles.footer}
      >
        {/* Pagination Dots */}
        <View style={styles.dotsRow}>
          {SLIDES.map((_, i) => (
            <AnimatedDot key={i} index={i} currentIndex={currentIndex} colors={colors} styles={styles} />
          ))}
        </View>

        {/* Primary Premium CTA */}
        <View style={styles.ctaWrapper}>
          <Pressable
            onPress={() => { ctaRingRef.current?.burst(); handleNext(); }}
            accessibilityRole="button"
            accessibilityLabel={currentIndex === SLIDES.length - 1 ? 'Start your journey' : 'Continue'}
          >
            <GradientGlowBorder
              ref={ctaRingRef}
              colors={PREMIUM_RING_COLORS}
              locations={PREMIUM_RING_LOCATIONS}
              fillColor={colors.surfaceContainerHigh}
              borderRadius={28}
              glow
              glowColor={colors.premiumBlue}
              glowColorSecondary={colors.premiumOrange}
              style={styles.premiumCta}
            >
              <Text style={styles.premiumCtaText}>
                {currentIndex === SLIDES.length - 1 ? 'Start Your Journey' : 'Continue'}
              </Text>
            </GradientGlowBorder>
          </Pressable>
        </View>
      </MotiView>
    </SafeAreaView>
  );
}

function SlideItem({
  slide,
  index,
  scrollX,
  colors,
  styles,
}: {
  slide: Slide;
  index: number;
  scrollX: SharedValue<number>;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    const inputRange = [
      (index - 1) * SCREEN_WIDTH,
      index * SCREEN_WIDTH,
      (index + 1) * SCREEN_WIDTH,
    ];
    
    const opacity = interpolate(
      scrollX.value,
      inputRange,
      [0, 1, 0],
      Extrapolation.CLAMP
    );

    const scale = interpolate(
      scrollX.value,
      inputRange,
      [0.85, 1, 0.85],
      Extrapolation.CLAMP
    );

    const translateY = interpolate(
      scrollX.value,
      inputRange,
      [40, 0, 40],
      Extrapolation.CLAMP
    );

    return {
      opacity,
      transform: [{ scale }, { translateY }],
    };
  });

  // Glowing halo scaling animation (snappy, responsive liquid scale)
  const glowScale = useSharedValue(1);
  useEffect(() => {
    glowScale.value = withRepeat(
      withSequence(
        withTiming(1.2, { duration: 2000 }),
        withTiming(1.0, { duration: 2000 })
      ),
      -1,
      true
    );
  }, [glowScale]);

  const glowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: glowScale.value }],
  }));

  return (
    <View style={[styles.slide, { width: SCREEN_WIDTH }]}>
      <Animated.View style={[styles.slideContent, animatedStyle]}>
        {/* Modern Illustration Halo with glassmorphism */}
        <View style={styles.illustrationOuter}>
          <Animated.View style={[styles.glowHalo, { borderColor: slide.accentColor + '40' }, glowStyle]} />
          
          {Platform.OS === 'ios' ? (
            <BlurView intensity={30} tint="dark" style={styles.illustrationGlass}>
              <View style={[styles.illustrationCore, { backgroundColor: withOpacity(colors.primary, 0.05) }]}>
                <SlideIllustration slideId={slide.id} />
              </View>
            </BlurView>
          ) : (
            // expo-blur on Android is just a tint (plus native-view overhead) — render the tint directly.
            <View style={[styles.illustrationGlass, { backgroundColor: 'rgba(255,255,255,0.05)' }]}>
              <View style={[styles.illustrationCore, { backgroundColor: withOpacity(colors.primary, 0.05) }]}>
                <SlideIllustration slideId={slide.id} />
              </View>
            </View>
          )}
        </View>

        {/* Feature tagline */}
        <Text style={[styles.tagline, { color: slide.accentColor }]}>{slide.tagline}</Text>

        {/* Main headline */}
        <Text variant="headlineLarge" style={styles.slideHeadline}>
          {slide.headline}
        </Text>

        {/* Subtext description */}
        <Text variant="bodyLarge" style={styles.slideSubtext}>
          {slide.subtext}
        </Text>
      </Animated.View>
    </View>
  );
}

function AnimatedDot({
  index,
  currentIndex,
  colors,
  styles,
}: {
  index: number;
  currentIndex: number;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const isActive = index === currentIndex;
  const scaleX = useSharedValue(isActive ? 1 : 0.25);

  useEffect(() => {
    scaleX.value = withSpring(isActive ? 1 : 0.25, { stiffness: 580, damping: 34, mass: 0.8 });
  }, [isActive, scaleX]);

  const dotStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: scaleX.value }],
    backgroundColor: isActive ? colors.primary : colors.rimLight,
  }));

  return <Animated.View style={[styles.dot, { width: 32 }, dotStyle]} />;
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    zIndex: 10,
  },
  brandText: {
    fontSize: fontSizes.titleLarge,
    lineHeight: fontSizes.titleLarge * 1.3,
    fontFamily: fonts.bold,
    color: colors.onSurface,
    letterSpacing: -0.5,
  },
  brandLogo: {
    width: 96,
    height: 40,
  },
  skipButton: {
    fontSize: fontSizes.bodySmall,
    fontFamily: fonts.medium,
    color: colors.onSurfaceVariant,
    letterSpacing: 0.2,
  },
  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing['2xl'],
    position: 'relative',
  },
  backgroundAura: {
    position: 'absolute',
    width: SCREEN_WIDTH * 0.95,
    height: SCREEN_WIDTH * 0.95,
    borderRadius: (SCREEN_WIDTH * 0.95) / 2,
    top: SCREEN_HEIGHT * 0.1,
    alignSelf: 'center',
    filter: 'blur(80px)' as any,
    opacity: 0.7,
  },
  slideContent: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  illustrationOuter: {
    width: 200,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing['3xl'],
    position: 'relative',
  },
  glowHalo: {
    position: 'absolute',
    width: 210,
    height: 210,
    borderRadius: 105,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    opacity: 0.75,
  },
  illustrationGlass: {
    width: 170,
    height: 170,
    borderRadius: 85,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: colors.rimLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  illustrationCore: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagline: {
    fontSize: fontSizes.caption,
    fontFamily: fonts.bold,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: spacing.md,
  },
  slideHeadline: {
    color: colors.onSurface,
    fontFamily: fonts.bold,
    fontSize: 32,
    lineHeight: 40,
    textAlign: 'center',
    letterSpacing: -1,
    marginBottom: spacing.md,
  },
  slideSubtext: {
    color: colors.onSurfaceVariant,
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
  footer: {
    paddingHorizontal: spacing['2xl'],
    paddingBottom: spacing['3xl'],
    gap: spacing['2xl'],
  },
  dotsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: spacing.sm,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  ctaWrapper: {
    width: '100%',
  },
  premiumCta: {
    // Background, ring, and glow are drawn by GradientGlowBorder — this
    // only supplies layout.
    width: '100%',
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  premiumCtaText: {
    color: colors.onSurface,
    fontSize: 16,
    lineHeight: 21,
    fontFamily: fonts.bold,
    letterSpacing: -0.2,
  },
});
