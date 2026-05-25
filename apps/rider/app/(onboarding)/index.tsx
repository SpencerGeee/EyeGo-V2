import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  Dimensions,
  Pressable,
  ViewToken,
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
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import * as SecureStore from 'expo-secure-store';
import { colors, fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button } from '@eyego/ui';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface Slide {
  id: string;
  emoji: string;
  headline: string;
  tagline: string;
  subtext: string;
  accentColor: string;
  glowColor: string;
}

const SLIDES: Slide[] = [
  {
    id: '1',
    emoji: '🟢',
    headline: 'High-Fidelity\nProfessional Transit',
    tagline: 'VERIFIED CARPOOLING',
    subtext: 'Step into security. Ride with verified professionals in premium carpools designed to fit your calendar.',
    accentColor: '#4BE277',
    glowColor: 'rgba(75, 226, 119, 0.25)',
  },
  {
    id: '2',
    emoji: '⚡',
    headline: 'Ultra-Crisp\nReal-time Radar',
    tagline: 'PREMIUM MAPBOX TILES',
    subtext: 'Track your ride on custom dark vector tilemaps with down-to-the-millisecond tracking and live arrival ETA.',
    accentColor: '#4BE277',
    glowColor: 'rgba(75, 226, 119, 0.25)',
  },
  {
    id: '3',
    emoji: '💵',
    headline: 'Frictionless\nCash & MoMo Checkout',
    tagline: 'TRANSPARENT BILLING',
    subtext: 'Confirm bookings seamlessly. Pay in cash directly or checkout with a single tap. Transit, refined.',
    accentColor: '#4BE277',
    glowColor: 'rgba(75, 226, 119, 0.25)',
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const flatListRef = useRef<FlatList>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollX = useSharedValue(0);

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
        <Text style={styles.brandText}>EyeGo</Text>
        <Pressable onPress={handleDone} hitSlop={16}>
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
        renderItem={({ item, index }) => (
          <SlideItem slide={item} index={index} scrollX={scrollX} />
        )}
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
            <AnimatedDot key={i} index={i} currentIndex={currentIndex} />
          ))}
        </View>

        {/* Primary Premium CTA */}
        <View style={styles.ctaWrapper}>
          <Pressable style={[styles.premiumCta, { shadowColor: '#4BE277' }]} onPress={handleNext}>
            <Text style={styles.premiumCtaText}>
              {currentIndex === SLIDES.length - 1 ? 'Start Your Journey' : 'Continue'}
            </Text>
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
}: {
  slide: Slide;
  index: number;
  scrollX: Animated.SharedValue<number>;
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
  }, []);

  const glowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: glowScale.value }],
  }));

  return (
    <View style={[styles.slide, { width: SCREEN_WIDTH }]}>
      <Animated.View style={[styles.slideContent, animatedStyle]}>
        {/* Modern Illustration Halo with glassmorphism */}
        <View style={styles.illustrationOuter}>
          <Animated.View style={[styles.glowHalo, { borderColor: slide.accentColor + '40' }, glowStyle]} />
          
          <BlurView intensity={30} tint="dark" style={styles.illustrationGlass}>
            <View style={[styles.illustrationCore, { backgroundColor: 'rgba(75, 226, 119, 0.05)' }]}>
              <Text style={styles.emoji}>{slide.emoji}</Text>
            </View>
          </BlurView>
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

function AnimatedDot({ index, currentIndex }: { index: number; currentIndex: number }) {
  const isActive = index === currentIndex;
  const width = useSharedValue(isActive ? 32 : 8);

  useEffect(() => {
    width.value = withSpring(isActive ? 32 : 8, { stiffness: 580, damping: 34, mass: 0.8 });
  }, [isActive]);

  const dotStyle = useAnimatedStyle(() => ({
    width: width.value,
    backgroundColor: isActive ? '#4BE277' : 'rgba(255, 255, 255, 0.15)',
  }));

  return <Animated.View style={[styles.dot, dotStyle]} />;
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#050508', // Ultra deep dark mode background
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
    fontSize: fontSizes.xl,
    fontFamily: fonts.bold,
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  skipButton: {
    fontSize: fontSizes.sm,
    fontFamily: fonts.medium,
    color: 'rgba(255, 255, 255, 0.5)',
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
    borderColor: 'rgba(255, 255, 255, 0.15)', // Premium glossy border
    alignItems: 'center',
    justifyContent: 'center',
  },
  illustrationCore: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 78,
  },
  tagline: {
    fontSize: fontSizes.xs,
    fontFamily: fonts.bold,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: spacing.md,
  },
  slideHeadline: {
    color: '#FFFFFF',
    fontFamily: fonts.bold,
    fontSize: 32,
    lineHeight: 40,
    textAlign: 'center',
    letterSpacing: -1,
    marginBottom: spacing.md,
  },
  slideSubtext: {
    color: 'rgba(255, 255, 255, 0.7)',
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
    width: '100%',
    height: 56,
    borderRadius: 28,
    backgroundColor: '#4BE277', // Verified brand mint green for luxurious look
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 6,
  },
  premiumCtaText: {
    color: '#050508',
    fontSize: 16,
    fontFamily: fonts.bold,
    letterSpacing: -0.2,
  },
});
