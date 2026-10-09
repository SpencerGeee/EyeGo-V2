import React, { useMemo, useEffect } from 'react';
import { formatGhs, originLabel, destinationLabel, shortDateTime, seatsOf } from '@eyego/utils';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { driverApi } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Entrance, GradientGlowBorder, AppBackground, bookingStatusLabel, goBack } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../../utils/useColors';
import { useDriverStore } from '../../../stores/driver.store';
import type { TripBooking } from '@eyego/types';

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
      goBack();
    }
  }, [id, router]);

  /**
   * A SEAT THAT RODE IS A SEAT THAT RODE, WHATEVER IT IS CALLED NOW.
   *
   * BUGFIX ("the trip summary doesn't show the right information — the trip
   * stats aren't showing the accurate things").
   *
   * Two status predicates here were wrong in the same direction, and both only
   * bite AFTER a trip finishes — which is the only time this screen is opened.
   *
   *   • `status !== 'CANCELLED'` counted seats that released themselves as
   *     passengers who rode and paid: an EXPIRED hold, a NO_SHOW, a REFUND, and
   *     a bare SEAT_HELD reservation the group hub creates on open. Those are
   *     the numbers the earnings figure was being built from.
   *   • `status === 'BOARDED'` was the passenger count — but `completeTrip`
   *     moves every boarded booking to COMPLETED, so on a finished trip that
   *     filter matches NOTHING. "Passengers: 0" on a trip with four people in
   *     it, and "fare × 0" underneath it.
   *
   * `RELEASED` / `isSettled` are the same rule the completion receipt uses
   * (`complete/[id].tsx`), so the two screens cannot disagree about how many
   * people rode or what the trip paid.
   */
  const RELEASED = ['CANCELLED', 'EXPIRED', 'REFUNDED', 'NO_SHOW'];
  const isSettled = (b: TripBooking) =>
    b.paymentStatus === 'PAID' || ['CONFIRMED', 'BOARDED', 'COMPLETED'].includes(b.status);
  const activeBookings = (trip?.bookings ?? []).filter((b: TripBooking) => !RELEASED.includes(b.status) && isSettled(b));
  // Seats, not rows: one booking can carry a whole party (Booking.seats).
  const boardedCount = activeBookings.reduce((n: number, b: any) => n + seatsOf(b), 0);
  // History lists cancelled and expired trips too; this chip said "Completed"
  // on every one of them.
  const tripStatus = String(trip?.status ?? '');
  const statusChip =
    tripStatus === 'COMPLETED'
      ? { label: 'Completed', tint: '#22C55E' }
      : tripStatus === 'CANCELLED'
        ? { label: 'Cancelled', tint: colors.error }
        : tripStatus === 'EXPIRED'
          ? { label: 'Expired', tint: colors.onSurfaceVariant }
          : tripStatus === 'NO_SHOW'
            ? { label: 'No-show', tint: colors.error }
            : { label: 'In progress', tint: colors.primary };
  // D24: guard against trip being undefined before reduce
  // "Total Earned" is the driver's net cut, not the raw fare — subtract each
  // booking's actual commissionAmountPesewas (falling back to trip.commissionRate
  // for legacy bookings that predate the column).
  // Fares, commission and net, so the breakdown adds up on screen. A booking
  // with no stored fare falls back to the per-seat fare × ITS seats (the old
  // fallback priced a three-seat party as one seat).
  const totals = trip
    ? activeBookings.reduce(
        (acc: { gross: number; commission: number }, b: any) => {
          const gross = Number(b.fareAmountPesewas) || (trip.farePerSeatPesewas || 0) * seatsOf(b);
          const commission =
            b.commissionAmountPesewas != null
              ? Number(b.commissionAmountPesewas) || 0
              : Math.round(gross * (trip.commissionRate ?? 0.15));
          return { gross: acc.gross + gross, commission: acc.commission + commission };
        },
        { gross: 0, commission: 0 },
      )
    : { gross: 0, commission: 0 };
  const earnedTotal = totals.gross - totals.commission;

  // D22: safe date construction
  const departureDate = trip?.departureTime ? new Date(trip.departureTime) : null;
  const arrivedDate = trip?.arrivedAt ? new Date(trip.arrivedAt) : null;
  const durationMin =
    departureDate && !isNaN(departureDate.getTime()) && arrivedDate && !isNaN(arrivedDate.getTime())
      ? Math.round((arrivedDate.getTime() - departureDate.getTime()) / 60000)
      : null;

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground isDark={theme !== 'light'} />
      <Entrance animation="slideLeft" style={styles.backRow}>
        <Pressable onPress={() => goBack()} hitSlop={12} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }} accessibilityRole="button">
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
                <Text style={styles.routeText}>{originLabel(trip) ?? '—'}</Text>
              </View>
              <View style={styles.routeLine} />
              <View style={styles.routeRow}>
                <View style={[styles.routeDot, { backgroundColor: colors.accent }]} />
                <Text style={styles.routeText}>{destinationLabel(trip) ?? '—'}</Text>
              </View>
              <View style={styles.routeMeta}>
                <Ionicons name="calendar-outline" size={13} color={colors.onSurfaceVariant} />
                <Text variant="caption" color={colors.onSurfaceVariant}>
                  {departureDate && !isNaN(departureDate.getTime())
                    ? shortDateTime(departureDate)
                    : '—'}
                </Text>
                <View style={[styles.statusChip, { backgroundColor: `${statusChip.tint}20`, borderColor: `${statusChip.tint}55` }]}>
                  <Text style={{ fontFamily: fonts.semiBold, fontSize: 10, color: statusChip.tint }}>{statusChip.label}</Text>
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
              value={`${formatGhs(earnedTotal, { showDecimals: false })}`}
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
              value={`${formatGhs(trip?.farePerSeatPesewas ?? null, { showDecimals: false })}`}
              colors={colors}
            />
          </View>
        </Entrance>

        {/* No per-trip rating card: ratings are anonymous by design (a
            rating tied to a two-seat trip names the rider), and the server
            never sent one — the card could only ever say "No rating yet".
            The driver's average lives under Ratings & performance. */}

        {/* Passenger breakdown */}
        {activeBookings.length > 0 && (
          <Entrance animation="slideDown" delay={200} style={styles.card}>
            <Text style={styles.cardTitle}>Passengers</Text>
            {/* No second filter: `activeBookings` is already "seats that rode
                and were paid for". The extra `BOARDED || CONFIRMED` here hid
                every passenger on a COMPLETED trip — the status they all end up
                in — so the section rendered empty on exactly the trips it is
                for. */}
            {activeBookings
              .map((booking: TripBooking) => (
                <Entrance
                  // D21: use booking.id as key; warn if missing
                  key={booking.id /* booking.id should always be present; log if missing */}
                  animation="slideLeft"
                  delay={220}
                  style={[styles.passengerRow, { borderTopWidth: 1, borderTopColor: colors.outlineVariant }]}
                >
                  <View style={styles.passengerAvatar}>
                    <Text style={{ fontFamily: fonts.displayBold, fontSize: 14, color: colors.primary }}>
                      {(((booking as any).guestName ?? booking.user?.name ?? 'P') as string)[0]?.toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, color: colors.onSurface }}>
                      {/* The guest first: they are who was in the seat. */}
                      {(booking as any).guestName ?? booking.user?.name ?? `Seat ${booking.seatNumber ?? '—'}`}
                    </Text>
                    <Text variant="caption" color={colors.onSurfaceVariant}>
                      {seatsOf(booking as any) > 1 ? `${seatsOf(booking as any)} seats` : `Seat ${booking.seatNumber ?? '—'}`}
                      {' · '}
                      {booking.paymentStatus === 'PAID' ? 'Paid' : booking.paymentStatus === 'PENDING' ? 'Cash' : bookingStatusLabel(booking.status)}
                    </Text>
                  </View>
                  {/* D16: fallback for unknown booking status values */}
                  {/* COMPLETED is the status every boarded booking ends on, and
                      it fell through to the literal word "Unknown" — a finished
                      trip listed every passenger as unknown. `bookingStatusLabel`
                      is the shared vocabulary; use it rather than a third
                      hand-rolled mapping. */}
                  {(() => {
                    const rode = booking.status === 'BOARDED' || booking.status === 'COMPLETED';
                    const tint = rode ? '#22C55E' : booking.status === 'CONFIRMED' ? colors.primary : colors.onSurfaceVariant;
                    return (
                      <View style={[styles.statusChip, { backgroundColor: `${tint}20`, borderColor: `${tint}55` }]}>
                        <Text style={{ fontFamily: fonts.semiBold, fontSize: 10, color: tint }}>
                          {bookingStatusLabel(booking.status)}
                        </Text>
                      </View>
                    );
                  })()}
                </Entrance>
              ))}
          </Entrance>
        )}

        {/* Earnings breakdown */}
        <Entrance animation="slideDown" delay={240} style={[styles.card, { gap: spacing.sm }]}>
          <Text style={styles.cardTitle}>Earnings Breakdown</Text>
          <View style={styles.earningsRow}>
            <Text variant="bodyMedium" color={colors.onSurfaceVariant}>
              Fares · {boardedCount} seat{boardedCount === 1 ? '' : 's'}
            </Text>
            <Text style={{ fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, color: colors.onSurface }}>
              {formatGhs(totals.gross)}
            </Text>
          </View>
          <View style={styles.earningsRow}>
            <Text variant="bodyMedium" color={colors.onSurfaceVariant}>EyeGo commission</Text>
            <Text style={{ fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, color: colors.onSurfaceVariant }}>
              {formatGhs(-totals.commission)}
            </Text>
          </View>
          <View style={[styles.earningsRow, { paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.outlineVariant }]}>
            <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: fontSizes.bodyMedium, color: colors.onSurface }}>Total Earned</Text>
            <Text style={{ fontFamily: fonts.displayBold, fontSize: fontSizes.titleSmall, color: '#22C55E' }}>
              {formatGhs(earnedTotal)}
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
