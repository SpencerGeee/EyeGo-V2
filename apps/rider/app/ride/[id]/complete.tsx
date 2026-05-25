import React, { useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { useRideStore } from '../../../stores/ride.store';
import { spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../../utils/useColors';
import { Text, Button } from '@eyego/ui';
import { formatCurrency, formatDistance, formatDuration } from '@eyego/utils';

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

  useEffect(() => {
    if (lottieRef.current) {
      setTimeout(() => lottieRef.current?.play(), 300);
    }
    // Auto-navigate to rating after celebration animation plays
    const timer = setTimeout(() => {
      if (!navigated.current) {
        navigated.current = true;
        const bookingId = paramBookingId || activeBooking?.id || '';
        router.push(`/ride/${id}/rate-tip${bookingId ? `?bookingId=${bookingId}` : ''}` as any);
      }
    }, 4000);
    return () => clearTimeout(timer);
  }, [id, paramBookingId, activeBooking?.id]);

  const handleRateAndTip = useCallback(() => {
    navigated.current = true;
    const bookingId = paramBookingId || activeBooking?.id || '';
    router.push(`/ride/${id}/rate-tip${bookingId ? `?bookingId=${bookingId}` : ''}` as any);
  }, [router, id, paramBookingId, activeBooking?.id]);

  const totalFare = (activeBooking as any)?.fareAmount ?? (activeBooking as any)?.fare ?? (selectedTrip as any)?.farePerSeat ?? 0;
  const platformFee = totalFare * 0.05;
  const baseFare = totalFare - platformFee;
  const surcharges = 0;
  const tip = 0;

  return (
    <SafeAreaView style={styles.safe}>
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
            <View style={styles.checkCircle}>
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
          
          <View style={styles.divider} />
          
          <View style={styles.receiptRowTotal}>
            <Text variant="titleMedium">Final Paid Total</Text>
            <Text variant="titleMedium" color={colors.primary}>{formatCurrency(totalFare)}</Text>
          </View>

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
