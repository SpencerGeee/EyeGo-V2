import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { fonts, fontSizes, radii, spacing, springs, withOpacity } from '@eyego/config';
import { Text } from '@eyego/ui';

import { useColors, type DriverColors } from '../utils/useColors';

/**
 * THE DRIVER'S STATUS BANNER — AND THE END OF THE TWO HAND-ROLLED PILLS.
 *
 * ── WHY THE TOAST "IS STILL THE OLD ONE" ────────────────────────────────────
 * "I thought I made you redesign the toast notification on the driver app. I
 * can still see the old one."
 *
 * Both true. `DriverToast` WAS rewritten — three times — and it is on main. But
 * `DriverToast` is only ever raised by `DriverTripStatusListener`, for trip
 * events. The banners a driver actually sees while sitting on the home screen
 * waiting for work came from somewhere else entirely: two blocks of JSX inlined
 * in `(tabs)/home.tsx`, `styles.errorBanner` and `styles.offlineBanner`, which
 * no redesign had ever touched. A flat tinted pill, `variant="caption"` text, no
 * call to action, no clock, and — for the offline one — no way to dismiss it at
 * all. That is the old thing, and it was never the component being fixed.
 *
 * So it moves out of the screen and into a component, in the same material as
 * `DriverToast`: opaque card, one accent rail, a real CTA with a word on it, a
 * draining clock. Read `DriverToast`'s header for why that material and not
 * glass — the reasoning is identical and the reason is the live map underneath.
 *
 * ── AND IT LEAVES WHEN IT SHOULD ────────────────────────────────────────────
 * "When the toast notification comes up, it takes a while to go."
 *
 * Two different faults wearing one symptom:
 *
 *   • TRANSIENT alerts (a failed go-online, a rejected wallet) had no timer at
 *     all — they sat there until tapped. `autoDismissMs` gives them one, and
 *     the clock rail shows it running so the driver knows it is going.
 *   • STATE banners ("no internet") correctly persist, because dismissing a
 *     fact does not change it. What they were missing was a way to ACT: this
 *     one carries "Retry now", so the driver can do something about it instead
 *     of watching it.
 *
 * The distinction is the `autoDismissMs` prop: a number means transient, null
 * means it stays until the condition clears.
 */

export type AlertTone = 'error' | 'warn' | 'info' | 'offline';

export interface DriverAlertBannerProps {
  title: string;
  detail?: string | null;
  icon?: keyof typeof Ionicons.glyphMap;
  tone?: AlertTone;
  /** ms until it retires itself. `null` for a banner that tracks a live state. */
  autoDismissMs?: number | null;
  action?: { label: string; onPress: () => void } | null;
  /** Spins the CTA and blocks re-taps while the action is in flight. */
  busy?: boolean;
  onDismiss?: (() => void) | null;
  /** The indicator breathes — for conditions the driver is losing money to. */
  pulse?: boolean;
}

function toneColor(tone: AlertTone, colors: DriverColors): string {
  switch (tone) {
    case 'error':
      return colors.error;
    case 'warn':
      return colors.statusWarning;
    case 'offline':
      // Its own hue. "No signal" is not the same class of event as "the server
      // refused you", and giving both the same red taught drivers to ignore red.
      return '#94A3B8';
    default:
      return colors.primaryFixedDim;
  }
}

export function DriverAlertBanner({
  title,
  detail,
  icon = 'alert-circle',
  tone = 'error',
  autoDismissMs = null,
  action = null,
  busy = false,
  onDismiss = null,
  pulse = false,
}: DriverAlertBannerProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const accent = toneColor(tone, colors);
  const reducedMotion = useReducedMotion();

  const rise = useSharedValue(0);
  const drag = useSharedValue(0);
  const life = useSharedValue(1);
  const press = useSharedValue(0);
  const breath = useSharedValue(0);

  useEffect(() => {
    rise.value = reducedMotion ? 1 : withSpring(1, springs.standard);
    return () => cancelAnimation(rise);
  }, [reducedMotion, rise]);

  // The clock. One linear drain, no interval, no state — same as DriverToast.
  useEffect(() => {
    if (autoDismissMs == null || !onDismiss) return;
    life.value = 1;
    life.value = withTiming(0, { duration: autoDismissMs, easing: Easing.linear });
    const t = setTimeout(onDismiss, autoDismissMs);
    return () => {
      clearTimeout(t);
      // An in-flight timing survives unmount unless cancelled.
      cancelAnimation(life);
    };
  }, [autoDismissMs, onDismiss, life]);

  useEffect(() => {
    if (!pulse || reducedMotion) return;
    breath.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 1000, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(breath);
  }, [pulse, reducedMotion, breath]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: rise.value,
    transform: [{ translateY: (1 - rise.value) * -14 + drag.value }],
  }));
  const railStyle = useAnimatedStyle(() => ({ width: `${Math.max(0, life.value) * 100}%` }));
  const ctaStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 - press.value * 0.03 }] }));
  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.16 + breath.value * 0.4,
    transform: [{ scale: 1 + breath.value * 0.4 }],
  }));

  /**
   * An upward flick puts it away — the direction it arrived from, which is the
   * rule every dismissable surface in both apps follows.
   *
   * `.runOnJS(true)`: a gesture callback is an auto-worklet, and calling a plain
   * JS closure from one is the SIGABRT this codebase has already paid for. See
   * the same note on MorphBackSwipeDetector.
   */
  const pan = Gesture.Pan()
    .enabled(!!onDismiss)
    .runOnJS(true)
    .activeOffsetY([-8, 8])
    .onUpdate((e) => {
      drag.value = Math.min(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY < -28 || e.velocityY < -600) {
        drag.value = withTiming(-120, { duration: 140 });
        rise.value = withTiming(0, { duration: 140 });
        onDismiss?.();
      } else {
        drag.value = withSpring(0, springs.standard);
      }
    });

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[styles.card, { borderColor: withOpacity(accent, 0.3) }, cardStyle]}
        accessibilityRole="alert"
        accessibilityLabel={detail ? `${title}. ${detail}` : title}
      >
        {/* The tone, carried by ONE element. */}
        <View style={[styles.toneRail, { backgroundColor: accent }]} pointerEvents="none" />

        <View style={styles.inner}>
          <View style={styles.topRow}>
            <View style={styles.iconWrap}>
              {pulse && (
                <Animated.View style={[styles.halo, { backgroundColor: accent }, haloStyle]} />
              )}
              <View
                style={[
                  styles.iconCore,
                  { backgroundColor: withOpacity(accent, 0.16), borderColor: withOpacity(accent, 0.45) },
                ]}
              >
                <Ionicons name={icon} size={15} color={accent} />
              </View>
            </View>

            <View style={styles.body}>
              <Text style={styles.title} numberOfLines={2}>
                {title}
              </Text>
              {!!detail && (
                <Text style={styles.detail} numberOfLines={3}>
                  {detail}
                </Text>
              )}
            </View>

            {onDismiss && (
              // 44 pt target for a 15 pt glyph via hitSlop, so the close does
              // not grow big enough to compete with the CTA.
              <Pressable
                onPress={onDismiss}
                hitSlop={14}
                accessibilityRole="button"
                accessibilityLabel="Dismiss"
                style={styles.close}
              >
                <Ionicons name="close" size={15} color={colors.onSurfaceVariant} />
              </Pressable>
            )}
          </View>

          {/* THE CALL TO ACTION, WITH A WORD ON IT.
              Full-width and 46 pt: a blocked driver is earning nothing, so the
              one control that unblocks them is the widest thing on the card. */}
          {action && (
            <Animated.View style={ctaStyle}>
              <Pressable
                onPress={() => {
                  if (busy) return;
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  action.onPress();
                }}
                disabled={busy}
                onPressIn={() => {
                  press.value = withSpring(1, springs.press);
                }}
                onPressOut={() => {
                  press.value = withSpring(0, springs.press);
                }}
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}
                accessibilityLabel={action.label}
                style={[styles.cta, { backgroundColor: colors.onSurface, opacity: busy ? 0.6 : 1 }]}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={colors.background} />
                ) : (
                  <>
                    <Text style={[styles.ctaText, { color: colors.background }]} numberOfLines={1}>
                      {action.label}
                    </Text>
                    <Ionicons name="arrow-forward" size={13} color={colors.background} />
                  </>
                )}
              </Pressable>
            </Animated.View>
          )}
        </View>

        {autoDismissMs != null && onDismiss && (
          <View style={styles.railTrack} pointerEvents="none">
            <Animated.View style={[styles.rail, { backgroundColor: accent }, railStyle]} />
          </View>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    card: {
      borderRadius: radii['2xl'],
      overflow: 'hidden',
      // Opaque, not glass: frosted glass over a live map has no stable ground,
      // so its contrast changes as the driver pans. See DriverToast.
      backgroundColor: colors.surfaceContainerHigh,
      borderWidth: StyleSheet.hairlineWidth,
      // Tinted toward the app's own deep navy rather than pure black, so the
      // shadow belongs to this palette instead of greying the map under it.
      shadowColor: colors.backgroundDeep,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.5,
      shadowRadius: 18,
      elevation: 12,
    },
    toneRail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
    inner: {
      paddingLeft: spacing.base + 4,
      paddingRight: spacing.md,
      paddingTop: spacing.md,
      paddingBottom: spacing.md + 2,
      gap: spacing.md,
    },
    topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
    iconWrap: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
    halo: { position: 'absolute', width: 30, height: 30, borderRadius: 15 },
    iconCore: {
      width: 28,
      height: 28,
      // Concentric with the 28pt square it sits in; see the radius note in the
      // interface-polish checklist.
      borderRadius: 9,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    body: { flex: 1, gap: 3 },
    title: {
      fontFamily: fonts.bold,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.32),
      letterSpacing: -0.1,
      color: colors.onSurface,
    },
    detail: {
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodySmall,
      lineHeight: 17,
      color: colors.onSurfaceVariant,
    },
    close: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
    cta: {
      alignSelf: 'stretch',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      minHeight: 46,
      paddingHorizontal: spacing.base,
      borderRadius: radii.full,
    },
    ctaText: { fontFamily: fonts.bold, fontSize: fontSizes.bodyMedium, letterSpacing: 0.1 },
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

export default DriverAlertBanner;
