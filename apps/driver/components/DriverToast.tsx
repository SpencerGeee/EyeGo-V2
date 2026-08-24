import React, { useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { fonts, fontSizes, radii, spacing, springs } from '@eyego/config';
import { Text, GlassSurface, GradientGlowBorder } from '@eyego/ui';

import { useColors, type DriverColors } from '../utils/useColors';

/**
 * THE DRIVER'S IN-APP TOAST.
 *
 * ── WHAT WAS WRONG WITH THE OLD ONE ─────────────────────────────────────────
 * "The toast notification shown on the home page of the driver app should be
 * redesigned to be made more aesthetic."
 *
 * It was a `BlurView` with a hard blue rim, one flat blue accent for every kind
 * of event, an `Animated.spring` on `translateY` alone, and a five-second
 * timeout with nothing on screen to say it was running. Four specific costs:
 *
 *   1. NO HIERARCHY. A chat message, a cancelled booking and a live ride offer
 *      all arrived looking identical, in the app's primary blue. The one that
 *      pays the driver was indistinguishable from the one that does not.
 *   2. NO SENSE OF TIME. The banner simply vanished mid-read. A progress rail
 *      is the cheapest possible answer and it doubles as the urgency signal for
 *      an offer that is genuinely counting down.
 *   3. NOT DISMISSABLE. A driver who had read it had to wait it out, on top of
 *      the map they were trying to look at.
 *   4. IT DID NOT MATCH THE APP. Every other elevated surface in this app is a
 *      `GlassSurface` inside a `GradientGlowBorder`; this was the one place
 *      still hand-rolling a blur and a border colour.
 *
 * ── THE DESIGN ──────────────────────────────────────────────────────────────
 * One glass card in a live ring, tinted by TONE. `offer` gets the driver
 * palette and the strongest halo because it is the only tone that is money on
 * the table; `alert` is amber, `error` red, `info` neutral. The rail underneath
 * drains over the toast's own life, so "how long have I got" is answered
 * without a number. A downward flick dismisses it, and a tap opens whatever it
 * is about.
 *
 * Deliberately NOT a queue. A driver reading a stack of banners is a driver not
 * looking at the road; the newest event replaces the current one, which is the
 * same rule the offer sheet uses.
 */

export type ToastTone = 'offer' | 'alert' | 'error' | 'info';

export interface DriverToastProps {
  /** Null hides it. Changing the `key` re-runs the entrance. */
  message: string | null;
  title?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  tone?: ToastTone;
  /** Total life in ms, and the period the progress rail drains over. */
  durationMs?: number;
  onPress?: () => void;
  onDismiss: () => void;
}

const TONE_RING: Record<ToastTone, 'driver' | 'gold' | 'default'> = {
  offer: 'driver',
  alert: 'gold',
  error: 'default',
  info: 'default',
};

function toneColor(tone: ToastTone, colors: DriverColors): string {
  switch (tone) {
    case 'offer':
      return colors.accent;
    case 'alert':
      return colors.statusWarning;
    case 'error':
      return colors.error;
    default:
      return colors.onSurfaceVariant;
  }
}

export function DriverToast({
  message,
  title,
  icon = 'notifications',
  tone = 'info',
  durationMs = 5200,
  onPress,
  onDismiss,
}: DriverToastProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const accent = toneColor(tone, colors);

  const rise = useSharedValue(0);
  const drag = useSharedValue(0);
  const life = useSharedValue(1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!message) {
      rise.value = withTiming(0, { duration: 200, easing: Easing.in(Easing.quad) });
      return;
    }
    drag.value = 0;
    rise.value = withSpring(1, springs.emphasized);
    // The rail is the toast's own clock: one linear drain, no state, no
    // interval. Restarted from full on every new message.
    life.value = 1;
    life.value = withTiming(0, { duration: durationMs, easing: Easing.linear });

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(onDismiss, durationMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      // An in-flight timing survives unmount unless cancelled — see the same
      // note in effects/AppBackground.
      cancelAnimation(life);
    };
    // `message` identity is the "this is a new toast" signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, durationMs]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: rise.value,
    transform: [
      { translateY: interpolate(rise.value, [0, 1], [-26, 0]) + drag.value },
      { scale: 0.96 + rise.value * 0.04 },
    ],
  }));

  const railStyle = useAnimatedStyle(() => ({ width: `${Math.max(0, life.value) * 100}%` }));

  /**
   * AN UPWARD FLICK PUTS IT AWAY.
   *
   * Upward because the toast is anchored to the top and came from off-screen
   * above; every other dismissable surface in both apps is thrown back the way
   * it arrived.
   *
   * `.runOnJS(true)` pins both gestures to the JS thread. A gesture callback is
   * an auto-worklet by default, and calling a plain JS closure from one is the
   * SIGABRT this codebase has already paid for once — see the same note on
   * packages/ui/src/morph/MorphBackSwipeDetector.tsx. Shared values are safe to
   * write from the JS thread; only the callbacks needed marshalling.
   */
  const pan = Gesture.Pan()
    .runOnJS(true)
    .onUpdate((e) => {
      drag.value = Math.min(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY < -30 || e.velocityY < -600) {
        drag.value = withTiming(-140, { duration: 160 });
        rise.value = withTiming(0, { duration: 160 });
        onDismiss();
      } else {
        drag.value = withSpring(0, springs.standard);
      }
    });

  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((_e, success) => {
      if (success && onPress) onPress();
    });

  if (!message) return null;

  return (
    <View style={styles.container} pointerEvents="box-none">
      <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
        <Animated.View style={cardStyle}>
          <GradientGlowBorder
            palette={TONE_RING[tone]}
            fillColor={colors.surfaceCard}
            borderRadius={radii['2xl']}
            thickness={tone === 'offer' ? 'regular' : 'thin'}
            glow
            glowIntensity={tone === 'offer' ? 1 : 0.6}
            maxGlowRadius={tone === 'offer' ? 24 : 14}
          >
            <View
              style={styles.card}
              accessibilityRole="button"
              accessibilityLabel={`${title ?? 'EyeGo'}: ${message}`}
            >
              <GlassSurface
                style={StyleSheet.absoluteFill}
                borderRadius={radii['2xl']}
                intensity={tone === 'offer' ? 'high' : 'low'}
              />
              {/* An inner wash rather than a shadow: shadows do not render
                  inside an `overflow: hidden` card. */}
              <View
                pointerEvents="none"
                style={[StyleSheet.absoluteFill, { backgroundColor: accent + '10' }]}
              />

              <View style={[styles.iconWrap, { backgroundColor: accent + '22', borderColor: accent + '55' }]}>
                <Ionicons name={icon} size={17} color={accent} />
              </View>

              <View style={styles.body}>
                <Text style={[styles.eyebrow, { color: accent }]} numberOfLines={1}>
                  {(title ?? 'EYEGO DRIVER').toUpperCase()}
                </Text>
                <Text style={styles.message} numberOfLines={2}>
                  {message}
                </Text>
              </View>

              {onPress ? (
                <Ionicons name="chevron-forward" size={16} color={accent} style={styles.chevron} />
              ) : null}

              {/* The clock. Sits on the card's bottom edge inside the ring, so
                  it reads as part of the surface rather than as a widget. */}
              <View style={styles.railTrack} pointerEvents="none">
                <Animated.View style={[styles.rail, { backgroundColor: accent }, railStyle]} />
              </View>
            </View>
          </GradientGlowBorder>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const TOP_OFFSET = Constants.statusBarHeight || (Platform.OS === 'ios' ? 56 : 46);

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    container: {
      position: 'absolute',
      top: TOP_OFFSET,
      left: spacing.base,
      right: spacing.base,
      zIndex: 9999,
      elevation: 30,
    },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.base,
      paddingBottom: spacing.base + 3,
      borderRadius: radii['2xl'],
      overflow: 'hidden',
    },
    iconWrap: {
      width: 34,
      height: 34,
      borderRadius: 17,
      borderWidth: StyleSheet.hairlineWidth,
      alignItems: 'center',
      justifyContent: 'center',
    },
    body: { flex: 1, gap: 2 },
    eyebrow: { fontFamily: fonts.bold, fontSize: 9.5, letterSpacing: 1 },
    message: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.32),
      color: colors.onSurface,
    },
    chevron: { marginLeft: -spacing.xs },
    railTrack: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: 2.5,
      backgroundColor: colors.rimLightSubtle,
    },
    rail: { height: '100%', borderRadius: 2 },
  });

export default DriverToast;
