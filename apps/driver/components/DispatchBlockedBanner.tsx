import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text } from '@eyego/ui';

import { useColors, type DriverColors } from '../utils/useColors';

/**
 * "YOU ARE NOT RECEIVING TRIP REQUESTS" — said loudly enough to act on.
 *
 * BUGFIX — "the driver homepage toast notification that says why the driver
 * isn't receiving updates is very faint and bland."
 *
 * It was a 9%-alpha amber wash behind two lines of `caption` text on a dark
 * map. Correct information, invisible delivery: this is the single most
 * expensive condition in the app — the driver is sitting there believing they
 * are working while dispatch cannot see them — and it looked less urgent than
 * the "no internet" chip above it.
 *
 * Three changes, in order of how much they matter:
 *
 *   1. It is now OPAQUE, with a warm gradient and a real border, so it reads as
 *      a state the app is in rather than a hint it is offering.
 *   2. Every reason ends in an ACTION. The server already names the exact
 *      condition (`explainIneligible`), and almost all of them have a one-tap
 *      fix — resume requests, toggle online, open your documents, finish that
 *      trip. A banner that names a problem and offers no verb makes the driver
 *      guess.
 *   3. The indicator BREATHES. A static icon on a screen the driver is not
 *      looking at is a static icon; a slow pulse is what makes a glance land.
 *      One shared value, one repeat — not a per-frame JS loop.
 */

export type DispatchBlockAction = {
  label: string;
  onPress: () => void;
};

/** What the reason code means, in the driver's language, plus what to do. */
export function describeDispatchBlock(reason: string | null | undefined): {
  headline: string;
  detail: string;
  /** Which action the caller should wire, or null when there is nothing to tap. */
  action: 'DOCUMENTS' | 'GO_ONLINE' | 'RESUME' | 'ACTIVE_TRIP' | 'SIGN_OUT' | 'RETRY';
  severity: 'warn' | 'error';
} {
  const code = reason ?? '';
  if (code.startsWith('NOT_ACTIVE')) {
    return {
      headline: 'Your account is not approved yet',
      detail: 'Dispatch can only offer trips to approved drivers. Finish your documents and we will review them.',
      action: 'DOCUMENTS',
      severity: 'error',
    };
  }
  if (code === 'OFFLINE') {
    return {
      headline: 'The server still has you offline',
      detail: 'Your phone thinks you are online but the dispatch pool disagrees. Toggle Online again to re-register.',
      action: 'GO_ONLINE',
      severity: 'error',
    };
  }
  if (code === 'REQUESTS_PAUSED') {
    return {
      headline: 'Requests are paused',
      detail: 'You paused incoming offers. Nothing will reach you until you resume them.',
      action: 'RESUME',
      severity: 'warn',
    };
  }
  if (code.startsWith('BUSY')) {
    return {
      headline: 'You still have an unfinished trip',
      detail: 'One trip at a time. Complete or cancel the one you are on and offers resume immediately.',
      action: 'ACTIVE_TRIP',
      severity: 'warn',
    };
  }
  if (code === 'NO_SUCH_DRIVER') {
    return {
      headline: 'We cannot find your driver record',
      detail: 'Sign out and back in. If it happens again, contact support — do not keep waiting for offers.',
      action: 'SIGN_OUT',
      severity: 'error',
    };
  }
  return {
    headline: 'Dispatch cannot see you',
    detail: 'You are online but not in the supply pool — usually a dropped connection or a stale GPS fix. Check now to re-register.',
    action: 'RETRY',
    severity: 'error',
  };
}

export interface DispatchBlockedBannerProps {
  reason: string | null | undefined;
  /** Absolute top offset, stacked under whatever banners are already showing. */
  top: number;
  action?: DispatchBlockAction | null;
  busy?: boolean;
}

export function DispatchBlockedBanner({ reason, top, action, busy = false }: DispatchBlockedBannerProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const meaning = useMemo(() => describeDispatchBlock(reason), [reason]);

  const isError = meaning.severity === 'error';
  const tint = isError ? '#F87171' : '#F59E0B';

  // A slow breath, on the UI thread. Two seconds is long enough not to nag and
  // short enough that a glance catches it mid-cycle.
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 1000, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(pulse);
  }, [pulse]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.18 + pulse.value * 0.42,
    transform: [{ scale: 1 + pulse.value * 0.45 }],
  }));

  // A one-off entrance: slides down from under the header rather than popping.
  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) });
  }, [enter]);
  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * -10 }],
  }));

  return (
    <Animated.View
      style={[styles.wrap, { top, borderColor: tint + '99' }, enterStyle]}
      accessibilityRole="alert"
      accessibilityLabel={`${meaning.headline}. ${meaning.detail}`}
    >
      <LinearGradient
        colors={[tint + '2E', colors.surfaceCard, colors.surfaceCard]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* A bright rule down the leading edge — the fastest possible read of
          "this one is different from the chips above it". */}
      <View style={[styles.edge, { backgroundColor: tint }]} />

      <View style={styles.iconWrap}>
        <Animated.View style={[styles.halo, { backgroundColor: tint }, haloStyle]} />
        <View style={[styles.iconCore, { backgroundColor: tint + '2A', borderColor: tint + '77' }]}>
          <Ionicons name={isError ? 'alert' : 'pause'} size={15} color={tint} />
        </View>
      </View>

      <View style={styles.body}>
        <Text style={[styles.headline, { color: colors.onSurface }]} numberOfLines={2}>
          {meaning.headline}
        </Text>
        <Text style={[styles.detail, { color: colors.onSurfaceVariant }]} numberOfLines={3}>
          {meaning.detail}
        </Text>

        {action ? (
          <Pressable
            onPress={action.onPress}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            style={({ pressed }) => [
              styles.cta,
              { backgroundColor: tint, opacity: busy ? 0.6 : pressed ? 0.86 : 1 },
            ]}
          >
            <Text style={[styles.ctaText, { color: '#0A1220' }]}>
              {busy ? 'Working…' : action.label}
            </Text>
            <Ionicons name="arrow-forward" size={13} color="#0A1220" />
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    wrap: {
      position: 'absolute',
      left: spacing['2xl'],
      right: spacing['2xl'],
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      paddingLeft: spacing.base + 3,
      paddingRight: spacing.base,
      paddingVertical: spacing.md,
      borderRadius: radii.xl,
      borderWidth: 1,
      overflow: 'hidden',
      // Opaque. The old 9%-alpha wash sat over a moving map and disappeared
      // whenever a pale road ran under it.
      backgroundColor: colors.surfaceCard,
      shadowColor: '#000',
      shadowOpacity: 0.35,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
    edge: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
    iconWrap: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
    halo: { position: 'absolute', width: 30, height: 30, borderRadius: 15 },
    iconCore: {
      width: 28, height: 28, borderRadius: 14, borderWidth: 1,
      alignItems: 'center', justifyContent: 'center',
    },
    body: { flex: 1, gap: 3 },
    headline: {
      fontFamily: fonts.bold,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.35),
      letterSpacing: -0.1,
    },
    detail: { fontFamily: fonts.regular, fontSize: fontSizes.bodySmall, lineHeight: 17 },
    cta: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      marginTop: spacing.sm,
      paddingHorizontal: spacing.base,
      paddingVertical: 7,
      borderRadius: radii.full,
    },
    ctaText: { fontFamily: fonts.bold, fontSize: fontSizes.bodySmall, letterSpacing: 0.1 },
  });

export default DispatchBlockedBanner;
