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
import { fonts, fontSizes, spacing, radii, withOpacity } from '@eyego/config';
import { useColors, Colors } from '../../../utils/useColors';
import { formatCurrency, formatDistance, formatDuration } from '@eyego/utils';
import { useQuery } from '@tanstack/react-query';
import { bookingsApi } from '@eyego/api';
import { Text, GlassSurface, GradientGlowBorder, AnimatedCheckmark, PREMIUM_RING_COLORS, PREMIUM_RING_LOCATIONS } from '@eyego/ui';

export default function TripCompleteScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id, bookingId: paramBookingId, viewOnly } = useLocalSearchParams<{ id: string; bookingId?: string; viewOnly?: string }>();
  const isViewOnly = viewOnly === '1';
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

  // Auto-navigate to rating after 4 s — but not when this screen was opened
  // to view an OLD completed trip's receipt from Activity (viewOnly=1). This
  // screen is also the "just finished a ride" celebration/rating funnel, so
  // without this guard, browsing a past receipt would forcibly kick the rider
  // into "rate your driver" for a ride they may have already rated.
  useEffect(() => {
    if (!id || isViewOnly) return;
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
      <View style={[styles.topGlow, { backgroundColor: withOpacity(colors.primary, 0.06) }]} pointerEvents="none" />

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
            <AnimatedCheckmark size={52} color={colors.primary} strokeWidth={3.5} />
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

        {/* Fare card — celebratory hero with premium green glow ring */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 300 }}
          style={styles.fareCardWrap}
        >
          <GradientGlowBorder
            colors={PREMIUM_RING_COLORS}
            locations={PREMIUM_RING_LOCATIONS}
            fillColor={colors.surfaceCard}
            borderRadius={radii['2xl']}
            glow
            glowColor={colors.primary}
            style={styles.fareCard}
          >
            <GlassSurface borderRadius={radii['2xl'] - 3} intensity="high" dark style={styles.glassInset} />
            <View style={styles.fareCardInner}>
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
            </View>
          </GradientGlowBorder>
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
  safe: { flex: 1, backgroundColor: 'transparent' },
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
    borderColor: colors.rimLight,
  },
  headlineSection: { alignItems: 'center' },
  headline: {
    fontFamily: fonts.displayBold,
    fontSize: 28,
    lineHeight: 36,
    color: colors.onSurface,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  fareCardWrap: { width: '100%' },
  fareCard: {
    width: '100%',
    borderRadius: radii['2xl'],
    overflow: 'hidden',
  },
  glassInset: { position: 'absolute', top: 3, left: 3, right: 3, bottom: 3 },
  fareCardInner: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  fareLabel: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodySmall,
    lineHeight: Math.round(fontSizes.bodySmall * 1.3),
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  fareAmount: {
    fontFamily: fonts.displayBold,
    fontSize: 40,
    lineHeight: 48,
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
    backgroundColor: colors.rimLight,
    marginLeft: 4,
  },
  routeText: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    lineHeight: Math.round(fontSizes.bodyMedium * 1.3),
    color: colors.onSurface,
    flex: 1,
  },
  fareCardDivider: {
    height: 1,
    backgroundColor: colors.rimLightSubtle,
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
    lineHeight: 13,
    color: colors.onSurfaceVariant,
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  statsValue: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    lineHeight: Math.round(fontSizes.bodyMedium * 1.3),
    color: colors.onSurface,
  },
  receiptLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.md,
    marginTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.rimLightSubtle,
  },
  receiptLinkText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodySmall,
    lineHeight: Math.round(fontSizes.bodySmall * 1.3),
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
    lineHeight: fontSizes.bodyLarge * 1.3,
    color: colors.onPrimary,
    letterSpacing: 0.2,
  },
  ghostBtn: {
    height: 56,
    borderRadius: radii.full,
    borderWidth: 1.5,
    borderColor: colors.rimLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyLarge,
    lineHeight: fontSizes.bodyLarge * 1.3,
    color: colors.onSurface,
    letterSpacing: 0.2,
  },
});
