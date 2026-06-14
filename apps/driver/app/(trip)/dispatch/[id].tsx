import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { driverApi } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../../utils/useColors';
import { useDriverStore } from '../../../stores/driver.store';
import * as Haptics from 'expo-haptics';

// How many seconds the driver has to respond if no expiresAt is provided
const DEFAULT_TIMEOUT_S = 30;

export default function DispatchScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const qc = useQueryClient();
  const { setActiveTripId } = useDriverStore();

  const { id, origin, destination, departureTime, expiresAt, estimatedEarnings } = useLocalSearchParams<{
    id: string;
    origin: string;
    destination: string;
    departureTime: string;
    estimatedEarnings?: string;
    expiresAt?: string;
  }>();

  const initialSeconds = useMemo(() => {
    if (expiresAt) {
      const diff = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
      return Math.max(1, diff);
    }
    return DEFAULT_TIMEOUT_S;
  }, [expiresAt]);

  const [secondsLeft, setSecondsLeft] = useState(initialSeconds);
  const timedOut = secondsLeft <= 0;

  // Countdown
  useEffect(() => {
    if (timedOut) return;
    const timer = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) { clearInterval(timer); return 0; }
        if (s <= 6) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [timedOut]);

  // D8: guard invalid id — navigate back after mount
  useEffect(() => {
    if (!id || typeof id !== 'string') {
      router.back();
    }
  }, [id, router]);

  // Auto-navigate away on timeout (1.5s delay lets "Expired" state render first)
  useEffect(() => {
    if (secondsLeft <= 0) {
      const t = setTimeout(() => router.replace('/(tabs)' as any), 1500);
      return () => clearTimeout(t);
    }
  }, [secondsLeft, router]);

  interface AcceptDispatchResponse {
    data?: { data?: { trip?: { id: string; status: string } | null; id?: string } };
  }

  const accept = useMutation({
    mutationFn: () => driverApi.acceptDispatch(id),
    onSuccess: (res: AcceptDispatchResponse) => {
      // DM5: haptic feedback on successful trip accept
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const tripData = res?.data?.data?.trip ?? res?.data?.data;
      const tripId = tripData?.id ?? id;
      setActiveTripId(tripId);
      // Invalidate trip lists so the accepted trip leaves the dispatch/assigned
      // list and shows as the active trip instead of lingering as "ASSIGNED".
      qc.invalidateQueries({ queryKey: ['driver', 'trips', 'all'] });
      qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
      router.replace(`/(trip)/active/${tripId}`);
    },
    onError: (err: any) => {
      const status = err?.response?.status;
      if (status === 409 || status === 410) {
        Alert.alert('Dispatch Unavailable', 'This dispatch has already expired or been claimed by another driver.');
        router.replace('/(tabs)' as any);
      } else {
        Alert.alert('Error', 'Failed to accept trip. Please try again.');
      }
    },
  });

  const decline = useMutation({
    mutationFn: () => driverApi.declineDispatch(id),
    onSuccess: () => router.back(),
    onError: () => router.back(), // navigate away regardless
  });

  const handleDecline = useCallback(() => {
    Alert.alert('Decline Trip?', 'This trip will be offered to another driver.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Decline',
        style: 'destructive',
        onPress: () => decline.mutate(),
      },
    ]);
  }, [decline]);

  const departureFormatted = departureTime
    ? new Date(departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '—';

  // Progress ring percentage
  const progress = timedOut ? 0 : secondsLeft / initialSeconds;
  const urgentColor = secondsLeft <= 10 ? colors.error : colors.primary;

  return (
    <SafeAreaView style={styles.safe}>
      <MotiView
        from={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 350, damping: 28 }}
        style={styles.container}
      >
        {/* Header */}
        <MotiView
          from={{ opacity: 0, translateY: -8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 60 }}
          style={styles.header}
        >
          <View style={[styles.dispatchBadge, { backgroundColor: `${colors.primary}22`, borderColor: `${colors.primary}55` }]}>
            <View style={[styles.dispatchDot, { backgroundColor: colors.primary }]} />
            <Text style={[styles.dispatchLabel, { color: colors.primary }]}>Trip Assigned</Text>
          </View>
          <Text style={styles.headline}>New Trip Request</Text>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant}>
            Accept within {initialSeconds}s or it will be reassigned.
          </Text>
        </MotiView>

        {/* Countdown ring */}
        <MotiView
          from={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25, delay: 100 }}
          style={styles.timerWrapper}
        >
          <View style={[styles.timerRing, { borderColor: `${urgentColor}33` }]}>
            <View style={[styles.timerInner, { backgroundColor: `${urgentColor}14` }]}>
              <Text style={[styles.timerDigits, { color: urgentColor }]}>
                {String(secondsLeft).padStart(2, '0')}
              </Text>
              <Text variant="caption" color={colors.onSurfaceVariant}>seconds</Text>
            </View>
          </View>
        </MotiView>

        {/* Route card */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 140 }}
          style={styles.routeCard}
        >
          <View style={styles.routeRow}>
            <View style={[styles.routeDot, { backgroundColor: colors.primary }]} />
            <View style={styles.routeInfo}>
              <Text variant="caption" color={colors.onSurfaceVariant}>From</Text>
              <Text style={styles.routeText}>{origin ?? '—'}</Text>
            </View>
          </View>
          <View style={styles.routeLine} />
          <View style={styles.routeRow}>
            <Ionicons name="location" size={16} color={colors.error} style={{ marginLeft: 2 }} />
            <View style={styles.routeInfo}>
              <Text variant="caption" color={colors.onSurfaceVariant}>To</Text>
              <Text style={styles.routeText}>{destination ?? '—'}</Text>
            </View>
          </View>
          <View style={styles.routeDivider} />
          <View style={styles.metaRow}>
            <Ionicons name="time-outline" size={14} color={colors.onSurfaceVariant} />
            <Text variant="caption" color={colors.onSurfaceVariant}>Departure: {departureFormatted}</Text>
          </View>
        </MotiView>

        {/* Estimated Earnings */}
        {estimatedEarnings && (
          <MotiView
            from={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 170 }}
            style={styles.earningsCard}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text variant="bodySmall" color={colors.onSurfaceVariant}>Estimated earnings</Text>
              <Text style={{ fontFamily: fonts.displayBold, fontSize: 18, color: colors.primary }}>
                GHS {parseFloat(estimatedEarnings).toFixed(2)}
              </Text>
            </View>
            <View style={{ height: 1, backgroundColor: colors.outline, marginVertical: spacing.sm }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
              <Ionicons name="time-outline" size={13} color={colors.onSurfaceVariant} />
              <Text variant="caption" color={colors.onSurfaceVariant}>
                Trip departs at {departureFormatted}
              </Text>
            </View>
          </MotiView>
        )}

        {/* Actions */}
        <MotiView
          from={{ opacity: 0, translateY: 16 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 200 }}
          style={styles.actions}
        >
          {timedOut ? (
            <Text
              variant="bodyMedium"
              color={colors.onSurfaceVariant}
              style={{ textAlign: 'center' }}
            >
              This dispatch has expired. Returning home…
            </Text>
          ) : (
            <>
              <Button
                label="Accept Trip"
                onPress={() => accept.mutate()}
                loading={accept.isPending}
                disabled={accept.isPending || decline.isPending}
                style={styles.acceptBtn}
              />
              <Button
                label="Decline"
                onPress={handleDecline}
                loading={decline.isPending}
                disabled={accept.isPending || decline.isPending}
                variant="secondary"
                style={styles.declineBtn}
              />
            </>
          )}
        </MotiView>
      </MotiView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.backgroundDeep },
    container: {
      flex: 1,
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing['2xl'],
      paddingBottom: spacing['3xl'],
      gap: spacing.xl,
    },
    header: { gap: spacing.sm },
    dispatchBadge: {
      flexDirection: 'row',
      alignSelf: 'flex-start',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radii.full,
      borderWidth: 1,
      marginBottom: spacing.xs,
    },
    dispatchDot: { width: 7, height: 7, borderRadius: 4 },
    dispatchLabel: { fontFamily: fonts.semiBold, fontSize: 11, letterSpacing: 0.5 },
    headline: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.headlineLarge ?? 28,
      color: colors.onSurface,
      letterSpacing: -0.5,
    },
    timerWrapper: { alignItems: 'center' },
    timerRing: {
      width: 130,
      height: 130,
      borderRadius: 65,
      borderWidth: 6,
      alignItems: 'center',
      justifyContent: 'center',
    },
    timerInner: {
      width: 108,
      height: 108,
      borderRadius: 54,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
    },
    timerDigits: {
      fontFamily: fonts.displayBold,
      fontSize: 42,
      letterSpacing: -2,
    },
    routeCard: {
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii['2xl'],
      borderWidth: 1,
      borderColor: colors.outline,
      padding: spacing.xl,
      gap: spacing.sm,
    },
    routeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    routeDot: { width: 10, height: 10, borderRadius: 5, marginLeft: 3 },
    routeInfo: { flex: 1 },
    routeText: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyMedium,
      color: colors.onSurface,
    },
    routeLine: {
      width: 2,
      height: 18,
      backgroundColor: colors.outline,
      marginLeft: 7,
    },
    routeDivider: { height: 1, backgroundColor: colors.outline, marginVertical: spacing.sm },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    actions: { gap: spacing.md, marginTop: 'auto' },
    earningsCard: {
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii['2xl'],
      borderWidth: 1,
      borderColor: colors.primary + '30',
      padding: spacing.xl,
      gap: spacing.xs,
    },
    acceptBtn: {},
    declineBtn: {},
  });
