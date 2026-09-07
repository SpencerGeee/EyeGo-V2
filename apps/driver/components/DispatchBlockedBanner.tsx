import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
/**
 * `Pressable` FROM @eyego/ui — see the note in DispatchOfferCard for the rule.
 *
 * BUGFIX ("the driver homepage banner that says Dispatch cannot see you is
 * STILL unstyled — the rest of the banners are styled").
 *
 * The banner's card was fine; its CTA was not, and the CTA is the whole point
 * of this banner. It was written `style={({ pressed }) => [styles.cta, {…}]}`
 * against React Native's Pressable, whose registered css-interop wrapper drops
 * a function style entirely — taking `styles.cta` AND the `backgroundColor`
 * with it. What rendered was dark label text and an arrow, unstyled, directly
 * on the card: no pill, no fill, no 46 pt target. Every previous pass at this
 * banner tuned the styles that were being thrown away.
 */
import { Text, GlassSurface, GradientGlowBorder, Pressable, useLoopsActive } from '@eyego/ui';

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
  /**
   * Absolute top offset. OMIT IT to render in normal flow.
   *
   * The caller used to compute this by hand —
   * `insets.top + 64 + (onlineError ? 48 : 0) + (isOffline ? 40 : 0) + …` —
   * one term per banner that might be above this one, with a guessed height for
   * each. Every guess was wrong for a two-line variant, which is how banners
   * ended up overlapping. The home screen now stacks these in a column with a
   * gap and lets layout do the arithmetic, so this prop survives only for any
   * caller that genuinely needs to pin one.
   */
  top?: number;
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
  // NOT decorative: this banner is telling a driver why they are getting no
  // work. It must not go silent for the people most likely to miss it.
  const loopsActive = useLoopsActive({ decorative: false });
  useEffect(() => {
    // This banner lives on the driver's home tab, which stays mounted behind
    // every other tab for the whole shift. See useLoopsActive.
    if (!loopsActive) {
      cancelAnimation(pulse);
      return;
    }
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 1000, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(pulse);
  }, [pulse, loopsActive]);

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
    /**
     * ── THE BANNER, REBUILT ────────────────────────────────────────────────
     *
     * "The buttons it shows underneath — like 'you have an unfinished ride,
     * click to open' — the click-to-open is not styled correctly and can barely
     * be seen. Use the GlassCard component as well as a bit of the GlowBorder."
     *
     * Two real problems behind that:
     *
     *  1. THE CTA WAS FIGHTING ITS OWN BACKGROUND. It was a solid `tint` pill —
     *     amber — sitting inside a card whose entire fill was a gradient of the
     *     SAME amber, with near-black text on it. That is a button competing
     *     with its own surface for contrast, and it is why a real, working
     *     control read as decoration.
     *  2. IT WAS THE ONE ELEVATED SURFACE IN THIS APP NOT BUILT FROM THE
     *     SYSTEM. Every other card here is a `GlassSurface` inside a
     *     `GradientGlowBorder`; this hand-rolled a LinearGradient, a 1px border
     *     and a box shadow, so it did not belong to the same product.
     *
     * So: the ring carries the severity, the glass carries the surface, and the
     * CTA is a high-contrast light pill with dark text — which reads at a glance
     * against a dark card in a way a tinted pill on a tinted card never can. The
     * tint survives where it belongs: the leading rule, the icon, and a faint
     * 8% wash that colours the surface without eating the button's contrast.
     */
    <Animated.View style={[top == null ? null : styles.wrap, top == null ? null : { top }, enterStyle]}>
      <GradientGlowBorder
        palette={isError ? 'default' : 'gold'}
        fillColor={colors.surfaceCard}
        borderRadius={radii.xl}
        thickness="thin"
        glow
        glowIntensity={isError ? 0.9 : 0.65}
        maxGlowRadius={isError ? 22 : 16}
      >
      <View
        style={styles.card}
        accessibilityRole="alert"
        accessibilityLabel={`${meaning.headline}. ${meaning.detail}`}
      >
      <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.xl - 2} intensity="high" />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: tint + '14' }]} />
      {/* A bright rule down the leading edge — the fastest possible read of
          "this one is different from the chips above it". */}
      <View style={[styles.edge, { backgroundColor: tint }]} />

      <View style={styles.row}>
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
      </View>
      </View>

        {/*
          THE ACTION, FULL WIDTH AND UNMISSABLE.

          Moved out of the text column: inset under a three-line paragraph it was
          about 150pt wide and read as a footnote, which is the whole of "it can
          barely be seen". A blocked driver is earning nothing, so the one thing
          that unblocks them is the widest element on the card — and 46pt tall,
          which the old 7pt-padded pill was not.
        */}
        {action ? (
          <Pressable
            onPress={action.onPress}
            disabled={busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            accessibilityLabel={action.label}
            style={({ pressed }) => [
              styles.cta,
              {
                backgroundColor: colors.onSurface,
                opacity: busy ? 0.55 : pressed ? 0.88 : 1,
                transform: [{ scale: pressed ? 0.985 : 1 }],
              },
            ]}
          >
            <Text style={[styles.ctaText, { color: colors.background }]}>
              {busy ? 'Working…' : action.label}
            </Text>
            <Ionicons name="arrow-forward" size={14} color={colors.background} />
          </Pressable>
        ) : null}
      </View>
      </GradientGlowBorder>
    </Animated.View>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    // Positioning only. The surface — fill, rim, glow — now comes from the ring
    // and the glass inside it, so this holds nothing that paints.
    wrap: {
      position: 'absolute',
      left: spacing['2xl'],
      right: spacing['2xl'],
    },
    card: {
      gap: spacing.md,
      paddingLeft: spacing.base + 3,
      paddingRight: spacing.base,
      paddingVertical: spacing.base,
      borderRadius: radii.xl - 2,
      overflow: 'hidden',
      // Opaque under the glass. The old 9%-alpha wash sat over a moving map and
      // disappeared whenever a pale road ran under it.
      backgroundColor: colors.surfaceCard,
    },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
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
      // Full width and 46pt tall — see the render comment. The old pill was
      // `alignSelf: 'flex-start'` at 7pt vertical padding, which is both under
      // the 44pt touch minimum (§2) and visually a footnote.
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
  });

export default DispatchBlockedBanner;
