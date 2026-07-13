import React, { useMemo, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii, withOpacity } from '@eyego/config';
import { Text, Button } from '@eyego/ui';
import { tripsApi, queryKeys } from '@eyego/api';
import { useColors, Colors } from '../../../utils/useColors';
import { useTripFlow } from '../../../stores/tripFlow.store';
import { useRideStore } from '../../../stores/ride.store';

const POLL_INTERVAL_MS = 4000;
// If no driver has accepted within this window, stop polling and show a
// terminal "no driver found" state instead of spinning forever.
const SEARCH_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * "Looking for a driver" stage of the persistent trip surface, ported from
 * app/ride/request.tsx. `mode='route'` keeps the legacy modal behavior for
 * the old /ride/request deep link.
 */
function RequestStageImpl({ mode = 'stage' }: { mode?: 'stage' | 'route' }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const popStage = useTripFlow((s) => s.popStage);
  const queryClient = useQueryClient();
  const { origin, destination: storeDestination } = useRideStore();
  const { destination: paramDestination, scheduledAt } = useLocalSearchParams<{
    destination?: string;
    scheduledAt?: string;
  }>();

  const destination = storeDestination?.address ?? paramDestination;

  const [status, setStatus] = useState<'sending' | 'searching' | 'matched' | 'error' | 'timeout'>('sending');
  const [cancelling, setCancelling] = useState(false);
  const requestIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentRef = useRef(false);

  useEffect(() => {
    if (sentRef.current || !destination) return;
    sentRef.current = true;

    (async () => {
      try {
        const res = await tripsApi.requestTrip({
          destination,
          scheduledAt: scheduledAt ?? new Date().toISOString(),
          seatCount: 1,
          pickupLat: origin?.latitude,
          pickupLng: origin?.longitude,
          destLat: storeDestination?.latitude,
          destLng: storeDestination?.longitude,
        });
        requestIdRef.current = res.data?.data?.requestId ?? null;

        if (!requestIdRef.current) {
          // Backend accepted the call but returned no id to poll — nothing to
          // wait on, so surface it instead of sitting in "searching" forever.
          setStatus('error');
          return;
        }

        setStatus('searching');
        pollTimerRef.current = setInterval(async () => {
          try {
            const check = await tripsApi.getTripRequest(requestIdRef.current!);
            const req = check.data?.data;
            if (req?.status === 'ACCEPTED' && req.matchedTripId) {
              if (pollTimerRef.current) clearInterval(pollTimerRef.current);
              if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
              setStatus('matched');
              queryClient.invalidateQueries({ queryKey: queryKeys.bookings.myHistory() });
              queryClient.invalidateQueries({ queryKey: queryKeys.bookings.active() });
              router.replace(`/ride/${req.matchedTripId}/tracking` as any);
            }
          } catch {
            // transient poll failure — try again on next tick
          }
        }, POLL_INTERVAL_MS);

        // No driver accepted within the window — stop polling and show a
        // terminal state instead of spinning on "Looking for a driver" forever.
        // Also cancel server-side so a driver can't still accept it later
        // while the rider believes the search ended.
        searchTimeoutRef.current = setTimeout(() => {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          setStatus((prev) => {
            if (prev !== 'searching') return prev;
            if (requestIdRef.current) tripsApi.cancelTripRequest(requestIdRef.current).catch(() => {});
            return 'timeout';
          });
        }, SEARCH_TIMEOUT_MS);
      } catch {
        setStatus('error');
      }
    })();

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Actually cancels the live request server-side (previously "Back to home"
  // only navigated away while the request kept searching, so a driver could
  // still accept it minutes later and silently create a booking the rider
  // had no idea was still live).
  const handleCancel = async () => {
    if (!requestIdRef.current) {
      router.replace('/(tabs)/home' as any);
      return;
    }
    setCancelling(true);
    try {
      await tripsApi.cancelTripRequest(requestIdRef.current);
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      router.replace('/(tabs)/home' as any);
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      Alert.alert('Could not cancel', msg ?? 'A driver may have already accepted — check your Activity tab.');
    } finally {
      setCancelling(false);
    }
  };

  const formattedTime = scheduledAt
    ? new Date(scheduledAt).toLocaleString('en-GH', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  const body = (
    <>
      {/* Back */}
      <View style={styles.header}>
        <Pressable
          onPress={() => (mode === 'route' ? router.back() : popStage())}
          style={styles.backBtn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
        </Pressable>
      </View>

      <View style={styles.body}>
        {/* Pulsing ring animation */}
        <View style={styles.iconContainer}>
          {[0, 1, 2].map((i) => (
            <MotiView
              key={i}
              from={{ opacity: 0.4, scale: 0.8 }}
              animate={{ opacity: 0, scale: 1.8 }}
              transition={{
                type: 'timing',
                duration: 2000,
                delay: i * 600,
                loop: true,
              }}
              style={[styles.ring, { position: 'absolute' }]}
            />
          ))}
          <View style={styles.iconCircle}>
            <Ionicons name="bus-outline" size={32} color={colors.primary} />
          </View>
        </View>

        <Text style={styles.title}>
          {status === 'matched' ? 'Driver found!'
            : status === 'error' ? "Couldn't send request"
            : status === 'timeout' ? 'No drivers found'
            : 'Looking for a driver'}
        </Text>
        <Text style={styles.subtitle}>
          {status === 'error' ? (
            "We couldn't reach the server to send your trip request. Check your connection and try again."
          ) : status === 'timeout' ? (
            "No nearby drivers accepted your request in time. Please try again, or search for a scheduled route instead."
          ) : (
            <>
              Your trip request to{' '}
              <Text style={styles.highlight}>{destination ?? 'your destination'}</Text>
              {formattedTime ? ` on ${formattedTime}` : ''}{' '}
              {status === 'sending'
                ? 'is being sent to nearby drivers…'
                : status === 'matched'
                ? 'was accepted — taking you to your trip.'
                : 'has been sent to nearby drivers.'}
            </>
          )}
        </Text>
        <Text style={styles.hint}>
          You'll be taken to live tracking automatically as soon as a driver accepts.
        </Text>

        {/* Info card */}
        <View style={styles.infoCard}>
          <Ionicons name="information-circle-outline" size={16} color={colors.onSurfaceVariant} />
          <Text style={styles.infoText}>
            Trip requests are grouped — other riders heading the same way will be added automatically.
          </Text>
        </View>

        {status === 'searching' ? (
          <>
            <Button
              label={cancelling ? 'Cancelling…' : 'Cancel request'}
              variant="ghost"
              onPress={() =>
                Alert.alert(
                  'Cancel trip request?',
                  'Nearby drivers will no longer be able to accept this request.',
                  [
                    { text: 'Keep searching', style: 'cancel' },
                    { text: 'Cancel request', style: 'destructive', onPress: handleCancel },
                  ]
                )
              }
              disabled={cancelling}
              style={{ width: '100%', marginTop: spacing.xl }}
            />
            <Pressable
              style={styles.activityBtn}
              onPress={() => router.replace('/(tabs)/home' as any)}
              accessibilityRole="button"
              accessibilityLabel="Leave without cancelling"
            >
              <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ textDecorationLine: 'underline' }}>
                Leave without cancelling — keep searching in the background
              </Text>
            </Pressable>
          </>
        ) : (
          <Button
            label="Back to home"
            onPress={() => router.replace('/(tabs)/home' as any)}
            style={{ width: '100%', marginTop: spacing.xl }}
          />
        )}

        <Pressable
          style={styles.activityBtn}
          onPress={() => router.replace('/(tabs)/activity' as any)}
          accessibilityRole="button"
          accessibilityLabel="View in Activity"
        >
          <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ textDecorationLine: 'underline' }}>
            View in Activity
          </Text>
        </Pressable>
      </View>
    </>
  );

  if (mode === 'route') {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {body}
      </SafeAreaView>
    );
  }
  // Stage mode: dimmed scrim over the persistent map so the pulse reads
  // as part of the surface instead of a separate screen.
  return (
    <View style={[styles.safe, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: withOpacity(colors.backgroundDeep, 0.9) }]} />
      {body}
    </View>
  );
}

// Memoized so the outgoing stage stays static during trip.tsx crossfades.
export const RequestStage = React.memo(RequestStageImpl);

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  header: {
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing.base,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceCard ?? colors.surfaceContainer,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing['2xl'],
    gap: spacing.lg,
  },
  iconContainer: {
    width: 96,
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  ring: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: `${colors.primary}50`,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: `${colors.primary}15`,
    borderWidth: 2,
    borderColor: `${colors.primary}40`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.headlineMedium,
    lineHeight: fontSizes.headlineMedium * 1.25,
    color: colors.onSurface,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodyMedium,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 22,
  },
  highlight: {
    fontFamily: fonts.semiBold,
    color: colors.primary,
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodySmall,
    color: colors.outline,
    textAlign: 'center',
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    marginTop: spacing.sm,
  },
  infoText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: fontSizes.caption,
    color: colors.onSurfaceVariant,
    lineHeight: 18,
  },
  activityBtn: {
    paddingVertical: spacing.md,
  },
});
