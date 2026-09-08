import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Pressable, GlassSurface } from '@eyego/ui';
import { formatGhs } from '@eyego/utils';
import { useColors, type DriverColors } from '../../utils/useColors';
import type { StopPassenger, TripStop } from './useTripStops';

/**
 * ── THE STOP TIMELINE ────────────────────────────────────────────────────────
 *
 * The driver's manage and tracking screens, rebuilt around the question a
 * driver is actually asking: WHERE AM I GOING AND WHO IS INVOLVED.
 *
 * The old screens answered a different question. They showed the trip's STATE —
 * a status chip, a six-step rail, a seat grid, a stack of buttons — which is
 * the shape a database has, not the shape a shift has. On a minibus with four
 * passengers and three drop-offs, "FILLING" tells the driver nothing they can
 * act on, and the seat grid tells them who is aboard but not where any of them
 * is going.
 *
 * A timeline of stops answers both at once, and it is why every serious driver
 * app converges on this shape. Each node is a place; the people under it are
 * the ones who get on or off there; the node the driver is heading for is lit
 * and the ones behind are spent. Reading down the list IS reading the rest of
 * the shift.
 *
 * ── DELIBERATELY NOT THE RIDER'S SURFACE ────────────────────────────────────
 * The rider's tracking screen is a single morphing sheet showing one fact at a
 * time, because a passenger has one journey and no decisions. This is the
 * opposite brief — many stops, many people, a decision at every node — so it is
 * a scrollable structure with per-row actions rather than a sheet that deforms.
 *
 * ── CONSTRUCTION ────────────────────────────────────────────────────────────
 *   RAIL      One 2 pt line down the gutter, drawn by the ROW rather than as a
 *             separate absolute layer, so it cannot desync from the content
 *             when a row grows. Solid behind completed stops, dimmed ahead.
 *   NODE      Filled for done, ringed + glowing for current, hollow for
 *             upcoming — three states readable without colour, which matters in
 *             direct sunlight through a windscreen.
 *   ROW       Passengers are `Pressable` with a real 44 pt hit area and their
 *             own pressed state; the whole point of the redesign is that the
 *             decisions live where the people are.
 *   NUMBERS   Fares and seat numbers are tabular so a row does not reflow as
 *             the amount changes.
 */

export interface StopTimelineProps {
  stops: TripStop[];
  /** Tapping a passenger opens their sheet — seat, PIN, call, board, no-show. */
  onPassenger?: (p: StopPassenger, stop: TripStop) => void;
  /** Tapping the stop itself navigates there. */
  onNavigate?: (stop: TripStop) => void;
  /** Rendered inside the CURRENT stop, under its passengers (the cabin strip). */
  currentStopAccessory?: React.ReactNode;
}

export function StopTimeline({
  stops,
  onPassenger,
  onNavigate,
  currentStopAccessory,
}: StopTimelineProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const reduced = useReducedMotion();

  return (
    <View style={styles.root}>
      {stops.map((stop, i) => (
        <StopNode
          key={stop.id}
          stop={stop}
          isLast={i === stops.length - 1}
          index={i}
          reduced={reduced}
          colors={colors}
          styles={styles}
          onPassenger={onPassenger}
          onNavigate={onNavigate}
          accessory={stop.state === 'CURRENT' ? currentStopAccessory : null}
        />
      ))}
    </View>
  );
}

function StopNode({
  stop,
  isLast,
  index,
  reduced,
  colors,
  styles,
  onPassenger,
  onNavigate,
  accessory,
}: {
  stop: TripStop;
  isLast: boolean;
  index: number;
  reduced: boolean;
  colors: DriverColors;
  styles: ReturnType<typeof makeStyles>;
  onPassenger?: (p: StopPassenger, stop: TripStop) => void;
  onNavigate?: (stop: TripStop) => void;
  accessory?: React.ReactNode;
}) {
  const done = stop.state === 'DONE';
  const current = stop.state === 'CURRENT';

  const nodeColor = done ? colors.onSurfaceVariant : current ? colors.primary : colors.outline;
  // The rail AHEAD of a node belongs to the leg the driver has not driven yet,
  // so it dims at the node rather than at the row boundary.
  const railColor = done ? colors.onSurfaceVariant : colors.outlineVariant;

  return (
    <Animated.View
      // 40ms per row: enough to read as a cascade, short enough that a
      // four-stop trip is fully on screen inside a fifth of a second.
      entering={reduced ? undefined : FadeInDown.delay(index * 40).duration(260)}
      style={styles.stop}
    >
      <View style={styles.gutter}>
        <View
          style={[
            styles.node,
            { borderColor: nodeColor },
            done && { backgroundColor: nodeColor },
            current && styles.nodeCurrent,
            current && { backgroundColor: `${colors.primary}22`, borderColor: colors.primary },
          ]}
        >
          {done ? (
            <Ionicons name="checkmark" size={11} color={colors.background} />
          ) : (
            <View style={[styles.nodeCore, { backgroundColor: current ? colors.primary : 'transparent' }]} />
          )}
        </View>
        {/* Flexes to the row's real height — never an absolute guess. */}
        {!isLast && <View style={[styles.rail, { backgroundColor: railColor }]} />}
      </View>

      <View style={styles.body}>
        <Pressable
          onPress={onNavigate ? () => onNavigate(stop) : undefined}
          disabled={!onNavigate}
          style={styles.stopHead}
          hitSlop={6}
          accessibilityRole={onNavigate ? 'button' : undefined}
          accessibilityLabel={onNavigate ? `Navigate to ${stop.title}` : undefined}
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.kind, { color: current ? colors.primary : colors.onSurfaceVariant }]}>
              {stop.kind === 'PICKUP' ? 'PICKUP' : 'DROP-OFF'}
            </Text>
            <Text style={[styles.title, done && styles.titleDone]} numberOfLines={1}>
              {stop.title}
            </Text>
            {stop.address ? (
              <Text style={styles.address} numberOfLines={1}>
                {stop.address}
              </Text>
            ) : null}
          </View>
          {onNavigate && !done ? (
            <View style={styles.navBtn}>
              <Ionicons name="navigate" size={15} color={colors.primary} />
            </View>
          ) : null}
        </Pressable>

        {stop.passengers.length > 0 && (
          <View style={styles.people}>
            {stop.passengers.map((p) => (
              <PassengerRow
                key={`${stop.id}:${p.bookingId}`}
                passenger={p}
                dimmed={done}
                colors={colors}
                styles={styles}
                onPress={onPassenger ? () => onPassenger(p, stop) : undefined}
              />
            ))}
          </View>
        )}

        {accessory ? <View style={styles.accessory}>{accessory}</View> : null}
      </View>
    </Animated.View>
  );
}

function PassengerRow({
  passenger,
  dimmed,
  colors,
  styles,
  onPress,
}: {
  passenger: StopPassenger;
  dimmed: boolean;
  colors: DriverColors;
  styles: ReturnType<typeof makeStyles>;
  onPress?: () => void;
}) {
  const p = passenger;

  /**
   * ONE STATUS PIP, NOT FOUR BADGES.
   *
   * A row can be boarded, unpaid, a no-show, or waiting for a PIN, and the old
   * seat sheet rendered a separate chip for each — four chips on a 40 pt row.
   * Only one of them is ever the thing the driver has to act on, so only one is
   * shown, in the order that matters: a no-show is over, boarded is settled,
   * money outstanding is the live obligation, and everything else is "waiting".
   */
  const pip = p.noShow
    ? { icon: 'close' as const, tone: colors.onSurfaceVariant, label: 'No show' }
    : p.boarded
      ? { icon: 'checkmark' as const, tone: colors.primary, label: 'Aboard' }
      : p.owesPesewas != null
        ? { icon: 'cash-outline' as const, tone: colors.statusWarning, label: formatGhs(p.owesPesewas) }
        : { icon: 'time-outline' as const, tone: colors.onSurfaceVariant, label: 'Waiting' };

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.person,
        pressed && { backgroundColor: colors.surfaceContainerHigh, transform: [{ scale: 0.985 }] },
        dimmed && { opacity: 0.5 },
      ]}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${p.name}, ${pip.label}${p.seatNumber != null ? `, seat ${p.seatNumber}` : ''}`}
    >
      <View style={[styles.seatChip, { borderColor: colors.outline }]}>
        <Text style={styles.seatNum}>{p.seatNumber ?? '—'}</Text>
      </View>

      <View style={{ flex: 1 }}>
        <Text style={[styles.personName, p.noShow && styles.struck]} numberOfLines={1}>
          {p.name}
        </Text>
        {p.bookedBy ? (
          <Text style={styles.personSub} numberOfLines={1}>
            Booked by {p.bookedBy}
          </Text>
        ) : p.extraSeats.length > 0 ? (
          <Text style={styles.personSub} numberOfLines={1}>
            +{p.extraSeats.length} more {p.extraSeats.length === 1 ? 'seat' : 'seats'}
          </Text>
        ) : null}
      </View>

      <View style={[styles.pip, { borderColor: `${pip.tone}55`, backgroundColor: `${pip.tone}14` }]}>
        <Ionicons name={pip.icon} size={11} color={pip.tone} />
        <Text style={[styles.pipLabel, { color: pip.tone }]} numberOfLines={1}>
          {pip.label}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * The cabin, as one strip.
 *
 * The old screen gave the seat map a whole section and a modal per seat. On a
 * timeline the occupancy is context, not content — "4 of 7, two still to board"
 * is the entire useful message, and the people themselves are already listed
 * above under the stop they belong to.
 */
export function CabinStrip({
  seatsTotal,
  seatsTaken,
  boarded,
  onPress,
}: {
  seatsTotal: number;
  seatsTaken: number;
  boarded: number;
  onPress?: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const total = Math.max(0, seatsTotal);
  const cells = Array.from({ length: total }, (_, i) => i);

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={styles.cabin}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${seatsTaken} of ${total} seats booked, ${boarded} aboard`}
    >
      <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.lg} intensity="low" />
      <Ionicons name="car-sport-outline" size={15} color={colors.onSurfaceVariant} />
      <View style={styles.cells}>
        {cells.map((i) => (
          <View
            key={i}
            style={[
              styles.cell,
              i < boarded
                ? { backgroundColor: colors.primary }
                : i < seatsTaken
                  ? { backgroundColor: `${colors.primary}55` }
                  : { backgroundColor: colors.outlineVariant },
            ]}
          />
        ))}
      </View>
      <Text style={styles.cabinCount}>
        {seatsTaken}/{total}
      </Text>
    </Pressable>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    root: { gap: 0 },

    stop: { flexDirection: 'row', gap: spacing.md },

    /** Fixed width so every title starts on the same x, whatever the node is. */
    gutter: { width: 22, alignItems: 'center' },
    node: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 3,
    },
    /** The current node is the only lit object in the gutter. */
    nodeCurrent: {
      shadowColor: colors.primary,
      shadowOpacity: 0.5,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 0 },
    },
    nodeCore: { width: 6, height: 6, borderRadius: 3 },
    rail: { flex: 1, width: 2, borderRadius: 1, marginVertical: 4 },

    body: { flex: 1, paddingBottom: spacing.lg },

    stopHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, minHeight: 44 },
    kind: {
      fontFamily: fonts.semiBold,
      fontSize: 10,
      letterSpacing: 1.1,
    },
    title: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.titleSmall,
      color: colors.onSurface,
      marginTop: 1,
    },
    titleDone: { color: colors.onSurfaceVariant },
    address: {
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodySmall,
      color: colors.onSurfaceVariant,
      marginTop: 1,
    },
    navBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: `${colors.primary}18`,
      borderWidth: 1,
      borderColor: `${colors.primary}44`,
    },

    people: { marginTop: spacing.sm, gap: 6 },
    person: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: 48,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      // Concentric with the seat chip inside it: 12 = 8 + 4 of padding.
      borderRadius: radii.md,
      backgroundColor: colors.surfaceCard,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
    },
    seatChip: {
      width: 30,
      height: 30,
      borderRadius: radii.sm,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    seatNum: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodySmall,
      color: colors.onSurface,
      fontVariant: ['tabular-nums'],
    },
    personName: {
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodyMedium,
      color: colors.onSurface,
    },
    struck: { textDecorationLine: 'line-through', color: colors.onSurfaceVariant },
    personSub: {
      fontFamily: fonts.regular,
      fontSize: fontSizes.caption,
      color: colors.onSurfaceVariant,
      marginTop: 1,
    },
    pip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: radii.full,
      borderWidth: 1,
    },
    pipLabel: {
      fontFamily: fonts.semiBold,
      fontSize: 10,
      letterSpacing: 0.2,
      fontVariant: ['tabular-nums'],
    },

    accessory: { marginTop: spacing.md },

    cabin: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.md,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      overflow: 'hidden',
      minHeight: 48,
    },
    cells: { flexDirection: 'row', gap: 4, flex: 1 },
    cell: { flex: 1, height: 8, borderRadius: 2, maxWidth: 26 },
    cabinCount: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodySmall,
      color: colors.onSurface,
      fontVariant: ['tabular-nums'],
    },
  });
