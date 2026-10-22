import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, type Href } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { tripsApi, bookingsApi, socketEvents, connectSocket } from '@eyego/api';
import { useShallow } from 'zustand/react/shallow';
import { formatGhs, clockTime } from '@eyego/utils';
import { useRideStore } from '../../../stores/ride.store';
import { fonts, fontSizes, spacing, radii, withOpacity } from '@eyego/config';
import { useColors, Colors } from '../../../utils/useColors';
import { layoutFor, type CabinSeat, type CabinLayout } from '../../../components/seat/VehicleCabin';
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
  useDepthMotion,
} from '@eyego/ui';
import { Cabin3D } from '../../../components/seat/Cabin3D';
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
  const motion = useDepthMotion();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const { id, pickupStopId } = useLocalSearchParams<{ id: string; pickupStopId?: string }>();
  const queryClient = useQueryClient();
  const { setSelectedSeat, selectedTrip } = useRideStore(
    useShallow((s) => ({ setSelectedSeat: s.setSelectedSeat, selectedTrip: s.selectedTrip })),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  /** The rider's own releasable hold reads as free and is chosen for them (`isMyHold`). */
  const myHoldNumbers = useMemo(
    () => new Set<number>(rawSeats.filter((s: any) => s?.isMyHold).map((s: any) => s.number)),
    [rawSeats],
  );
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

  /** Capacity picks the body template — a saloon is never drawn as a minibus. */
  const seatCount =
    (selectedTrip as { vehicle?: { seaterCount?: number } })?.vehicle?.seaterCount ??
    (selectedTrip as { maxSeats?: number })?.maxSeats ??
    seats.length;

  const selectedSeat = seats.find((s) => s.id === selectedId);
  const freeCount = seats.filter((s) => s.status === 'AVAILABLE').length;
  const heldCount = seats.filter((s) => (s.status as string) === 'PENDING').length;
  const cabinLayout = useMemo(() => layoutFor(seatCount || seats.length || 4), [seatCount, seats.length]);

  // Arrive holding a seat → it is already chosen. Once.
  const preselectedRef = useRef(false);
  useEffect(() => {
    if (preselectedRef.current || selectedId || myHoldNumbers.size === 0) return;
    preselectedRef.current = true;
    setSelectedId(`seat-${Math.min(...myHoldNumbers)}`);
  }, [myHoldNumbers, selectedId]);

  // The map is live: a seat taken from under the rider is let go, and said so.
  // Focus-gated — this screen stays mounted under payment, where the rider's
  // own booking turns this very seat OCCUPIED.
  const isFocused = useIsFocused();
  useEffect(() => {
    if (!isFocused || !selectedSeat || selectedSeat.status === 'AVAILABLE') return;
    setSelectedId(null);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    notify(`Seat ${selectedSeat.number} was just taken`, 'Pick another — the seat map is live.', { tone: 'info' });
  }, [selectedSeat, isFocused]);

  const chooseSeat = (seatId: string | null) => {
    void Haptics.selectionAsync().catch(() => {});
    setSelectedId(seatId);
  };

  /** "Pick for me": windows front to back, then the front seat, the bench ends, the rest. */
  const pickForMe = () => {
    const free = new Set(seats.filter((x) => x.status === 'AVAILABLE').map((x) => x.number));
    const { rows, bench, front } = cabinLayout;
    const order = [
      ...rows.flatMap((r) => [r.pair[0], r.single].filter((n): n is number => n != null)),
      ...front,
      ...bench.filter((_, i) => i === 0 || i === bench.length - 1),
      ...rows.map((r) => r.pair[1]),
      ...bench,
    ];
    const best = order.find((n) => free.has(n));
    if (best != null) chooseSeat(`seat-${best}`);
  };

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

  const [dropoffStopId, setDropoffStopId] = useState<string | null>(null);
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
    if (!selectedSeat) return;
    setSelectedSeat(selectedSeat);
    // Both stop ids travel to payment, which is what books the seat.
    const query = [
      pickupStopId ? `pickupStopId=${pickupStopId}` : '',
      dropoffStopId ? `dropoffStopId=${dropoffStopId}` : '',
      dropoff ? `dropoffLat=${dropoff.latitude}&dropoffLng=${dropoff.longitude}` : '',
      dropoff?.address ? `dropoffAddress=${encodeURIComponent(dropoff.address)}` : '',
      `tier=${busTier}`,
    ]
      .filter(Boolean)
      .join('&');
    goDeeper(`/ride/${id}/payment${query ? `?${query}` : ''}` as Href);
  };

  // The cabin gets whatever the header and the sheet's peek leave.
  const cabinSize = Math.max(220, Math.min(winW - spacing.lg * 2, winH - insets.top - insets.bottom - 360, 440));

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
  const peek = (
    <View style={styles.peekRow}>
      <View style={[styles.seatTile, selectedSeat && { backgroundColor: withOpacity(colors.primary, 0.14), borderColor: withOpacity(colors.primary, 0.5) }]}>
        {selectedSeat ? (
          <Animated.Text key={selectedSeat.id} entering={FadeIn.duration(180)} style={[styles.seatTileNum, { color: colors.primary }]}>
            {selectedSeat.number}
          </Animated.Text>
        ) : (
          <Ionicons name="person-outline" size={20} color={colors.onSurfaceVariant} />
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.peekTitle} numberOfLines={1}>
          {selectedSeat ? `Seat ${selectedSeat.number}` : freeCount > 0 ? 'Choose your seat' : 'This ride is full'}
        </Text>
        {selectedSeat ? (
          <Text variant="caption" color={colors.onSurfaceVariant} numberOfLines={1}>
            {myHoldNumbers.has(selectedSeat.number) ? 'Held for you · ' : ''}
            {describeSeat(selectedSeat.number, cabinLayout)}
          </Text>
        ) : freeCount > 0 ? (
          <Pressable onPress={pickForMe} hitSlop={8} style={styles.pickForMe} accessibilityRole="button" accessibilityLabel="Pick the best seat for me">
            <Ionicons name="sparkles" size={13} color={colors.primary} />
            <Text style={[styles.pickForMeText, { color: colors.primary }]}>Pick the best seat for me</Text>
          </Pressable>
        ) : null}
      </View>
      {farePesewas != null ? (
        <View style={styles.fareBlock}>
          <Text style={[styles.fareValue, repricing && { opacity: 0.55 }]}>{formatGhs(farePesewas)}</Text>
          <Text variant="caption" color={saving > 0 ? colors.primary : colors.onSurfaceVariant}>
            {saving > 0 ? `You save ${formatGhs(saving)}` : 'per seat'}
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
      label={selectedSeat ? `Continue · Seat ${selectedSeat.number}` : 'Choose a seat'}
      onPress={handleConfirm}
      disabled={!selectedId}
    />
  );

  return (
    <View style={styles.root}>
      <AppBackground variant="static" isDark={isDark} />

      <View style={{ paddingTop: insets.top }}>
        <Header colors={colors} styles={styles} subtitle={routeLabel} />
        {seats.length ? (
          <Animated.View entering={FadeInDown.duration(280)} style={styles.facts}>
            <Fact styles={styles} dot={freeCount > 2 ? colors.primary : colors.statusWarning} label={freeCount === 0 ? 'Full' : `${freeCount} seat${freeCount === 1 ? '' : 's'} left`} />
            {departs && departs !== '—' ? <Fact styles={styles} icon="time-outline" color={colors.onSurfaceVariant} label={`Leaves ${departs}`} /> : null}
            <Fact styles={styles} icon="bus-outline" color={tierTheme.accent} label={`${tierTheme.label} · ${cabinLayout.label}`} />
          </Animated.View>
        ) : null}
      </View>

      {/* The cabin — the only vehicle on this page. */}
      <View style={styles.stage}>
        <Cabin3D
          seats={seats}
          seatCount={seatCount}
          selectedId={selectedId}
          onSelect={(seat: CabinSeat) => {
            if (seat.status !== 'AVAILABLE') return;
            chooseSeat(selectedId === seat.id ? null : seat.id);
          }}
          size={cabinSize}
          accent={colors.primary}
          body={(LIVERY[busTier] ?? LIVERY.ECO).body}
          dark={isDark}
          motion={motion}
        />
        <View style={styles.legend}>
          <LegendItem colors={colors} tone="free" label="Free" />
          <LegendItem colors={colors} tone="selected" label="Yours" />
          {heldCount > 0 ? <LegendItem colors={colors} tone="pending" label="On hold" /> : null}
          <LegendItem colors={colors} tone="taken" label="Taken" />
          {motion ? <Text variant="caption" color={colors.onSurfaceVariant}>· swipe to look around</Text> : null}
        </View>
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

/** Where a seat is, in the words a rider uses: window or aisle, which row. */
function describeSeat(n: number, layout: CabinLayout): string {
  if (layout.front.includes(n)) return 'Front · beside the driver';
  const ri = layout.rows.findIndex((r) => r.pair.includes(n) || r.single === n);
  if (ri >= 0) {
    const r = layout.rows[ri];
    return `${r.pair[1] === n ? 'Aisle' : 'Window'} · Row ${ri + 1}`;
  }
  const bi = layout.bench.indexOf(n);
  if (bi >= 0) return bi === 0 || bi === layout.bench.length - 1 ? 'Back row · window' : 'Back row · middle';
  return '';
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

function LegendItem({
  colors,
  tone,
  label,
}: {
  colors: Colors;
  tone: 'free' | 'selected' | 'pending' | 'taken';
  label: string;
}) {
  const bg =
    tone === 'selected' ? colors.primary
    : tone === 'pending' ? `${colors.statusWarning}22`
    : tone === 'taken' ? colors.surfaceContainerHigh
    : 'transparent';
  const border =
    tone === 'selected' ? colors.primary
    : tone === 'pending' ? colors.statusWarning
    : tone === 'taken' ? colors.outlineVariant
    : `${colors.onSurface}99`;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: bg, borderWidth: 1.25, borderColor: border }} />
      <Text variant="caption" color={tone === 'selected' ? colors.onSurface : colors.onSurfaceVariant}>
        {label}
      </Text>
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
    legend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: spacing.base },

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
