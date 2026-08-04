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
import { tripsApi, ridesApi, queryKeys, secondsRemaining } from '@eyego/api';
import { useColors, Colors } from '../../../utils/useColors';
import { useTripFlow } from '../../../stores/tripFlow.store';
import { useRideStore } from '../../../stores/ride.store';
import { useTripStore, isTerminal } from '../../../stores/trip.store';

/**
 * NO POLLING HERE ANY MORE.
 *
 * This screen used to run TWO `setInterval` polls (a 4s "has anyone accepted"
 * and a resumed variant) alongside socket listeners, plus a 3-minute
 * client-side timeout that decided on its own when the search had failed.
 * Poll and push raced to settle the same transition with no version to
 * arbitrate, and the client's timeout could contradict a server that was
 * still happily cascading.
 *
 * All three are gone. The trip store projects `Trip.status` off the sequenced
 * `trip:event` channel, which replays anything missed on reconnect, and the
 * server owns the expiry (RIDE_REQUEST_EXPIRY, a durable ScheduledTask) so
 * "we gave up" is a fact both apps receive rather than a guess each makes.
 */

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
  // `dispatchAttempt` is derived from the trip store below — it is no longer
  // local state, because local state is exactly what could disagree with the
  // server about which driver was being asked.
  const queryClient = useQueryClient();
  const { origin, destination: storeDestination, setPendingTripRequest, requestSeatCount, requestCoverAll } = useRideStore();
  const { destination: paramDestination, scheduledAt, resumeRequestId } = useLocalSearchParams<{
    destination?: string;
    scheduledAt?: string;
    resumeRequestId?: string;
  }>();

  const destination = storeDestination?.address ?? paramDestination;

  const [localStatus, setLocalStatus] = useState<'sending' | 'error'>('sending');
  const [cancelling, setCancelling] = useState(false);
  const tripIdRef = useRef<string | null>(null);
  const sentRef = useRef(false);
  /**
   * Generated ONCE per mount — i.e. once per user intent — and reused across
   * every retry. Without it, a flaky connection during Confirm books two rides
   * and charges twice.
   */
  const idempotencyKeyRef = useRef<string>(
    `ride-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  );

  // ── Server state. The screen reads; it never decides. ────────────────────
  const snapshot = useTripStore((s) => s.snapshot);
  const dispatch = useTripStore((s) => s.dispatch);
  const clockSkewMs = useTripStore((s) => s.clockSkewMs);
  const recovering = useTripStore((s) => s.recovering);
  const watchTrip = useTripStore((s) => s.watch);

  /**
   * The visible status is DERIVED, not stored. There is no local state that
   * can drift from the trip, because there is no local state — which is the
   * entire fix for "the request page isn't consistent".
   */
  const status: 'sending' | 'searching' | 'matched' | 'error' | 'timeout' =
    localStatus === 'error'
      ? 'error'
      : snapshot == null
        ? localStatus
        : snapshot.status === 'NO_DRIVERS_FOUND' || snapshot.status === 'EXPIRED'
          ? 'timeout'
          : isTerminal(snapshot.status)
            ? 'error'
            : snapshot.status === 'REQUESTED' ||
                snapshot.status === 'MATCHING' ||
                snapshot.status === 'REASSIGNING'
              ? 'searching'
              : 'matched';

  /**
   * Seconds left on the CURRENT driver's exclusive offer, counted against
   * server time. The server sends `expiresAtServerMs` plus its own clock on
   * every payload, so two phones with different clocks show the same number.
   */
  const offerSecondsLeft =
    dispatch?.expiresAtServerMs != null
      ? secondsRemaining(dispatch.expiresAtServerMs, clockSkewMs)
      : null;

  const dispatchAttempt = {
    attempt: dispatch?.attempt ?? 0,
    total: dispatch?.totalCandidates ?? 0,
  };

  /**
   * Navigate onward once a driver is attached.
   *
   * Driven by the server's status rather than by whichever of the poll or the
   * socket happened to land first. The double-navigation guard is still
   * needed because the Activity tab's live card watches the same trip.
   */
  const navigatedRef = useRef(false);
  const finishMatch = React.useCallback(
    (matchedTripId: string) => {
      if (navigatedRef.current) return;
      navigatedRef.current = true;
      setPendingTripRequest(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.myHistory() });
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.active() });
      router.dismissTo(`/ride/${matchedTripId}/tracking` as any);
    },
    [queryClient, router, setPendingTripRequest],
  );

  useEffect(() => {
    if (!snapshot) return;
    // One rule, applied to one field. Previously four different socket events
    // and a poll could each independently conclude "we are matched", and they
    // did not always agree.
    if (snapshot.status === 'DRIVER_ASSIGNED' || snapshot.status === 'DRIVER_EN_ROUTE') {
      finishMatch(snapshot.tripId);
    }
    if (isTerminal(snapshot.status)) {
      setPendingTripRequest(null);
    }
  }, [snapshot?.status, snapshot?.tripId, finishMatch, setPendingTripRequest]);

  // ── Live dispatch cascade → map overlay ──────────────────────────────
  // Dispatch is sequential (one driver at a time), so there is always exactly
  // one "driver being asked". Mirroring it onto the map store is what lets the
  // persistent map draw a polyline to them and move it along as the offer
  // cascades.
  //
  // This used to be a bespoke `dispatch:*` socket listener with four event
  // names. It now reads the trip store, which gets the same facts off the one
  // sequenced channel — so a rider whose phone was locked through two offers
  // sees the CURRENT one on wake, not a replayed animation of stale ones.
  useEffect(() => {
    if (!dispatch || dispatch.driverLat == null || dispatch.driverLng == null) {
      // Either no live offer, or a driver who has never reported a position:
      // keep the counter, but draw no line to a place we do not know.
      setDispatchOffer(null);
      return;
    }
    setDispatchOffer({
      driverId: dispatch.driverId!,
      latitude: dispatch.driverLat,
      longitude: dispatch.driverLng,
      attempt: dispatch.attempt,
      totalCandidates: dispatch.totalCandidates,
    });
  }, [dispatch, setDispatchOffer]);

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

    // Resuming a ride already requested elsewhere (e.g. the Activity tab's
    // live card, or a cold start mid-search). Nothing to re-POST and nothing
    // to poll — just start following it. The channel replays anything that
    // happened while this screen did not exist.
    if (resumeRequestId) {
      tripIdRef.current = resumeRequestId;
      watchTrip(resumeRequestId);
      return;
    }

    if (!destination) return;

    // A request with no pickup coordinate cannot be dispatched: driver matching
    // is a proximity search around the pickup. Fail here, visibly, rather than
    // leaving the rider watching a spinner that can never resolve.
    if (origin?.latitude == null || origin?.longitude == null) {
      setLocalStatus('error');
      return;
    }
    if (storeDestination?.latitude == null || storeDestination?.longitude == null) {
      setLocalStatus('error');
      return;
    }

    (async () => {
      try {
        // Price first. The quote is server-signed and single-use, so the number
        // the rider just agreed to is the number they are charged — the two
        // used to be independent computations that could silently disagree.
        const quote = await ridesApi.quote({
          pickupLat: origin.latitude,
          pickupLng: origin.longitude,
          dropoffLat: storeDestination.latitude,
          dropoffLng: storeDestination.longitude,
        });

        const { tripId } = await ridesApi.request(
          {
            quoteId: quote.quoteId,
            pickupLat: origin.latitude,
            pickupLng: origin.longitude,
            pickupAddress: origin.address ?? undefined,
            dropoffLat: storeDestination.latitude,
            dropoffLng: storeDestination.longitude,
            dropoffAddress: destination ?? undefined,
          },
          idempotencyKeyRef.current,
        );

        tripIdRef.current = tripId;
        // Persist so the Activity tab can show a live card if the rider
        // navigates away from this screen.
        setPendingTripRequest(tripId, destination ?? null);
        // From here the server drives everything. No interval, no client
        // timeout: expiry is a durable ScheduledTask on the server, so "we
        // gave up" is one fact both apps receive rather than two guesses.
        watchTrip(tripId);
      } catch {
        setLocalStatus('error');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Actually cancels the live request server-side (previously "Back to home"
  // only navigated away while the request kept searching, so a driver could
  // still accept it minutes later and silently create a booking the rider
  // had no idea was still live).
  const handleCancel = async () => {
    const tripId = tripIdRef.current ?? snapshot?.tripId ?? null;
    if (!tripId) {
      router.dismissTo('/(tabs)/home' as any);
      return;
    }
    setCancelling(true);
    try {
      await ridesApi.cancel(tripId);
      setPendingTripRequest(null);
      useTripStore.getState().unwatch();
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
