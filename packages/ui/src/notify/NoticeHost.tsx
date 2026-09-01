import React, { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, radii, spacing, springs, withOpacity, type ColorTokens } from '@eyego/config';

import { Text } from '../Text';
/**
 * OUR Pressable, NOT React Native's.
 *
 * The notice's action button was written `style={({ pressed }) => [...]}`
 * against RN's Pressable, and NativeWind's css-interop — registered app-wide in
 * both apps — silently discards a FUNCTION style. So `styles.action` never
 * applied: no pill, no border, no tint, no 36 pt target. The one verb on the
 * most important surface in either app rendered as a bare word floating beside
 * the message. This is the same defect that made the driver's Pass button and
 * the Dispatch-blocked CTA look unstyled; it is fixed the same way, and the
 * rule is absolute — a function style is only ever safe on this Pressable.
 */
import { Pressable } from '../Pressable';
import { useThemedColors } from '../ColorsContext';
import {
  dismissNotice,
  noticeHaptic,
  subscribeNotices,
  type Notice,
  type NoticeTone,
} from './notice';

/**
 * THE ONE SURFACE THAT DRAWS EVERY `notify()`.
 *
 * Mounted once at each app's root layout, so it covers every screen in both
 * apps. That last part is the point: the driver's offline pill used to live
 * inlined in `(tabs)/home.tsx`, which meant going offline on the Earnings tab
 * told you nothing at all. A status surface that only exists on one screen is
 * not a status surface.
 *
 * ── WHY IT IS SHARED AND NOT PER-APP ────────────────────────────────────────
 * Both apps had a toast component and both were fine. What they did not have
 * was the same one, which meant a rider and a driver were told about the same
 * class of event in two different visual languages, and a fix to one never
 * reached the other. It reads its palette from `ColorsContext`, so the rider
 * gets the rider's colours and the driver gets the driver's blue without this
 * file knowing either exists.
 *
 * ── THE MATERIAL ────────────────────────────────────────────────────────────
 * Opaque, not glass. Both apps show this over a live map more often than not,
 * and frosted glass over moving map tiles has no stable ground: text legible
 * over a park is not legible over a motorway two seconds later. Same reasoning
 * as `DriverToast` and `DriverAlertBanner`, which is why all three now look
 * like one family.
 *
 * One accent rail carries the tone. It used to be spread across a ring, a wash,
 * an icon chip and a rail — four elements saying one thing.
 */

const TONE_ICON: Record<NoticeTone, React.ComponentProps<typeof Ionicons>['name']> = {
  success: 'checkmark-circle',
  error: 'alert-circle',
  warning: 'warning',
  info: 'information-circle',
};

function toneColor(tone: NoticeTone, colors: ColorTokens, isNetwork: boolean): string {
  // "No signal" is not the same class of event as "the server refused you".
  // Giving both the same red is how people learn to ignore red.
  if (isNetwork) return '#94A3B8';
  switch (tone) {
    case 'success':
      return colors.statusSuccess;
    case 'error':
      return colors.error;
    case 'warning':
      return colors.statusWarning;
    default:
      return colors.onSurfaceVariant;
  }
}

export function NoticeHost() {
  const colors = useThemedColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();

  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => subscribeNotices(setNotice), []);

  const rise = useSharedValue(0);
  const drag = useSharedValue(0);
  const breath = useSharedValue(0);

  useEffect(() => {
    if (!notice) {
      rise.value = withTiming(0, { duration: 150, easing: Easing.in(Easing.quad) });
      return;
    }
    drag.value = 0;
    // Enter on a spring, leave shorter and quieter — the asymmetry is what
    // makes an arrival read as arrival rather than as a jump.
    rise.value = reducedMotion ? 1 : withSpring(1, springs.standard);
    noticeHaptic(notice.tone);
    return () => cancelAnimation(rise);
    // `notice.id` is the "this is a new one" signal; the object identity alone
    // would re-run on the in-place offline count update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice?.id, reducedMotion]);

  // Only the persistent network notice breathes. A pulse on a toast that is
  // leaving in three seconds is noise; a pulse on a state the user is stuck in
  // is what makes a glance land.
  const shouldBreathe = !!notice?.isNetwork && !reducedMotion;
  useEffect(() => {
    if (!shouldBreathe) return;
    breath.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(breath);
  }, [shouldBreathe, breath]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: rise.value,
    transform: [{ translateY: (1 - rise.value) * -24 + drag.value }],
  }));
  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.14 + breath.value * 0.36,
    transform: [{ scale: 1 + breath.value * 0.4 }],
  }));

  /**
   * An upward flick puts it away — the direction it arrived from, which every
   * dismissable surface in both apps follows.
   *
   * `.runOnJS(true)`: a gesture callback is an auto-worklet, and calling a plain
   * JS closure from one is the SIGABRT this codebase has already paid for once.
   * See MorphBackSwipeDetector.
   */
  const pan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetY([-8, 8])
    .onUpdate((e) => {
      drag.value = Math.min(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY < -28 || e.velocityY < -600) {
        drag.value = withTiming(-140, { duration: 140 });
        rise.value = withTiming(0, { duration: 140 });
        dismissNotice();
      } else {
        drag.value = withSpring(0, springs.standard);
      }
    });

  if (!notice) return null;

  const isNetwork = !!notice.isNetwork;
  const accent = toneColor(notice.tone, colors, isNetwork);

  return (
    <View style={[styles.container, { top: insets.top + 8 }]} pointerEvents="box-none">
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[styles.card, { borderColor: withOpacity(accent, 0.3) }, cardStyle]}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          accessibilityLabel={notice.title ? `${notice.title}. ${notice.message}` : notice.message}
        >
          <View style={[styles.toneRail, { backgroundColor: accent }]} pointerEvents="none" />

          <View style={styles.row}>
            <View style={styles.iconWrap}>
              {isNetwork && (
                <Animated.View style={[styles.halo, { backgroundColor: accent }, haloStyle]} />
              )}
              <View
                style={[
                  styles.iconCore,
                  { backgroundColor: withOpacity(accent, 0.16), borderColor: withOpacity(accent, 0.42) },
                ]}
              >
                <Ionicons
                  name={isNetwork ? 'cloud-offline' : TONE_ICON[notice.tone]}
                  size={15}
                  color={accent}
                />
              </View>
            </View>

            <View style={styles.body}>
              {!!notice.title && (
                <Text style={[styles.title, { color: accent }]} numberOfLines={1}>
                  {notice.title}
                </Text>
              )}
              <Text style={styles.message} numberOfLines={3}>
                {notice.message}
              </Text>
            </View>

            {/* The one verb, when there is one. See `Notice.action`. */}
            {notice.action && (
              <Pressable
                onPress={() => {
                  const run = notice.action?.onPress;
                  dismissNotice();
                  run?.();
                }}
                accessibilityRole="button"
                accessibilityLabel={notice.action.label}
                style={({ pressed }: { pressed: boolean }) => [
                  styles.action,
                  { borderColor: withOpacity(accent, 0.55), backgroundColor: withOpacity(accent, 0.14) },
                  pressed && { opacity: 0.75 },
                ]}
              >
                <Text style={[styles.actionText, { color: accent }]} numberOfLines={1}>
                  {notice.action.label}
                </Text>
              </Pressable>
            )}

            {/* The persistent network notice has no close: dismissing a fact
                does not change it, and an X that hides the reason nothing works
                is a worse screen than one that keeps saying so. */}
            {!isNetwork && !notice.action && (
              // 44 pt target for a 15 pt glyph via hitSlop, rather than a bigger
              // visual that would compete with the message.
              <Pressable
                onPress={dismissNotice}
                hitSlop={14}
                accessibilityRole="button"
                accessibilityLabel="Dismiss"
                style={styles.close}
              >
                <Ionicons name="close" size={15} color={colors.onSurfaceVariant} />
              </Pressable>
            )}
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const makeStyles = (colors: ColorTokens) =>
  StyleSheet.create({
    container: {
      position: 'absolute',
      left: spacing.base,
      right: spacing.base,
      // Above every sheet, panel and map control in both apps, and above the
      // morph overlay — a notice the user cannot see is not a notice.
      zIndex: 10000,
      elevation: 32,
    },
    card: {
      borderRadius: radii['2xl'],
      overflow: 'hidden',
      // Opaque. See the header: glass over a live map has no stable ground.
      backgroundColor: colors.surfaceContainerHigh,
      borderWidth: StyleSheet.hairlineWidth,
      // Tinted toward the app's own deep ground rather than pure black, so the
      // shadow belongs to this palette instead of greying whatever is under it.
      shadowColor: colors.backgroundDeep,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: Platform.OS === 'ios' ? 0.5 : 0,
      shadowRadius: 20,
      elevation: 14,
    },
    /** The tone, as one 4 pt bar down the leading edge. */
    toneRail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingLeft: spacing.base + 4,
      paddingRight: spacing.md,
      paddingVertical: spacing.md,
    },
    iconWrap: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
    halo: { position: 'absolute', width: 30, height: 30, borderRadius: 15 },
    iconCore: {
      width: 28,
      height: 28,
      // Concentric with the 28 pt square it sits in.
      borderRadius: 9,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    body: { flex: 1, gap: 2 },
    title: { fontFamily: fonts.labelCaps, fontSize: 9.5, lineHeight: 12, letterSpacing: 1.1 },
    message: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.35),
      color: colors.onSurface,
    },
    close: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
    action: {
      // 36 pt tall inside a 44 pt row — a control a driver reaches for without
      // looking has to be findable by thumb, not just visible.
      minHeight: 36,
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
      borderRadius: radii.full,
      borderWidth: 1,
    },
    actionText: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodySmall, letterSpacing: 0.1 },
  });

export default NoticeHost;
