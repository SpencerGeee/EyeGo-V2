import React, { useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { useRideStore } from '../../../stores/ride.store';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../../utils/useColors';
import { formatCurrency, formatDistance, formatDuration } from '@eyego/utils';
import { useQuery } from '@tanstack/react-query';
import { bookingsApi } from '@eyego/api';
import { Text } from '@eyego/ui';

export default function TripCompleteScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id, bookingId: paramBookingId } = useLocalSearchParams<{ id: string; bookingId?: string }>();
  const router = useRouter();
  const { activeBooking, selectedTrip } = useRideStore();
  const navigated = useRef(false);

  const bookingId = paramBookingId || activeBooking?.id || '';
  const { data: receiptData } = useQuery({
    queryKey: ['receipt', bookingId],
    queryFn: () => bookingsApi.getReceipt(bookingId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (r: any) => r.data?.data?.receipt ?? r.data?.data ?? r?.data ?? r,
    enabled: !!bookingId,
    staleTime: 60_000,
  });

  const receiptNumber = receiptData?.receiptNumber;
  const fareBreakdown = receiptData?.fareBreakdown ?? (receiptData?.totalPaid != null ? {
    total: receiptData.totalPaid,
    platformFee: receiptData.platformFee ?? 0,
    baseFare: (receiptData.totalPaid ?? 0) - (receiptData.platformFee ?? 0),
    discount: receiptData.discountApplied ?? 0,
    surcharges: 0,
    tip: 0,
  } : undefined);

  const totalFare = fareBreakdown?.total ?? activeBooking?.fareAmount ?? activeBooking?.fare ?? selectedTrip?.farePerSeat ?? 0;

  // Auto-navigate to rating after 4 s
  useEffect(() => {
    if (!id) return;
    const timer = setTimeout(() => {
      if (!navigated.current) {
        navigated.current = true;
        router.push(`/ride/${id}/rate-tip${bookingId ? `?bookingId=${bookingId}` : ''}` as Href);
      }
    }, 4000);
    return () => clearTimeout(timer);
  }, [id, bookingId, router]);

  const handleRateAndTip = useCallback(() => {
    navigated.current = true;
    router.push(`/ride/${id}/rate-tip${bookingId ? `?bookingId=${bookingId}` : ''}` as Href);
  }, [router, id, bookingId]);

  const handleShareReceipt = useCallback(() => {
    const shareText = [
      `EyeGo Trip Receipt${receiptNumber ? ` #${receiptNumber}` : ''}`,
      `Route: ${selectedTrip?.origin?.address?.split(',')[0] ?? 'Origin'} → ${selectedTrip?.destination?.address?.split(',')[0] ?? 'Destination'}`,
      `Total: ${formatCurrency(totalFare)}`,
      'Thank you for riding with EyeGo!',
    ].join('\n');
    Share.share({ message: shareText, title: 'EyeGo Receipt' }).catch(() => {});
  }, [receiptNumber, totalFare, selectedTrip]);

  useEffect(() => { if (!id) router.back(); }, [id, router]);
  if (!id) return null;

  const vehicleDisplay = [
    (selectedTrip as any)?.vehicle?.make,
    (selectedTrip as any)?.vehicle?.model,
  ].filter(Boolean).join(' ') || 'EyeGo';

  return (
    <SafeAreaView style={styles.safe}>
      {/* Ambient top glow */}
      <View style={[styles.topGlow, { backgroundColor: colors.primary + '10' }]} pointerEvents="none" />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Checkmark icon */}
        <MotiView
          from={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 28, delay: 100 }}
          style={styles.iconWrap}
        >
          <View style={styles.checkSquare}>
            <Ionicons name="checkmark-circle" size={52} color={colors.primary} />
          </View>
        </MotiView>

        {/* Headline */}
        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 200 }}
          style={styles.headlineSection}
        >
          <Text style={styles.headline}>Arrived Safely</Text>
        </MotiView>

        {/* Fare card */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 300 }}
          style={styles.fareCard}
        >
          <Text style={styles.fareLabel}>Total Fare</Text>
          <Text style={styles.fareAmount}>{formatCurrency(totalFare)}</Text>

          {/* Route timeline */}
          <View style={styles.routeRow}>
            <View style={styles.routeDot} />
            <Text style={styles.routeText} numberOfLines={1}>
              {selectedTrip?.origin?.address?.split(',')[0] ?? 'Origin'}
            </Text>
          </View>
          <View style={styles.routeLine} />
          <View style={styles.routeRow}>
            <View style={[styles.routeDot, styles.routeDotDest]} />
            <Text style={styles.routeText} numberOfLines={1}>
              {selectedTrip?.destination?.address?.split(',')[0] ?? 'Destination'}
            </Text>
          </View>

          <View style={styles.fareCardDivider} />

          {/* Stats row */}
          <View style={styles.statsRow}>
            <View>
              <Text style={styles.statsLabel}>DISTANCE / TIME</Text>
              <Text style={styles.statsValue}>
                {selectedTrip?.distanceKm ? formatDistance(selectedTrip.distanceKm) : '—'}
                {selectedTrip?.durationMinutes ? ` · ${formatDuration(selectedTrip.durationMinutes)}` : ''}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.statsLabel}>VEHICLE</Text>
              <Text style={[styles.statsValue, { color: colors.primary }]}>{vehicleDisplay}</Text>
            </View>
          </View>

          {/* Receipt link */}
          {receiptNumber && (
            <Pressable onPress={handleShareReceipt} style={styles.receiptLink} accessibilityRole="button" accessibilityLabel="Share receipt">
              <Ionicons name="receipt-outline" size={13} color={colors.onSurfaceVariant} />
              <Text style={styles.receiptLinkText}>Receipt #{receiptNumber}</Text>
              <Ionicons name="share-outline" size={13} color={colors.primary} />
            </Pressable>
          )}
        </MotiView>

        {/* CTAs */}
        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 400 }}
          style={styles.ctaSection}
        >
          <Pressable style={styles.primaryBtn} onPress={handleRateAndTip} accessibilityRole="button" accessibilityLabel="Rate your driver">
            <Text style={styles.primaryBtnText}>Rate your Trip</Text>
          </Pressable>
          <Pressable style={styles.ghostBtn} onPress={() => router.replace('/(tabs)/home' as Href)} accessibilityRole="button" accessibilityLabel="Back to home">
            <Text style={styles.ghostBtnText}>Back to Home</Text>
          </Pressable>
        </MotiView>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.backgroundDeep },
  topGlow: {
    position: 'absolute',
    top: -200,
    left: -100,
    right: -100,
    height: 500,
    borderRadius: 250,
    zIndex: 0,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing['3xl'],
    paddingBottom: spacing['3xl'],
    alignItems: 'center',
    gap: spacing.xl,
  },
  iconWrap: { alignItems: 'center' },
  checkSquare: {
    width: 88,
    height: 88,
    borderRadius: 22,
    backgroundColor: colors.surfaceCard,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  headlineSection: { alignItems: 'center' },
  headline: {
    fontFamily: fonts.displayBold,
    fontSize: 28,
    color: colors.onSurface,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  fareCard: {
    width: '100%',
    backgroundColor: colors.surfaceCard,
    borderRadius: radii['2xl'],
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    gap: spacing.md,
  },
  fareLabel: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodySmall,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  fareAmount: {
    fontFamily: fonts.displayBold,
    fontSize: 40,
    color: colors.onSurface,
    textAlign: 'center',
    letterSpacing: -1,
    marginBottom: spacing.sm,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  routeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  routeDotDest: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: colors.onSurface,
  },
  routeLine: {
    width: 2,
    height: 16,
    backgroundColor: colors.outlineVariant,
    marginLeft: 4,
  },
  routeText: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    color: colors.onSurface,
    flex: 1,
  },
  fareCardDivider: {
    height: 1,
    backgroundColor: colors.outlineVariant,
    marginVertical: spacing.xs,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  statsLabel: {
    fontFamily: fonts.medium,
    fontSize: 10,
    color: colors.onSurfaceVariant,
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  statsValue: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    color: colors.onSurface,
  },
  receiptLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.md,
    marginTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
  },
  receiptLinkText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodySmall,
    color: colors.onSurfaceVariant,
    flex: 1,
  },
  ctaSection: { width: '100%', gap: spacing.md },
  primaryBtn: {
    height: 56,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyLarge,
    color: '#002109',
    letterSpacing: 0.2,
  },
  ghostBtn: {
    height: 56,
    borderRadius: radii.full,
    borderWidth: 1.5,
    borderColor: colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyLarge,
    color: colors.onSurface,
    letterSpacing: 0.2,
  },
});
