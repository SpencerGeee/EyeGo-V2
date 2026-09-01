import React, { useEffect, useMemo } from 'react';
import { View, StyleSheet, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { fonts, fontSizes, radii, spacing, springs, withOpacity } from '@eyego/config';
// Pressable from @eyego/ui, never react-native: NativeWind's css-interop
// registers RN's and DROPS a function style, taking the whole declaration with
// it. This sheet is what tells a rider their ride died and offers them another
// car — its buttons rendering unstyled is not a cosmetic problem.
import { Text, goDeeper, Pressable } from '@eyego/ui';

import { useColors, type Colors } from '../utils/useColors';
import { useRideEnded, shouldAnnounce, type RideEndedReason } from '../stores/rideEnded.store';

/**
 * WHAT THE RIDER SEES WHEN THEIR RIDE IS TAKEN AWAY FROM THEM.
 *
 * FEATURE ("if the driver marks as no-show, when the rider is redirected to the
 * homepage they should be given a notification or popup like 'the driver
 * cancelled' or something. It needs to be very aesthetic").
 *
 * ── WHY A SHEET AND NOT A TOAST ─────────────────────────────────────────────
 * A toast is for something the user already knows they did. This is news, it is
 * bad, and it is about money — three things a four-second banner over a screen
 * that is mid-teardown cannot carry. See `rideEnded.store` for why the existing
 * banner was never actually read.
 *
 * ── THE COMPOSITION ─────────────────────────────────────────────────────────
 * One idea per layer, and the layers arrive in the order the rider reads them:
 *
 *   THE SCRIM        A real blur, not a flat black wash. Home stays legible
 *                    behind it, so this reads as something that happened TO the
 *                    app rather than as a different screen.
 *   THE MARK         A ring that draws itself once and a glyph that settles into
 *                    it. Motion here is doing one job — carrying the eye to the
 *                    single fact — so it happens once and stops. Nothing on this
 *                    sheet loops: an animation still running while somebody
 *                    reads bad news is the app fidgeting.
 *   THE HEADLINE     What happened, in the rider's words. Never "NO_SHOW".
 *   THE MONEY        Its own line, in its own colour, because it is the question
 *                    the rider is actually asking and a sentence that buries it
 *                    mid-paragraph will not be read.
 *   THE WAY OUT      One primary action, going where they were already going.
 *
 * Reduced motion collapses every entrance to a fade and drops the ring draw —
 * this is a surface people meet at a bad moment and it must not move for anyone
 * who has asked the system for less of that.
 */

const COPY: Record<
  RideEndedReason,
  { title: string; body: string; icon: keyof typeof Ionicons.glyphMap; cta: string }
> = {
  DRIVER_CANCELLED: {
    title: 'Your driver cancelled',
    body: 'They are no longer coming. Nothing else about your trip has changed.',
    icon: 'car-outline',
    cta: 'Find another driver',
  },
  DRIVER_NO_SHOW: {
    title: 'Your driver cancelled',
    body: 'They marked the pickup as a no-show and released the ride.',
    icon: 'car-outline',
    cta: 'Find another driver',
  },
  RIDER_CANCELLED: {
    title: 'Ride cancelled',
    body: 'Your ride has been cancelled.',
    icon: 'close-circle-outline',
    cta: 'Book a ride',
  },
  NO_DRIVERS: {
    title: 'No drivers free right now',
    body: 'We asked everyone nearby and nobody could take it. This usually clears in a few minutes.',
    icon: 'time-outline',
    cta: 'Try again',
  },
  EXPIRED: {
    title: 'Your request timed out',
    body: 'Nobody accepted it in time, so we stopped searching rather than leave you waiting.',
    icon: 'hourglass-outline',
    cta: 'Try again',
  },
};

export function RideEndedSheet() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reducedMotion = useReducedMotion();

  const notice = useRideEnded((s) => s.notice);
  const clear = useRideEnded((s) => s.clear);

  const open = !!notice && shouldAnnounce(notice.reason);

  const rise = useSharedValue(0);
  const ring = useSharedValue(0);
  const glyph = useSharedValue(0);

  useEffect(() => {
    if (!open) {
      rise.value = 0;
      ring.value = 0;
      glyph.value = 0;
      return;
    }
    if (reducedMotion) {
      rise.value = 1;
      ring.value = 1;
      glyph.value = 1;
      return;
    }
    rise.value = withSpring(1, springs.emphasized);
    // Draws once, then holds. See the header: nothing here loops.
    ring.value = withTiming(1, { duration: 720, easing: Easing.out(Easing.cubic) });
    glyph.value = withDelay(
      220,
      withSequence(
        withSpring(1.06, springs.standard),
        withSpring(1, springs.standard),
      ),
    );
    return () => {
      cancelAnimation(rise);
      cancelAnimation(ring);
      cancelAnimation(glyph);
    };
  }, [open, reducedMotion, rise, ring, glyph]);

  const sheetStyle = useAnimatedStyle(() => ({
    opacity: rise.value,
    transform: [{ translateY: (1 - rise.value) * 34 }],
  }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: rise.value }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.15 + ring.value * 0.45,
    transform: [{ scale: 0.86 + ring.value * 0.14 }],
  }));
  const glyphStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, glyph.value * 1.4),
    transform: [{ scale: 0.9 + glyph.value * 0.1 }],
  }));

  if (!open || !notice) return null;

  const copy = COPY[notice.reason];
  // Cancelled-by-driver is the only tone that is a person's decision; the rest
  // are the system running out of options, and shouting at the rider about a
  // timeout in red is punishing them for something nobody did.
  const accent =
    notice.reason === 'DRIVER_CANCELLED' || notice.reason === 'DRIVER_NO_SHOW'
      ? colors.error
      : colors.primary;

  const dismiss = () => {
    void Haptics.selectionAsync().catch(() => {});
    clear();
  };

  const rebook = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    clear();
    // Straight back into the flow at the search step. The rider's destination
    // is already in the ride store when there is one, so this is one tap from
    // "my ride vanished" to "somebody is coming".
    goDeeper('/trip?stage=search' as never);
  };

  return (
    <Modal transparent visible animationType="none" onRequestClose={dismiss} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, scrimStyle]}>
        {/* A blur, so Home is still there behind the news. */}
        <BlurView intensity={26} tint="dark" style={StyleSheet.absoluteFill} />
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={dismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
      </Animated.View>

      <View style={styles.dock} pointerEvents="box-none">
        <Animated.View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }, sheetStyle]}>
          <View style={styles.grabber} />

          <View style={styles.markWrap}>
            <Animated.View
              style={[styles.markRing, { borderColor: accent }, ringStyle]}
              pointerEvents="none"
            />
            <Animated.View style={[styles.markCore, { backgroundColor: withOpacity(accent, 0.14) }, glyphStyle]}>
              <Ionicons name={copy.icon} size={26} color={accent} />
            </Animated.View>
          </View>

          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.body}>{copy.body}</Text>

          {/*
            THE MONEY, ON ITS OWN LINE.

            A refund promised inside a paragraph is a refund the rider will open
            a support ticket about. And a CASH rider must never be told money is
            coming back — `refunded` is read off the server's own payload, not
            inferred here.
          */}
          <View style={[styles.moneyRow, { borderColor: colors.outline }]}>
            <Ionicons
              name={notice.refunded ? 'card-outline' : 'shield-checkmark-outline'}
              size={16}
              color={notice.refunded ? colors.statusSuccess : colors.onSurfaceVariant}
            />
            <Text style={styles.moneyText}>
              {notice.refunded
                ? 'You have been refunded in full. It lands back on your original payment method.'
                : 'You have not been charged for this trip.'}
            </Text>
          </View>

          {notice.destinationLabel ? (
            <View style={styles.destRow}>
              <Ionicons name="location-outline" size={14} color={colors.onSurfaceVariant} />
              <Text variant="caption" color={colors.onSurfaceVariant} numberOfLines={1} style={{ flex: 1 }}>
                {notice.destinationLabel}
              </Text>
            </View>
          ) : null}

          <Pressable
            onPress={rebook}
            accessibilityRole="button"
            accessibilityLabel={copy.cta}
            style={({ pressed }) => [
              styles.primary,
              { backgroundColor: colors.primary, transform: [{ scale: pressed ? 0.985 : 1 }] },
            ]}
          >
            <Text style={[styles.primaryText, { color: colors.onPrimary }]}>{copy.cta}</Text>
            <Ionicons name="arrow-forward" size={16} color={colors.onPrimary} />
          </Pressable>

          <Pressable
            onPress={dismiss}
            accessibilityRole="button"
            accessibilityLabel="Not now"
            style={styles.secondary}
          >
            <Text style={[styles.secondaryText, { color: colors.onSurfaceVariant }]}>Not now</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    dock: { flex: 1, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.surfaceContainerHigh,
      borderTopLeftRadius: radii['4xl'],
      borderTopRightRadius: radii['4xl'],
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: withOpacity(colors.onSurface, 0.12),
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      alignItems: 'center',
      gap: spacing.md,
    },
    grabber: {
      width: 38,
      height: 4,
      borderRadius: 2,
      backgroundColor: withOpacity(colors.onSurface, 0.18),
      marginBottom: spacing.lg,
    },
    markWrap: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center' },
    markRing: { position: 'absolute', width: 84, height: 84, borderRadius: 42, borderWidth: 1.5 },
    markCore: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
    title: {
      fontFamily: fonts.displayBold,
      fontSize: 23,
      lineHeight: 29,
      letterSpacing: -0.4,
      color: colors.onSurface,
      textAlign: 'center',
      marginTop: spacing.xs,
    },
    body: {
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodyMedium,
      lineHeight: 21,
      color: colors.onSurfaceVariant,
      textAlign: 'center',
      // ~48 characters at this size. Centred copy past that gets hard to track
      // back to the start of the next line.
      maxWidth: 320,
    },
    moneyRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      alignSelf: 'stretch',
      marginTop: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderRadius: radii.lg,
      borderWidth: StyleSheet.hairlineWidth,
      backgroundColor: withOpacity(colors.onSurface, 0.04),
    },
    moneyText: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodySmall,
      lineHeight: 18,
      color: colors.onSurface,
    },
    destRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'stretch' },
    primary: {
      alignSelf: 'stretch',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      minHeight: 54,
      borderRadius: radii.full,
      marginTop: spacing.sm,
    },
    primaryText: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyLarge },
    secondary: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.xl },
    secondaryText: { fontFamily: fonts.medium, fontSize: fontSizes.bodyMedium },
  });

export default RideEndedSheet;
