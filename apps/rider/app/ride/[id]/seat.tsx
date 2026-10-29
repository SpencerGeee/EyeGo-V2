import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, type Href } from 'expo-router';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { tripsApi, bookingsApi, socketEvents, connectSocket } from '@eyego/api';
import { useShallow } from 'zustand/react/shallow';
import { formatGhs, clockTime } from '@eyego/utils';
import { useRideStore } from '../../../stores/ride.store';
import { fonts, fontSizes, spacing, radii, withOpacity, MAX_SEATS_PER_BOOKING } from '@eyego/config';
import { useColors, Colors } from '../../../utils/useColors';
import { RouteDropoffMap, type RouteDropoff } from '../../../components/seat/RouteDropoffMap';
import { useThemeStore } from '../../../stores/theme.store';
import {
  Text,
  Button,
  EmptyState,
  AppBackground,
  Pressable,
  SnapSheet,
  goDeeper,
  goBack,
  getTierTheme,
  notify,
} from '@eyego/ui';
import { LIVERY } from '../../../components/trip/RidePicker';
import type { Seat } from '@eyego/types';

/**
 * ── PICK YOUR SEAT ──────────────────────────────────────────────────────────
 *
 * The vehicle is the page; the decision is one sheet.
 *
 * REBUILT ("the bus morphs wrong and sits in the middle of the pick-your-seat
 * screen with the view at the top like watching from the rooftop … it's
 * overlapping the new 3D inside-bus"; "the where-do-you-get-off section and all
 * the parts of the page look boring and off").
 *
 *  · NO FLYING BUS. The hero bus used to land top-down over the cabin and
 *    linger on top of it. The cabin is the only vehicle here now, opening on
 *    its three-quarter view — see Cabin3D.
 *  · ONE SHEET, TWO DETENTS, THE SNAP SHEET. Peek: your seat and its price.
 *    Half: where you get off. The Continue button is pinned under both, so it
 *    can never scroll away or be covered.
 *  · WHERE YOU GET OFF IS A CHOICE, NOT A MAP IN A SCROLL VIEW. Two clear
 *    options — ride to the end, or get off earlier and pay less — and the
 *    second opens the route full-screen, tilted into the city, to drop a pin
 *    on. A pannable map inside a draggable sheet fights the sheet on every
 *    vertical swipe; neither Uber nor Bolt ever puts one there.
 *  · THE PRICE IS THE SERVER'S PREVIEW for these exact choices — the number
 *    the booking is written with (`priceSeat`), and the saving is shown as a
 *    saving, against the full-route fare from the same answer.
 */

const SEATS_PER_ROW = 3;

export default function SeatPickerScreen() {
  const colors = useColors();
  const isDark = useThemeStore((s) => s.isDark);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { id, pickupStopId, dropoffStopId: dropoffStopParam, walkUpCode } = useLocalSearchParams<{ id: string; pickupStopId?: string; dropoffStopId?: string; walkUpCode?: string }>();
  const queryClient = useQueryClient();
  const { setSelectedSeat, selectedTrip } = useRideStore(
    useShallow((s) => ({ setSelectedSeat: s.setSelectedSeat, selectedTrip: s.selectedTrip })),
  );

  const { data, isError, refetch } = useQuery({
    queryKey: ['seats', id],
    queryFn: () => tripsApi.getSeats(id ?? ''),
    enabled: !!id,
  });

  useEffect(() => {
    connectSocket();
    // TripStatusListener owns joining/leaving trip rooms; this only listens.
    const unsub = socketEvents.onSeatUpdate(() => {
      queryClient.invalidateQueries({ queryKey: ['seats', id] });
    });
    return () => {
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const rawSeats = (data?.data?.data as any)?.seats || (data?.data as any)?.seats || [];

  const seats: Seat[] = useMemo(
    () =>
      rawSeats.map((s: any) => ({
        id: `seat-${s.number}`,
        number: s.number,
        row: Math.floor((s.number - 1) / SEATS_PER_ROW),
        column: (s.number - 1) % SEATS_PER_ROW,
        status:
          s.status === 'AVAILABLE' || s.isMyHold
            ? 'AVAILABLE'
            : s.status === 'PENDING'
              ? 'PENDING'
              : 'OCCUPIED',
      })),
    [rawSeats],
  );

  /**
   * NO SEAT PICKING (client 2026-10-29, D1/D7). A trotro is boarded, not
   * assigned: the rider says HOW MANY, one booking covers them all, and they
   * sit anywhere. Free seats are the rider's own stretch when search sent them
   * (a seat freed at Kaneshie is free from Kaneshie on), else the live count.
   */
  const freeCount = seats.filter((s) => s.status === 'AVAILABLE').length;
  const spanFree = (selectedTrip as { availableSeats?: number })?.availableSeats;
  const freeForMe = typeof spanFree === 'number' ? Math.min(spanFree, seats.length ? freeCount : spanFree) : freeCount;
  const maxSeats = Math.max(1, Math.min(MAX_SEATS_PER_BOOKING, freeForMe));
  const [count, setCount] = useState(1);
  useEffect(() => {
    if (count > maxSeats) setCount(maxSeats);
  }, [count, maxSeats]);
  const step = (d: number) => {
    void Haptics.selectionAsync().catch(() => {});
    setCount((c) => Math.min(maxSeats, Math.max(1, c + d)));
  };
  const isFull = seats.length > 0 && freeForMe <= 0;

  const busTier = String((selectedTrip as any)?.tier ?? 'ECO').toUpperCase() as keyof typeof LIVERY;
  const tierTheme = getTierTheme(colors as any, busTier);
  const shortPlace = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.split(',')[0].trim() : null;
  const fromName = shortPlace((selectedTrip as any)?.origin?.address);
  const toName = shortPlace((selectedTrip as any)?.destination?.address);
  const routeLabel =
    fromName && toName ? `${fromName} → ${toName}` : ((selectedTrip as any)?.route?.name as string | undefined) ?? null;
  const departs = (selectedTrip as any)?.departureTime ? clockTime((selectedTrip as any).departureTime) : null;

  // ── Where you get off ─────────────────────────────────────────────────────
  const stops =
    (selectedTrip as { route?: { virtualStops?: { id: string; name: string }[] } })?.route?.virtualStops ?? [];
  const coordOf = (lng: unknown, lat: unknown): [number, number] | null =>
    Number.isFinite(lng) && Number.isFinite(lat) ? [lng as number, lat as number] : null;
  const routeOrigin = coordOf((selectedTrip as any)?.route?.originLng, (selectedTrip as any)?.route?.originLat);
  const routeDestination = coordOf((selectedTrip as any)?.route?.destLng, (selectedTrip as any)?.route?.destLat);
  const routeLine: [number, number][] | null = (selectedTrip as any)?.path?.geometry?.coordinates ?? null;
  const canPin = routeLine != null && routeLine.length >= 2;
  const hasAlight = canPin || stops.length > 0;

  const [dropoffStopId, setDropoffStopId] = useState<string | null>(dropoffStopParam ?? null);
  /** A free pin on the route — see RouteDropoffMap. Exclusive with a named stop. */
  const [dropoff, setDropoff] = useState<RouteDropoff | null>(null);
  const [pickingPin, setPickingPin] = useState(false);
  const rideToEnd = () => {
    void Haptics.selectionAsync().catch(() => {});
    setDropoffStopId(null);
    setDropoff(null);
  };
  const chooseStop = (stopId: string) => {
    void Haptics.selectionAsync().catch(() => {});
    setDropoffStopId(stopId);
    setDropoff(null);
  };

  /** The server's price for exactly these choices — see the header. */
  const { data: farePreview, isFetching: repricing } = useQuery({
    queryKey: ['seat-fare-preview', id, pickupStopId ?? null, dropoffStopId, dropoff?.latitude ?? null, dropoff?.longitude ?? null],
    queryFn: () =>
      bookingsApi.previewFare({
        tripId: id ?? '',
        pickupStopId: pickupStopId ?? null,
        dropoffStopId,
        ...(dropoff ? { dropoffLat: dropoff.latitude, dropoffLng: dropoff.longitude, dropoffAddress: dropoff.address } : {}),
      }),
    enabled: !!id,
    staleTime: 30_000,
    // While a moved pin is re-priced the last real price stays.
    placeholderData: (prev) => prev,
  });
  const farePesewas = farePreview?.farePerSeatPesewas ?? (selectedTrip as any)?.farePerSeatPesewas ?? null;
  const fullFare = farePreview?.fullFarePerSeatPesewas ?? null;
  const saving = farePesewas != null && fullFare != null && fullFare > farePesewas ? fullFare - farePesewas : 0;
  const leavingEarly = dropoff != null || dropoffStopId != null;
  const stopName = dropoffStopId ? stops.find((s) => s.id === dropoffStopId)?.name ?? null : null;

  const handleConfirm = () => {
    if (isFull) return;
    setSelectedSeat(null);
    // Both stop ids travel to payment, which is what books the seat.
    const query = [
      pickupStopId ? `pickupStopId=${pickupStopId}` : '',
      dropoffStopId ? `dropoffStopId=${dropoffStopId}` : '',
      walkUpCode ? `walkUpCode=${walkUpCode}` : '',
      dropoff ? `dropoffLat=${dropoff.latitude}&dropoffLng=${dropoff.longitude}` : '',
      dropoff?.address ? `dropoffAddress=${encodeURIComponent(dropoff.address)}` : '',
      `tier=${busTier}`,
      `seats=${count}`,
    ]
      .filter(Boolean)
      .join('&');
    goDeeper(`/ride/${id}/payment${query ? `?${query}` : ''}` as Href);
  };

  // Fail loudly: never a fabricated seat layout.
  if (isError) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <AppBackground variant="static" isDark={isDark} />
        <Header colors={colors} styles={styles} subtitle={null} />
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState
            icon="car-outline"
            title="Couldn't load seats"
            subtitle="Check your connection and try again."
            action={{ label: 'Try again', onPress: () => refetch() }}
          />
        </View>
      </View>
    );
  }

  // ── The sheet ───────────────────────────────────────────────────────────
  const total = farePesewas != null ? farePesewas * count : null;
  const peek = (
    <View style={styles.peekRow}>
      <View style={[styles.seatTile, { backgroundColor: withOpacity(colors.primary, 0.14), borderColor: withOpacity(colors.primary, 0.5) }]}>
        <Animated.Text key={count} entering={FadeIn.duration(180)} style={[styles.seatTileNum, { color: colors.primary }]}>
          {count}
        </Animated.Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.peekTitle} numberOfLines={1}>
          {isFull ? 'This bus is full' : `${count} seat${count === 1 ? '' : 's'}`}
        </Text>
        <Text variant="caption" color={colors.onSurfaceVariant} numberOfLines={1}>
          {count > 1 ? 'One booking · everyone boards with it' : 'Sit anywhere on board'}
        </Text>
      </View>
      {total != null ? (
        <View style={styles.fareBlock}>
          <Text style={[styles.fareValue, repricing && { opacity: 0.55 }]}>{formatGhs(total)}</Text>
          <Text variant="caption" color={saving > 0 ? colors.primary : colors.onSurfaceVariant}>
            {saving > 0 ? `You save ${formatGhs(saving * count)}` : count > 1 ? `${formatGhs(farePesewas!)} each` : 'per seat'}
          </Text>
        </View>
      ) : null}
    </View>
  );

  const half = hasAlight ? (
    <View style={styles.alight}>
      <Text style={styles.sectionLabel}>WHERE ARE YOU GETTING OFF?</Text>
      <OptionRow
        colors={colors}
        styles={styles}
        icon="flag"
        title="Ride to the end"
        subtitle={toName ? `Final stop · ${toName}` : 'The final stop of this route'}
        trailing={fullFare != null ? formatGhs(fullFare) : null}
        selected={!leavingEarly}
        onPress={rideToEnd}
      />
      {canPin ? (
        <OptionRow
          colors={colors}
          styles={styles}
          icon="location"
          title={dropoff ? 'Getting off on the way' : 'Get off earlier'}
          subtitle={dropoff?.address ?? 'Drop a pin on the route · pay only for the road you ride'}
          trailing={dropoff ? 'Change' : 'Pick'}
          trailingAccent
          selected={dropoff != null}
          onPress={() => setPickingPin(true)}
        />
      ) : null}
      {stops.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          <Text variant="caption" color={colors.onSurfaceVariant}>Stops on this route</Text>
          <View style={styles.chips}>
            {stops.map((stop) => {
              const on = dropoffStopId === stop.id;
              return (
                <Pressable
                  key={stop.id}
                  onPress={() => chooseStop(stop.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={[styles.chip, on && { backgroundColor: colors.primary, borderColor: colors.primary }]}
                >
                  <Text variant="caption" color={on ? colors.onPrimary : colors.onSurface} numberOfLines={1}>
                    {stop.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
      {leavingEarly ? (
        <Animated.View entering={FadeInDown.duration(220)} exiting={FadeOut.duration(140)} style={styles.savingNote}>
          <Ionicons name="leaf-outline" size={14} color={colors.primary} />
          <Text variant="caption" color={colors.onSurface} style={{ flex: 1 }}>
            {stopName ? `Dropping you at ${stopName}. ` : ''}You pay for the part of the route you ride
            {saving > 0 ? ` — ${formatGhs(saving)} less than the full trip.` : '.'}
          </Text>
        </Animated.View>
      ) : null}
    </View>
  ) : undefined;

  const footer = (
    <Button
      variant="glow"
      label={isFull ? 'This bus is full' : `Continue · ${count} seat${count === 1 ? '' : 's'}`}
      onPress={handleConfirm}
      disabled={isFull}
    />
  );

  return (
    <View style={styles.root}>
      <AppBackground variant="static" isDark={isDark} />

      <View style={{ paddingTop: insets.top }}>
        <Header colors={colors} styles={styles} subtitle={routeLabel} />
        {seats.length ? (
          <Animated.View entering={FadeInDown.duration(280)} style={styles.facts}>
            <Fact styles={styles} dot={freeForMe > 2 ? colors.primary : colors.statusWarning} label={freeForMe <= 0 ? 'Full' : `${freeForMe} seat${freeForMe === 1 ? '' : 's'} left`} />
            {departs && departs !== '—' ? <Fact styles={styles} icon="time-outline" color={colors.onSurfaceVariant} label={`Leaves ${departs}`} /> : null}
            <Fact styles={styles} icon="bus-outline" color={tierTheme.accent} label={tierTheme.label} />
          </Animated.View>
        ) : null}
      </View>

      {/* How many — the whole question now (D1). */}
      <View style={styles.stage}>
        <Text style={styles.sectionLabel}>HOW MANY SEATS?</Text>
        <View style={styles.stepper}>
          <Pressable onPress={() => step(-1)} disabled={count <= 1} hitSlop={8} accessibilityRole="button" accessibilityLabel="Fewer seats" style={[styles.stepBtn, count <= 1 && { opacity: 0.35 }]}>
            <Ionicons name="remove" size={26} color={colors.onSurface} />
          </Pressable>
          <Animated.Text key={`n${count}`} entering={FadeIn.duration(160)} style={[styles.stepValue, { color: colors.onSurface }]}>
            {count}
          </Animated.Text>
          <Pressable onPress={() => step(1)} disabled={count >= maxSeats} hitSlop={8} accessibilityRole="button" accessibilityLabel="More seats" style={[styles.stepBtn, count >= maxSeats && { opacity: 0.35 }]}>
            <Ionicons name="add" size={26} color={colors.onSurface} />
          </Pressable>
        </View>
        <Text variant="caption" color={colors.onSurfaceVariant} style={{ textAlign: 'center', paddingHorizontal: spacing.xl }}>
          {count > 1
            ? `Booking for others too? They don't need the app — they board with your booking.`
            : 'Seats are not numbered. Board and sit anywhere.'}
        </Text>
      </View>

      <SnapSheet peek={peek} half={half} footer={footer} backgroundColor={colors.surfaceCard} radius={28} gutter={spacing.xl} />

      {pickingPin && canPin ? (
        <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(160)} style={StyleSheet.absoluteFill}>
          <RouteDropoffMap
            variant="screen"
            insets={{ top: insets.top, bottom: insets.bottom }}
            onClose={() => setPickingPin(false)}
            route={routeLine}
            origin={routeOrigin}
            destination={routeDestination}
            value={dropoff}
            onChange={(next) => {
              setDropoff(next);
              if (next) setDropoffStopId(null);
              setPickingPin(false);
            }}
            isDark={isDark}
            accent={colors.primary}
            colors={colors as unknown as Record<string, string>}
            destinationName={toName}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

/** One answer to "where do you get off", as a selectable row. */
function OptionRow({
  colors,
  styles,
  icon,
  title,
  subtitle,
  trailing,
  trailingAccent,
  selected,
  onPress,
}: {
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
  trailing: string | null;
  trailingAccent?: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}. ${subtitle}`}
      style={[styles.option, selected && { borderColor: colors.primary, backgroundColor: withOpacity(colors.primary, 0.08) }]}
    >
      <View style={[styles.optionIcon, { backgroundColor: selected ? colors.primary : colors.surfaceContainerHigh }]}>
        <Ionicons name={icon} size={15} color={selected ? colors.onPrimary : colors.onSurface} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.optionTitle} numberOfLines={1}>{title}</Text>
        <Text variant="caption" color={colors.onSurfaceVariant} numberOfLines={2}>{subtitle}</Text>
      </View>
      {trailing ? (
        <Text style={[styles.optionTrailing, { color: trailingAccent ? colors.primary : colors.onSurface }]}>{trailing}</Text>
      ) : null}
    </Pressable>
  );
}

function Fact({
  styles,
  label,
  icon,
  color,
  dot,
}: {
  styles: ReturnType<typeof makeStyles>;
  label: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  color?: string;
  dot?: string;
}) {
  return (
    <View style={styles.fact}>
      {dot ? <View style={[styles.liveDot, { backgroundColor: dot }]} /> : icon ? <Ionicons name={icon} size={12} color={color} /> : null}
      <Text style={styles.factText} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function Header({
  colors,
  styles,
  subtitle,
}: {
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
  subtitle: string | null;
}) {
  return (
    <View style={styles.header}>
      <Pressable
        onPress={() => goBack()}
        style={styles.backBtn}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Pick your seat</Text>
        {subtitle ? (
          <Text variant="caption" color={colors.onSurfaceVariant} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.backgroundDeep ?? colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.md,
    },
    backBtn: {
      width: 40,
      height: 40,
      borderRadius: radii.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceContainer,
    },
    title: {
      fontFamily: fonts.displaySemiBold,
      fontSize: fontSizes.headlineSmall,
      color: colors.onSurface,
      letterSpacing: -0.4,
    },
    facts: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      paddingHorizontal: spacing.xl,
    },
    fact: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radii.full,
      backgroundColor: `${colors.surfaceContainerHigh}CC`,
      borderWidth: 1,
      borderColor: `${colors.onSurface}14`,
    },
    factText: { fontFamily: fonts.medium, fontSize: fontSizes.caption, color: colors.onSurface },
    liveDot: { width: 7, height: 7, borderRadius: 3.5 },
    // Centred in what the header leaves, lifted clear of the sheet's peek.
    stage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 170, gap: spacing.sm },
    stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl, marginVertical: spacing.md },
    stepBtn: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: colors.outlineVariant,
      backgroundColor: colors.surfaceCard,
    },
    stepValue: { fontFamily: fonts.semiBold, fontSize: 64, minWidth: 80, textAlign: 'center', fontVariant: ['tabular-nums'] },

    peekRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    seatTile: {
      width: 48,
      height: 48,
      borderRadius: radii.lg,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceContainerHigh,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
    },
    seatTileNum: { fontFamily: fonts.displayBold, fontSize: fontSizes.titleLarge },
    peekTitle: { fontFamily: fonts.displaySemiBold, fontSize: fontSizes.titleMedium, color: colors.onSurface },
    pickForMe: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    pickForMeText: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodySmall },
    fareBlock: { alignItems: 'flex-end', gap: 2 },
    fareValue: { fontFamily: fonts.displayBold, fontSize: fontSizes.titleLarge, color: colors.onSurface, letterSpacing: -0.4 },

    alight: { gap: spacing.md, paddingTop: spacing.sm },
    sectionLabel: { fontFamily: fonts.medium, fontSize: 11, letterSpacing: 0.8, color: colors.onSurfaceVariant },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      backgroundColor: colors.surfaceContainer,
    },
    optionIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    optionTitle: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, color: colors.onSurface },
    optionTrailing: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: {
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.sm,
      borderRadius: radii.full,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
    },
    savingNote: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      padding: spacing.md,
      borderRadius: radii.lg,
      backgroundColor: withOpacity(colors.primary, 0.08),
    },
  });
