import React, { useMemo, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { expectTripSurfaceReturn } from '../../../utils/tripSurfaceReturn';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { fonts, fontSizes, spacing, radii, withOpacity } from '@eyego/config';
import { Text, Button, GlassSurface, MorphTarget } from '@eyego/ui';
import { SearchingIndicator } from '../SearchingIndicator';
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
  const setDispatchOffer = useTripFlow((s) => s.setDispatchOffer);
  const setNearbyDrivers = useTripFlow((s) => s.setNearbyDrivers);
  const setPickupCoord = useTripFlow((s) => s.setPickupCoord);
  const dispatchOffer = useTripFlow((s) => s.dispatchOffer);
  // `dispatchAttempt` is derived from the trip store below — it is no longer
  // local state, because local state is exactly what could disagree with the
  // server about which driver was being asked.
  const queryClient = useQueryClient();
  const { origin, destination: storeDestination, setPendingTripRequest, requestSeatCount, requestCoverAll, setGuestInfo } = useRideStore();
  /** True between opening guest-selection and coming back with an answer. */
  const awaitingGuestRef = useRef(false);
  const { destination: paramDestination, scheduledAt, resumeRequestId } = useLocalSearchParams<{
    destination?: string;
    scheduledAt?: string;
    resumeRequestId?: string;
  }>();

  const destination = storeDestination?.address ?? paramDestination;

  const [localStatus, setLocalStatus] = useState<'sending' | 'error'>('sending');
  /**
   * Why the request failed, in the rider's words.
   *
   * Every failure here used to collapse into one string — "We couldn't reach
   * the server" — including the two cases that never touch the network at all
   * (a missing pickup or dropoff coordinate). A rider whose destination had no
   * coordinate attached was told their connection was bad, and the bare
   * `catch {}` around the POST meant the real server message was discarded
   * before anyone could read it.
   */
  const [errorReason, setErrorReason] = useState<string | null>(null);
  /**
   * The server refused because a ride is already running.
   *
   * Kept apart from `errorReason` because it is not a failure — it is a
   * question. "You already have a ride in progress" was previously a dead end,
   * which is wrong for the case Uber and Bolt both support: booking a second
   * car, usually for somebody else, while your own ride is still going.
   */
  const [conflict, setConflict] = useState(false);
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
   * Settle up once a driver is attached.
   *
   * NOTE THE ABSENCE OF NAVIGATION. This used to `dismissTo` the legacy
   * tracking route, which meant the moment a driver accepted was also the
   * moment the map was destroyed and rebuilt. Nothing needs to navigate now:
   * `assigned` is a sibling stage on this same surface, and the status
   * projection in `trip.tsx` crossfades to it as soon as the snapshot lands.
   * All that is left here is clearing the pending request and refreshing the
   * lists that show it — still guarded, because the Activity tab's live card
   * watches the same trip and would otherwise clear it twice.
   */
  const navigatedRef = useRef(false);
  const finishMatch = React.useCallback(
    (_matchedTripId: string) => {
      if (navigatedRef.current) return;
      navigatedRef.current = true;
      setPendingTripRequest(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.myHistory() });
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.active() });
    },
    [queryClient, setPendingTripRequest],
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

  /**
   * Quote, then request. Extracted from the mount effect so the conflict flow
   * below can re-run it with different terms after the rider answers.
   *
   * A retry ALWAYS takes a fresh idempotency key. The key is what makes a
   * double-tap safe, and reusing it here would replay the cached 409 instead of
   * sending the second ride the rider just explicitly asked for.
   */
  const sendRequest = React.useCallback(
    async (opts?: { allowConcurrent?: boolean; passenger?: { name: string; phone: string } | null }) => {
      if (origin?.latitude == null || origin?.longitude == null) return;
      if (storeDestination?.latitude == null || storeDestination?.longitude == null) return;

      setConflict(false);
      setErrorReason(null);
      setLocalStatus('sending');

      try {
        // Price first. The quote is server-signed and single-use, so the number
        // the rider just agreed to is the number they are charged — the two
        // used to be independent computations that could silently disagree.
        // The options the rider chose in the paged flow. These were always
        // parameters of the quote; nothing sent them, so every ride was priced
        // and dispatched as a plain ECO with no extras regardless of what the
        // rider asked for.
        const { rideTier, doorstepPickup, heavyLoad } = useRideStore.getState();

        const quote = await ridesApi.quote({
          pickupLat: origin.latitude,
          pickupLng: origin.longitude,
          dropoffLat: storeDestination.latitude,
          dropoffLng: storeDestination.longitude,
          tier: rideTier,
          doorstepPickup,
          heavyLoad,
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
            doorstepPickup,
            ...(opts?.allowConcurrent ? { allowConcurrent: true } : {}),
            ...(opts?.passenger ? { passenger: opts.passenger } : {}),
          } as any,
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
      } catch (err: any) {
        const code = err?.response?.data?.code ?? err?.response?.data?.error?.code;
        // Not a failure — a question. See `conflict`.
        if (code === 'RIDE_ALREADY_ACTIVE') {
          setConflict(true);
          setLocalStatus('error');
          return;
        }
        // Surface what the server actually said. Swallowing this is what made
        // every distinct failure — an expired quote, a rejected fare, an
        // out-of-zone pickup, a genuine network drop — look like the same
        // "couldn't send request" dead end with no way to act on it.
        const serverMsg = err?.response?.data?.message ?? err?.response?.data?.error;
        const isOffline = !err?.response;
        console.error('[RequestStage] trip request failed', {
          status: err?.response?.status,
          data: err?.response?.data,
          message: err?.message,
        });
        setErrorReason(
          serverMsg ??
            (isOffline
              ? "We couldn't reach the server. Check your connection and try again."
              : 'Something went wrong sending your request. Please try again.'),
        );
        setLocalStatus('error');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [origin?.latitude, origin?.longitude, storeDestination?.latitude, storeDestination?.longitude, destination],
  );

  /** "Book it anyway, and it's for me." */
  const bookConcurrentForSelf = React.useCallback(() => {
    setGuestInfo(null);
    idempotencyKeyRef.current = `ride-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    void sendRequest({ allowConcurrent: true, passenger: null });
  }, [sendRequest, setGuestInfo]);

  /**
   * "Book it anyway, and it's for someone else."
   *
   * Hands off to the existing guest-selection screen rather than growing a
   * second name/phone form. Coming back with `guestInfo` set is the signal to
   * send — see the focus effect below.
   */
  const bookConcurrentForGuest = React.useCallback(() => {
    setGuestInfo(null);
    awaitingGuestRef.current = true;
    expectTripSurfaceReturn();
    router.push('/ride/guest-selection' as any);
  }, [router, setGuestInfo]);

  useFocusEffect(
    React.useCallback(() => {
      if (!awaitingGuestRef.current) return;
      const info = useRideStore.getState().guestInfo;
      if (!info?.name) return; // backed out without choosing anyone
      awaitingGuestRef.current = false;
      idempotencyKeyRef.current = `ride-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      void sendRequest({ allowConcurrent: true, passenger: { name: info.name, phone: info.phone } });
    }, [sendRequest]),
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
      setErrorReason(
        "We don't have a pin for your pickup yet. Go back and pick your pickup point on the map.",
      );
      setLocalStatus('error');
      return;
    }
    if (storeDestination?.latitude == null || storeDestination?.longitude == null) {
      setErrorReason(
        "Your destination doesn't have a location attached. Go back and choose it from the suggestions so we know where to send the driver.",
      );
      setLocalStatus('error');
      return;
    }

    void sendRequest();
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
      // The home screen's live-ride card reads a CACHED `['bookings','active']`.
      // Cancelling here did not touch that cache, so the rider landed on home
      // and was shown the ride they had just cancelled, served from the stale
      // response — and pulling to refresh made it vanish, which is exactly what
      // was reported. Drop it on the way out so home refetches on mount.
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.active() });
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.myHistory() });
      router.dismissTo('/(tabs)/home' as any);
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      Alert.alert('Could not cancel', msg ?? 'A driver may have already accepted — check your Activity tab.');
    } finally {
      setCancelling(false);
    }
  };

  /**
   * Back, on a stage the client does not own.
   *
   * BUGFIX ("on the request trip page the back button doesnt work"). This used
   * to call `popStage()`, which opens by returning null for any stage outside
   * CLIENT_OWNED_STAGES — and 'request' is not one of them, by design: once a
   * request is in flight the server owns the stage and you cannot rewind to
   * picking a seat. So the handler was correct about the stack and wrong about
   * the button: it left the only visible exit wired to a function defined to do
   * nothing.
   *
   * There IS a way out of a live search; it just isn't "back". It's cancel.
   * When the request is still live we ask first, because leaving silently is
   * what used to let a driver accept an abandoned request minutes later. When
   * there is nothing live left to cancel (the request errored or timed out),
   * back is unambiguous and goes straight home.
   *
   * `dismissTo` — not `back()` — because the Where-To screen is somewhere in
   * this stack and must never be what a back gesture lands on.
   */
  const handleBack = () => {
    if (mode === 'route') {
      router.back();
      return;
    }
    if (status === 'error' || status === 'timeout') {
      router.dismissTo('/(tabs)/home' as any);
      return;
    }
    Alert.alert(
      'Stop looking for a driver?',
      'We\'ll cancel this request. You can book again any time.',
      [
        { text: 'Keep looking', style: 'cancel' },
        { text: 'Stop', style: 'destructive', onPress: handleCancel },
      ],
    );
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
          onPress={handleBack}
          style={styles.backBtn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
        </Pressable>
      </View>

      <View style={styles.body}>
        {/* Concentric ring pulse — one UI-thread animation, no gradients, no
            shadow layers. See SearchingIndicator for what this replaced and
            why the old version cost frames exactly when dispatch needed them. */}
        <View style={styles.iconContainer}>
          <SearchingIndicator status={status as any} />
        </View>

        <Text style={styles.title}>
          {status === 'matched' ? 'Driver found!'
            : conflict ? 'You already have a ride'
            : status === 'error' ? "Couldn't send request"
            : status === 'timeout' ? 'All our drivers are busy'
            : 'Looking for a driver'}
        </Text>
        <Text style={styles.subtitle}>
          {conflict ? (
            'One of your trips is still running. Do you want to book a separate trip as well?'
          ) : status === 'error' ? (
            errorReason ?? 'Something went wrong sending your request. Please try again.'
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
        {!conflict && (
          <Text style={styles.hint}>
            {status === 'timeout'
              ? 'Nothing was charged for this request.'
              : "You'll be taken to live tracking automatically as soon as a driver accepts."}
          </Text>
        )}

        {/* THE SECOND-RIDE CHOICE.
            Two taps, because there are genuinely two questions: whether to book
            at all, and who is riding. Asking "who for" up front would put a
            decision in front of every rider to serve the minority who need it —
            which is why Uber and Bolt both surface it at exactly this moment. */}
        {conflict && (
          <View style={styles.conflictActions}>
            <Button
              label="Book a trip for myself"
              onPress={bookConcurrentForSelf}
              style={{ width: '100%' }}
            />
            <Button
              label="Book for someone else"
              variant="secondary"
              onPress={bookConcurrentForGuest}
              style={{ width: '100%' }}
            />
            <Text style={styles.hint}>
              You pay for both rides. The driver sees whoever you name as the passenger.
            </Text>
          </View>
        )}

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
    lineHeight: Math.round(fontSizes.bodySmall * 1.3),
    color: colors.outline,
    textAlign: 'center',
  },
  conflictActions: {
    width: '100%',
    gap: spacing.sm,
    marginTop: spacing.lg,
    alignItems: 'center',
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
