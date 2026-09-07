import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, radii, spacing, springs, withOpacity } from '@eyego/config';
import { Text, useLoopsActive } from '@eyego/ui';

import { useColors, type Colors } from '../../utils/useColors';

/**
 * "LOOKING FOR A DRIVER", REBUILT.
 *
 * ── WHAT WAS WRONG WITH IT ──────────────────────────────────────────────────
 * "You need to fix the looking for a driver page. You need to completely
 * redesign it to be very aesthetic and professional. Research and see how Uber,
 * Bolt and Yango do theirs so you can mirror it."
 *
 * The old screen was a centred column: a pulsing ring, a centred headline, a
 * centred paragraph, two centred hint lines, a bordered info card, a ghost
 * button and an underlined text link. Eight elements, all centred, all the same
 * width, none of them the thing the rider is actually waiting on. Centred stacks
 * read as a loading SCREEN — the thing you show when you have nothing to say.
 *
 * ── WHAT THE THREE OF THEM ACTUALLY DO ──────────────────────────────────────
 * Uber, Bolt and Yango have converged on the same four moves, and none of them
 * is a spinner:
 *
 *   1. THE SEARCH RUNS ON THE SHEET'S EDGE, not in the middle of it. A sweeping
 *      indeterminate rail pinned to the top edge of the panel. It says "working"
 *      continuously without occupying the space where information goes, and it
 *      is the single most recognisable element of all three products.
 *   2. THE HEADLINE IS LEFT-ALIGNED AND LARGE. Waiting is a status, and a status
 *      belongs on the same axis as the rest of the sheet's text, not floating
 *      on the centre line.
 *   3. THE ITINERARY IS SHOWN, NOT DESCRIBED. Uber shows the pickup and the
 *      destination as two rows joined by a connector, because the rider's real
 *      question in this minute is "is it going to the right place". The old
 *      screen buried the destination mid-sentence in a paragraph.
 *   4. THE WAIT IS ACCOUNTED FOR. Bolt counts elapsed seconds; Uber escalates
 *      its copy the longer it takes. A search that says the same thing at 8
 *      seconds and at 80 feels stalled. Ours has a genuinely honest signal the
 *      others do not — dispatch asks ONE driver at a time, so "asking driver 2
 *      of 5" is a real position in a real queue.
 *
 * The concentric-ring indicator survives, at a third of the size, as a chip
 * beside the headline. It was never the problem; being 72 pt in the middle of
 * the screen with nothing around it was.
 */

export type SearchStatus = 'sending' | 'searching' | 'matched' | 'error' | 'timeout';

export interface SearchingPanelProps {
  status: SearchStatus;
  originText?: string | null;
  destinationText?: string | null;
  /** Dispatch's real position in the cascade. `total` of 0 hides it. */
  attempt?: { attempt: number; total: number };
  /** An offer is out with a specific driver right now. */
  offerPending?: boolean;
  /**
   * Road ETA from the driver currently being asked to the rider's pickup.
   *
   * "Asking driver 2 of 5" tells a rider the search is progressing but not
   * whether it is progressing towards anything good — driver 2 could be three
   * minutes away or twenty, and that is the difference between waiting and
   * cancelling. Uber and Bolt both show the distance to whoever is being asked
   * for exactly this reason. Null while nobody holds an offer, or when the ETA
   * provider degraded.
   */
  etaSeconds?: number | null;
  /**
   * How wide the server's search currently is, in km.
   *
   * The map draws this as a real ring around the pickup. Naming it here is what
   * makes the quiet case legible: with no cars in the area the map has a ring
   * and nothing else, and "looking within 5 km" explains that emptiness where
   * "finding your driver" over a blank map just looks broken.
   */
  radiusKm?: number | null;
  seats?: number;
  tierLabel?: string | null;
  scheduledFor?: string | null;
  errorReason?: string | null;
}

/** How long the rider has been waiting, in whole seconds. */
function useElapsed(active: boolean): number {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!active) {
      setSecs(0);
      return;
    }
    const started = Date.now();
    const t = setInterval(() => setSecs(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [active]);
  return secs;
}

/**
 * THE SWEEP. One shared value, on the UI thread, no gradient and no shadow.
 *
 * A 38%-wide highlight travelling the full width and easing at each end, which
 * is what makes it read as a search rather than as a progress bar that keeps
 * resetting. `withRepeat(..., true)` reverses rather than jumping back.
 */
function ProgressSweep({ colors, active }: { colors: Colors; active: boolean }) {
  const reduceMotion = useReducedMotion();
  const t = useSharedValue(0);

  const loopsActive = useLoopsActive();
  useEffect(() => {
    // A search can still be running while the rider looks at something else —
    // the sweep is only worth frames while it is on screen.
    if (!active || reduceMotion || !loopsActive) {
      t.value = withTiming(0, { duration: 200 });
      return;
    }
    t.value = 0;
    t.value = withRepeat(
      withTiming(1, { duration: 1150, easing: Easing.inOut(Easing.cubic) }),
      -1,
      true,
    );
    return () => cancelAnimation(t);
  }, [active, reduceMotion, t, loopsActive]);

  const style = useAnimatedStyle(() => ({
    left: `${interpolate(t.value, [0, 1], [-38, 100])}%`,
    opacity: active ? 1 : 0,
  }));

  return (
    <View style={[styles.sweepTrack, { backgroundColor: withOpacity(colors.primary, 0.14) }]}>
      <Animated.View style={[styles.sweepHead, { backgroundColor: colors.primary }, style]} />
    </View>
  );
}

/** The small radar chip beside the headline. Two rings off one phase. */
function RadarChip({ colors, status }: { colors: Colors; status: SearchStatus }) {
  const reduceMotion = useReducedMotion();
  const searching = status === 'searching' || status === 'sending';
  const phase = useSharedValue(0);
  const pop = useSharedValue(0);

  useEffect(() => {
    if (searching && !reduceMotion) {
      phase.value = withRepeat(
        withTiming(1, { duration: 2000, easing: Easing.out(Easing.quad) }),
        -1,
        false,
      );
    } else {
      phase.value = withTiming(0, { duration: 200 });
    }
    return () => cancelAnimation(phase);
  }, [searching, reduceMotion, phase]);

  useEffect(() => {
    if (status !== 'matched') return;
    // The one overshoot in the whole flow, and it is earned: see springs.accent.
    pop.value = withSequence(withSpring(1, springs.accent), withSpring(0, springs.standard));
    return () => cancelAnimation(pop);
  }, [status, pop]);

  const ringA = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + phase.value * 1.5 }],
    opacity: (1 - phase.value) * 0.5,
  }));
  // The trailing ring IS the leading ring, half a cycle behind — an offset,
  // not a second animation.
  const ringB = useAnimatedStyle(() => {
    const p = (phase.value + 0.5) % 1;
    return { transform: [{ scale: 1 + p * 1.5 }], opacity: (1 - p) * 0.5 };
  });
  const core = useAnimatedStyle(() => ({ transform: [{ scale: 1 + pop.value * 0.14 }] }));

  const tone =
    status === 'matched' ? colors.statusSuccess
    : status === 'error' || status === 'timeout' ? colors.error
    : colors.primary;

  return (
    <View style={styles.radar}>
      <Animated.View style={[styles.radarRing, { borderColor: tone }, ringA]} pointerEvents="none" />
      <Animated.View style={[styles.radarRing, { borderColor: tone }, ringB]} pointerEvents="none" />
      <Animated.View style={[styles.radarCore, { backgroundColor: withOpacity(tone, 0.18), borderColor: tone }, core]}>
        <Ionicons
          name={
            status === 'matched' ? 'checkmark'
            : status === 'error' ? 'close'
            : status === 'timeout' ? 'time-outline'
            : 'car-sport'
          }
          size={15}
          color={tone}
        />
      </Animated.View>
    </View>
  );
}

export function SearchingPanel({
  status,
  originText,
  destinationText,
  attempt = { attempt: 0, total: 0 },
  offerPending = false,
  etaSeconds = null,
  radiusKm = null,
  seats = 1,
  tierLabel,
  scheduledFor,
  errorReason,
}: SearchingPanelProps) {
  const colors = useColors();
  const styles2 = useMemo(() => makeStyles(colors), [colors]);
  const live = status === 'searching' || status === 'sending';
  const elapsed = useElapsed(live);

  const headline =
    status === 'matched' ? 'Driver found'
    : status === 'error' ? "We couldn't send that"
    : status === 'timeout' ? 'No drivers free right now'
    : status === 'sending' ? 'Sending your request'
    : 'Finding your driver';

  /**
   * WHAT TO SAY, AND WHEN.
   *
   * Ordered by how much it is worth knowing, not by how the code is arranged:
   * a live cascade position beats an elapsed count beats generic reassurance.
   * The copy escalates with the wait because a line that has not changed in a
   * minute is how a working search comes to look like a stuck one.
   */
  const substatus = (() => {
    if (status === 'matched') return 'Taking you to your trip…';
    if (status === 'error') return errorReason ?? 'Please try again in a moment.';
    if (status === 'timeout') return 'Nothing was charged. Try again shortly, or book a scheduled ride.';
    if (status === 'sending') return 'Reaching drivers near your pickup…';
    /**
     * The distance is the part a rider can act on.
     *
     * "Asking driver 2 of 5" says the search is moving; it does not say whether
     * it is moving towards anything worth waiting for. Naming the ETA of the
     * driver currently holding the offer is what turns the position into
     * information — and it is the number both Uber and Bolt put here.
     *
     * Rounded up to a whole minute, floored at 1: "0 min away" reads as a bug,
     * and a sub-minute ETA is inside the error bar of any routing provider.
     */
    if (offerPending && attempt.total > 0) {
      const mins = etaSeconds != null && Number.isFinite(etaSeconds)
        ? Math.max(1, Math.round(etaSeconds / 60))
        : null;
      return mins != null
        ? `Asking a driver ${mins} min away · ${attempt.attempt} of ${attempt.total}`
        : `Asking driver ${attempt.attempt} of ${attempt.total}…`;
    }
    if (attempt.total > 0) return `${attempt.total} driver${attempt.total === 1 ? '' : 's'} nearby — asking them in turn`;
    /**
     * NOTHING FOUND YET — SAY HOW MUCH GROUND WE ARE COVERING.
     *
     * This is the case the map goes empty in, and an empty map under "finding
     * your driver" reads as a broken screen rather than a quiet area. The ring
     * on the map is the same number, so the words and the picture agree, and
     * the ring GROWS when the server widens — at which point this line grows
     * with it and the rider can see the search working.
     */
    const km = Number.isFinite(radiusKm) ? (radiusKm as number) : null;
    if (km != null) {
      return elapsed > 45
        ? `Still looking — the search is out to ${km} km now.`
        : `Looking within ${km} km of your pickup.`;
    }
    if (elapsed > 45) return 'Still looking. We widen the search the longer it takes.';
    if (elapsed > 20) return 'Most riders are matched in under two minutes.';
    return 'We ask the closest driver first, then the next.';
  })();

  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;

  return (
    <View style={styles2.root}>
      {/* THE SEARCH, ON THE EDGE. See the header — this is the move all three
          products share, and it keeps the middle of the sheet for content. */}
      <ProgressSweep colors={colors} active={live} />

      <View style={styles2.headRow}>
        <RadarChip colors={colors} status={status} />
        <View style={styles2.headText}>
          <Text style={styles2.headline} numberOfLines={1}>
            {headline}
          </Text>
          <Text style={styles2.substatus} numberOfLines={2}>
            {substatus}
          </Text>
        </View>
        {/* Tabular figures — a clock whose digits shift width jitters once a
            second for as long as the rider is watching it. */}
        {live && elapsed >= 5 && (
          <View style={styles2.clock}>
            <Text style={styles2.clockText}>{mmss}</Text>
          </View>
        )}
      </View>

      {/* THE ITINERARY. Shown, not described — the rider's question in this
          minute is "is this going where I said". */}
      {(originText || destinationText) && (
        <View style={styles2.itinerary}>
          <View style={styles2.rail}>
            <View style={[styles2.railDot, { borderColor: colors.onSurface }]} />
            <View style={[styles2.railLine, { backgroundColor: colors.outline }]} />
            <View style={[styles2.railPin, { backgroundColor: colors.primary }]} />
          </View>
          <View style={styles2.itineraryText}>
            <View style={styles2.itineraryRow}>
              <Text style={styles2.itineraryLabel}>PICKUP</Text>
              <Text style={styles2.itineraryValue} numberOfLines={1}>
                {originText ?? 'Your pickup'}
              </Text>
            </View>
            <View style={styles2.itineraryRow}>
              <Text style={styles2.itineraryLabel}>DROP-OFF</Text>
              <Text style={styles2.itineraryValue} numberOfLines={1}>
                {destinationText ?? 'Your destination'}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* The facts of the booking, as chips. Small, quiet, and only the ones
          that exist — an empty row of placeholders is worse than no row. */}
      {(tierLabel || seats > 1 || scheduledFor) && (
        <View style={styles2.chips}>
          {tierLabel ? (
            <View style={styles2.chip}>
              <Ionicons name="car-outline" size={12} color={colors.onSurfaceVariant} />
              <Text style={styles2.chipText}>{tierLabel}</Text>
            </View>
          ) : null}
          {seats > 1 ? (
            <View style={styles2.chip}>
              <Ionicons name="people-outline" size={12} color={colors.onSurfaceVariant} />
              <Text style={styles2.chipText}>{seats} seats</Text>
            </View>
          ) : null}
          {scheduledFor ? (
            <View style={styles2.chip}>
              <Ionicons name="calendar-outline" size={12} color={colors.onSurfaceVariant} />
              <Text style={styles2.chipText}>{scheduledFor}</Text>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

/** Layout-only styles that do not read the palette. */
const styles = StyleSheet.create({
  sweepTrack: {
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  sweepHead: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '38%',
    borderRadius: 2,
  },
  radar: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  radarRing: { position: 'absolute', width: 32, height: 32, borderRadius: 16, borderWidth: 1.5 },
  radarCore: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    root: { gap: spacing.lg },
    headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    headText: { flex: 1, gap: 2 },
    /* Large, tight and LEFT-aligned. See the header: a centred headline is what
       made this read as a loading screen rather than as a live status. */
    headline: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.headlineSmall,
      lineHeight: Math.round(fontSizes.headlineSmall * 1.15),
      letterSpacing: -0.5,
      color: colors.onSurface,
    },
    substatus: {
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodySmall,
      lineHeight: 17,
      color: colors.onSurfaceVariant,
    },
    clock: {
      paddingHorizontal: 9,
      paddingVertical: 4,
      borderRadius: radii.full,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.outline,
      backgroundColor: colors.surfaceContainer,
    },
    clockText: {
      fontFamily: fonts.semiBold,
      fontSize: 12,
      color: colors.onSurfaceVariant,
      fontVariant: ['tabular-nums'],
    },

    itinerary: { flexDirection: 'row', gap: spacing.md },
    /** The connector. One column, three elements, no absolute positioning. */
    rail: { width: 12, alignItems: 'center', paddingTop: 15, paddingBottom: 15 },
    railDot: { width: 9, height: 9, borderRadius: 5, borderWidth: 2 },
    railLine: { flex: 1, width: 1.5, marginVertical: 4, borderRadius: 1 },
    railPin: { width: 9, height: 9, borderRadius: 2 },
    itineraryText: { flex: 1 },
    itineraryRow: { height: 44, justifyContent: 'center', gap: 1 },
    itineraryLabel: {
      fontFamily: fonts.labelCaps,
      fontSize: 9,
      lineHeight: 11,
      letterSpacing: 1.1,
      color: colors.onSurfaceVariant,
    },
    itineraryValue: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.25),
      color: colors.onSurface,
    },

    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: radii.full,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.outline,
      backgroundColor: colors.surfaceContainer,
    },
    chipText: {
      fontFamily: fonts.medium,
      fontSize: 11.5,
      color: colors.onSurfaceVariant,
    },
  });

export default SearchingPanel;
