import React, { useMemo, useEffect } from 'react';
import type { Trip, Booking } from '@eyego/types';
import type { DriverTrip } from '@eyego/api';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { useQuery } from '@tanstack/react-query';
import { driverApi } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../../utils/useColors';

export default function TripCompleteScreen() {
  const colors = useColors();
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
  const grossEarnings = bookings.reduce((sum: number, b: any) => sum + (parseFloat(b.fareAmount) || 0), 0);
  // commissionRate should come from backend — fallback to 15% if not provided
  const commissionRate = (completedTrip as any)?.commissionRate ?? 0.15;
  const platformFee = grossEarnings * commissionRate;
  const netEarnings = Math.max(0, grossEarnings - platformFee);
  const earnings = earningsParam ? parseFloat(earningsParam) : netEarnings;
  const boarded = allActiveBookings.length;
  const total = completedTrip?.maxSeats ?? 14;
  const farePerSeat = completedTrip?.farePerSeat ?? 0;

  // Receipt breakdown per passenger
  const paidBookings = allActiveBookings.filter((b: any) => b.paymentStatus === 'PAID');
  const cashBookings = allActiveBookings.filter((b: any) => b.paymentStatus !== 'PAID');
  const totalPaid = paidBookings.reduce((s: number, b: any) => s + (parseFloat(b.fareAmount) || 0), 0);
  const totalCash = cashBookings.reduce((s: number, b: any) => s + (parseFloat(b.fareAmount) || 0), 0);
  const commissionTotal = allActiveBookings.reduce((s: number, b: any) => {
    const c = parseFloat(b.commissionAmount);
    return s + (isNaN(c) ? (parseFloat(b.fareAmount) || 0) * commissionRate : c);
  }, 0);
  const driverNetTotal = grossEarnings - commissionTotal;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Animated checkmark */}
        <MotiView
          from={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 18, delay: 100 }}
          style={styles.checkCircle}
        >
          <View style={styles.checkGlow} />
          <Ionicons name="checkmark" size={52} color="#fff" />
        </MotiView>

        {/* Title */}
        <MotiView
          from={{ opacity: 0, translateY: 16 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 300 }}
          style={styles.titleContainer}
        >
          <Text style={styles.headline}>Trip Complete!</Text>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.subtitle}>
            {completedTrip?.route?.originName} → {completedTrip?.route?.destinationName}
          </Text>
        </MotiView>

        {/* Earnings card */}
        <MotiView
          from={{ opacity: 0, translateY: 16, scale: 0.96 }}
          animate={{ opacity: 1, translateY: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 400 }}
          style={styles.earningsCard}
        >
          <View style={styles.earningsGlow} />
          <Text variant="caption" color={colors.onSurfaceVariant} style={styles.earningsLabel}>
            You earned
          </Text>
          <Text style={styles.earningsAmount}>GHS {driverNetTotal.toFixed(2)}</Text>
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
                GHS {farePerSeat.toFixed(2)}/seat
              </Text>
            </View>
          </View>
        </MotiView>

        {/* Stats row */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 500 }}
          style={styles.statsRow}
        >
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
            <Text style={styles.statValue}>{completedTrip?.route?.distanceKm ? Math.round(completedTrip.route.distanceKm / 40 * 60) : '—'} min</Text>
            <Text variant="caption" color={colors.onSurfaceVariant}>Duration</Text>
          </View>
        </MotiView>

        {/* Receipt breakdown */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 520 }}
          style={styles.receiptCard}
        >
          <Text style={styles.receiptTitle}>Earnings Breakdown</Text>

          <View style={styles.receiptRow}>
            <Text variant="bodyMedium" color={colors.onSurfaceVariant}>Gross fare × {boarded} seats</Text>
            <Text variant="bodyMedium">GHS {grossEarnings.toFixed(2)}</Text>
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
                    {b.paymentStatus === 'PAID' ? 'Paid' : b.paymentStatus === 'PENDING' ? 'Cash' : b.status}
                  </Text>
                </View>
                <Text variant="bodySmall" style={{ fontFamily: fonts.semiBold, color: colors.onSurface, marginLeft: spacing.sm }}>
                  GHS {(parseFloat(b.fareAmount) || farePerSeat).toFixed(2)}
                </Text>
              </View>
            ))}
          </View>

          <View style={styles.divider} />

          <View style={styles.receiptRow}>
            <Text variant="bodyMedium" color={colors.onSurfaceVariant}>Collected (Paid)</Text>
            <Text variant="bodyMedium" color={colors.online}>GHS {totalPaid.toFixed(2)}</Text>
          </View>
          <View style={styles.receiptRow}>
            <Text variant="bodyMedium" color={colors.onSurfaceVariant}>Pending (Cash)</Text>
            <Text variant="bodyMedium" color={colors.warning}>GHS {totalCash.toFixed(2)}</Text>
          </View>
          <View style={styles.receiptRow}>
            <Text variant="bodyMedium" color={colors.onSurfaceVariant}>EyeGo Commission ({Math.round(commissionRate * 100)}%)</Text>
            <Text variant="bodyMedium" color={colors.error}>− GHS {commissionTotal.toFixed(2)}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.receiptRowTotal}>
            <Text variant="titleMedium">Your Net Earnings</Text>
            <Text variant="titleMedium" color={colors.primary}>GHS {driverNetTotal.toFixed(2)}</Text>
          </View>

          {completedTrip?.route?.distanceKm && (
            <Text variant="caption" color={colors.onSurfaceVariant} style={{ marginTop: spacing.sm, textAlign: 'center' }}>
              ~GHS {(driverNetTotal / completedTrip.route.distanceKm).toFixed(2)}/km average
            </Text>
          )}
        </MotiView>

        {/* CTA */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 600 }}
          style={styles.ctaWrapper}
        >
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
        </MotiView>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
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
      color: colors.onSurface,
      letterSpacing: -0.5,
    },
    subtitle: { textAlign: 'center', lineHeight: 22 },
    earningsCard: {
      width: '100%',
      backgroundColor: colors.surfaceContainerHigh,
      borderRadius: radii['2xl'],
      borderWidth: 1,
      borderColor: colors.outline,
      padding: spacing['2xl'],
      alignItems: 'center',
      overflow: 'hidden',
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
      color: colors.primary,
      letterSpacing: -1,
      marginVertical: spacing.xs,
    },
    earningsMeta: { flexDirection: 'row', gap: spacing.lg },
    metaItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    statsRow: {
      width: '100%',
      flexDirection: 'row',
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outline,
      padding: spacing.base,
    },
    statItem: { flex: 1, alignItems: 'center', gap: 4 },
    statDivider: { width: 1, backgroundColor: colors.outline, marginVertical: 4 },
    statValue: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.titleSmall,
      color: colors.onSurface,
    },
    ctaWrapper: { width: '100%', gap: spacing.md },
    receiptCard: {
      width: '100%',
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii['2xl'],
      borderWidth: 1,
      borderColor: colors.outline,
      padding: spacing.xl,
      gap: spacing.sm,
    },
    receiptTitle: {
      fontFamily: fonts.displaySemiBold,
      fontSize: fontSizes.titleSmall,
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
      letterSpacing: 0.3,
    },
  });
