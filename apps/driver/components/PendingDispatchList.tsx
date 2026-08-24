import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
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
import { Text, GlassSurface, GradientGlowBorder, ShinyText } from '@eyego/ui';
import {
  MapView,
  Camera,
  MarkerView,
  boundsFor,
  isUsableCoord,
  type Coord,
  type CameraRef,
} from '@eyego/maps';
import { eyegoDriverDarkStyle } from '@eyego/map-styles';
import type { PendingDispatch } from '@eyego/api';

import { useColors, type DriverColors } from '../utils/useColors';
import { useDriverTripStore } from '../stores/trip.store';
import { beatPresenceNow, lastKnownReportedFix } from '../hooks/useDriverLocation';

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
 * ── WHY THERE IS A MAP, AND WHY THERE IS EXACTLY ONE ────────────────────────
 * The thing a list of addresses cannot answer is the only question a driver
 * actually has — WHERE. So the board opens with one live map showing every
 * pending pickup relative to where this driver is parked.
 *
 * One. A MapView is a native GL surface; one per row would put four or five on
 * a scrolling screen, which is the same mistake as the stacked shader canvases
 * that cooked the phone. The rows get a cheap drawn glyph instead, and the map
 * is shared. Selecting a row re-frames the shared map rather than mounting
 * another.
 */
export function PendingDispatchList({ compact = false }: { compact?: boolean }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const requests = useDriverTripStore((s) => s.pendingRequests);
  const resync = useDriverTripStore((s) => s.resync);
  const clockSkewMs = useDriverTripStore((s) => s.clockSkewMs);
  const [refreshing, setRefreshing] = useState(false);
  const [, forceTick] = useState(0);
  const [focused, setFocused] = useState<string | null>(null);

  // One timer for the whole list, not one per row: countdowns are cosmetic and
  // a second's granularity is plenty, but N intervals on a list is not.
  useEffect(() => {
    if (!requests.some((r) => r.expiresAtServerMs)) return;
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [requests]);

  // A row that vanishes (taken, expired) must not leave the map framed on it.
  useEffect(() => {
    if (focused && !requests.some((r) => r.tripId === focused)) setFocused(null);
  }, [requests, focused]);

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

  const open = useCallback(
    (r: PendingDispatch) => {
      if (r.heldByAnother) {
        /**
         * The ONE case that is genuinely not takeable this second: another
         * driver is inside their exclusive window. Framing the map on it is the
         * honest answer to "where is that one" — and the row's own tag already
         * says why it cannot be opened.
         */
        void Haptics.selectionAsync().catch(() => {});
        setFocused((cur) => (cur === r.tripId ? null : r.tripId));
        return;
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      router.push(`/(trip)/dispatch/${r.tripId}` as any);
    },
    [router],
  );

  const mine = useMemo(
    () =>
      requests.filter(
        (r) =>
          r.offeredToMe &&
          (r.expiresAtServerMs == null || r.expiresAtServerMs - (Date.now() + clockSkewMs) > 0),
      ),
    [requests, clockSkewMs],
  );
  /** Rows nobody is holding — takeable by whoever gets there first. */
  const open_ = useMemo(
    () => requests.filter((r) => !r.heldByAnother && !mine.includes(r)),
    [requests, mine],
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
              <Text style={styles.headerTitle}>No live requests</Text>
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

      {requests.length === 0 ? (
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
          <DispatchBoardMap requests={requests} focusedTripId={focused} />

          <View style={{ gap: spacing.md }}>
            {requests.map((r) => (
              <DispatchRow
                key={r.tripId}
                request={r}
                clockSkewMs={clockSkewMs}
                focused={focused === r.tripId}
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

/* ── The shared board map ─────────────────────────────────────────────────── */

function DispatchBoardMap({
  requests,
  focusedTripId,
}: {
  requests: PendingDispatch[];
  focusedTripId: string | null;
}) {
  const colors = useColors();
  const cameraRef = useRef<CameraRef | null>(null);

  const fix = lastKnownReportedFix();
  const me = useMemo<Coord | null>(
    () => (fix && Number.isFinite(fix.lng) && Number.isFinite(fix.lat) ? [fix.lng, fix.lat] : null),
    [fix?.lng, fix?.lat],
  );

  const pins = useMemo(
    () =>
      requests
        .map((r) => ({
          tripId: r.tripId,
          coord: coordOf(r.pickupLng, r.pickupLat),
          mine: r.offeredToMe,
        }))
        .filter((p): p is { tripId: string; coord: Coord; mine: boolean } => p.coord != null),
    [requests],
  );

  const focusedPin = pins.find((p) => p.tripId === focusedTripId) ?? null;

  const frameKey =
    (focusedPin ? `f:${focusedPin.coord.join(',')}` : pins.map((p) => p.coord.join(',')).join('|')) +
    (me ? `|me:${me.join(',')}` : '');

  useEffect(() => {
    const cam = cameraRef.current;
    if (!cam) return;
    const t = setTimeout(() => {
      // A focused row zooms to it and its relationship to the driver, because
      // "where is that one" is the question the tap asked.
      const targets = focusedPin
        ? [focusedPin.coord, ...(me ? [me] : [])]
        : [...pins.map((p) => p.coord), ...(me ? [me] : [])];
      if (targets.length === 0) return;
      if (targets.length === 1) {
        cam.setCamera({ centerCoordinate: targets[0], zoomLevel: 13.5, animationDuration: 500 });
        return;
      }
      // `boundsFor` enforces a minimum span. A degenerate box is the MLRNCamera
      // SIGABRT, and two pickups on the same street corner produce one.
      const box = boundsFor(targets);
      if (!box) {
        cam.setCamera({ centerCoordinate: targets[0], zoomLevel: 12.5, animationDuration: 500 });
        return;
      }
      cam.fitBounds([box.ne, box.sw], { top: 46, bottom: 46, left: 42, right: 42 }, true);
    }, 140);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey]);

  if (pins.length === 0 && !me) return null;

  return (
    // The board's frame is a live ring rather than a hairline: this is the one
    // element on the home screen that means "work is available", and it now has
    // to hold that on a screen it shares with the map and the earnings strip.
    <GradientGlowBorder
      palette="driver"
      fillColor={colors.surfaceInput}
      borderRadius={radii['2xl']}
      thickness="thin"
      glow
      glowIntensity={0.8}
      maxGlowRadius={18}
      style={boardStyles.ring}
    >
      <View style={boardStyles.wrap}>
        <MapView
          style={StyleSheet.absoluteFill}
          styleURL={eyegoDriverDarkStyle}
          logoEnabled={false}
          attributionEnabled={false}
          compassEnabled={false}
          scaleBarEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
          zoomEnabled={false}
          scrollEnabled={false}
        >
          <Camera ref={cameraRef} animationMode="easeTo" animationDuration={520} />

          {me ? (
            <MarkerView coordinate={me} anchor="center">
              <View style={[boardStyles.me, { borderColor: colors.background }]}>
                <View style={[boardStyles.meCore, { backgroundColor: colors.onSurface }]} />
              </View>
            </MarkerView>
          ) : null}

          {pins.map((p) => (
            <MarkerView key={p.tripId} coordinate={p.coord} anchor="center">
              <View style={boardStyles.pinWrap}>
                <View
                  style={[
                    boardStyles.halo,
                    {
                      backgroundColor: (p.mine ? colors.accent : colors.onSurfaceVariant) + '2A',
                      opacity: focusedTripId && focusedTripId !== p.tripId ? 0.35 : 1,
                    },
                  ]}
                />
                <View
                  style={[
                    boardStyles.pin,
                    {
                      backgroundColor: p.mine ? colors.accent : colors.surfaceContainerHighest,
                      borderColor: colors.background,
                      opacity: focusedTripId && focusedTripId !== p.tripId ? 0.45 : 1,
                      transform: [{ scale: focusedTripId === p.tripId ? 1.25 : 1 }],
                    },
                  ]}
                />
              </View>
            </MarkerView>
          ))}
        </MapView>

        <LinearGradient
          pointerEvents="none"
          colors={['rgba(3,12,24,0.5)', 'rgba(3,12,24,0)', 'rgba(3,12,24,0.7)']}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFill}
        />

        <View style={boardStyles.legend} pointerEvents="none">
          <View style={[boardStyles.legendChip, { backgroundColor: colors.background + 'CC' }]}>
            <View style={[boardStyles.legendDot, { backgroundColor: colors.accent }]} />
            <Text style={[boardStyles.legendText, { color: colors.onSurface }]}>Yours</Text>
          </View>
          <View style={[boardStyles.legendChip, { backgroundColor: colors.background + 'CC' }]}>
            <View style={[boardStyles.legendDot, { backgroundColor: colors.surfaceContainerHighest }]} />
            <Text style={[boardStyles.legendText, { color: colors.onSurfaceVariant }]}>Open</Text>
          </View>
        </View>
      </View>
    </GradientGlowBorder>
  );
}

/* ── One row ──────────────────────────────────────────────────────────────── */

function DispatchRow({
  request: r,
  clockSkewMs,
  focused,
  onPress,
}: {
  request: PendingDispatch;
  clockSkewMs: number;
  focused: boolean;
  onPress: () => void;
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
  const accent = urgent
    ? colors.error
    : mine
      ? colors.accent
      : claimable
        ? colors.statusInfo
        : colors.onSurfaceVariant;

  const waitedMin =
    r.requestedAtMs != null ? Math.max(0, Math.round((Date.now() - r.requestedAtMs) / 60000)) : null;

  const body = (
    <Pressable
      onPress={onPress}
      style={[styles.row, focused && { borderColor: accent }]}
      accessibilityRole="button"
      accessibilityLabel={
        mine
          ? `Offer to ${r.dropoffAddress ?? 'destination'}, tap to review and accept`
          : claimable
            ? `Open request to ${r.dropoffAddress ?? 'destination'}, tap to claim it`
            : `Request to ${r.dropoffAddress ?? 'destination'}, being decided by another driver. Tap to see it on the map.`
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
        <View style={styles.topRow}>
          <Text style={styles.dest} numberOfLines={1}>
            {r.dropoffAddress ?? 'Destination on the map'}
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
          {r.tier ? (
            <View style={[styles.tag, { backgroundColor: colors.onSurfaceVariant + '14' }]}>
              <Text style={[styles.tagText, { color: colors.onSurfaceVariant }]}>{r.tier}</Text>
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
        name={mine || claimable ? 'chevron-forward' : focused ? 'close' : 'map-outline'}
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
    <GradientGlowBorder
      palette={urgent ? 'gold' : mine ? 'driver' : 'comfort'}
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

function coordOf(lng: unknown, lat: unknown): Coord | null {
  if (typeof lng !== 'number' || typeof lat !== 'number') return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const c: Coord = [lng, lat];
  return isUsableCoord(c) ? c : null;
}

const boardStyles = StyleSheet.create({
  ring: { marginBottom: spacing.sm },
  wrap: {
    height: 168,
    borderRadius: radii['2xl'],
    overflow: 'hidden',
  },
  me: {
    width: 16, height: 16, borderRadius: 8, borderWidth: 3,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  meCore: { width: 7, height: 7, borderRadius: 4 },
  pinWrap: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 32, height: 32, borderRadius: 16 },
  pin: { width: 13, height: 13, borderRadius: 7, borderWidth: 2.5 },
  legend: {
    position: 'absolute',
    left: spacing.md,
    bottom: spacing.md,
    flexDirection: 'row',
    gap: spacing.xs,
  },
  legendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.full,
  },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendText: { fontFamily: fonts.bold, fontSize: 9, letterSpacing: 0.6 },
});

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
