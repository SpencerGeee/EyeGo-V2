import React, { useMemo, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { fonts, fontSizes, spacing, radii, withOpacity } from '@eyego/config';
import { Text, Button, GlassSurface, GradientGlowBorder, MorphTarget } from '@eyego/ui';
import { tripsApi, queryKeys, socketEvents } from '@eyego/api';
import { useColors, Colors } from '../../../utils/useColors';
import { offlineQueue } from '../../../utils/offlineQueue';
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
  const setDispatchOffer = useTripFlow((s) => s.setDispatchOffer);
  const setNearbyDrivers = useTripFlow((s) => s.setNearbyDrivers);
  const setPickupCoord = useTripFlow((s) => s.setPickupCoord);
  const dispatchOffer = useTripFlow((s) => s.dispatchOffer);
  const [dispatchAttempt, setDispatchAttempt] = useState<{ attempt: number; total: number }>({ attempt: 0, total: 0 });
  const queryClient = useQueryClient();
  const { origin, destination: storeDestination, setPendingTripRequest, requestSeatCount, requestCoverAll } = useRideStore();
  const { destination: paramDestination, scheduledAt, resumeRequestId } = useLocalSearchParams<{
    destination?: string;
    scheduledAt?: string;
    resumeRequestId?: string;
  }>();

  const destination = storeDestination?.address ?? paramDestination;

  const [status, setStatus] = useState<'sending' | 'searching' | 'matched' | 'error' | 'timeout'>('sending');
  const [cancelling, setCancelling] = useState(false);
  const requestIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentRef = useRef(false);

  // One place that owns "a driver took this request", so the 4s poll, the
  // resumed poll and the (previously unwired) socket push all settle it
  // identically. The double-navigation guard lives here too — the Activity
  // tab's LiveRequestCard polls the same request independently, and two
  // racing navigations into a not-yet-existing tracking route used to crash.
  const finishMatch = React.useCallback((matchedTripId: string) => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (useRideStore.getState().pendingTripRequestId !== requestIdRef.current) return;
    setPendingTripRequest(null);
    setStatus('matched');
    queryClient.invalidateQueries({ queryKey: queryKeys.bookings.myHistory() });
    queryClient.invalidateQueries({ queryKey: queryKeys.bookings.active() });
    router.dismissTo(`/ride/${matchedTripId}/tracking` as any);
  }, [queryClient, router, setPendingTripRequest]);

  // DEAD-PATH FIX: the backend emits `trip:request_accepted` to this rider the
  // instant a driver accepts, but nothing ever listened, so the only way this
  // screen learned it had been matched was its own 4-second poll. The rider
  // watched a spinner for up to four seconds after their driver was already on
  // the way. The poll stays as the fallback for a dropped socket.
  useEffect(() => {
    const off = socketEvents.onTripRequestAccepted((data) => {
      const id = requestIdRef.current;
      if (!id) return;
      if (data?.requestId && data.requestId !== id) return;
      if (!data?.tripId) return;
      finishMatch(data.tripId);
    });
    return () => { off(); };
  }, [finishMatch]);

  // ── Live dispatch cascade → map overlay ──────────────────────────────
  // Dispatch is sequential (one driver at a time), so there is always exactly
  // one "driver being asked". Feeding that into the trip store is what lets the
  // persistent map draw a polyline to them and move it along as the offer
  // cascades — and it gives us a real, server-authoritative failure signal
  // instead of only the 3-minute client timeout.
  useEffect(() => {
    const off = socketEvents.onDispatchProgress((event, data) => {
      const id = requestIdRef.current;
      // `rideId` is the TripRequest id the cascade is running for.
      if (id && data.rideId && data.rideId !== id) return;

      if (event === 'offer') {
        setDispatchAttempt({ attempt: data.attempt ?? 0, total: data.totalCandidates ?? 0 });
        if (Number.isFinite(data.driverLat) && Number.isFinite(data.driverLng)) {
          setDispatchOffer({
            driverId: String(data.driverId),
            latitude: data.driverLat as number,
            longitude: data.driverLng as number,
            attempt: data.attempt ?? 0,
            totalCandidates: data.totalCandidates ?? 0,
          });
        } else {
          // Driver has never reported a position — keep them as the current
          // offer for the counter, but draw no line to a place we don't know.
          setDispatchOffer(null);
        }
      } else if (event === 'searching' || event === 'widening') {
        setDispatchAttempt({ attempt: 0, total: data.totalCandidates ?? 0 });
      } else if (event === 'exhausted') {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
        setDispatchOffer(null);
        setPendingTripRequest(null);
        setStatus('timeout');
      } else if (event === 'matched') {
        setDispatchOffer(null);
      }
    });
    return () => { off(); };
  }, [setDispatchOffer, setPendingTripRequest]);

  // Seed the map: the pickup anchors the polyline, and the surrounding drivers
  // are the ambient context that makes the search legible.
  useEffect(() => {
    if (origin?.latitude != null && origin?.longitude != null) {
      setPickupCoord([origin.longitude, origin.latitude]);
    }
    let cancelled = false;
    (async () => {
      if (origin?.latitude == null || origin?.longitude == null) return;
      try {
        const res = await tripsApi.getNearbyDrivers(origin.latitude, origin.longitude);
        if (cancelled) return;
        const rows = Array.isArray(res.data?.data) ? res.data.data : [];
        setNearbyDrivers(
          rows
            .filter((d: any) => Number.isFinite(d?.latitude) && Number.isFinite(d?.longitude))
            .map((d: any) => ({ id: String(d.id), latitude: d.latitude, longitude: d.longitude })),
        );
      } catch {
        // Ambient pins only — a failure here must not disturb the request.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [origin?.latitude, origin?.longitude, setNearbyDrivers, setPickupCoord]);

  // Leaving the stage must clear the overlay, or the next request opens with a
  // stale line to a driver from the previous attempt.
  useEffect(
    () => () => {
      setDispatchOffer(null);
      setNearbyDrivers([]);
    },
    [setDispatchOffer, setNearbyDrivers],
  );

  useEffect(() => {
    if (sentRef.current) return;
    sentRef.current = true;

    // Resuming a request already sent from elsewhere (e.g. the Activity tab's
    // live card) — skip re-POSTing (which would create a second, duplicate
    // request) and just pick the polling back up.
    if (resumeRequestId) {
      requestIdRef.current = resumeRequestId;
      setStatus('searching');
      pollTimerRef.current = setInterval(async () => {
        try {
          const check = await tripsApi.getTripRequest(requestIdRef.current!);
          const req = check.data?.data;
          if (req?.status === 'ACCEPTED' && req.matchedTripId) {
            finishMatch(req.matchedTripId);
          } else if (req?.status === 'CANCELLED') {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
            setPendingTripRequest(null);
            setStatus('timeout');
          }
        } catch {
          // transient poll failure — try again on next tick
        }
      }, POLL_INTERVAL_MS);
      return () => {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      };
    }

    if (!destination) return;

    // A request with no pickup coordinate cannot be dispatched: driver matching is
    // a proximity search around the pickup, and the accept path rejects it with
    // MISSING_PICKUP_COORDS. Fail here, visibly, rather than leaving the rider
    // watching a "finding your driver" spinner that can never resolve.
    if (origin?.latitude == null || origin?.longitude == null) {
      setStatus('error');
      return;
    }

    (async () => {
      try {
        const res = await tripsApi.requestTrip({
          destination,
          scheduledAt: scheduledAt ?? new Date().toISOString(),
          seatCount: requestSeatCount,
          coverAll: requestCoverAll,
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

        // Persist so the Activity tab can show a live card and keep polling
        // even if the rider navigates away from this screen.
        setPendingTripRequest(requestIdRef.current, destination ?? null);

        setStatus('searching');
        pollTimerRef.current = setInterval(async () => {
          try {
            const check = await tripsApi.getTripRequest(requestIdRef.current!);
            const req = check.data?.data;
            if (req?.status === 'ACCEPTED' && req.matchedTripId) {
              finishMatch(req.matchedTripId);
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
            if (requestIdRef.current) {
              const reqId = requestIdRef.current;
              tripsApi.cancelTripRequest(reqId).catch(() => {
                // The cancel must eventually land server-side — otherwise a
                // driver can still accept this "ended" search and create a
                // booking the rider no longer expects. Queue it for retry.
                offlineQueue.enqueue('TRIP_REQUEST_CANCEL', `/trips/request/${reqId}`, 'DELETE', null);
              });
            }
            setPendingTripRequest(null);
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
      router.dismissTo('/(tabs)/home' as any);
      return;
    }
    setCancelling(true);
    try {
      await tripsApi.cancelTripRequest(requestIdRef.current);
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      setPendingTripRequest(null);
      router.dismissTo('/(tabs)/home' as any);
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
        {/* Pulsing ring animation, glowing while actively searching */}
        <View style={styles.iconContainer}>
          {status === 'searching' && [0, 1, 2].map((i) => (
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
          <GradientGlowBorder
            palette={status === 'matched' ? 'green' : status === 'error' || status === 'timeout' ? undefined : 'green'}
            fillColor={colors.surfaceCard}
            borderRadius={36}
            glow={status === 'searching' || status === 'matched'}
            style={styles.iconGlowWrap}
          >
            <Ionicons
              name={status === 'matched' ? 'checkmark-circle' : status === 'error' || status === 'timeout' ? 'alert-circle-outline' : 'bus-outline'}
              size={32}
              color={colors.primary}
            />
          </GradientGlowBorder>
        </View>

        <Text style={styles.title}>
          {status === 'matched' ? 'Driver found!'
            : status === 'error' ? "Couldn't send request"
            : status === 'timeout' ? 'All our drivers are busy'
            : 'Looking for a driver'}
        </Text>
        <Text style={styles.subtitle}>
          {status === 'error' ? (
            "We couldn't reach the server to send your trip request. Check your connection and try again."
          ) : status === 'timeout' ? (
            'All our drivers are busy right now. Please try again in a few minutes, or book a scheduled ride instead.'
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
        {/* Cascade progress. Dispatch asks one driver at a time, so this is a
            truthful count of where the search has got to, not a fake spinner. */}
        {status === 'searching' && dispatchAttempt.total > 0 && (
          <Text style={styles.hint}>
            {dispatchOffer
              ? `Asking driver ${dispatchAttempt.attempt} of ${dispatchAttempt.total}…`
              : `${dispatchAttempt.total} driver${dispatchAttempt.total === 1 ? '' : 's'} nearby — contacting them in turn…`}
          </Text>
        )}
        <Text style={styles.hint}>
          {status === 'timeout'
            ? 'Nothing was charged for this request.'
            : "You'll be taken to live tracking automatically as soon as a driver accepts."}
        </Text>

        {/* Info card */}
        <View style={styles.infoCard}>
          <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.lg} intensity="low" />
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
              onPress={() => router.dismissTo('/(tabs)/home' as any)}
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
            onPress={() => router.dismissTo('/(tabs)/home' as any)}
            style={{ width: '100%', marginTop: spacing.xl }}
          />
        )}

        <Pressable
          style={styles.activityBtn}
          onPress={() => router.dismissTo('/(tabs)/activity' as any)}
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
  // Stage mode. This used to lay a 90%-opaque scrim over the whole surface,
  // which hid the very thing the rider wants to see while waiting: where the
  // drivers around them are, and which one is being asked right now. The map
  // stays visible up top and the status content sits in a gradient-anchored
  // panel below it — the Uber/Bolt arrangement.
  return (
    // Landing target for the home screen's pending-request card, so tapping it
    // grows into this surface instead of hard-pushing. Inert when the rider
    // arrived any other way.
    <MorphTarget id="home-pending-request" borderRadius={0} style={styles.safe}>
    <View style={[styles.safe, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <LinearGradient
        colors={['transparent', withOpacity(colors.backgroundDeep, 0.72), colors.backgroundDeep]}
        locations={[0, 0.38, 0.62]}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />
      {body}
    </View>
    </MorphTarget>
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
  iconGlowWrap: {
    width: 72,
    height: 72,
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
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    marginTop: spacing.sm,
    overflow: 'hidden',
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
