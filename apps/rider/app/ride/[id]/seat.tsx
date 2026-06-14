import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, FlatList, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { MotiView } from 'moti';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withSpring,
} from 'react-native-reanimated';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { tripsApi, socketEvents, connectSocket, disconnectSocket } from '@eyego/api';
import { useRideStore } from '../../../stores/ride.store';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../../utils/useColors';
import { Text, Button, EmptyState } from '@eyego/ui';
import type { Seat } from '@eyego/types';

export default function SeatPickerScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { setSelectedSeat, selectedTrip } = useRideStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['seats', id],
    queryFn: () => tripsApi.getSeats(id ?? ''),
    enabled: !!id,
  });

  const tripRef = useRef(selectedTrip);
  useEffect(() => { tripRef.current = selectedTrip; }, [selectedTrip]);

  useEffect(() => {
    connectSocket();
    // BUGFIX: Removed joinTripRoom + disconnectSocket from seat.tsx — TripStatusListener
    // already handles joining/leaving trip rooms globally. This was fighting with
    // the ref-counted socket lifecycle, causing unnecessary connect/disconnect churn.
    // The socket stays connected via TripStatusListener; seat updates arrive through
    // the existing onSeatUpdate subscription.
    const unsub = socketEvents.onSeatUpdate(() => {
      queryClient.invalidateQueries({ queryKey: ['seats', id] });
    });
    return () => {
      unsub();
      // BUGFIX: No longer call disconnectSocket() here — TripStatusListener manages
      // the global socket lifecycle. This was decrementing the ref count prematurely.
    };
    // Intentionally only run on mount/unmount — do NOT re-run on selectedTrip change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const rawSeats = (data?.data?.data as any)?.seats || (data?.data as any)?.seats || [];

  const seats: Seat[] = rawSeats.map((s: any) => ({
    id: `seat-${s.number}`,
    number: s.number,
    row: Math.floor((s.number - 1) / 3),
    column: (s.number - 1) % 3,
    // PENDING = SEAT_HELD (payment not confirmed) — shows amber, still unselectable
    status: s.status === 'AVAILABLE' ? 'AVAILABLE' : s.status === 'PENDING' ? 'PENDING' : 'OCCUPIED',
  }));

  // Group seats by row for grid display
  const rows = seats.reduce<Seat[][]>((acc, seat) => {
    if (!acc[seat.row]) acc[seat.row] = [];
    acc[seat.row].push(seat);
    return acc;
  }, []);

  const selectedSeat = seats.find((s) => s.id === selectedId);

  const handleConfirm = () => {
    if (!selectedSeat) return;
    setSelectedSeat(selectedSeat);
    router.push(`/ride/${id}/payment` as Href);
  };

  // Fail loudly: if seats can't be loaded we show a real error with retry,
  // never a fabricated seat layout.
  if (isError) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
          </Pressable>
          <Text variant="titleMedium">Choose Your Seat</Text>
          <View style={{ width: 24 }} />
        </View>
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
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text variant="titleMedium">Choose Your Seat</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Legend */}
        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 1200, damping: 18, delay: 50 }}
          style={styles.legend}
        >
          <LegendItem color={colors.surfaceContainerHigh} borderColor={colors.outline} label="Available" />
          <LegendItem color={colors.primary} borderColor={colors.primary} label="Selected" />
          <LegendItem color="#F59E0B" borderColor="#F59E0B" label="Pending" disabled />
          <LegendItem color={colors.surfaceContainer} borderColor={colors.outlineVariant} label="Taken" disabled />
        </MotiView>

        {/* Bus outline */}
        <MotiView
          from={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 1200, damping: 18, delay: 100 }}
          style={styles.busContainer}
        >
          {/* Driver area */}
          <View style={styles.driverArea}>
            <View style={styles.steeringWheel}>
              <Ionicons name="car-sport" size={20} color={colors.onSurfaceVariant} />
            </View>
            <Text variant="caption" color={colors.onSurfaceVariant}>Driver</Text>
          </View>

          <View style={styles.seatGrid}>
            {rows.map((rowSeats, rowIdx) => (
              <MotiView
                key={rowIdx}
                from={{ opacity: 0, translateX: -10 }}
                animate={{ opacity: 1, translateX: 0 }}
                transition={{ type: 'spring', stiffness: 1200, damping: 18, delay: 120 + rowIdx * 30 }}
                style={styles.seatRow}
              >
                {rowSeats.map((seat) => (
                  <SeatButton
                    key={seat.id}
                    seat={seat}
                    isSelected={selectedId === seat.id}
                    onPress={() => {
                      if (seat.status === 'OCCUPIED') return;
                      setSelectedId(selectedId === seat.id ? null : seat.id);
                    }}
                  />
                ))}
              </MotiView>
            ))}
          </View>
        </MotiView>

        {/* Selected seat info */}
        {selectedSeat && (
          <MotiView
            from={{ opacity: 0, translateY: 10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 1200, damping: 15 }}
            style={styles.selectedInfo}
          >
            <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
            <Text variant="bodyMedium">
              Seat <Text variant="titleSmall" color={colors.primary}>#{selectedSeat.number}</Text> selected
            </Text>
          </MotiView>
        )}
      </ScrollView>

      {/* Confirm CTA */}
      <MotiView
        from={{ opacity: 0, translateY: 20 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'spring', stiffness: 1200, damping: 15, delay: 150 }}
        style={styles.footer}
      >
        <Button
          label="Confirm Seat"
          onPress={handleConfirm}
          disabled={!selectedId}
        />
      </MotiView>
    </SafeAreaView>
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
  const isPending = seat.status === 'PENDING' as any;
  const isUnavailable = isOccupied || isPending;

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = () => {
    if (isUnavailable) return;
    scale.value = withSequence(
      withSpring(0.88, { stiffness: 800, damping: 12 }),
      withSpring(1, { stiffness: 800, damping: 12 })
    );
    onPress();
  };

  return (
    <Pressable onPress={handlePress} disabled={isUnavailable}>
      <Animated.View
        style={[
          styles.seatButton,
          isOccupied && styles.seatOccupied,
          isPending && styles.seatPending,
          isSelected && styles.seatSelected,
          animStyle,
        ]}
      >
        <Text
          style={[
            styles.seatNumber,
            { color: isSelected ? colors.onPrimary : isUnavailable ? colors.onSurfaceVariant : colors.onSurface },
          ]}
        >
          {seat.number}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

function LegendItem({
  color,
  borderColor,
  label,
  disabled,
}: {
  color: string;
  borderColor: string;
  label: string;
  disabled?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color, borderColor, opacity: disabled ? 0.5 : 1 }]} />
      <Text variant="caption" color={colors.onSurfaceVariant}>{label}</Text>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.backgroundDeep },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.base,
  },
  scroll: {
    paddingHorizontal: spacing['2xl'],
    paddingBottom: spacing['3xl'],
    alignItems: 'center',
    gap: spacing.xl,
  },
  legend: {
    flexDirection: 'row',
    gap: spacing.xl,
    justifyContent: 'center',
    paddingVertical: spacing.base,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  legendSwatch: {
    width: 24,
    height: 24,
    borderRadius: radii.sm,
    borderWidth: 1.5,
  },
  busContainer: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii['2xl'],
    padding: spacing.xl,
    borderWidth: 1.5,
    borderColor: colors.outlineVariant,
    alignItems: 'center',
    gap: spacing.lg,
    width: '100%',
    maxWidth: 280,
  },
  driverArea: {
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
    paddingBottom: spacing.md,
    width: '100%',
  },
  steeringWheel: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  seatGrid: { gap: spacing.md, width: '100%' },
  seatRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
  },
  seatButton: {
    width: 48,
    height: 52,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceContainerHigh,
    borderWidth: 1.5,
    borderColor: colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seatOccupied: {
    backgroundColor: colors.surfaceContainer,
    borderColor: colors.outlineVariant,
    opacity: 0.45,
  },
  seatPending: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderColor: '#F59E0B',
    opacity: 0.8,
  },
  seatSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  seatNumber: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodySmall,
  },
  selectedInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(75, 226, 119, 0.1)',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.primary + '40',
  },
  footer: {
    paddingHorizontal: spacing['2xl'],
    paddingBottom: spacing['2xl'],
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
    backgroundColor: colors.backgroundDeep,
  },
});
