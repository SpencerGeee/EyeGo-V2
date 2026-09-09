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
import { useThemeStore } from '../../../stores/theme.store';
import {
  Text,
  Button,
  EmptyState,
  AppBackground,
  GlassSurface,
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
 * So the cabin is drawn properly: a 2 + 1 layout either side of a real aisle,
 * the driver at the front where the rider will see them, and the rows running
 * back the way they do in the vehicle. Same seat numbers, same statuses — it is
 * the same data, finally arranged like the thing it describes.
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

/** Seats to the left of the aisle. A 2 + 1 minibus, which is what these are. */
const LEFT_OF_AISLE = 2;
const SEATS_PER_ROW = 3;

export default function SeatPickerScreen() {
  const colors = useColors();
  const isDark = useThemeStore((s) => s.isDark);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
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

  const rows = useMemo(
    () =>
      seats.reduce<Seat[][]>((acc, seat) => {
        if (!acc[seat.row]) acc[seat.row] = [];
        acc[seat.row].push(seat);
        return acc;
      }, []),
    [seats],
  );

  const selectedSeat = seats.find((s) => s.id === selectedId);
  const freeCount = seats.filter((s) => s.status === 'AVAILABLE').length;
  const farePesewas = (selectedTrip as any)?.farePerSeatPesewas ?? null;

  const handleConfirm = () => {
    if (!selectedSeat) return;
    setSelectedSeat(selectedSeat);
    goDeeper(`/ride/${id}/payment` as Href);
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

      <Header
        colors={colors}
        styles={styles}
        subtitle={seats.length ? `${freeCount} of ${seats.length} free` : null}
      />

      {/*
        THE CABIN.

        Scrollable because a 20-seat vehicle will not fit a small phone, but
        content-sized so the common 14-seat minibus never scrolls at all.
      */}
      <ScrollView
        contentContainerStyle={styles.cabinScroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.cabin}>
          <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii['2xl']} intensity="low" />

          {/* The front of the vehicle, so the map has an orientation. */}
          <View style={styles.front}>
            <View style={styles.wheel}>
              <Ionicons name="disc-outline" size={18} color={colors.onSurfaceVariant} />
            </View>
            <Text variant="caption" color={colors.onSurfaceVariant}>
              Driver
            </Text>
          </View>

          <View style={styles.aisleRule} />

          <View style={styles.grid}>
            {rows.map((rowSeats, rowIdx) => (
              <View key={rowIdx} style={styles.row}>
                {rowSeats.map((seat, i) => (
                  <React.Fragment key={seat.id}>
                    <SeatButton
                      seat={seat}
                      isSelected={selectedId === seat.id}
                      onPress={() => {
                        if (seat.status !== 'AVAILABLE') return;
                        setSelectedId(selectedId === seat.id ? null : seat.id);
                      }}
                    />
                    {/* The aisle — a gap, not a seat. This is the whole
                        difference between a cabin and a keypad. */}
                    {i === LEFT_OF_AISLE - 1 ? <View style={styles.aisle} /> : null}
                  </React.Fragment>
                ))}
              </View>
            ))}
          </View>
        </View>

        <View style={styles.legend}>
          <LegendItem colors={colors} tone="free" label="Free" />
          <LegendItem colors={colors} tone="selected" label="Yours" />
          <LegendItem colors={colors} tone="pending" label="On hold" />
          <LegendItem colors={colors} tone="taken" label="Taken" />
        </View>
      </ScrollView>

      {/*
        The action, on the same sheet physics as every other rider surface.
        Content-sized: this panel is three lines, and a detent would leave it
        floating in the middle of the screen with nothing under it.
      */}
      <MorphSheet radius={28} grabber={false} style={styles.sheet}>
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
      </MorphSheet>
    </SafeAreaView>
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
        <Text style={styles.title}>Pick a seat</Text>
        {subtitle ? (
          <Text variant="caption" color={colors.onSurfaceVariant}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function SeatButton({
  seat,
  isSelected,
  onPress,
}: {
  seat: Seat;
  isSelected: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const scale = useSharedValue(1);
  const isOccupied = seat.status === 'OCCUPIED';
  const isPending = (seat.status as any) === 'PENDING';
  const isUnavailable = isOccupied || isPending;

  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const handlePress = () => {
    if (isUnavailable) return;
    // Selecting a seat is a state change, not a celebration: press down, come
    // back, done. An underdamped spring here inflates the seat past its own
    // size on the way back and knocks into its neighbours.
    scale.value = withSequence(withSpring(0.92, springs.press), withSpring(1, springs.micro));
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={isUnavailable}
      accessibilityRole="button"
      accessibilityState={{ disabled: isUnavailable, selected: isSelected }}
      accessibilityLabel={
        `Seat ${seat.number}, ` +
        (isOccupied ? 'taken' : isPending ? 'on hold' : isSelected ? 'selected' : 'free')
      }
    >
      <Animated.View
        style={[
          styles.seat,
          isOccupied && styles.seatTaken,
          isPending && styles.seatPending,
          isSelected && styles.seatSelected,
          animStyle,
        ]}
      >
        <Text
          style={[
            styles.seatNumber,
            {
              color: isSelected
                ? colors.onPrimary
                : isUnavailable
                  ? colors.onSurfaceVariant
                  : colors.onSurface,
            },
          ]}
        >
          {seat.number}
        </Text>
      </Animated.View>
    </Pressable>
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
    : tone === 'pending' ? colors.statusWarning
    : tone === 'taken' ? colors.surfaceContainer
    : colors.surfaceContainerHigh;
  const border =
    tone === 'selected' ? colors.primary
    : tone === 'pending' ? colors.statusWarning
    : tone === 'taken' ? colors.outlineVariant
    : colors.outline;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View
        style={{
          width: 12,
          height: 12,
          borderRadius: 4,
          backgroundColor: bg,
          borderWidth: 1,
          borderColor: border,
          opacity: tone === 'taken' ? 0.6 : 1,
        }}
      />
      <Text variant="caption" color={colors.onSurfaceVariant}>
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

    cabinScroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing['4xl'], gap: spacing.lg },
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

    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, paddingHorizontal: 4 },

    sheet: { paddingHorizontal: spacing['2xl'], paddingBottom: spacing.md, gap: spacing.md },
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
