import React, { useMemo, useEffect } from 'react';
import { formatGhs } from '@eyego/utils';
import type { Trip, Booking } from '@eyego/types';
import type { DriverTrip } from '@eyego/api';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { driverApi } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import {
  Text,
  Button,
  Entrance,
  AnimatedCheckmark,
  AnimatedFareText,
  Skeleton,
  GradientGlowBorder,
  GlassSurface,
  AppBackground,
  bookingStatusLabel,
} from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../../utils/useColors';
import { useDriverStore } from '../../../stores/driver.store';

/**
 * Whole minutes a finished trip actually took.
 *
 * Order of preference: measured (startedAt→completedAt) > the route's stored
 * traffic-aware estimate > nothing. Never derive it from distance and an assumed
 * speed — that is what made this screen under-report every trip.
 */
function formatTripMinutes(trip: any): number | null {
  // `departedAt` — the field the state machine actually stamps on IN_PROGRESS.
  //
  // This used to read `trip.startedAt`, which is not a column on Trip, and then
  // fall back to `trip.route.durationMin`, which is not a column on Route
  // either. Both branches were therefore permanently undefined and the screen
  // showed "—" for every trip ever completed. `departureTime` is the SCHEDULED
  // time and is the last resort only: for an on-demand ride it is the moment
  // the trip row was created, which is close enough to be useful and never
  // exact, so measured departure wins whenever it exists.
  const end = trip?.completedAt ? new Date(trip.completedAt).getTime() : NaN;
  if (!Number.isFinite(end)) return null;

  for (const candidate of [trip?.departedAt, trip?.arrivedAt, trip?.departureTime]) {
    const start = candidate ? new Date(candidate).getTime() : NaN;
    if (Number.isFinite(start) && end > start) {
      return Math.max(1, Math.round((end - start) / 60000));
    }
  }
  return null;
}

export default function TripCompleteScreen() {
  const colors = useColors();
  const theme = useDriverStore(s => s.theme);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id, earnings: earningsParam } = useLocalSearchParams<{ id: string; earnings?: string }>();
  const router = useRouter();

  // D8: guard invalid id — navigate back after all hooks have run
  useEffect(() => {
    if (!id || typeof id !== 'string') {
      router.back();
    }
  }, [id, router]);

  const { data: trips } = useQuery({
    queryKey: ['driver', 'trips', 'all'],
    queryFn: () => driverApi.getAllTrips(),
    select: (r: { data?: { data?: { trips?: DriverTrip[] } } }) => r.data?.data?.trips ?? [],
    enabled: !!id && typeof id === 'string',
  });

  const completedTrip = trips?.find((t: DriverTrip) => t.id === id);
  const allActiveBookings = (completedTrip?.bookings as Booking[] | undefined)?.filter((b: Booking) => b.status !== 'CANCELLED') ?? [];
  // Include all non-cancelled bookings regardless of payment status — cash bookings have PENDING payment
  // D24: guard the reduce with a safe bookings array
  const bookings = allActiveBookings;
  const grossEarnings = bookings.reduce((sum: number, b: any) => sum + (parseFloat(b.fareAmountPesewas) || 0), 0);
  // commissionRate should come from backend — fallback to 15% if not provided
  const commissionRate = (completedTrip as any)?.commissionRate ?? 0.15;
  const platformFeePesewas = grossEarnings * commissionRate;
  const netEarnings = Math.max(0, grossEarnings - platformFeePesewas);
  /**
   * BUGFIX ("the trip complete page showed 0 at first then later went to 5.10 —
   * a driver who skips past it quickly thinks the trip paid nothing").
   *
   * This read `earningsParam ? parseFloat(...) : netEarnings`, and the string
   * `"0"` IS TRUTHY — so a zero handed over in the route params pinned the
   * headline at ₵0.00 and locked out the figure derived from the trip's own
   * bookings, which is the number the screen would otherwise have shown
   * immediately.
   *
   * Zero arrives here legitimately: `arriveTrip` short-circuits with
   * `totalEarningsPesewas: 0` when the trip was ALREADY completed (its
   * idempotency guard), which is exactly what a duplicate completion call hits.
   * So the one path that produces a zero is the path where the real earnings
   * definitely exist and are definitely not zero.
   *
   * A zero (or absent, or unparseable) param now means "I wasn't told", not
   * "it was nothing", and the locally-computed figure answers instead — no
   * flash of ₵0.00, and no wait for the round trip.
   */
  const paramEarnings = earningsParam != null ? parseFloat(earningsParam) : NaN;
  const hasParamEarnings = Number.isFinite(paramEarnings) && paramEarnings > 0;
  const boarded = allActiveBookings.length;
  const total = completedTrip?.maxSeats ?? 14;
  const farePerSeatPesewas = completedTrip?.farePerSeatPesewas ?? 0;

  // Receipt breakdown per passenger
  const paidBookings = allActiveBookings.filter((b: any) => b.paymentStatus === 'PAID');
  const cashBookings = allActiveBookings.filter((b: any) => b.paymentStatus !== 'PAID');
  const totalPaidPesewas = paidBookings.reduce((s: number, b: any) => s + (parseFloat(b.fareAmountPesewas) || 0), 0);
  const totalCash = cashBookings.reduce((s: number, b: any) => s + (parseFloat(b.fareAmountPesewas) || 0), 0);
  const commissionTotal = allActiveBookings.reduce((s: number, b: any) => {
    const c = parseFloat(b.commissionAmountPesewas);
    return s + (isNaN(c) ? (parseFloat(b.fareAmountPesewas) || 0) * commissionRate : c);
  }, 0);
  const driverNetTotal = grossEarnings - commissionTotal;

  /**
   * What the headline actually shows.
   *
   * `driverNetTotal` is derived entirely from `completedTrip`, which comes out
   * of the full `['driver','trips','all']` fetch. Until that resolves,
   * `bookings` is `[]`, every reduce above sums to zero, and the screen
   * confidently announced "You earned ₵0.00" before correcting itself a moment
   * later — the reported "showed 0 at first then later went to 5.10". A driver
   * who taps through quickly, or whose connection is slow, only ever sees the
   * zero and reasonably concludes the trip paid nothing.
   *
   * The completion call already returned the authoritative figure and passed it
   * here in the route params; it was parsed into a variable nothing rendered.
   * Use it for the instant paint, hand over to the locally-derived total once
   * the trip is really loaded (it carries the per-passenger breakdown the rest
   * of the receipt needs), and show a skeleton rather than a fabricated zero
   * when neither is available yet.
   *
   * STILL SHOWING ZERO after the fix above, and this is why: the branch was
   * `completedTrip ? driverNetTotal : …`, which prefers the derived total the
   * instant the trip object exists — including when its own numbers are not
   * ready. `['driver','trips','all']` is a CACHED list, so `completedTrip` is
   * very often present immediately, populated from before this ride was paid
   * out: every booking reduce sums to zero and the headline announces ₵0.00
   * while a perfectly good figure sits unused in the route params.
   *
   * The rule is not "which source" but "which is a real number". A positive
   * total wins wherever it comes from, the derived one takes over as soon as it
   * has substance, and zero is only ever shown when both sources agree the trip
   * genuinely paid nothing.
   */
  const headlineNetPesewas =
    driverNetTotal > 0
      ? driverNetTotal
      : hasParamEarnings
        ? paramEarnings
        : completedTrip
          ? driverNetTotal
          : null;

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground isDark={theme !== 'light'} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Animated checkmark — draws in on the UI thread */}
        <Entrance animation="scaleIn" delay={100} style={styles.checkCircle}>
          <View style={styles.checkGlow} />
          <AnimatedCheckmark size={52} color="#fff" strokeWidth={3.5} />
        </Entrance>

        {/* Title */}
        <Entrance animation="slideDown" delay={300} style={styles.titleContainer}>
          <Text style={styles.headline}>Trip Complete!</Text>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.subtitle}>
            {completedTrip?.route?.originName} → {completedTrip?.route?.destinationName}
          </Text>
        </Entrance>

        {/* Earnings card — the screen's hero number gets the premium ring */}
        <Entrance animation="slideDown" delay={400} style={styles.earningsCardWrapper}>
        <GradientGlowBorder
          palette="driver"
          fillColor={colors.surfaceContainerHigh}
          borderRadius={radii['2xl']}
          glow
          style={styles.earningsCard}
        >
          <View style={styles.earningsGlow} />
          <Text variant="caption" color={colors.onSurfaceVariant} style={styles.earningsLabel}>
            You earned
          </Text>
          {headlineNetPesewas != null ? (
            <AnimatedFareText pesewas={headlineNetPesewas} variant="fareLarge" color={colors.primary} shiny />
          ) : (
            <Skeleton width={140} height={38} borderRadius={10} />
          )}
          <View style={styles.earningsMeta}>
            <View style={styles.metaItem}>
              <Ionicons name="people" size={16} color={colors.onSurfaceVariant} />
              <Text variant="caption" color={colors.onSurfaceVariant}>
                {boarded}/{total} seats
              </Text>
            </View>
            <View style={styles.metaItem}>
              <Ionicons name="cash" size={16} color={colors.onSurfaceVariant} />
              <Text variant="caption" color={colors.onSurfaceVariant}>
                {formatGhs(farePerSeatPesewas)}/seat
              </Text>
            </View>
          </View>
        </GradientGlowBorder>
        </Entrance>

        {/* Stats row */}
        <Entrance animation="slideDown" delay={500} style={styles.statsRow}>
          <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.xl} intensity="low" />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{boarded}</Text>
            <Text variant="caption" color={colors.onSurfaceVariant}>Passengers</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{completedTrip?.route?.distanceKm ?? '—'} km</Text>
            <Text variant="caption" color={colors.onSurfaceVariant}>Distance</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            {/* This is a FINISHED trip, so the honest number is how long it
                actually took — startedAt→completedAt — not a distance/speed
                guess. The old `distanceKm / 40 * 60` reported a 40 km/h
                free-flow drive, so a 25-minute trip through traffic was
                summarised back to the driver as 12 minutes. Falls back to the
                route's stored traffic-aware estimate, then to nothing. */}
            <Text style={styles.statValue}>{formatTripMinutes(completedTrip) ?? '—'} min</Text>
            <Text variant="caption" color={colors.onSurfaceVariant}>Duration</Text>
          </View>
        </Entrance>

        {/* Receipt breakdown */}
        <Entrance animation="slideDown" delay={520} style={styles.receiptCard}>
          <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii['2xl']} intensity="low" />
          <Text style={styles.receiptTitle}>Earnings Breakdown</Text>

          <View style={styles.receiptRow}>
            <Text variant="bodyMedium" color={colors.onSurfaceVariant}>Gross fare × {boarded} seats</Text>
            <Text variant="bodyMedium">{formatGhs(grossEarnings)}</Text>
          </View>

          <View style={styles.passengerList}>
            {allActiveBookings.map((b: any, i: number) => (
              <View key={b.id ?? i} style={styles.passengerRow}>
                <View style={styles.passengerAvatar}>
                  <Text style={styles.passengerInitial}>
                    {(b.user?.name?.[0] ?? '?').toUpperCase()}
                  </Text>
                </View>
                <Text variant="caption" color={colors.onSurfaceVariant} style={{ flex: 1 }}>
                  {b.user?.name ?? `Seat ${b.seatNumber}`}
                </Text>
                <View style={[styles.payBadge, { backgroundColor: b.paymentStatus === 'PAID' ? `${colors.online}22` : `${colors.warning}22` }]}>
                  <Text style={[styles.payBadgeText, { color: b.paymentStatus === 'PAID' ? colors.online : colors.warning }]}>
                    {b.paymentStatus === 'PAID' ? 'Paid' : b.paymentStatus === 'PENDING' ? 'Cash' : bookingStatusLabel(b.status)}
                  </Text>
                </View>
                <Text variant="bodySmall" style={{ fontFamily: fonts.semiBold, color: colors.onSurface, marginLeft: spacing.sm }}>
                  {formatGhs((parseFloat(b.fareAmountPesewas) || farePerSeatPesewas))}
                </Text>
              </View>
            ))}
          </View>

          <View style={styles.divider} />

          <View style={styles.receiptRow}>
            <Text variant="bodyMedium" color={colors.onSurfaceVariant}>Collected (Paid)</Text>
            <Text variant="bodyMedium" color={colors.online}>{formatGhs(totalPaidPesewas)}</Text>
          </View>
          <View style={styles.receiptRow}>
            <Text variant="bodyMedium" color={colors.onSurfaceVariant}>Pending (Cash)</Text>
            <Text variant="bodyMedium" color={colors.warning}>{formatGhs(totalCash)}</Text>
          </View>
          <View style={styles.receiptRow}>
            <Text variant="bodyMedium" color={colors.onSurfaceVariant}>EyeGo Commission ({Math.round(commissionRate * 100)}%)</Text>
            <Text variant="bodyMedium" color={colors.error}>− {formatGhs(commissionTotal)}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.receiptRowTotal}>
            <Text variant="titleMedium">Your Net Earnings</Text>
            <Text variant="titleMedium" color={colors.primary}>{formatGhs(driverNetTotal)}</Text>
          </View>

          {completedTrip?.route?.distanceKm && (
            <Text variant="caption" color={colors.onSurfaceVariant} style={{ marginTop: spacing.sm, textAlign: 'center' }}>
              ~{formatGhs((driverNetTotal / completedTrip.route.distanceKm))}/km average
            </Text>
          )}
        </Entrance>

        {/* CTA */}
        <Entrance animation="slideDown" delay={600} style={styles.ctaWrapper}>
          <Button
            label="Rate Passengers"
            onPress={() => router.push(`/(trip)/rate-passengers/${id}`)}
            variant="secondary"
          />
          <Button
            label="Back to Home"
            onPress={() => router.replace('/(tabs)/home')}
          />
          <Button
            label="View Earnings"
            variant="secondary"
            onPress={() => router.replace('/(tabs)/earnings')}
          />
        </Entrance>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    scroll: { alignItems: 'center', paddingHorizontal: spacing['2xl'], paddingBottom: spacing['3xl'], gap: spacing.xl, paddingTop: spacing['3xl'] },
    checkCircle: {
      width: 100,
      height: 100,
      borderRadius: 50,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    checkGlow: {
      position: 'absolute',
      width: 140,
      height: 140,
      borderRadius: 70,
      backgroundColor: colors.primary,
      opacity: 0.3,
    },
    titleContainer: { alignItems: 'center', gap: spacing.xs },
    headline: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.headlineLarge,
      lineHeight: Math.round(fontSizes.headlineLarge * 1.25),
      color: colors.onSurface,
      letterSpacing: -0.5,
    },
    subtitle: { textAlign: 'center', lineHeight: 22 },
    earningsCardWrapper: { width: '100%' },
    earningsCard: {
      padding: spacing['2xl'],
      alignItems: 'center',
      gap: spacing.xs,
    },
    earningsGlow: {
      position: 'absolute',
      width: 200,
      height: 200,
      borderRadius: 100,
      backgroundColor: colors.primary,
      opacity: 0.08,
    },
    earningsLabel: {},
    earningsAmount: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.hero,
      lineHeight: Math.round(fontSizes.hero * 1.15),
      color: colors.primary,
      letterSpacing: -1,
      marginVertical: spacing.xs,
    },
    earningsMeta: { flexDirection: 'row', gap: spacing.lg },
    metaItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    statsRow: {
      width: '100%',
      flexDirection: 'row',
      borderRadius: radii.xl,
      padding: spacing.base,
      overflow: 'hidden',
    },
    statItem: { flex: 1, alignItems: 'center', gap: 4 },
    statDivider: { width: 1, backgroundColor: colors.outline, marginVertical: 4 },
    statValue: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.titleSmall,
      lineHeight: Math.round(fontSizes.titleSmall * 1.4),
      color: colors.onSurface,
    },
    ctaWrapper: { width: '100%', gap: spacing.md },
    receiptCard: {
      width: '100%',
      borderRadius: radii['2xl'],
      padding: spacing.xl,
      gap: spacing.sm,
      overflow: 'hidden',
    },
    receiptTitle: {
      fontFamily: fonts.displaySemiBold,
      fontSize: fontSizes.titleSmall,
      lineHeight: Math.round(fontSizes.titleSmall * 1.4),
      color: colors.onSurface,
      marginBottom: spacing.sm,
    },
    receiptRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    receiptRowTotal: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    divider: { height: 1, backgroundColor: colors.outlineVariant, marginVertical: spacing.sm },
    passengerList: { gap: spacing.xs },
    passengerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.xs,
    },
    passengerAvatar: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.surfaceContainerHigh,
      alignItems: 'center',
      justifyContent: 'center',
    },
    passengerInitial: {
      fontFamily: fonts.semiBold,
      fontSize: 11,
      lineHeight: 14,
      color: colors.onSurface,
    },
    payBadge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: radii.full,
    },
    payBadgeText: {
      fontFamily: fonts.semiBold,
      fontSize: 9,
      lineHeight: 12,
      letterSpacing: 0.3,
    },
  });
