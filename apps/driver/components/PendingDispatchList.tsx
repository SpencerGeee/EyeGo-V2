import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Svg, { Circle, Path } from 'react-native-svg';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { formatGhs } from '@eyego/utils';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, GlassSurface, GradientGlowBorder, ShinyText, Skeleton, getTierTheme } from '@eyego/ui';
import type { PendingDispatch } from '@eyego/api';

import { useColors, type DriverColors } from '../utils/useColors';
import { useDriverTripStore } from '../stores/trip.store';
import { useDriverSurface } from './surface/driverStage';
import { beatPresenceNow } from '../hooks/useDriverLocation';

/**
 * WHAT IS ACTUALLY LOOKING FOR A DRIVER RIGHT NOW.
 *
 * THE BUG THIS EXISTS FOR: "it's saying asking driver 1 of 1 but nothing on the
 * driver app is showing". A dispatch offer is one socket frame with no trip
 * `seq`, which means it cannot be replayed. Miss it — phone asleep, tunnel, or
 * simply being in the rider app on the same handset — and the only evidence the
 * ride ever existed was a card that never rendered.
 *
 * Deliberately a LIST rather than a card: the offer sheet is for the one ride
 * that is exclusively mine this second, while this shows every live search I am
 * eligible for, including the ones another driver is being asked about first.
 *
 * ── EVERY ROW IS TAKEABLE ───────────────────────────────────────────────────
 * "When I tap on the 1 live request card, nothing happens", and "I'm the only
 * driver available but now it's saying it's in queue."
 *
 * A row used to do one of two things depending on `offeredToMe`: open the offer
 * screen, or wiggle the map. That split was wrong on both sides. A SEARCH runs
 * for five minutes while an OFFER is a 45-second window, so for most of a
 * ride's life the row a driver is looking at is not "theirs" — and with one
 * driver in the city, "not yours" and "nobody's" are the same state. The row
 * now always opens the ride, and the accept path is first-claim-wins on the
 * server (`acceptRide` refuses only while somebody ELSE holds a live exclusive
 * offer). The only inert row is one genuinely being decided by another driver,
 * and that one says so.
 *
 * ── NO MAP ON THE BOARD ─────────────────────────────────────────────────────
 * "The live map card that appears isn't needed." It was a second GL surface
 * on a screen that already IS a map, and its legend/pins duplicated what the
 * offer sheet's own mini map shows the moment a row is opened. Rows only:
 * each one says, prominently, that a new request exists, what it pays, where
 * it starts and which way it goes.
 */

export interface PendingDispatchListProps {
  compact?: boolean;
}

export function PendingDispatchList({ compact = false }: PendingDispatchListProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const requests = useDriverTripStore((s) => s.pendingRequests);
  const hydrated = useDriverTripStore((s) => s.requestsHydrated);
  const resync = useDriverTripStore((s) => s.resync);
  const clockSkewMs = useDriverTripStore((s) => s.clockSkewMs);
  const [refreshing, setRefreshing] = useState(false);
  const [, forceTick] = useState(0);

  // One timer for the whole list, not one per row: countdowns are cosmetic and
  // a second's granularity is plenty, but N intervals on a list is not.
  useEffect(() => {
    if (!requests.some((r) => r.expiresAtServerMs)) return;
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [requests]);

  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await beatPresenceNow().catch(() => {});
      await resync();
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, resync]);

  /**
   * ONE WAY TO OPEN A RIDE. The row focuses itself on the surface store and the
   * root-mounted `DispatchOfferSheet` raises the card — countdown, road, swipe —
   * over whatever screen this board is on. Nothing navigates and nothing
   * mounts a screen, so nothing can lag (see driverStage.ts), and the Alerts
   * board gets exactly the card home gets instead of the old pushed page.
   */
  const open = useCallback((r: PendingDispatch) => {
    if (r.heldByAnother) {
      // Genuinely not takeable this second: another driver is inside their
      // exclusive window. The row's own tag says so.
      void Haptics.selectionAsync().catch(() => {});
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    useDriverSurface.getState().openOffer(r.tripId);
  }, []);

  /**
   * ── AN OPEN REQUEST AGES OUT TOO ──────────────────────────────────────────
   *
   * BUGFIX ("the dispatch offer of the rider-requested trip only vanishes when
   * the rider closes it. It would stay open the whole time on the driver app
   * and nothing expires it").
   *
   * An EXCLUSIVE offer carries `expiresAtServerMs` and the filter below has
   * always honoured it. An OPEN request — a ride on the board that nobody is
   * holding — carries none, because there is no per-driver hold to expire, and
   * `expiresAtServerMs == null` was therefore read as "never expires".
   *
   * That is only survivable while the five-second poll is running, because the
   * poll replaces this list wholesale and the server drops dead trips from it.
   * The moment the poll stops — the driver opens an offer, backgrounds the app,
   * loses signal — the last list it fetched becomes permanent, and a ride the
   * rider cancelled ten minutes ago is still sitting there looking takeable.
   *
   * `requestedAtMs` is what the row already carries for exactly this. A request
   * older than the server's own search ceiling cannot still be live: dispatch
   * has either matched it or given up. Generous rather than tight, because the
   * server remains the authority and this is only the backstop for when we
   * cannot hear it — a row wrongly hidden comes straight back on the next poll,
   * while a row wrongly SHOWN costs a driver a tap into a 409.
   */
  const OPEN_REQUEST_MAX_AGE_MS = 6 * 60_000;
  const notStale = useCallback(
    (r: { requestedAtMs?: number | null }) =>
      r.requestedAtMs == null ||
      Date.now() + clockSkewMs - r.requestedAtMs < OPEN_REQUEST_MAX_AGE_MS,
    [clockSkewMs],
  );

  const mine = useMemo(
    () =>
      requests.filter(
        (r) =>
          r.offeredToMe &&
          (r.expiresAtServerMs != null
            ? r.expiresAtServerMs - (Date.now() + clockSkewMs) > 0
            : notStale(r)),
      ),
    [requests, clockSkewMs, notStale],
  );
  /** Rows nobody is holding — takeable by whoever gets there first. */
  const open_ = useMemo(
    () => requests.filter((r) => !r.heldByAnother && !mine.includes(r) && notStale(r)),
    [requests, mine, notStale],
  );

  const hasWork = requests.length > 0;

  return (
    <View style={[styles.wrap, compact && { paddingHorizontal: 0 }]}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <LivePulse active={hasWork} color={hasWork ? colors.accent : colors.onSurfaceVariant} />
          <View style={{ flex: 1 }}>
            {/* The one hero string on this surface, so the shimmer stays a
                hero treatment rather than decoration — see ShinyText's own
                note about scope. Only while there is live work: a sweep over
                "No live requests" is motion advertising nothing. */}
            {hasWork ? (
              <ShinyText
                textStyle={styles.headerTitle}
                shineColor={colors.accent}
                baseColor={colors.onSurface}
                speedMs={3200}
              >
                {`${requests.length} live request${requests.length > 1 ? 's' : ''}`}
              </ShinyText>
            ) : (
              // Not "No live requests" until we have asked. See the skeleton.
              <Text style={styles.headerTitle}>
                {hydrated ? 'No live requests' : 'Checking for work…'}
              </Text>
            )}
            {mine.length > 0 ? (
              <Text variant="caption" color={colors.accent}>
                {mine.length} waiting on you
              </Text>
            ) : open_.length > 0 ? (
              <Text variant="caption" color={colors.onSurfaceVariant}>
                {open_.length} open to claim
              </Text>
            ) : null}
          </View>
        </View>
        <Pressable
          onPress={refresh}
          hitSlop={10}
          style={[styles.refreshBtn, { borderColor: colors.outline }]}
          accessibilityRole="button"
          accessibilityLabel="Check for new requests"
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <>
              <Ionicons name="refresh" size={13} color={colors.accent} />
              <Text style={[styles.refreshLabel, { color: colors.accent }]}>Check now</Text>
            </>
          )}
        </Pressable>
      </View>

      {/*
        A BLANK BOARD MEANS "NO WORK". SAY IT ONLY WHEN IT IS TRUE.

        BUGFIX (item 1: "the live card that shows the live trip dispatch takes a
        while to load up and it comes as blank for a while before the whole
        thing is loaded up").

        `pendingRequests` starts empty, and this branch read empty as "nothing is
        being dispatched to you" — a confident, wrong answer rendered for the
        whole of the first round trip and then swapped for live work. The
        shimmer is the honest state for a question that has not come back yet,
        and it holds the same height as the answer will, so nothing jumps when
        it does.
      */}
      {!hydrated && requests.length === 0 ? (
        <View style={styles.skeletonWrap}>
          <Skeleton width="100%" height={132} borderRadius={radii['2xl']} />
          <Skeleton width="100%" height={84} borderRadius={radii.xl} />
          <Skeleton width="100%" height={84} borderRadius={radii.xl} />
        </View>
      ) : requests.length === 0 ? (
        <View style={[styles.emptyCard, { borderColor: colors.outline }]}>
          <View style={[styles.emptyGlyph, { backgroundColor: colors.surfaceContainerHigh }]}>
            <Ionicons name="radio-outline" size={20} color={colors.onSurfaceVariant} />
          </View>
          <Text style={styles.emptyTitle}>Nothing is being dispatched to you</Text>
          <Text variant="bodySmall" color={colors.onSurfaceVariant} style={styles.emptyLine}>
            Stay online and this fills in the moment a rider requests nearby. Tap Check now if you
            think you missed one.
          </Text>
        </View>
      ) : (
        <>
          <View style={{ gap: spacing.md }}>
            {requests.map((r) => (
              <DispatchRow
                key={r.tripId}
                request={r}
                clockSkewMs={clockSkewMs}
                testID="driver-request-row"
                onPress={() => open(r)}
              />
            ))}
          </View>
        </>
      )}
    </View>
  );
}

/**
 * The live dot, breathing.
 *
 * A static dot labelled "live" is a claim the surface does not back up. One
 * shared 1.8 s loop on the halo is the cheapest possible way to make the board
 * read as connected rather than as a screenshot.
 */
function LivePulse({ active, color }: { active: boolean; color: string }) {
  const t = useSharedValue(0);
  useEffect(() => {
    if (!active) {
      cancelAnimation(t);
      t.value = 0;
      return;
    }
    t.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.quad) }), -1, false);
    // An infinite repeat outlives unmount unless it is cancelled.
    return () => cancelAnimation(t);
  }, [active, t]);

  const halo = useAnimatedStyle(() => ({
    opacity: active ? 0.42 * (1 - t.value) : 0,
    transform: [{ scale: 1 + t.value * 1.6 }],
  }));

  return (
    <View style={pulseStyles.wrap}>
      <Animated.View style={[pulseStyles.halo, { backgroundColor: color }, halo]} />
      <View style={[pulseStyles.dot, { backgroundColor: color }]} />
    </View>
  );
}

const pulseStyles = StyleSheet.create({
  wrap: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 12, height: 12, borderRadius: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});

/* ── One row ──────────────────────────────────────────────────────────────── */

function DispatchRow({
  request: r,
  clockSkewMs,
  onPress,
  testID,
}: {
  request: PendingDispatch;
  clockSkewMs: number;
  onPress: () => void;
  /** Stable handle for E2E flows — copy changes must not break a test. */
  testID?: string;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const secondsLeft = r.expiresAtServerMs
    ? Math.max(0, Math.round((r.expiresAtServerMs - (Date.now() + clockSkewMs)) / 1000))
    : null;
  const mine = r.offeredToMe && (secondsLeft == null || secondsLeft > 0);
  /**
   * NOT MINE, BUT TAKEABLE.
   *
   * The middle state the board never had. `heldByAnother` is the server's
   * answer to "is somebody inside their exclusive window right now" — and once
   * `releaseHold` stopped a lapsed offer from claiming to be live, the honest
   * answer for most rows is no. Those rows are claimable and must not wear the
   * same dead grey as one that genuinely belongs to another driver.
   */
  const claimable = !mine && !r.heldByAnother;
  const urgent = mine && secondsLeft != null && secondsLeft <= 8;

  /**
   * WHAT KIND OF CAR THIS RIDE IS ASKING FOR — see the ring below (item 8).
   *
   * `getTierTheme` normalises the wire's spelling (`ECO` and `ECONOMY` are the
   * same tier and used to render as two different colours) and hands back both
   * the accent and the matching ring palette, so the tag, the fare and the glow
   * are guaranteed to agree. Same lookup the rider's suggested-trip cards use.
   */
  const tier = getTierTheme(colors as any, r.tier);
  const ring = tier.ringPalette;

  const accent = urgent
    ? colors.error
    : mine
      ? tier.accent
      : claimable
        ? tier.accent
        : colors.onSurfaceVariant;

  const waitedMin =
    r.requestedAtMs != null ? Math.max(0, Math.round((Date.now() - r.requestedAtMs) / 60000)) : null;

  const body = (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={
        mine
          ? `Offer to ${r.dropoffAddress ?? 'destination'}, tap to review and accept`
          : claimable
            ? `Open request to ${r.dropoffAddress ?? 'destination'}, tap to claim it`
            : `Request to ${r.dropoffAddress ?? 'destination'}, being decided by another driver.`
      }
    >
      <GlassSurface
        borderRadius={radii.xl}
        intensity={mine ? 'high' : 'low'}
        style={StyleSheet.absoluteFill}
      />
      {mine || claimable ? (
        <View style={[styles.rowGlow, { backgroundColor: accent + (mine ? '16' : '0C') }]} pointerEvents="none" />
      ) : null}

      {/* The drawn route glyph — a map's worth of shape for none of a map's cost. */}
      <RouteGlyph accent={accent} dim={colors.outline} muted={!mine && !claimable} />

      <View style={styles.body}>
        {/*
          THE ROW SAYS WHAT IT IS BEFORE IT SAYS WHERE.

          "It should prominently say new request." The headline used to be the
          destination — which the server withholds until the ride starts, so
          most rows led with the placeholder "Destination on the map" and read
          as a broken address rather than as work. The event is the headline
          now, the money beside it; the pickup and the ride's shape (which way,
          roughly how far — `directionHint`) are the detail underneath.
        */}
        <View style={styles.topRow}>
          <Text style={[styles.dest, mine && { color: accent }]} numberOfLines={1}>
            {mine ? 'Offered to you' : r.status === 'REASSIGNING' ? 'Ride up for grabs' : 'New request'}
          </Text>
          {r.driverEarningsPesewas != null ? (
            <Text style={[styles.money, { color: mine || claimable ? accent : colors.onSurface }]}>
              {formatGhs(r.driverEarningsPesewas)}
            </Text>
          ) : null}
        </View>

        <Text variant="caption" color={colors.onSurfaceVariant} numberOfLines={1}>
          From {r.pickupAddress ?? 'a pickup point nearby'}
        </Text>
        <Text variant="caption" color={colors.onSurfaceVariant} numberOfLines={1}>
          {r.dropoffAddress
            ? `To ${r.dropoffAddress}`
            : r.dropoffBearing
              ? `Heading ${r.dropoffBearing}${r.dropoffDistanceKm ? ` · about ${r.dropoffDistanceKm} km` : ''}`
              : 'Destination shared when you start the ride'}
        </Text>

        <View style={styles.tagRow}>
          {mine ? (
            <View style={[styles.tag, { backgroundColor: accent + '1F' }]}>
              <Ionicons name="flash" size={9} color={accent} />
              <Text style={[styles.tagText, { color: accent }]}>
                {secondsLeft != null ? `YOURS · ${secondsLeft}s` : 'YOURS'}
              </Text>
            </View>
          ) : claimable ? (
            /**
             * "OPEN — TAP TO TAKE", never "IN QUEUE".
             *
             * IN QUEUE described the CASCADE's internal state, not anything the
             * driver could act on, and it was flatly wrong for the reported
             * case: the only driver in the city, looking at a ride nobody was
             * holding, told to wait for a queue that was them.
             */
            <View style={[styles.tag, { backgroundColor: accent + '1F' }]}>
              <Ionicons name="hand-left-outline" size={9} color={accent} />
              <Text style={[styles.tagText, { color: accent }]}>OPEN · TAP TO TAKE</Text>
            </View>
          ) : (
            <View style={[styles.tag, { backgroundColor: colors.onSurfaceVariant + '14' }]}>
              <Text style={[styles.tagText, { color: colors.onSurfaceVariant }]}>
                WITH ANOTHER DRIVER
              </Text>
            </View>
          )}
          {/* The tier tag wears the tier's own colour and its human label —
              "Economy", not the wire's "ECO". Same source as the ring. */}
          {r.tier ? (
            <View style={[styles.tag, { backgroundColor: tier.accent + '1A' }]}>
              <Ionicons name={tier.icon} size={9} color={tier.accent} />
              <Text style={[styles.tagText, { color: tier.accent }]}>{tier.label.toUpperCase()}</Text>
            </View>
          ) : null}
          {waitedMin != null && waitedMin >= 1 ? (
            <View style={[styles.tag, { backgroundColor: colors.onSurfaceVariant + '14' }]}>
              <Text style={[styles.tagText, { color: colors.onSurfaceVariant }]}>
                WAITING {waitedMin}M
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      <Ionicons
        name={mine || claimable ? 'chevron-forward' : 'time-outline'}
        size={16}
        color={mine || claimable ? accent : colors.onSurfaceVariant}
      />
    </Pressable>
  );

  /**
   * The glow ring is reserved for a row the driver can act on THIS SECOND, and
   * is at full strength only for the one being held for them. A ring on every
   * row is four shadow-casting layers apiece and no hierarchy at all.
   */
  if (!mine && !claimable) return body;

  return (
    /**
     * THE RING IS THE RIDE TYPE.
     *
     * BUGFIX (item 8: "make the live dispatch also glow-border aware based on
     * the ride type, like the way the suggested trips section of the rider app
     * behaves").
     *
     * The palette was chosen from URGENCY alone — gold when the clock ran down,
     * the driver blue otherwise — so a Premium fare and an Economy one arrived
     * looking identical, and the driver had to read the tag to find out which
     * they were being offered. The rider's own cards have been tier-coloured
     * since `tierTheme.ts` was written; this is the same lookup, so the two apps
     * describe one ride with one colour.
     *
     * Urgency still wins when it applies: eight seconds left is a fact about
     * THIS offer that outranks what kind of car it is, and it is the only state
     * that overrides the tier.
     */
    <GradientGlowBorder
      palette={urgent ? 'gold' : ring}
      fillColor={colors.surfaceCard}
      borderRadius={radii.xl}
      thickness={mine ? 'regular' : 'thin'}
      glow
      glowIntensity={mine ? 1 : 0.5}
      maxGlowRadius={mine ? 20 : 12}
    >
      {body}
    </GradientGlowBorder>
  );
}

/**
 * A stylised route: origin dot, bowed path, destination pin. Drawn in SVG so a
 * row costs a handful of vector nodes rather than a GL surface — the whole
 * reason the list can show this on every row and the map only once.
 */
function RouteGlyph({ accent, dim, muted }: { accent: string; dim: string; muted: boolean }) {
  return (
    <Svg width={42} height={42} viewBox="0 0 42 42">
      <Circle cx={21} cy={21} r={20} fill={accent} opacity={muted ? 0.06 : 0.1} />
      <Path
        d="M11 29 C 17 29, 15 15, 21 15 S 25 13, 31 13"
        stroke={dim}
        strokeWidth={7}
        fill="none"
        strokeLinecap="round"
        opacity={0.7}
      />
      <Path
        d="M11 29 C 17 29, 15 15, 21 15 S 25 13, 31 13"
        stroke={accent}
        strokeWidth={2.4}
        fill="none"
        strokeLinecap="round"
        opacity={muted ? 0.55 : 1}
      />
      <Circle cx={11} cy={29} r={3.4} fill={accent} opacity={muted ? 0.6 : 1} />
      <Circle cx={31} cy={13} r={3.4} fill="none" stroke={accent} strokeWidth={2.2} opacity={muted ? 0.6 : 1} />
    </Svg>
  );
}


const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    wrap: { paddingHorizontal: spacing['2xl'], gap: spacing.sm, marginBottom: spacing.base },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      marginBottom: spacing.xs,
    },
    headerLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    headerTitle: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyMedium,
      color: colors.onSurface,
      letterSpacing: 0.2,
    },
    refreshBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      minWidth: 92,
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radii.full,
      borderWidth: StyleSheet.hairlineWidth,
    },
    refreshLabel: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodySmall },

    skeletonWrap: { gap: spacing.md },
    emptyCard: {
      alignItems: 'center',
      gap: spacing.sm,
      padding: spacing.xl,
      borderRadius: radii['2xl'],
      borderWidth: StyleSheet.hairlineWidth,
      borderStyle: 'dashed',
    },
    emptyGlyph: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    emptyTitle: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, color: colors.onSurface },
    emptyLine: { lineHeight: 18, textAlign: 'center' },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.base,
      borderRadius: radii.xl,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: 'transparent',
    },
    // A soft inner wash rather than a shadow: shadows do not render inside an
    // `overflow: hidden` card, and a second absolute layer costs nothing.
    rowGlow: { ...StyleSheet.absoluteFillObject },
    body: { flex: 1, gap: 2 },
    topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    dest: { flex: 1, fontFamily: fonts.semiBold, fontSize: fontSizes.bodyLarge, color: colors.onSurface },
    money: { fontFamily: fonts.bold, fontSize: fontSizes.bodyLarge },
    tagRow: { flexDirection: 'row', gap: spacing.xs, marginTop: 5, flexWrap: 'wrap' },
    tag: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2.5,
      borderRadius: radii.sm,
    },
    tagText: { fontFamily: fonts.bold, fontSize: 9, letterSpacing: 0.6 },
  });

export default PendingDispatchList;
