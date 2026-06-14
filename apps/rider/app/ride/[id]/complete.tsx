import React, { useCallback, useRef, useEffect, useMemo, useState } from 'react';
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
import { spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../../utils/useColors';
import { Text, Button } from '@eyego/ui';
import { formatCurrency, formatDistance, formatDuration } from '@eyego/utils';
import { useQuery } from '@tanstack/react-query';
import { bookingsApi } from '@eyego/api';

let LottieView: any = null;
try { LottieView = require('lottie-react-native').default; } catch {}

const successLottie = require('../../../assets/lottie/payment-success.json');

export default function TripCompleteScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id, bookingId: paramBookingId } = useLocalSearchParams<{ id: string; bookingId?: string }>();
  const router = useRouter();
  const { activeBooking, selectedTrip } = useRideStore();
  const lottieRef = useRef<any>(null);
  const navigated = useRef(false);
  const [expandedReceipt, setExpandedReceipt] = useState(false);

  // Fetch receipt from API — hooks must be called before any early return
  const bookingId = paramBookingId || activeBooking?.id || '';
  const { data: receiptData } = useQuery({
    queryKey: ['receipt', bookingId],
    queryFn: () => bookingsApi.getReceipt(bookingId),
    // Backend returns { receipt } (receipts.routes.js) — unwrap it; the previous
    // select stopped at .data so receiptNumber/fareBreakdown were always undefined.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (r: any) => r.data?.data?.receipt ?? r.data?.data ?? r?.data ?? r,
    enabled: !!bookingId,
    staleTime: 60_000,
  });

  const receiptNumber = receiptData?.receiptNumber;
  // The backend Receipt row is flat (totalPaid/platformFee/discountApplied) — it has
  // no nested fareBreakdown object, so synthesize one for the breakdown UI.
  const fareBreakdown = receiptData?.fareBreakdown ?? (receiptData?.totalPaid != null ? {
    total: receiptData.totalPaid,
    platformFee: receiptData.platformFee ?? 0,
    baseFare: (receiptData.totalPaid ?? 0) - (receiptData.platformFee ?? 0),
    discount: receiptData.discountApplied ?? 0,
    surcharges: 0,
    tip: 0,
  } : undefined);

  useEffect(() => {
    if (!id) return;
    if (lottieRef.current) {
      const timer = setTimeout(() => lottieRef.current?.play(), 300);
      return () => clearTimeout(timer);
    }
  }, [id]);

  // BUGFIX: Separated auto-navigation timer from lottie timer to ensure both have
  // proper cleanup. Previous code had a single useEffect with both setTimeout calls
  // that could fire after unmount.
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

  // Use receipt data if available, fallback to store
  const totalFare = fareBreakdown?.total ?? activeBooking?.fareAmount ?? activeBooking?.fare ?? selectedTrip?.farePerSeat ?? 0;
  const baseFare = fareBreakdown?.baseFare ?? totalFare * 0.95;
  const platformFee = fareBreakdown?.platformFee ?? totalFare * 0.05;
  const surcharges = fareBreakdown?.surcharges ?? 0;
  const discount = fareBreakdown?.discount ?? 0;
  const tip = fareBreakdown?.tip ?? 0;

  const handleShareReceipt = useCallback(() => {
    const shareText = [
      `🐾 EyeGo Trip Receipt #${receiptNumber ?? 'N/A'}`,
      `Route: ${selectedTrip?.origin?.address?.split(',')[0] ?? 'Origin'} → ${selectedTrip?.destination?.address?.split(',')[0] ?? 'Destination'}`,
      `Total: ${formatCurrency(totalFare)}`,
      'Thank you for riding with EyeGo!',
    ].join('\n');
    Share.share({ message: shareText, title: 'EyeGo Receipt' }).catch(() => {});
  }, [receiptNumber, totalFare, selectedTrip]);

  // R9: Guard against missing trip id — navigate back as a side-effect, not during render
  useEffect(() => {
    if (!id) router.back();
  }, [id, router]);

  if (!id) return null;

  return (
    <SafeAreaView style={styles.safe} accessibilityLabel="Trip complete screen">
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Celebration header with Lottie */}
        <MotiView
          from={{ opacity: 0, scale: 0.94, translateY: -10 }}
          animate={{ opacity: 1, scale: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 50 }}
          style={styles.celebrationSection}
        >
          {LottieView ? (
            <LottieView
              ref={lottieRef}
              source={successLottie}
              style={styles.lottie}
              loop={false}
              autoPlay={false}
            />
          ) : (
            <View style={styles.checkCircle} accessibilityLabel="Trip completed">
              <Ionicons name="checkmark" size={40} color={colors.onPrimary} />
            </View>
          )}
          <Text variant="headlineLarge" style={styles.arrivalText}>You've arrived!</Text>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant}>
            Trip completed successfully
          </Text>
        </MotiView>

        {/* Receipt card */}
        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 100 }}
          style={styles.receiptCard}
          accessibilityLabel={`Receipt. Total ${formatCurrency(totalFare)}`}
        >
          <Text variant="titleMedium" style={{ marginBottom: spacing.md }}>Receipt</Text>

          <View style={styles.receiptRow}>
            <Text variant="bodyMedium" color={colors.onSurfaceVariant}>Base Fare</Text>
            <Text variant="bodyMedium">{formatCurrency(baseFare)}</Text>
          </View>

          <View style={styles.receiptRow}>
            <Text variant="bodyMedium" color={colors.onSurfaceVariant}>Platform Fee</Text>
            <Text variant="bodyMedium">{formatCurrency(platformFee)}</Text>
          </View>

          {surcharges > 0 && (
            <View style={styles.receiptRow}>
              <Text variant="bodyMedium" color={colors.onSurfaceVariant}>Surcharges</Text>
              <Text variant="bodyMedium">{formatCurrency(surcharges)}</Text>
            </View>
          )}

          <View style={styles.receiptRow}>
            <Text variant="bodyMedium" color={colors.onSurfaceVariant}>Tip</Text>
            <Text variant="bodyMedium">{formatCurrency(tip)}</Text>
          </View>

          {discount > 0 && (
            <View style={styles.receiptRow}>
              <Text variant="bodyMedium" color="#4BE277">Discount Applied</Text>
              <Text variant="bodyMedium" color="#4BE277">−{formatCurrency(discount)}</Text>
            </View>
          )}

          <View style={styles.divider} />

          <View style={styles.receiptRowTotal}>
            <Text variant="titleMedium">Final Paid Total</Text>
            <Text variant="titleMedium" color={colors.primary}>{formatCurrency(totalFare)}</Text>
          </View>

          {/* Receipt number */}
          {receiptNumber && !expandedReceipt && (
            <Pressable
              onPress={() => setExpandedReceipt(true)}
              style={{ marginTop: spacing.sm }}
              accessibilityRole="button"
              accessibilityLabel={`Receipt number ${receiptNumber}. Tap for details`}
            >
              <Text variant="caption" color={colors.onSurfaceVariant}>
                Receipt #{receiptNumber}  〉
              </Text>
            </Pressable>
          )}

          {/* Expanded receipt details */}
          {expandedReceipt && (
            <MotiView
              from={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              style={{ marginTop: spacing.sm }}
            >
              <View style={[styles.divider, { marginVertical: spacing.sm }]} />
              <Text variant="caption" color={colors.onSurfaceVariant}>Receipt #{receiptNumber}</Text>
              {receiptData?.paymentMethod && (
                <Text variant="caption" color={colors.onSurfaceVariant}>Payment: {receiptData.paymentMethod}</Text>
              )}
              {receiptData?.paidAt && (
                <Text variant="caption" color={colors.onSurfaceVariant}>
                  Paid: {new Date(receiptData.paidAt).toLocaleString()}
                </Text>
              )}
              <Pressable
                onPress={handleShareReceipt}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm }}
                accessibilityRole="button"
                accessibilityLabel="Share receipt"
              >
                <Ionicons name="share-outline" size={14} color={colors.primary} />
                <Text variant="caption" color={colors.primary}>Share Receipt</Text>
              </Pressable>
            </MotiView>
          )}

          <View style={styles.tripRecap}>
            <RecapItem
              icon="map-outline"
              label={`${selectedTrip?.origin?.address?.split(',')[0] ?? 'Origin'} → ${selectedTrip?.destination?.address?.split(',')[0] ?? 'Dest'}`}
            />
            {selectedTrip?.distanceKm && (
              <RecapItem icon="speedometer-outline" label={formatDistance(selectedTrip.distanceKm)} />
            )}
            {selectedTrip?.durationMinutes && (
              <RecapItem icon="time-outline" label={formatDuration(selectedTrip.durationMinutes)} />
            )}
          </View>
        </MotiView>

        {/* CTA */}
        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 160 }}
          style={styles.ctaSection}
        >
          <Button
            label="Rate & Tip Driver"
            onPress={handleRateAndTip}
            accessibilityLabel="Rate your driver and add a tip"
          />
        </MotiView>
      </ScrollView>
    </SafeAreaView>
  );
}

function RecapItem({ icon, label }: { icon: any; label: string }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.recapItem}>
      <Ionicons name={icon} size={14} color={colors.onSurfaceVariant} />
      <Text variant="bodySmall" color={colors.onSurfaceVariant} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.backgroundDeep },
  scroll: {
    paddingHorizontal: spacing['2xl'],
    paddingBottom: spacing['3xl'],
    gap: spacing.xl,
  },
  celebrationSection: {
    alignItems: 'center',
    paddingTop: spacing['3xl'],
  },
  lottie: {
    width: 160,
    height: 160,
    marginBottom: spacing.base,
  },
  checkCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 12,
    marginBottom: spacing.xl,
  },
  arrivalText: { letterSpacing: -1, marginBottom: spacing.sm },
  receiptCard: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii['2xl'],
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  divider: {
    height: 1,
    backgroundColor: colors.outlineVariant,
    marginVertical: spacing.md,
  },
  receiptRowTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tripRecap: {
    width: '100%',
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingTop: spacing.base,
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
  },
  recapItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  ctaSection: {
    marginTop: spacing.sm,
  },
});
