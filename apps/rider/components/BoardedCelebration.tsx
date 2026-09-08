import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withDelay,
  cancelAnimation,
  Easing,
  runOnJS,
  useReducedMotion,
} from 'react-native-reanimated';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, GlassSurface } from '@eyego/ui';
import { useColors, Colors } from '../utils/useColors';
import { useTripStore } from '../stores/trip.store';

/**
 * "YOU'RE ABOARD."
 *
 * FEATURE ("on the driver app the status was 'filling up', and on the rider app
 * I chose 'mark as boarded' and boarded — nothing changed on the rider app. You
 * need to create a component for this particular thing so the rider app can
 * accurately reflect an animation or something for the rider to know they've
 * been marked as boarded").
 *
 * The plumbing half of that report is fixed in `tripChannel.applyBookingScopedEvent`
 * — the rider's `booking.status` now actually reaches `BOARDED`. This is the
 * half the rider can see.
 *
 * WHY A ONE-SHOT OVERLAY AND NOT A PANEL ROW. Boarding is a TRANSITION, not a
 * state: the useful information is the instant it changes, and five seconds
 * later "you are in the vehicle" is something the rider can establish by looking
 * out of the window. A permanent badge would be read once and then become
 * furniture; a row that silently swaps its text is exactly the change the
 * reporter did not notice. So this earns the delight budget precisely because it
 * happens once per ride and the rider caused it.
 *
 * MOTION. Ring first (the seat is claimed), then the tick draws into it, then
 * the words. Nothing scales from zero — the ring starts at 0.86 with the label
 * already faintly present, because objects do not appear out of nothing. It
 * dismisses itself; a celebration that has to be dismissed is a dialog.
 */

const VISIBLE_MS = 2600;

export function BoardedCelebration() {
  const colors = useColors();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);
  const reduced = useReducedMotion();

  const bookingStatus = useTripStore((s) => (s.snapshot as any)?.booking?.status ?? null);
  const seatNumber = useTripStore((s) => (s.snapshot as any)?.booking?.seatNumber ?? null);

  /**
   * Fire on the EDGE, not on the state.
   *
   * The status is `BOARDED` for the whole rest of the ride, so rendering off it
   * directly would put this back on screen after every navigation, every
   * reconnect and every replayed event. The ref holds what we have already
   * celebrated; a cold start mid-ride therefore shows nothing, which is correct
   * — the rider boarded before this screen existed.
   */
  const celebrated = useRef<string | null>(null);
  const [shown, setShown] = useState(false);

  const progress = useSharedValue(0);
  const tick = useSharedValue(0);

  useEffect(() => {
    if (bookingStatus !== 'BOARDED') {
      // A different ride: allow the next boarding to celebrate.
      if (bookingStatus == null) celebrated.current = null;
      return;
    }
    const key = `${seatNumber ?? 'x'}`;
    if (celebrated.current === key) return;
    celebrated.current = key;
    setShown(true);
  }, [bookingStatus, seatNumber]);

  useEffect(() => {
    if (!shown) return;

    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    if (reduced) {
      // Reduced motion means fewer and gentler, not absent: the fact still
      // needs announcing, so opacity carries it and nothing translates.
      progress.value = withTiming(1, { duration: 180 });
      tick.value = withTiming(1, { duration: 180 });
    } else {
      progress.value = withSpring(1, { duration: 420, dampingRatio: 0.72 });
      tick.value = withDelay(140, withTiming(1, { duration: 260, easing: EASE_OUT }));
    }

    const t = setTimeout(() => {
      // Exit is shorter and quieter than the entrance — see the skill note; a
      // celebration that lingers on the way out reads as a stuck view.
      progress.value = withTiming(0, { duration: 180, easing: EASE_OUT }, (done) => {
        'worklet';
        if (done) runOnJS(setShown)(false);
      });
      tick.value = withTiming(0, { duration: 140 });
    }, VISIBLE_MS);

    return () => {
      clearTimeout(t);
      cancelAnimation(progress);
      cancelAnimation(tick);
    };
  }, [shown, reduced, progress, tick]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: reduced
      ? []
      : [{ scale: 0.86 + progress.value * 0.14 }, { translateY: (1 - progress.value) * 10 }],
  }));

  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.35 + tick.value * 0.65,
    transform: reduced ? [] : [{ scale: 0.9 + tick.value * 0.1 }],
  }));

  if (!shown) return null;

  return (
    // `box-none` so the map and the sheet underneath keep every gesture — this
    // is an announcement, not a modal, and it must never eat a touch.
    <View style={styles.host} pointerEvents="box-none">
      <Animated.View style={[styles.card, cardStyle]} pointerEvents="none">
        <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii['2xl']} intensity="high" />
        <Animated.View style={[styles.ring, ringStyle]}>
          <Ionicons name="checkmark" size={22} color={colors.primary} />
        </Animated.View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>You&apos;re on board</Text>
          <Text style={styles.subtitle}>
            {seatNumber != null
              ? `Seat ${seatNumber} confirmed with your driver.`
              : 'Your driver has confirmed your seat.'}
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}

/** Strong ease-out. Reanimated's built-ins are as weak as CSS's. */
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    host: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'flex-start',
      paddingTop: spacing['5xl'],
      paddingHorizontal: spacing.lg,
    },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.base,
      paddingHorizontal: spacing.lg,
      borderRadius: radii['2xl'],
      borderWidth: 1,
      borderColor: colors.rimLight,
      backgroundColor: colors.surfaceContainerHigh,
      overflow: 'hidden',
      maxWidth: 420,
      width: '100%',
    },
    /** Concentric: the card's radius less its padding, so the two read as one
     *  object rather than a circle sitting on a rectangle. */
    ring: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      borderColor: colors.primary,
      backgroundColor: `${colors.primary}1F`,
    },
    title: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyLarge,
      color: colors.onSurface,
    },
    subtitle: {
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodySmall,
      color: colors.onSurfaceVariant,
      marginTop: 2,
    },
  });
