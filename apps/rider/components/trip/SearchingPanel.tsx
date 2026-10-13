import React, { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  ReduceMotion,
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
import { Text, useLoopsActive, RollingDigits } from '@eyego/ui';
import { formatGhs } from '@eyego/utils';

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
  /** How the ride will be paid ("Cash") — the fourth fact every rival shows here. */
  paymentLabel?: string | null;
  scheduledFor?: string | null;
  errorReason?: string | null;
  /** What the rider is offering, boosts included. Null hides the fare line. */
  farePesewas?: number | null;
  /** How much of that the rider added to find a driver faster. */
  boostedPesewas?: number;
  /**
   * Nobody is in range yet — the server parked the search and is re-scanning.
   * The commonest searching state in a quiet area, and it deserves its own
   * sentence rather than the same "asking drivers" copy as a busy one.
   */
  waiting?: boolean;
  /**
   * The peek card ("the card is way too tall and is covering 90% of the
   * screen"): status, then the price with the booking's facts on ONE line.
   * The itinerary and the chip row are what the expanded card is for — the
   * map behind it already shows where the ride goes.
   */
  compact?: boolean;
  /**
   * THREE SNAPS ("the card seems small and busy … different snap points to show
   * appropriate details per snap point"). 0 peek: the status and the money.
   * 1 half: + the journey and the booking in one line. 2 full: + how the
   * search is going, in numbers. Defaults to full (the route screen).
   */
  level?: 0 | 1 | 2;
  /** Sits under the fare — the boost pill. */
  fareAccessory?: React.ReactNode;
}

/** How long the rider has been waiting, in whole seconds. */
export function useElapsed(active: boolean): number {
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
function ProgressSweep({ colors, active, compact }: { colors: Colors; active: boolean; compact?: boolean }) {
  const reduceMotion = useReducedMotion();
  const t = useSharedValue(0);

  // NOT decorative: the sweep is what says the search is running. This file
  // already honours reduce-motion explicitly via `reduceMotion` above.
  const loopsActive = useLoopsActive({ decorative: false });
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
    <View style={[styles.sweepTrack, compact && { marginBottom: 0 }, { backgroundColor: withOpacity(colors.primary, 0.14) }]}>
      <Animated.View style={[styles.sweepHead, { backgroundColor: colors.primary }, style]} />
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
  paymentLabel,
  scheduledFor,
  errorReason,
  farePesewas = null,
  boostedPesewas = 0,
  waiting = false,
  compact = false,
  level,
  fareAccessory,
}: SearchingPanelProps) {
  const lv = level ?? (compact ? 0 : 2);
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
    if (status === 'timeout') {
      // "Drivers near Osu are all busy" — the place makes it a fact about the
      // area, not a verdict on the app.
      const area = originText?.split(',')[0]?.trim();
      return `${area ? `Drivers near ${area} are busy` : 'Drivers are busy'} — you weren't charged.`;
    }
    /*
     * ONE SHORT LINE PER BEAT ("the card seems busy — a lot of wording, it can
     * be very overwhelming"). These were two-line sentences, and the waiting
     * one carried a second countdown beside the clock pill. Each beat is now a
     * phrase that fits one line; the clock pill is the only timer.
     */
    if (status === 'sending') return 'Reaching nearby drivers…';
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
      return mins != null ? `Asking a driver ${mins} min away` : `Asking driver ${attempt.attempt} of ${attempt.total}`;
    }
    /**
     * NOBODY IN RANGE — SAY SO, AND SAY WHAT HAPPENS NEXT.
     *
     * The server has parked the search and re-scans every few seconds; the
     * first driver to come online or free up nearby is asked straight away.
     * That is a real, different state from "asking drivers in turn", and the
     * screen used to describe both the same way — which is how a working
     * search on an empty map came to read as dead.
     */
    if (waiting) return 'No drivers free yet — still looking';
    if (attempt.total > 0) return `${attempt.total} driver${attempt.total === 1 ? '' : 's'} nearby`;
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
    if (km != null) return elapsed > 45 ? `Widening the search to ${km} km` : `Searching within ${km} km`;
    if (elapsed > 45) return 'Widening the search';
    return 'Asking the closest driver first';
  })();

  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;

  // Screen readers hear the state change ("Driver found"), not the ticking line.
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(headline);
  }, [headline]);

  const facts = [tierLabel, seats > 1 ? `${seats} seats` : null, paymentLabel, scheduledFor].filter(Boolean).join(' · ');
  const detail: [string, string][] = [];
  if (live) {
    if (radiusKm != null && Number.isFinite(radiusKm)) detail.push(['Search radius', `${radiusKm} km`]);
    if (attempt.total > 0) detail.push(['Drivers nearby', String(attempt.total)]);
    if (offerPending && attempt.total > 0) detail.push(['Asking now', `Driver ${attempt.attempt} of ${attempt.total}`]);
    detail.push(['Waiting', mmss]);
  }

  return (
    <View style={[styles2.root, lv === 0 && styles2.rootCompact]}>
      {/* THE SEARCH, ON THE EDGE — the only progress indicator on the card. */}
      <ProgressSweep colors={colors} active={live} compact={lv === 0} />

      {/* PEEK: what you are waiting on, and what you are offering. Nothing else. */}
      <View style={styles2.headRow}>
        <View style={styles2.headText}>
          <Animated.View key={headline} entering={FadeIn.duration(240).reduceMotion(ReduceMotion.System)}>
            <Text style={styles2.headline} numberOfLines={1}>
              {headline}
            </Text>
          </Animated.View>
          {/* Each new beat of the search fades in, so the rider notices it changed. */}
          <Animated.View
            key={`${status}|${offerPending ? attempt.attempt : 0}|${waiting}|${radiusKm ?? ''}`}
            entering={FadeIn.duration(240).reduceMotion(ReduceMotion.System)}
          >
            <Text style={styles2.substatus} numberOfLines={1}>
              {substatus}
            </Text>
          </Animated.View>
        </View>
        {farePesewas != null && farePesewas > 0 ? (
          <View style={styles2.fareCol}>
            {/* Rolls up, odometer-style, when a boost lands. */}
            <RollingDigits
              text={formatGhs(farePesewas)}
              value={farePesewas}
              fontSize={fontSizes.headlineSmall}
              fontFamily={fonts.displayBold}
              color={colors.onSurface}
            />
            {fareAccessory ?? (boostedPesewas > 0 ? (
              <Text style={[styles2.boostText, { color: colors.primary }]}>+{formatGhs(boostedPesewas)} boost</Text>
            ) : null)}
          </View>
        ) : null}
      </View>

      {/* HALF: the journey, and the booking in one quiet line. */}
      {lv >= 1 && (originText || destinationText) ? (
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
      ) : null}
      {lv >= 1 && facts ? (
        <Text style={styles2.factsLine} numberOfLines={1}>
          {facts}
        </Text>
      ) : null}

      {/* FULL: how the search is actually going, in numbers. */}
      {lv === 2 && detail.length ? (
        <View style={[styles2.detail, { borderColor: colors.outline }]}>
          {detail.map(([k, v]) => (
            <View key={k} style={styles2.detailRow}>
              <Text style={styles2.detailKey}>{k}</Text>
              <Text style={styles2.detailValue}>{v}</Text>
            </View>
          ))}
        </View>
      ) : null}
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
});

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    root: { gap: spacing.lg },
    rootCompact: { gap: spacing.md },
    factsLine: {
      flexShrink: 1,
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodySmall,
      color: colors.onSurfaceVariant,
    },
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

    fareRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
    fareLabel: {
      fontFamily: fonts.labelCaps,
      fontSize: 9,
      letterSpacing: 1.1,
      color: colors.onSurfaceVariant,
    },
    boostBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radii.full,
    },
    boostText: { fontFamily: fonts.semiBold, fontSize: 11, fontVariant: ['tabular-nums'] },
    fareCol: { alignItems: 'flex-end', gap: 4 },
    detail: {
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingTop: spacing.md,
      gap: spacing.sm,
    },
    detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    detailKey: { fontFamily: fonts.regular, fontSize: fontSizes.bodySmall, color: colors.onSurfaceVariant },
    detailValue: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodySmall, color: colors.onSurface, fontVariant: ['tabular-nums'] },
  });

export default SearchingPanel;
