import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { formatGhs, originShort, destinationShort, seatsOf } from '@eyego/utils';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, GlassSurface, GradientGlowBorder, Pressable, useLoopsActive } from '@eyego/ui';

import { useColors, type DriverColors } from '../utils/useColors';

/**
 * ── THE LIVE TRIP, AS A CARD ────────────────────────────────────────────────
 *
 * FEATURE ("on the homepage of the driver app, create a live trip card like the
 * way the rider app home screen does. At the moment the button to resume the
 * trip isn't really aesthetic").
 *
 * What was there: one line of text — "Active trip: Circle → Madina" — above a
 * default-styled `Button` labelled "Resume Trip", both sitting inside the same
 * glow ring the "+ Create Trip" button uses when there is no trip at all. Three
 * things wrong with that, in order of how much they cost the driver:
 *
 *  1. IT ANSWERED NOTHING. A driver glancing at their phone at a junction wants
 *     to know what phase the ride is in, who is aboard and what it pays. The
 *     banner named two places and left every one of those unanswered, so the
 *     only way to find out was to open the trip — which is the tap the card is
 *     supposed to save.
 *  2. IT LOOKED LIKE A FORM CONTROL. The rider's equivalent is a surface with
 *     its own presence; this was a sentence and a rectangle. Identical chrome
 *     for "you are mid-ride" and "you have nothing on" is the reason it read as
 *     unfinished.
 *  3. IT DID NOT SIGNAL LIFE. Nothing on it moved or changed while a trip was
 *     actually running underneath it.
 *
 * The rebuild keeps the app's existing vocabulary rather than inventing one: the
 * driver-blue ring every hero surface in this app wears, the status rail's own
 * phase colours, the spine used on the dispatch offer, and tabular figures for
 * the money. The only new motion is a slow breath on the status dot, which is
 * the one thing on the card that means "this is happening right now".
 */

export interface LiveTripCardProps {
  /** The driver's active trip, straight off `GET /driver/trips/active`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trip: any;
  onPress: () => void;
}

/** Phase → what the driver is being asked to do next, and in what colour. */
function phaseOf(colors: DriverColors, status: string | null | undefined) {
  switch (status) {
    case 'DRIVER_ASSIGNED':
      return { label: 'ACCEPTED', next: 'Set off for the pickup', tint: colors.accent };
    case 'DRIVER_EN_ROUTE':
      return { label: 'HEADING TO PICKUP', next: 'Drive to the pickup point', tint: colors.accent };
    case 'ARRIVED_AT_PICKUP':
      return { label: 'AT PICKUP', next: 'Board your passengers', tint: colors.statusWarning };
    case 'IN_PROGRESS':
      return { label: 'ON TRIP', next: 'Drive to the destination', tint: colors.online };
    case 'FILLING':
      return { label: 'FILLING SEATS', next: 'Waiting for the van to fill', tint: colors.statusWarning };
    case 'SCHEDULED':
      return { label: 'SCHEDULED', next: 'Not departed yet', tint: colors.onSurfaceVariant };
    case 'CONFIRMED':
      return { label: 'CONFIRMED', next: 'Set off for the pickup', tint: colors.accent };
    default:
      return { label: 'ACTIVE', next: 'Open the trip', tint: colors.accent };
  }
}

export function LiveTripCard({ trip, onPress }: LiveTripCardProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const reducedMotion = useReducedMotion();

  const phase = phaseOf(colors, trip?.status);

  /**
   * A SLOW BREATH ON THE STATUS DOT.
   *
   * The one piece of motion on this card, and it earns its place: a running trip
   * and a stale card look identical when nothing moves. 2.4 s, opacity only, so
   * it is a compositor-thread property and costs nothing to keep going while the
   * driver reads the rest of the screen.
   *
   * Off entirely under reduced motion, where the colour and the label already
   * carry the whole signal.
   */
  const pulse = useSharedValue(0);
  // NOT decorative: the pulse is how a LIVE trip is distinguished from a
  // finished one. `reducedMotion` is already handled explicitly below.
  const loopsActive = useLoopsActive({ decorative: false });
  useEffect(() => {
    // The live-trip card lives on the driver's home tab, which stays mounted
    // for the whole session behind every other tab. See useLoopsActive.
    if (reducedMotion || !loopsActive) {
      cancelAnimation(pulse);
      pulse.value = 1;
      return;
    }
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.25, { duration: 1200, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(pulse);
  }, [reducedMotion, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  /**
   * WHO IS ABOARD, AND WHAT THE TRIP PAYS.
   *
   * Seats are counted as PEOPLE — a party of three is one booking row carrying
   * three — which is the same rule the seat map and the server's capacity check
   * use. Counting rows here would have put "1 passenger" on a card for a van
   * with a family of four in it.
   */
  const bookings: any[] = Array.isArray(trip?.bookings) ? trip.bookings : [];
  const live = bookings.filter(
    (b) => !['CANCELLED', 'REFUNDED', 'EXPIRED', 'NO_SHOW'].includes(b?.status),
  );
  const aboard = live.reduce(
    (n, b) => n + (b?.status === 'BOARDED' || b?.status === 'COMPLETED' ? seatsOf(b) : 0),
    0,
  );
  const booked = live.reduce((n, b) => n + seatsOf(b), 0);
  const maxSeats: number | null = typeof trip?.maxSeats === 'number' ? trip.maxSeats : null;

  /**
   * The driver's own money, per seat sold, from the server's split.
   *
   * `driverEarningsPerSeatPesewas` is the figure `attachFarePerSeat` computes;
   * guessing a commission rate on the client is how the active-trip screen once
   * told drivers they were losing 30% while the server charged 15%.
   */
  const perSeat: number | null =
    typeof trip?.driverEarningsPerSeatPesewas === 'number'
      ? trip.driverEarningsPerSeatPesewas
      : typeof trip?.farePerSeatPesewas === 'number'
        ? trip.farePerSeatPesewas
        : null;
  const earnings = perSeat != null && booked > 0 ? perSeat * booked : perSeat;

  const from = originShort(trip) ?? 'Pickup';
  const to = destinationShort(trip) ?? 'Destination';

  return (
    <Pressable
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`Resume trip from ${from} to ${to}. ${phase.next}.`}
      style={({ pressed }) => (pressed ? styles.pressed : undefined)}
    >
      {/*
        The shell. `driver` is this app's own two-arc sweep (blue → cyan); the
        rider's blue/orange combo reads muddy against the driver theme.
      */}
      <GradientGlowBorder
        palette="driver"
        fillColor={colors.surfaceContainerHigh}
        borderRadius={radii['2xl']}
        glow
        glowIntensity={0.9}
        maxGlowRadius={20}
        style={styles.shell}
      >
        {/* Inset by the ring's stroke so the blur never paints over the ring. */}
        <GlassSurface
          borderRadius={radii['2xl'] - 3}
          intensity="high"
          style={styles.glassInset}
        />

        <View style={styles.body}>
          {/* ── Phase ── */}
          <View style={styles.phaseRow}>
            <View style={[styles.phaseChip, { borderColor: `${phase.tint}55`, backgroundColor: `${phase.tint}14` }]}>
              <Animated.View style={[styles.phaseDot, { backgroundColor: phase.tint }, pulseStyle]} />
              <Text style={[styles.phaseLabel, { color: phase.tint }]}>{phase.label}</Text>
            </View>
            {trip?.shortId ? (
              <Text style={styles.tripId}>#{String(trip.shortId).slice(0, 6).toUpperCase()}</Text>
            ) : null}
          </View>

          {/* ── The ride, as a spine ── */}
          <View style={styles.spine}>
            <View style={styles.spineRail}>
              <View style={[styles.spineDot, { backgroundColor: phase.tint }]} />
              <View style={[styles.spineLine, { backgroundColor: colors.outline }]} />
              <Ionicons name="location" size={12} color={colors.error} />
            </View>
            <View style={styles.spineBody}>
              <Text style={styles.legText} numberOfLines={1}>{from}</Text>
              <Text style={[styles.legText, styles.legTextDest]} numberOfLines={1}>{to}</Text>
            </View>
          </View>

          {/* ── The two numbers that size the job ── */}
          <View style={styles.stats}>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>ABOARD</Text>
              <Text style={styles.statValue}>
                {aboard}
                <Text style={styles.statValueDim}>
                  {maxSeats ? ` / ${maxSeats}` : booked ? ` / ${booked}` : ''}
                </Text>
              </Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.outline }]} />
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>YOU EARN</Text>
              <Text style={styles.statValue}>{earnings != null ? formatGhs(earnings) : '—'}</Text>
            </View>
          </View>

          {/*
            ── THE CTA ──
            A full-width pill with the arrow nested in its own circle, flush with
            the inner padding — the same "button-in-button" the rest of the
            premium surfaces use. It is a Pressable's child rather than its own
            control so the WHOLE card is the target: a 44pt button inside a card
            a driver has already reached for is a smaller target than the card.
          */}
          <View style={[styles.cta, { backgroundColor: colors.accent }]}>
            <Text style={[styles.ctaText, { color: colors.background }]}>Resume trip</Text>
            <View style={[styles.ctaIcon, { backgroundColor: `${colors.background}26` }]}>
              <Ionicons name="arrow-forward" size={15} color={colors.background} />
            </View>
          </View>

          <Text style={styles.nextLine} numberOfLines={1}>{phase.next}</Text>
        </View>
      </GradientGlowBorder>
    </Pressable>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    pressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
    shell: { overflow: 'hidden' },
    glassInset: { position: 'absolute', top: 3, left: 3, right: 3, bottom: 3 },
    body: { padding: spacing.lg, gap: spacing.md },

    phaseRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    phaseChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: spacing.md,
      paddingVertical: 5,
      borderRadius: radii.full,
      borderWidth: 1,
    },
    phaseDot: { width: 6, height: 6, borderRadius: 3 },
    phaseLabel: { fontFamily: fonts.bold, fontSize: 9.5, letterSpacing: 0.9 },
    tripId: {
      fontFamily: fonts.monoRegular,
      fontSize: fontSizes.caption,
      lineHeight: 15,
      color: colors.onSurfaceVariant,
      letterSpacing: 0.5,
    },

    spine: { flexDirection: 'row', gap: spacing.md },
    spineRail: { width: 14, alignItems: 'center', paddingTop: 7 },
    spineDot: { width: 8, height: 8, borderRadius: 4 },
    spineLine: { width: 1.5, flex: 1, minHeight: 18, marginVertical: 4, borderRadius: 1 },
    spineBody: { flex: 1, gap: spacing.sm },
    legText: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyLarge,
      lineHeight: Math.round(fontSizes.bodyLarge * 1.3),
      color: colors.onSurface,
    },
    legTextDest: { color: colors.onSurface },

    stats: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.base,
      borderRadius: radii.lg,
      backgroundColor: `${colors.surfaceContainerHighest}99`,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.rimLightSubtle,
    },
    statCell: { flex: 1, gap: 2 },
    statDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', opacity: 0.6 },
    statLabel: { fontFamily: fonts.bold, fontSize: 9, letterSpacing: 0.9, color: colors.onSurfaceVariant },
    statValue: {
      fontFamily: fonts.displayBold,
      fontSize: 20,
      lineHeight: 25,
      letterSpacing: -0.4,
      color: colors.onSurface,
      // Counts and money change under the driver's eyes; they must not reflow.
      fontVariant: ['tabular-nums'],
    },
    statValueDim: { color: colors.onSurfaceVariant },

    cta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: 52,
      borderRadius: radii.full,
      paddingLeft: spacing.xl,
      paddingRight: 6,
    },
    ctaText: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyLarge, letterSpacing: 0.2 },
    ctaIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    nextLine: {
      fontFamily: fonts.regular,
      fontSize: fontSizes.caption,
      lineHeight: 16,
      color: colors.onSurfaceVariant,
      textAlign: 'center',
      marginTop: -spacing.xs,
    },
  });

export default LiveTripCard;
