import React, { useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, Platform, Pressable } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { fonts, fontSizes, radii, spacing, springs, withOpacity } from '@eyego/config';
import { Text } from '@eyego/ui';

import { useColors, type DriverColors } from '../utils/useColors';

/**
 * THE DRIVER'S IN-APP TOAST — THIRD REWRITE, AND A DIFFERENT SHAPE THIS TIME.
 *
 * ── WHY THE PREVIOUS ONE WAS STILL WRONG ────────────────────────────────────
 * "This is the 3rd or 4th time, so you know you need to find a different
 * approach for this. Right now you can see the texts and all, but the call to
 * action underneath is black and unstyled, so the user wouldn't be able to see
 * that he can click it."
 *
 * The previous version was a `GlassSurface` inside a `GradientGlowBorder`: a
 * blur, a rotating gradient ring, a wash, an icon chip and a rail. Five layers,
 * and the ONE thing the driver had to notice — that this banner is a door into
 * a live ride — was a 16 pt chevron in a tone colour that, for `info` and
 * `error`, is a muted slate. There was no CTA at all; there was a chevron, and
 * a chevron is not an affordance a driver reads at a glance while working.
 *
 * Layering blur on blur was also the wrong material for where this thing lives.
 * The driver's home screen is a full-bleed live map. Frosted glass over moving
 * map tiles has no stable ground to sit on, so its contrast changes as the map
 * pans — text that is legible over a park is not legible over a motorway.
 *
 * ── THE DIFFERENT APPROACH ──────────────────────────────────────────────────
 * Opaque, not glass. One accent rail, not a ring. And a REAL button.
 *
 *   OPAQUE CARD       `surfaceContainerHigh` with a hairline rim and a tinted,
 *                     layered shadow. Contrast is now a constant, whatever the
 *                     map is doing underneath, and there is no `BlurView`
 *                     resampling live map tiles at 60 fps (see the perf note on
 *                     the driver's live-map screens).
 *   ONE ACCENT RAIL   A 4 pt bar down the leading edge carries the tone. Tone
 *                     used to be spread across a ring, a wash, an icon chip and
 *                     a rail — four things saying one thing.
 *   A REAL CTA        A bordered pill with a WORD in it ("Open the ride",
 *                     "Reply", "Open"), tinted in the accent on an accent-tinted
 *                     fill. It is a control that looks like a control. This is
 *                     the fix for "black and unstyled".
 *   THE CLOCK STAYS   The draining rail was the one thing that worked. Kept, on
 *                     the bottom edge.
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
  /**
   * The words on the button. Required for the button to render at all: a CTA
   * with no verb is the chevron problem again, so a caller that cannot name the
   * action gets no button and the card is simply not tappable.
   */
  actionLabel?: string | null;
  onPress?: () => void;
  onDismiss: () => void;
}

function toneColor(tone: ToastTone, colors: DriverColors): string {
  switch (tone) {
    case 'offer':
      return colors.accent;
    case 'alert':
      return colors.statusWarning;
    case 'error':
      return colors.error;
    default:
      // Not `onSurfaceVariant`. A muted slate on a slate card is the exact
      // contrast failure this rewrite exists to end — `info` gets the app's
      // own blue, one step down in weight from `offer`.
      return colors.primaryFixedDim;
  }
}

export function DriverToast({
  message,
  title,
  icon = 'notifications',
  tone = 'info',
  durationMs = 5200,
  actionLabel,
  onPress,
  onDismiss,
}: DriverToastProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const accent = toneColor(tone, colors);
  const reducedMotion = useReducedMotion();
  const actionable = !!onPress && !!actionLabel;

  const rise = useSharedValue(0);
  const drag = useSharedValue(0);
  const life = useSharedValue(1);
  const press = useSharedValue(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!message) {
      rise.value = withTiming(0, { duration: 150, easing: Easing.in(Easing.quad) });
      return;
    }
    drag.value = 0;
    // Enter with a spring, leave shorter and quieter — the asymmetry is what
    // makes an entrance read as arrival rather than as a jump.
    rise.value = reducedMotion ? 1 : withSpring(1, springs.standard);
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
      cancelAnimation(rise);
    };
    // `message` identity is the "this is a new toast" signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, durationMs, reducedMotion]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: rise.value,
    transform: [
      { translateY: interpolate(rise.value, [0, 1], [-22, 0]) + drag.value },
      { scale: 0.97 + rise.value * 0.03 },
    ],
  }));

  const railStyle = useAnimatedStyle(() => ({ width: `${Math.max(0, life.value) * 100}%` }));
  const ctaStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 - press.value * 0.04 }] }));

  const fire = () => {
    if (!onPress) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  };

  /**
   * AN UPWARD FLICK PUTS IT AWAY.
   *
   * Upward because the toast is anchored to the top and came from off-screen
   * above; every other dismissable surface in both apps is thrown back the way
   * it arrived.
   *
   * `.runOnJS(true)` pins the gesture to the JS thread. A gesture callback is
   * an auto-worklet by default, and calling a plain JS closure from one is the
   * SIGABRT this codebase has already paid for once — see the same note on
   * packages/ui/src/morph/MorphBackSwipeDetector.tsx. Shared values are safe to
   * write from the JS thread; only the callbacks needed marshalling.
   */
  const pan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetY([-8, 8])
    .onUpdate((e) => {
      drag.value = Math.min(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY < -30 || e.velocityY < -600) {
        drag.value = withTiming(-140, { duration: 150 });
        rise.value = withTiming(0, { duration: 150 });
        onDismiss();
      } else {
        drag.value = withSpring(0, springs.standard);
      }
    });

  if (!message) return null;

  return (
    <View style={styles.container} pointerEvents="box-none">
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[styles.card, { borderColor: withOpacity(accent, 0.28) }, cardStyle]}
          accessibilityRole={actionable ? 'button' : 'alert'}
          accessibilityLabel={`${title ?? 'EyeGo'}: ${message}`}
        >
          {/* The tone, carried by ONE element. */}
          <View style={[styles.toneRail, { backgroundColor: accent }]} pointerEvents="none" />

          <View style={styles.inner}>
            <View style={styles.topRow}>
              <View style={[styles.iconWrap, { backgroundColor: withOpacity(accent, 0.16) }]}>
                <Ionicons name={icon} size={16} color={accent} />
              </View>

              <View style={styles.body}>
                <Text style={[styles.eyebrow, { color: accent }]} numberOfLines={1}>
                  {(title ?? 'EYEGO DRIVER').toUpperCase()}
                </Text>
                <Text style={styles.message} numberOfLines={2}>
                  {message}
                </Text>
              </View>

              {/* 44 pt target for a 16 pt glyph — `hitSlop` rather than a
                  bigger visual, so the close does not compete with the CTA. */}
              <Pressable
                onPress={onDismiss}
                hitSlop={14}
                accessibilityRole="button"
                accessibilityLabel="Dismiss"
                style={styles.close}
              >
                <Ionicons name="close" size={15} color={colors.onSurfaceVariant} />
              </Pressable>
            </View>

            {/*
              THE CALL TO ACTION, WITH WORDS ON IT.

              This is the whole point of the rewrite. It only renders when the
              caller named the action, so a banner that goes nowhere ("Payment
              received", "Connection lost") shows no button at all rather than a
              dead chevron — which is also the fix for tapping a stale banner
              and landing on a cancelled trip.
            */}
            {actionable && (
              <Animated.View style={ctaStyle}>
                <Pressable
                  onPress={fire}
                  onPressIn={() => {
                    press.value = withSpring(1, springs.press);
                  }}
                  onPressOut={() => {
                    press.value = withSpring(0, springs.press);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={actionLabel ?? undefined}
                  style={[
                    styles.cta,
                    { backgroundColor: withOpacity(accent, 0.14), borderColor: withOpacity(accent, 0.55) },
                  ]}
                >
                  <Text style={[styles.ctaText, { color: accent }]} numberOfLines={1}>
                    {actionLabel}
                  </Text>
                  <Ionicons name="arrow-forward" size={13} color={accent} />
                </Pressable>
              </Animated.View>
            )}
          </View>

          {/* The clock. On the card's bottom edge, so it reads as part of the
              surface rather than as a widget. */}
          <View style={styles.railTrack} pointerEvents="none">
            <Animated.View style={[styles.rail, { backgroundColor: accent }, railStyle]} />
          </View>
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
      borderRadius: radii['2xl'],
      overflow: 'hidden',
      // Opaque. See the header: frosted glass over a live map has no stable
      // ground, so its contrast changes as the driver pans.
      backgroundColor: colors.surfaceContainerHigh,
      borderWidth: StyleSheet.hairlineWidth,
      // Tinted toward the app's own deep navy rather than pure black, so the
      // shadow belongs to this palette instead of greying the map under it.
      shadowColor: colors.backgroundDeep,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.55,
      shadowRadius: 22,
      elevation: 14,
    },
    /** The tone, as one 4 pt bar down the leading edge. */
    toneRail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
    inner: {
      paddingLeft: spacing.base + 4,
      paddingRight: spacing.md,
      paddingTop: spacing.md,
      paddingBottom: spacing.md + 3,
      gap: spacing.md,
    },
    topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
    iconWrap: {
      width: 30,
      height: 30,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 1,
    },
    body: { flex: 1, gap: 3 },
    eyebrow: { fontFamily: fonts.labelCaps, fontSize: 9.5, lineHeight: 12, letterSpacing: 1.1 },
    message: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.35),
      color: colors.onSurface,
    },
    close: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
    cta: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      // 40 pt of height on a control a driver reaches for without looking.
      minHeight: 40,
      paddingHorizontal: spacing.base,
      borderRadius: radii.full,
      borderWidth: 1,
    },
    ctaText: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, letterSpacing: 0.1 },
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
