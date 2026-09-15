import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, type Href } from 'expo-router';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withSpring,
} from 'react-native-reanimated';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { tripsApi, socketEvents, connectSocket } from '@eyego/api';
import { useShallow } from 'zustand/react/shallow';
import { formatGhs } from '@eyego/utils';
import { useRideStore } from '../../../stores/ride.store';
import { fonts, fontSizes, spacing, radii, springs } from '@eyego/config';
import { useColors, Colors } from '../../../utils/useColors';
import { VehicleCabin, layoutFor, type CabinSeat } from '../../../components/seat/VehicleCabin';
import { useThemeStore } from '../../../stores/theme.store';
import {
  Text,
  Button,
  EmptyState,
  AppBackground,
  MorphSheet,
  goDeeper,
  goBack,
} from '@eyego/ui';
import type { Seat } from '@eyego/types';

/**
 * PICK A SEAT — the vehicle is the page.
 *
 * BUGFIX ("I want you to redesign the pick a seat page of the rider app. It's
 * using the old design and we need a new page for that so it's complete").
 *
 * ── WHAT WAS ACTUALLY WRONG, BEYOND THE STYLING ─────────────────────────────
 *
 * The old screen laid seats out as `column = (number - 1) % 3` — a flat
 * three-across grid with no aisle and no orientation. That is not a minibus,
 * and it is the reason the page never read as "choose where you will sit": a
 * rider could not tell the window from the aisle, the front from the back, or
 * which side they would be boarding from. A seat map that does not resemble the
 * vehicle is just a numbered keypad.
 *
 * So the cabin is drawn properly, and the drawing now lives in `VehicleCabin`:
 * a top-down architectural view of the vehicle with a lit body outline, a real
 * aisle, the driver's wheel marking the front, and a body template chosen from
 * the vehicle's own `seaterCount` so a saloon is never drawn as a minibus. Same
 * seat numbers, same statuses — the same data, finally arranged like the thing
 * it describes.
 *
 * It opens with a camera move: a low three-quarter view of the vehicle swinging
 * up and over to flat top-down. That is a perspective transform on the canvas
 * rather than a 3D scene, so it costs no dependency and cannot fail on a cheap
 * handset. See the note in VehicleCabin.
 *
 * The price rides in a tooltip above the chosen seat rather than only in the
 * footer, so the number and what it costs are one object.
 *
 * ── AND THE SHELL ───────────────────────────────────────────────────────────
 *
 * It was a `ScrollView` with staggered `Entrance` slide-ins per row and a glass
 * box pinned at the bottom. Every other rider surface had long since moved to
 * the shared sheet, which is what made this page feel like it belonged to an
 * older app — the same complaint made about the driver's screens, and the same
 * cause: the motion, not the paint.
 *
 * The vehicle now owns the screen and the action sits in a `MorphSheet`, so the
 * fare and the Confirm ride on the same physics as every other sheet in both
 * apps. The per-row entrance stagger is gone: fourteen seats sliding in one
 * after another is 400 ms of waiting before a rider can tap anything, on the
 * one screen whose entire purpose is a single tap.
 */

const SEATS_PER_ROW = 3;

export default function SeatPickerScreen() {
  const colors = useColors();
  const isDark = useThemeStore((s) => s.isDark);
  const styles = useMemo(() => makeStyles(colors), [colors]);
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

  const tripRef = useRef(selectedTrip);
  useEffect(() => {
    tripRef.current = selectedTrip;
  }, [selectedTrip]);

  useEffect(() => {
    connectSocket();
    // TripStatusListener owns joining/leaving trip rooms and the ref-counted
    // socket lifecycle. This only subscribes to seat changes; connecting or
    // disconnecting here fought that and caused churn.
    const unsub = socketEvents.onSeatUpdate(() => {
      queryClient.invalidateQueries({ queryKey: ['seats', id] });
    });
    return () => {
      unsub();
    };
    // Intentionally only on mount/unmount — do NOT re-run on selectedTrip change.
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
        // PENDING = SEAT_HELD (payment not confirmed) — amber, still unselectable.
        status:
          s.status === 'AVAILABLE' ? 'AVAILABLE' : s.status === 'PENDING' ? 'PENDING' : 'OCCUPIED',
      })),
    [rawSeats],
  );

  /**
   * Capacity, which is what picks the body template — a saloon must not be
   * drawn as a minibus. The vehicle row is authoritative; the seat list is the
   * fallback for a trip whose vehicle has not loaded yet, and it is the same
   * number in every case that matters.
   */
  const seatCount =
    (selectedTrip as { vehicle?: { seaterCount?: number } })?.vehicle?.seaterCount ??
    (selectedTrip as { maxSeats?: number })?.maxSeats ??
    seats.length;

  const selectedSeat = seats.find((s) => s.id === selectedId);
  const freeCount = seats.filter((s) => s.status === 'AVAILABLE').length;
  const heldCount = seats.filter((s) => (s.status as string) === 'PENDING').length;
  const farePesewas = (selectedTrip as any)?.farePerSeatPesewas ?? null;
  const tierLabel: string =
    (selectedTrip as any)?.tier?.name ?? (selectedTrip as any)?.tierName ?? 'Standard';
  // "Accra Express • Sprinter 15-Seater": the route and the body, as the
  // reference frame captions it.
  const routeName: string | null =
    (selectedTrip as any)?.route?.name ??
    ((selectedTrip as any)?.route?.origin && (selectedTrip as any)?.route?.destination
      ? `${(selectedTrip as any).route.origin} → ${(selectedTrip as any).route.destination}`
      : null);
  const bodyLabel = `${layoutFor(seatCount || seats.length || 4).label} ${seatCount || seats.length}-Seater`;
  const subtitle = seats.length
    ? `${routeName ? `${routeName} • ` : ''}${bodyLabel} • ${freeCount} free`
    : null;

  /**
   * ── WHERE DO YOU GET OFF? ───────────────────────────────────────────────
   *
   * "it would make sense if someone would like to alight inbetween to which you
   * have to make sure you correctly and fully implement that functionality so
   * if someone is on the ride but wouldnt go the full distance, they get charged
   * less instead of full ... it should be easy to access meaning it should be
   * seen on the stages of booking the ride."
   *
   * So it sits here, in the flow, one step after choosing a seat and before
   * paying for it — not buried in a menu the rider would have to know to look
   * for. Every option is a `VirtualStop`, which is a point ON the route the
   * driver is already driving, so choosing one costs the vehicle no detour and
   * cannot inconvenience anyone else aboard. Null is "ride to the end", which
   * is the default and what every booking meant before this existed.
   */
  const stops =
    (selectedTrip as { route?: { virtualStops?: { id: string; name: string }[] } })?.route
      ?.virtualStops ?? [];
  const [dropoffStopId, setDropoffStopId] = useState<string | null>(null);

  const handleConfirm = () => {
    if (!selectedSeat) return;
    setSelectedSeat(selectedSeat);
    /**
     * Both stop ids travel to payment, which is what actually books the seat.
     *
     * `pickupStopId` was being DROPPED here: it arrives from the trip list as a
     * route param, and this screen read only `id`, so a rider who chose to board
     * part-way along was silently booked — and charged — from the origin. It is
     * forwarded now, alongside the drop-off.
     */
    const query = [
      pickupStopId ? `pickupStopId=${pickupStopId}` : '',
      dropoffStopId ? `dropoffStopId=${dropoffStopId}` : '',
    ]
      .filter(Boolean)
      .join('&');
    goDeeper(`/ride/${id}/payment${query ? `?${query}` : ''}` as Href);
  };

  // Fail loudly: if seats cannot be loaded we show a real error with retry,
  // never a fabricated seat layout.
  if (isError) {
    return (
      <SafeAreaView style={styles.safe}>
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
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground variant="static" isDark={isDark} />

      <Header colors={colors} styles={styles} subtitle={subtitle} />

      {/*
        THE CABIN.

        Scrollable because a 20-seat vehicle will not fit a small phone, but
        content-sized so the common 14-seat minibus never scrolls at all.
      */}
      <ScrollView
        contentContainerStyle={styles.cabinScroll}
        showsVerticalScrollIndicator={false}
      >
        {/*
          The legend goes ABOVE the vehicle, not below it. It is a key, and a key
          read after the thing it explains is a key nobody read.
        */}
        <View style={styles.legend}>
          <LegendItem colors={colors} tone="free" label="Available" />
          <LegendItem colors={colors} tone="selected" label="Selected" />
          {heldCount > 0 ? <LegendItem colors={colors} tone="pending" label="On hold" /> : null}
          <LegendItem colors={colors} tone="taken" label="Occupied" />
        </View>

        <VehicleCabin
          seats={seats}
          seatCount={seatCount}
          selectedId={selectedId}
          onSelect={(seat: CabinSeat) => {
            if (seat.status !== 'AVAILABLE') return;
            setSelectedId(selectedId === seat.id ? null : seat.id);
          }}
          colors={colors as unknown as Record<string, string>}
          accent={colors.primary}
          fareLabel={farePesewas != null ? formatGhs(farePesewas) : null}
          tierLabel={tierLabel}
        />

        {/* Only offered when the route actually has stops on it. A section
            headed "where do you get off?" with one option is a worse answer
            than no section at all. */}
        {stops.length > 0 ? (
          <View style={styles.alight}>
            <Text variant="caption" color={colors.onSurfaceVariant}>
              WHERE DO YOU GET OFF?
            </Text>
            <View style={styles.alightRow}>
              <AlightChip
                colors={colors}
                label="Ride to the end"
                selected={dropoffStopId == null}
                onPress={() => setDropoffStopId(null)}
              />
              {stops.map((stop) => (
                <AlightChip
                  key={stop.id}
                  colors={colors}
                  label={stop.name}
                  selected={dropoffStopId === stop.id}
                  onPress={() => setDropoffStopId(stop.id)}
                />
              ))}
            </View>
            <Text variant="caption" color={colors.onSurfaceVariant}>
              Getting off early costs less — you pay for the part of the route you ride.
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/*
        The action, on the same sheet physics as every other rider surface.
        Content-sized: this panel is three lines, and a detent would leave it
        floating in the middle of the screen with nothing under it.
      */}
      {/*
        BUGFIX ("the 'Your seat / Seat 3' text is being overlapped by the glow
        button, and the fare section suffers from this too"). `gap` was set on
        the sheet style — but MorphSheet lifts padding off that style onto its
        content wrapper and leaves everything else on the SURFACE view, whose
        only children are the background layers and one wrapper. So the row and
        the Button were siblings with no gap at all, and a glow Button paints a
        halo outside its own box. The gap now lives on a wrapper that actually
        contains both.
      */}
      <MorphSheet radius={28} grabber={false} style={styles.sheet}>
        <View style={styles.sheetBody}>
        <View style={styles.sheetRow}>
          <View style={{ flex: 1 }}>
            <Text variant="caption" color={colors.onSurfaceVariant}>
              {selectedSeat ? 'Your seat' : 'Pick a seat to continue'}
            </Text>
            <Text style={styles.sheetValue} numberOfLines={1}>
              {selectedSeat ? `Seat ${selectedSeat.number}` : '—'}
            </Text>
          </View>
          {farePesewas != null ? (
            <View style={styles.fareBlock}>
              <Text variant="caption" color={colors.onSurfaceVariant}>
                Fare
              </Text>
              <Text style={styles.fareValue}>{formatGhs(farePesewas)}</Text>
            </View>
          ) : null}
        </View>
        <Button variant="glow" label="Confirm seat" onPress={handleConfirm} disabled={!selectedId} />
        </View>
      </MorphSheet>
    </SafeAreaView>
  );
}

function AlightChip({
  colors,
  label,
  selected,
  onPress,
}: {
  colors: Colors;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={{
        paddingHorizontal: spacing.base,
        paddingVertical: spacing.sm,
        borderRadius: radii.full,
        borderWidth: 1,
        borderColor: selected ? colors.primary : colors.outlineVariant,
        backgroundColor: selected ? colors.primary : 'transparent',
      }}
    >
      <Text
        variant="caption"
        color={selected ? colors.onPrimary ?? '#0A0D14' : colors.onSurface}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
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
        <Text style={styles.title}>Select seat</Text>
        {subtitle ? (
          <Text variant="caption" color={colors.onSurfaceVariant}>
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
  // The three tokens of the reference legend: a clean outline, the accent lit
  // from within (halo and all), and a muted dark square.
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
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
      <View style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
        {tone === 'selected' ? (
          <View
            style={{
              position: 'absolute',
              width: 16,
              height: 16,
              borderRadius: 8,
              backgroundColor: `${colors.primary}44`,
            }}
          />
        ) : null}
        <View
          style={{
            width: 11,
            height: 11,
            borderRadius: tone === 'selected' ? 5.5 : 3.5,
            backgroundColor: bg,
            borderWidth: 1.25,
            borderColor: border,
          }}
        />
      </View>
      <Text variant="caption" color={tone === 'selected' ? colors.onSurface : colors.onSurfaceVariant}>
        {label}
      </Text>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
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
    },

    /**
     * BUGFIX ("even the text under the page (where the confirm seat button is)
     * is being cut off by the button").
     *
     * The sheet is an absolutely-positioned sibling, so it takes no space in
     * this ScrollView's layout — meaning the last thing in the cabin sat
     * UNDERNEATH it with no way to scroll past. `spacing['4xl']` (48) was not
     * close: the sheet is a caption, a value row and a full-height Button, which
     * is around 170pt before its own safe-area inset.
     *
     * 220 clears it with room to spare. Overshooting costs a little empty scroll
     * at the bottom; undershooting hides the rider's own seat number behind the
     * button that confirms it.
     */
    alight: { gap: spacing.sm, marginTop: spacing.lg },
    alightRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    cabinScroll: { paddingHorizontal: spacing.xl, paddingTop: spacing.xs, paddingBottom: 220, gap: spacing.xl },
    cabin: {
      borderRadius: radii['2xl'],
      overflow: 'hidden',
      paddingVertical: spacing.xl,
      paddingHorizontal: spacing.lg,
      gap: spacing.md,
    },
    front: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: 4 },
    wheel: {
      width: 34,
      height: 34,
      borderRadius: radii.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceContainer,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
    },
    aisleRule: { height: 1, backgroundColor: colors.outlineVariant, opacity: 0.5 },
    grid: { gap: spacing.sm },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    /** The gap between the pair and the single. Wider than the seat gutter so
     *  the two blocks read as two blocks. */
    aisle: { width: spacing.xl },

    seat: {
      width: 48,
      height: 48,
      borderRadius: radii.lg,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceContainerHigh,
      borderWidth: 1,
      borderColor: colors.outline,
    },
    seatTaken: {
      backgroundColor: colors.surfaceContainer,
      borderColor: colors.outlineVariant,
      opacity: 0.55,
    },
    seatPending: {
      backgroundColor: `${colors.statusWarning}22`,
      borderColor: colors.statusWarning,
    },
    seatSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
    seatNumber: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium },

    legend: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      alignSelf: 'center',
      gap: spacing.base,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.sm,
      borderRadius: radii.full,
      backgroundColor: `${colors.surfaceContainerHigh}B3`,
      borderWidth: 1,
      borderColor: `${colors.onSurface}14`,
    },

    sheet: { paddingHorizontal: spacing['2xl'], paddingBottom: spacing.md },
    /* The gap belongs here, on the view that holds both the row and the button
       — see the note at the MorphSheet. */
    sheetBody: { gap: spacing.base },
    sheetRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.lg },
    sheetValue: {
      fontFamily: fonts.displaySemiBold,
      fontSize: fontSizes.titleMedium,
      color: colors.onSurface,
      marginTop: 2,
    },
    fareBlock: { alignItems: 'flex-end' },
    fareValue: {
      fontFamily: fonts.displaySemiBold,
      fontSize: fontSizes.titleMedium,
      color: colors.primary,
      marginTop: 2,
    },
  });
