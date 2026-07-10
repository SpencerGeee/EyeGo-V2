import React, { useMemo, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { driverApi } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Entrance, GradientGlowBorder, AppBackground } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../../utils/useColors';
import { useDriverStore } from '../../../stores/driver.store';

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
  const theme = useDriverStore(s => s.theme);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const { data: trip, isLoading } = useQuery({
    queryKey: ['driver', 'trip', 'detail', id],
    // D8: enabled:false when id is missing/invalid — no API call made
    queryFn: () => driverApi.getTripById(id!),
    select: (r) => r.data.data?.trip ?? null,
    enabled: !!id && typeof id === 'string',
  });

  // D8: guard after all hooks — navigate back for invalid id
  useEffect(() => {
    if (!id || typeof id !== 'string') {
      router.back();
    }
  }, [id, router]);

  const activeBookings = (trip?.bookings ?? []).filter((b: any) => b.status !== 'CANCELLED');
  const boardedCount = activeBookings.filter((b: any) => b.status === 'BOARDED').length;
  // D24: guard against trip being undefined before reduce
  const earnedTotal = trip
    ? activeBookings.reduce((s: number, b: any) => s + (parseFloat(b.fareAmount) || trip.farePerSeat || 0), 0)
    : 0;

  // D22: safe date construction
  const departureDate = trip?.departureTime ? new Date(trip.departureTime) : null;
  const arrivedDate = trip?.arrivedAt ? new Date(trip.arrivedAt) : null;
  const durationMin =
    departureDate && !isNaN(departureDate.getTime()) && arrivedDate && !isNaN(arrivedDate.getTime())
      ? Math.round((arrivedDate.getTime() - departureDate.getTime()) / 60000)
      : null;

  const ratingReceived = (trip as any)?.ratingReceived ?? null;

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground isDark={theme !== 'light'} />
      <Entrance animation="slideLeft" style={styles.backRow}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Ionicons name="arrow-back" size={18} color={colors.onSurfaceVariant} />
          <Text variant="bodyMedium" color={colors.onSurfaceVariant}>Back</Text>
        </Pressable>
      </Entrance>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Headline */}
        <Entrance animation="slideUp" delay={40}>
          <Text variant="headlineLarge" style={styles.headline}>Trip Summary</Text>
        </Entrance>

        {/* Route card — hero element gets the premium ring */}
        <Entrance animation="scaleIn" delay={80}>
        <GradientGlowBorder
          palette="driver"
          fillColor={colors.surfaceContainerHigh}
          borderRadius={radii['2xl']}
          glow
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
                  {departureDate && !isNaN(departureDate.getTime())
                    ? departureDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : '—'}
                </Text>
                <View style={[styles.statusChip, { backgroundColor: '#22C55E20', borderColor: '#22C55E55' }]}>
                  <Text style={{ fontFamily: fonts.semiBold, fontSize: 10, color: '#22C55E' }}>Completed</Text>
                </View>
              </View>
            </>
          )}
        </GradientGlowBorder>
        </Entrance>

        {/* Stats grid */}
        <Entrance animation="slideDown" delay={120} style={styles.card}>
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
        </Entrance>

        {/* Rating received */}
        <Entrance animation="slideDown" delay={160} style={styles.card}>
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
        </Entrance>

        {/* Passenger breakdown */}
        {activeBookings.length > 0 && (
          <Entrance animation="slideDown" delay={200} style={styles.card}>
            <Text style={styles.cardTitle}>Passengers</Text>
            {activeBookings
              .filter((b: any) => b.status === 'BOARDED' || b.status === 'CONFIRMED')
              .map((booking: any) => (
                <Entrance
                  // D21: use booking.id as key; warn if missing
                  key={booking.id /* booking.id should always be present; log if missing */}
                  animation="slideLeft"
                  delay={220}
                  style={[styles.passengerRow, { borderTopWidth: 1, borderTopColor: colors.outlineVariant }]}
                >
                  <View style={styles.passengerAvatar}>
                    <Text style={{ fontFamily: fonts.displayBold, fontSize: 14, color: colors.primary }}>
                      {(booking.user?.name ?? 'P')[0]?.toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, color: colors.onSurface }}>
                      {booking.user?.name ?? `Seat ${booking.seatNumber ?? '—'}`}
                    </Text>
                    <Text variant="caption" color={colors.onSurfaceVariant}>Seat {booking.seatNumber ?? '—'} · {booking.paymentStatus === 'PAID' ? 'Paid' : booking.paymentStatus === 'PENDING' ? 'Cash' : booking.status}</Text>
                  </View>
                  {/* D16: fallback for unknown booking status values */}
                  <View style={[styles.statusChip, booking.status === 'BOARDED' ? { backgroundColor: '#22C55E20', borderColor: '#22C55E55' } : booking.status === 'CONFIRMED' ? { backgroundColor: `${colors.primary}20`, borderColor: `${colors.primary}55` } : { backgroundColor: `${colors.onSurfaceVariant}20`, borderColor: `${colors.onSurfaceVariant}55` }]}>
                    <Text style={{ fontFamily: fonts.semiBold, fontSize: 10, color: booking.status === 'BOARDED' ? '#22C55E' : booking.status === 'CONFIRMED' ? colors.primary : colors.onSurfaceVariant }}>
                      {booking.status === 'BOARDED' ? 'Boarded' : booking.status === 'CONFIRMED' ? 'Confirmed' : 'Unknown'}
                    </Text>
                  </View>
                </Entrance>
              ))}
          </Entrance>
        )}

        {/* Earnings breakdown */}
        <Entrance animation="slideDown" delay={240} style={[styles.card, { gap: spacing.sm }]}>
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
        </Entrance>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    backRow: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.base },
    scroll: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.xl, paddingBottom: spacing['3xl'], gap: spacing.xl },
    headline: { letterSpacing: -1 },
    routeCard: {
      padding: spacing.xl,
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
    routeText: { fontFamily: fonts.displaySemiBold, fontSize: fontSizes.bodyMedium, lineHeight: Math.round(fontSizes.bodyMedium * 1.4), color: colors.onSurface, flex: 1 },
    routeMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
    statusChip: { borderRadius: radii.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
    card: {
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii['2xl'],
      borderWidth: 1,
      borderColor: colors.outline,
      padding: spacing.xl,
    },
    cardTitle: { fontFamily: fonts.displaySemiBold, fontSize: fontSizes.titleSmall, lineHeight: Math.round(fontSizes.titleSmall * 1.3), color: colors.onSurface, marginBottom: spacing.md },
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
