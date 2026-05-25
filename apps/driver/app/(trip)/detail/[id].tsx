import React, { useMemo } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { useQuery } from '@tanstack/react-query';
import { driverApi } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../../utils/useColors';

function StatBox({ icon, label, value, color, colors }: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  color?: string;
  colors: DriverColors;
}) {
  const c = color ?? colors.primary;
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: spacing.xs }}>
      <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: `${c}18`, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: `${c}33` }}>
        <Ionicons name={icon} size={20} color={c} />
      </View>
      <Text style={{ fontFamily: fonts.displayBold, fontSize: fontSizes.titleSmall, color: colors.onSurface }}>{value}</Text>
      <Text variant="caption" color={colors.onSurfaceVariant} style={{ textAlign: 'center' }}>{label}</Text>
    </View>
  );
}

export default function TripDetailScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const { data: trip, isLoading } = useQuery({
    queryKey: ['driver', 'trip', 'detail', id],
    queryFn: () => driverApi.getAllTrips(),
    select: (r) => {
      const trips = (r.data as any)?.data?.trips ?? [];
      return trips.find((t: any) => t.id === id);
    },
    enabled: !!id,
  });

  const boardedCount = trip?.seats?.filter((s: any) => s.status === 'BOARDED').length ?? 0;
  const earnedTotal = boardedCount * (trip?.farePerSeat ?? 0);

  const durationMin = trip?.departureTime && trip?.arrivedAt
    ? Math.round((new Date(trip.arrivedAt).getTime() - new Date(trip.departureTime).getTime()) / 60000)
    : null;

  const ratingReceived = (trip as any)?.ratingReceived ?? null;

  return (
    <SafeAreaView style={styles.safe}>
      <MotiView
        from={{ opacity: 0, translateX: -6 }}
        animate={{ opacity: 1, translateX: 0 }}
        transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        style={styles.backRow}
      >
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Ionicons name="arrow-back" size={18} color={colors.onSurfaceVariant} />
          <Text variant="bodyMedium" color={colors.onSurfaceVariant}>Back</Text>
        </TouchableOpacity>
      </MotiView>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Headline */}
        <MotiView
          from={{ opacity: 0, translateY: -6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 40 }}
        >
          <Text variant="headlineLarge" style={styles.headline}>Trip Summary</Text>
        </MotiView>

        {/* Route card */}
        <MotiView
          from={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25, delay: 80 }}
          style={styles.routeCard}
        >
          <View style={styles.routeGlow} />
          {isLoading ? (
            <View style={{ height: 60, borderRadius: radii.lg, backgroundColor: colors.surfaceContainerHighest }} />
          ) : (
            <>
              <View style={styles.routeRow}>
                <View style={styles.routeDot} />
                <Text style={styles.routeText}>{trip?.route?.originName ?? '—'}</Text>
              </View>
              <View style={styles.routeLine} />
              <View style={styles.routeRow}>
                <View style={[styles.routeDot, { backgroundColor: colors.accent }]} />
                <Text style={styles.routeText}>{trip?.route?.destinationName ?? '—'}</Text>
              </View>
              <View style={styles.routeMeta}>
                <Ionicons name="calendar-outline" size={13} color={colors.onSurfaceVariant} />
                <Text variant="caption" color={colors.onSurfaceVariant}>
                  {trip?.departureTime
                    ? new Date(trip.departureTime).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : '—'}
                </Text>
                <View style={[styles.statusChip, { backgroundColor: '#22C55E20', borderColor: '#22C55E55' }]}>
                  <Text style={{ fontFamily: fonts.semiBold, fontSize: 10, color: '#22C55E' }}>Completed</Text>
                </View>
              </View>
            </>
          )}
        </MotiView>

        {/* Stats grid */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 120 }}
          style={styles.card}
        >
          <Text style={styles.cardTitle}>Trip Stats</Text>
          <View style={styles.statsGrid}>
            <StatBox
              icon="people-outline"
              label="Passengers"
              value={String(boardedCount)}
              colors={colors}
            />
            <StatBox
              icon="cash-outline"
              label="Earned"
              value={`GHS ${earnedTotal.toFixed(0)}`}
              color="#22C55E"
              colors={colors}
            />
            {durationMin !== null && (
              <StatBox
                icon="time-outline"
                label="Duration"
                value={`${durationMin}m`}
                color={colors.accent}
                colors={colors}
              />
            )}
            <StatBox
              icon="ticket-outline"
              label="Fare/Seat"
              value={`GHS ${(trip?.farePerSeat ?? 0).toFixed(0)}`}
              colors={colors}
            />
          </View>
        </MotiView>

        {/* Rating received */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 160 }}
          style={styles.card}
        >
          <Text style={styles.cardTitle}>Your Rating</Text>
          {ratingReceived != null ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm }}>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                {[1, 2, 3, 4, 5].map((s) => (
                  <Ionicons
                    key={s}
                    name={s <= ratingReceived ? 'star' : 'star-outline'}
                    size={20}
                    color="#F59E0B"
                  />
                ))}
              </View>
              <Text style={{ fontFamily: fonts.displayBold, fontSize: fontSizes.titleSmall, color: colors.onSurface }}>
                {ratingReceived.toFixed(1)}
              </Text>
            </View>
          ) : (
            <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ paddingVertical: spacing.sm }}>
              No rating received for this trip yet.
            </Text>
          )}
        </MotiView>

        {/* Passenger breakdown */}
        {(trip?.seats?.length ?? 0) > 0 && (
          <MotiView
            from={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 200 }}
            style={styles.card}
          >
            <Text style={styles.cardTitle}>Passengers</Text>
            {(trip?.seats ?? [])
              .filter((s: any) => s.status === 'BOARDED' || s.status === 'CONFIRMED')
              .map((seat: any, i: number) => (
                <MotiView
                  key={seat.id ?? i}
                  from={{ opacity: 0, translateX: -8 }}
                  animate={{ opacity: 1, translateX: 0 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 220 + i * 40 }}
                  style={[styles.passengerRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.outlineVariant }]}
                >
                  <View style={styles.passengerAvatar}>
                    <Text style={{ fontFamily: fonts.displayBold, fontSize: 14, color: colors.primary }}>
                      {(seat.passenger?.name ?? seat.name ?? 'P')[0]?.toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, color: colors.onSurface }}>
                      {seat.passenger?.name ?? seat.name ?? 'Passenger'}
                    </Text>
                    <Text variant="caption" color={colors.onSurfaceVariant}>Seat {seat.seatNumber}</Text>
                  </View>
                  <View style={[styles.statusChip, seat.status === 'BOARDED' ? { backgroundColor: '#22C55E20', borderColor: '#22C55E55' } : { backgroundColor: `${colors.primary}20`, borderColor: `${colors.primary}55` }]}>
                    <Text style={{ fontFamily: fonts.semiBold, fontSize: 10, color: seat.status === 'BOARDED' ? '#22C55E' : colors.primary }}>
                      {seat.status === 'BOARDED' ? 'Boarded' : 'Confirmed'}
                    </Text>
                  </View>
                </MotiView>
              ))}
          </MotiView>
        )}

        {/* Earnings breakdown */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 240 }}
          style={[styles.card, { gap: spacing.sm }]}
        >
          <Text style={styles.cardTitle}>Earnings Breakdown</Text>
          <View style={styles.earningsRow}>
            <Text variant="bodyMedium" color={colors.onSurfaceVariant}>Fare × passengers</Text>
            <Text style={{ fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, color: colors.onSurface }}>
              GHS {(trip?.farePerSeat ?? 0).toFixed(2)} × {boardedCount}
            </Text>
          </View>
          <View style={[styles.earningsRow, { paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.outlineVariant }]}>
            <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: fontSizes.bodyMedium, color: colors.onSurface }}>Total Earned</Text>
            <Text style={{ fontFamily: fonts.displayBold, fontSize: fontSizes.titleSmall, color: '#22C55E' }}>
              GHS {earnedTotal.toFixed(2)}
            </Text>
          </View>
        </MotiView>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.backgroundDeep },
    backRow: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.base },
    scroll: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.xl, paddingBottom: spacing['3xl'], gap: spacing.xl },
    headline: { letterSpacing: -1 },
    routeCard: {
      backgroundColor: colors.surfaceContainerHigh,
      borderRadius: radii['2xl'],
      borderWidth: 1.5,
      borderColor: colors.outline,
      padding: spacing.xl,
      overflow: 'hidden',
      gap: spacing.sm,
    },
    routeGlow: {
      position: 'absolute',
      width: 150,
      height: 150,
      borderRadius: 75,
      backgroundColor: colors.primary,
      opacity: 0.07,
      right: -30,
      top: -30,
    },
    routeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    routeDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
    routeLine: { width: 2, height: 16, backgroundColor: colors.outline, marginLeft: 4 },
    routeText: { fontFamily: fonts.displaySemiBold, fontSize: fontSizes.bodyMedium, color: colors.onSurface, flex: 1 },
    routeMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
    statusChip: { borderRadius: radii.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
    card: {
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii['2xl'],
      borderWidth: 1,
      borderColor: colors.outline,
      padding: spacing.xl,
    },
    cardTitle: { fontFamily: fonts.displaySemiBold, fontSize: fontSizes.titleSmall, color: colors.onSurface, marginBottom: spacing.md },
    statsGrid: { flexDirection: 'row', justifyContent: 'space-around', flexWrap: 'wrap', gap: spacing.md },
    passengerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
    passengerAvatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: `${colors.primary}22`,
      borderWidth: 1,
      borderColor: `${colors.primary}44`,
      alignItems: 'center',
      justifyContent: 'center',
    },
    earningsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  });
