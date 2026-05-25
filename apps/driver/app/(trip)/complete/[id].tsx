import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
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

  const { data: trips } = useQuery({
    queryKey: ['driver', 'trips', 'all'],
    queryFn: () => driverApi.getAllTrips(),
    select: (r) => (r.data as any)?.data?.trips ?? [],
  });

  const completedTrip = (trips as any[])?.find((t: any) => t.id === id);
  const allActiveBookings = completedTrip?.bookings?.filter((b: any) => b.status !== 'CANCELLED') ?? [];
  // Include all non-cancelled bookings regardless of payment status — cash bookings have PENDING payment
  const grossEarnings = allActiveBookings.reduce((sum: number, b: any) => sum + (parseFloat(b.fareAmount) || 0), 0);
  const platformFee = grossEarnings * 0.15;
  const netEarnings = Math.max(0, grossEarnings - platformFee);
  const earnings = earningsParam ? parseFloat(earningsParam) : netEarnings;
  const boarded = allActiveBookings.length;
  const total = completedTrip?.maxSeats ?? 14;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
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
          <Text style={styles.earningsAmount}>GHS {earnings.toFixed(2)}</Text>
          <View style={styles.earningsMeta}>
            <View style={styles.metaItem}>
              <Ionicons name="people" size={16} color={colors.onSurfaceVariant} />
              <Text variant="caption" color={colors.onSurfaceVariant}>
                {boarded}/{total} seats
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

        {/* CTA */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 600 }}
          style={styles.ctaWrapper}
        >
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
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    container: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing['2xl'],
      gap: spacing.xl,
    },
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
  });
