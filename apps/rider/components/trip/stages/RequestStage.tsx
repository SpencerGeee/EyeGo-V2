import React, { useMemo, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { expectTripSurfaceReturn } from '../../../utils/tripSurfaceReturn';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { fonts, fontSizes, spacing, radii, withOpacity } from '@eyego/config';
import { Text, Button, GlassSurface, MorphTarget, AppBackground, GradientGlowBorder, goDeeper, goBack, notify, goOut } from '@eyego/ui';
import { useThemeStore } from '../../../stores/theme.store';
import { SearchingPanel } from '../SearchingPanel';
import { tripsApi, ridesApi, queryKeys, secondsRemaining } from '@eyego/api';
import { useColors, Colors } from '../../../utils/useColors';
import { useTripFlow } from '../../../stores/tripFlow.store';
import { useShallow } from 'zustand/react/shallow';
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
/**
 * How often the ambient nearby-car pins are refreshed while a search runs.
 *
 * Slow on purpose: these are context, not tracking. The dispatch result
 * arrives over the socket, so this never gates the outcome of the request.
 */
const NEARBY_REFRESH_MS = 12_000;

function RequestStageImpl({ mode = 'stage' }: { mode?: 'stage' | 'route' }) {
  const colors = useColors();
  const isDark = useThemeStore((s) => s.isDark);
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
  const { origin, destination: storeDestination, setPendingTripRequest, requestSeatCount, requestCoverAll, setGuestInfo } = useRideStore(useShallow((s) => ({ origin: s.origin, destination: s.destination, setPendingTripRequest: s.setPendingTripRequest, requestSeatCount: s.requestSeatCount, requestCoverAll: s.requestCoverAll, setGuestInfo: s.setGuestInfo })));
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

    /**
     * Polled, not fetched once.
     *
     * These pins are the rider’s only answer to "is anything actually out
     * there?", and a single shot at mount freezes that answer for the whole
     * search — cars that come online during it never appear, and the ones
     * that do appear are pinned wherever they were the second the stage
     * opened, while the copy underneath says we are still looking.
     */
    const load = async () => {
      if (origin?.latitude == null || origin?.longitude == null) return;
      try {
        const res = await tripsApi.getNearbyDrivers(origin.latitude, origin.longitude);
        if (cancelled) return;
        const rows = Array.isArray(res.data?.data) ? res.data.data : [];
        const pins = rows
          .filter((d: any) => Number.isFinite(d?.latitude) && Number.isFinite(d?.longitude))
          .map((d: any) => ({ id: String(d.id), latitude: d.latitude, longitude: d.longitude }));
        // An empty answer is a real answer here ("nobody nearby"), so it is
        // published like any other.
        setNearbyDrivers(pins);
      } catch {
        // Ambient pins only — a failure here must not disturb the request, and
        // must not blank the pins we already drew.
      }
    };

    void load();
    const timer = setInterval(load, NEARBY_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
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
  type SendRequestOpts = {
    allowConcurrent?: boolean;
    passenger?: { name: string; phone: string } | null;
    /** Set on the one automatic re-entry after a spent quote. Stops a loop. */
    refreshedFare?: boolean;
  };

  /**
   * Self-reference, so the fare-expired path below can re-enter with a fresh
   * price. A `useCallback` cannot name itself without capturing a stale
   * closure, and the recovery has to run the CURRENT one.
   */
  const sendRequestRef = React.useRef<((opts?: SendRequestOpts) => Promise<void>) | null>(null);

  /**
   * THE PARTY SIZE THE RIDER ACTUALLY CHOSE, HELD OUT OF REACH OF `clearRideState`.
   *
   * `requestSeatCount` lives in the ride store, and `clearRideState()` resets it
   * to 1 along with everything else. Any path that clears between the rider
   * picking their seats and the request landing — the "you already have a ride"
   * prompt and its retry being the one that was reported — sent `seatCount: 1`
   * for a party of three, and the trip was created with `maxSeats: 1`. The
   * driver was then told to expect one passenger and the admin console showed
   * the trip as 1/1, which is what made it look like a display bug rather than a
   * lost value.
   *
   * The first non-default value this screen ever sees is the rider's answer, and
   * it stays the answer for every retry of the same request.
   */
  const chosenSeatsRef = React.useRef<number | null>(null);
  if (requestSeatCount > 1 && chosenSeatsRef.current == null) {
    chosenSeatsRef.current = requestSeatCount;
  }

  const sendRequest = React.useCallback(
    async (opts?: SendRequestOpts) => {
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
          // Tri-state: `undefined` (which axios drops) until the rider has
          // actually answered. See the note on `doorstepPickup` in the ride
          // store — `false` means "declined", not "not asked".
          doorstepPickup: doorstepPickup ?? undefined,
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
            doorstepPickup: doorstepPickup ?? undefined,
            // The seat stepper the rider actually used. This was read from the
            // store and then never sent — see the note on `seatCount` in
            // rides.api.ts. Whole-car pricing is unaffected; the driver just
            // learns how many people to expect.
            seatCount: chosenSeatsRef.current ?? requestSeatCount,
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

        /**
         * The quote was spent on a ride that did not happen.
         *
         * A quote is single-use and the server claims it before it does any of
         * the work that can still fail. So the rider could be shown "this price
         * has expired — please confirm the new fare" seconds after being quoted,
         * for a price they never actually used and cannot re-confirm: the only
         * way out was backing all the way to the map. The server now hands the
         * quote back on its own failure paths, but a retry at the transport
         * layer can still spend one underneath us.
         *
         * Re-entering is the whole recovery, because `sendRequest` prices from
         * scratch on every attempt — the rider sees one spinner, not an error.
         * Once only, and with a new idempotency key so the retry is not answered
         * out of the cache with the failure it is trying to escape.
         */
        if ((code === 'FARE_EXPIRED' || code === 'FARE_ALREADY_USED') && !opts?.refreshedFare) {
          idempotencyKeyRef.current = `ride-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
          await sendRequestRef.current?.({ ...opts, refreshedFare: true });
          return;
        }
        /**
         * A TIMEOUT IS NOT A FAILURE — IT IS AN UNKNOWN.
         *
         * `POST /rides` is not idempotent from the client's point of view once
         * the socket has been given up on: the server may well have created the
         * trip and started dispatching it, and we simply stopped listening. That
         * is exactly what happened in testing — the request took ~14 s against a
         * 15 s timeout, the rider was told "we couldn't reach the server", and
         * the retry came back "you already have a ride in progress", because
         * they did. Two ghost trips per attempt, and a rider with no way back.
         *
         * The server side of this is fixed (dispatch no longer runs inside the
         * request), but the client must not go back to guessing either. Ask who
         * the authority is: if `getActiveRide` says a ride exists, adopt it and
         * carry on into tracking as though the response had arrived.
         */
        if (!err?.response) {
          try {
            const active = await ridesApi.active();
            const liveTripId = (active as any)?.trip?.id ?? (active as any)?.trip?.tripId ?? null;
            if (liveTripId) {
              tripIdRef.current = liveTripId;
              setPendingTripRequest(liveTripId, destination ?? null);
              watchTrip(liveTripId);
              return;
            }
          } catch {
            // Genuinely unreachable. Fall through to the offline message below,
            // which is now telling the truth rather than covering a timeout.
          }
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
  sendRequestRef.current = sendRequest;

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
    goDeeper('/ride/guest-selection' as any);
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
      goOut('/(tabs)/home');
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
      /**
       * AND THE ONE THE FINDING-YOUR-DRIVER CARD ACTUALLY READS.
       *
       * BUGFIX ("after cancelling a trip, the finding-your-driver card stays on
       * the homepage and only disappears when i tap it").
       *
       * Home stopped gating that card on the local store and started gating it
       * on `['rides','active']` — the server's answer — but this cancel was
       * never taught about the new key. Worse than a stale card: home's
       * adoption effect copies whatever that cache says back INTO the store, so
       * the `setPendingTripRequest(null)` two lines up was undone on the next
       * render by the very response this cancel invalidated.
       *
       * Written through rather than only invalidated. An invalidate schedules a
       * refetch; the card would survive until it landed, which on a slow
       * connection is exactly the window the rider spends looking at the home
       * screen. Setting `trip: null` locally makes it gone on the frame the
       * rider arrives, and the refetch then confirms it.
       */
      queryClient.setQueryData(['rides', 'active'], (old: any) =>
        old ? { ...old, trip: null, dispatch: null } : old,
      );
      queryClient.invalidateQueries({ queryKey: ['rides', 'active'] });
      goOut('/(tabs)/home');
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      notify('Could not cancel', msg ?? 'A driver may have already accepted — check your Activity tab.');
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
      goBack();
      return;
    }
    if (status === 'error' || status === 'timeout') {
      goOut('/(tabs)/home');
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

  const body = (variant: 'route' | 'stage') => (
    <>
      {/* Back. Stage mode floats its own over the map — see the render. */}
      <View style={styles.header} pointerEvents={variant === 'stage' ? 'none' : 'auto'}>
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

      <View style={variant === 'stage' ? styles.panelBody : styles.body}>
        {/*
          ── THE SEARCH ITSELF ──────────────────────────────────────────────
          Was: a 72 pt ring, a centred headline, a centred paragraph and two
          centred hint lines — eight centred elements, none of them the thing
          the rider is waiting on. See SearchingPanel for what Uber, Bolt and
          Yango do instead and why the sweeping edge rail is the whole trick.

          The conflict case keeps its own copy: it is not a search at all, it is
          a question, and dressing a question as a progress state would be a lie.
        */}
        {conflict ? (
          <>
            <Text style={styles.title}>You already have a ride</Text>
            <Text style={styles.subtitle}>
              One of your trips is still running. Do you want to book a separate trip as well?
            </Text>
          </>
        ) : (
          <SearchingPanel
            status={status as any}
            originText={origin?.address ?? null}
            destinationText={destination ?? null}
            attempt={dispatchAttempt}
            offerPending={!!dispatchOffer}
            seats={requestSeatCount}
            scheduledFor={formattedTime}
            errorReason={errorReason}
          />
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

        {/* Info card. Ringed while the search is live — this is the only lit
            element on the screen during the wait, and it is what makes the
            stage read as active rather than stalled. Dropped once a driver is
            found, so the ring means "still looking" and nothing else. */}
        {/* Opaque fill + the brand palette, same fix as SearchStage: a
            transparent `fillColor` leaves the ring's rotating sweep unpunched, so
            it washes the whole inside of the card instead of showing as an edge —
            the "same inverted glow border" on the requesting-a-driver page. With
            no `palette` it also swept blue/orange over a green-brand screen.
            Faint on purpose ("or better still make it faint"): it only has to say
            "still looking". */}
        {variant === 'route' && (
        <GradientGlowBorder
          palette="brandGreen"
          borderRadius={radii.lg}
          thickness="thin"
          fillColor={colors.surfaceCard}
          glow={status === 'searching'}
          glowIntensity={0.5}
          maxGlowRadius={12}
          style={{ width: '100%' }}
        >
          <View style={styles.infoCard}>
            <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.lg} intensity="low" />
            <Ionicons name="information-circle-outline" size={16} color={colors.onSurfaceVariant} />
            <Text style={styles.infoText}>
              Trip requests are grouped — other riders heading the same way will be added automatically.
            </Text>
          </View>
        </GradientGlowBorder>
        )}

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
              onPress={() => goOut('/(tabs)/home')}
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
            onPress={() => goOut('/(tabs)/home')}
            style={{ width: '100%', marginTop: spacing.xl }}
          />
        )}

        {variant === 'route' && (
          <Pressable
            style={styles.activityBtn}
            onPress={() => goOut('/(tabs)/activity')}
            accessibilityRole="button"
            accessibilityLabel="View in Activity"
          >
            <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ textDecorationLine: 'underline' }}>
              View in Activity
            </Text>
          </Pressable>
        )}
      </View>
    </>
  );

  if (mode === 'route') {
    /**
     * ROUTE MODE HAD NO BACKGROUND AT ALL.
     *
     * `safe` is `backgroundColor: 'transparent'`, which is right in stage mode
     * — the persistent map and the gradient below sit behind it there. Reached
     * as a standalone route (the home screen's pending-request card, a push
     * notification) there is nothing behind it, so the rider watched for a
     * driver on a flat black rectangle. That is the "black and bare" screen.
     *
     * Static variant: this screen already runs the SearchingIndicator's pulse
     * and is the one moment in the flow where dispatch wants the frames.
     */
    return (
      <View style={styles.routeRoot}>
        <AppBackground variant="static" isDark={isDark} />
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          {body('route')}
        </SafeAreaView>
      </View>
    );
  }
  /**
   * ── STAGE MODE: THE MAP IS THE PAGE ────────────────────────────────────────
   *
   * FEATURE ("on the 'looking for a driver' page when the rider requests a
   * trip, it should be redesigned to be more aesthetic and nice, since that's
   * where the user would spend a bit of time looking for a ride. Make sure you
   * include the map, a route polyline to the nearest driver, and it should be
   * animated. That page is a static page and it needs to be done correctly").
   *
   * It was a static page in the literal sense: a full-screen `LinearGradient`
   * that went fully opaque by 62% of the screen height, laid over a map that
   * the trip surface was already mounting and drawing on. Underneath that
   * gradient, invisible, were the idle cars around the rider and the line to
   * the driver being asked this second — the only things on the whole screen
   * that were actually moving. A ring pulsing over a black rectangle for two
   * minutes is the least informative way to spend the most anxious part of the
   * flow.
   *
   * The rebuild is the arrangement every hailing app converged on, for the
   * reason they converged on it: while you wait, you watch.
   *
   *   THE MAP IS UNCOVERED   Top ~56% of the screen. Pannable, because the
   *                          question the rider is asking is "is anyone near
   *                          me". `box-none` all the way down so the pans reach
   *                          it — the exact bug the tracking stage had.
   *   THE LINE IS THE STORY  `TripMap` now draws a real ROAD route from the
   *                          driver being asked to the pickup, and draws it ON,
   *                          restarting for each driver the cascade reaches.
   *                          The cascade's progress and the animation are the
   *                          same event rather than two descriptions of it.
   *   THE PANEL IS OPAQUE    Not glass. Live map tiles are bright, arbitrarily
   *                          coloured and moving, and body copy does not
   *                          survive being laid on them; the scrim above the
   *                          panel carries the transition instead.
   */
  return (
    // Landing target for the home screen's pending-request card, so tapping it
    // grows into this surface instead of hard-pushing. Inert when the rider
    // arrived any other way.
    <MorphTarget id="home-pending-request" borderRadius={0} style={styles.safe}>
    <View style={[styles.safe, { paddingTop: insets.top }]} pointerEvents="box-none">
      {/* Reading ground for the back control, which floats on live tiles. */}
      <LinearGradient
        colors={[withOpacity(colors.backgroundDeep, 0.85), 'transparent']}
        style={styles.topScrim}
        pointerEvents="none"
      />
      <Pressable
        onPress={handleBack}
        style={[styles.floatingBack, { top: insets.top + spacing.sm }]}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
      </Pressable>

      <View style={styles.panelDock} pointerEvents="box-none">
        <LinearGradient
          colors={['transparent', withOpacity(colors.backgroundDeep, 0.9)]}
          style={styles.panelScrim}
          pointerEvents="none"
        />
        <View style={[styles.panel, { paddingBottom: insets.bottom + spacing.lg }]}>
          {body('stage')}
        </View>
      </View>
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
  /** Route mode only — the layer `AppBackground` paints. In stage mode the
   *  persistent map plus the gradient below do this job, which is why `safe`
   *  is transparent and why this screen had no background at all on the route. */
  routeRoot: {
    flex: 1,
    backgroundColor: colors.backgroundDeep,
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
  /**
   * LEFT-ALIGNED, AND SITTING LOW.
   *
   * `alignItems: 'center'` + `justifyContent: 'center'` is what made every
   * child of this screen a centred island — see SearchingPanel's header. The
   * panel now owns its own internal alignment, so this only has to place it:
   * `flex-end` so the content sits where a sheet would, over the map, rather
   * than floating in the vertical middle of a phone.
   */
  body: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: spacing['2xl'],
    paddingBottom: spacing['2xl'],
    gap: spacing.lg,
  },
  /** Reading ground for the floating back control. */
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0, height: 132 },
  /** Stage mode's back control — on the map, not in the panel. */
  floatingBack: {
    position: 'absolute',
    left: spacing.lg,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withOpacity(colors.backgroundDeep, 0.78),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withOpacity(colors.onSurface, 0.14),
    zIndex: 5,
  },
  /** The panel's version of the searching ring — half the height. */
  iconContainerCompact: {
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** The bottom half. `box-none` so pans land on the map above it. */
  panelDock: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  /** Softens the map into the panel's top edge instead of cutting it. */
  panelScrim: { position: 'absolute', left: 0, right: 0, bottom: '100%', height: 96 },
  /**
   * The opaque half. Not glass — see the note at the render site: map tiles
   * are bright and moving, and a translucent panel is a different colour
   * everywhere it sits.
   */
  panel: {
    backgroundColor: colors.backgroundDeep,
    borderTopLeftRadius: radii['4xl'],
    borderTopRightRadius: radii['4xl'],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: withOpacity(colors.onSurface, 0.1),
    paddingTop: spacing.xl,
    paddingHorizontal: spacing['2xl'],
    alignItems: 'center',
    gap: spacing.md,
  },
  /**
   * The panel's own content box.
   *
   * `body` centres itself in a full screen, which is right for route mode and
   * wrong here: inside a docked panel `flex: 1` would stretch it to the full
   * height of the screen and push the map off. This is the same content,
   * measured by what is in it.
   */
  /* Stretch, not centre — the panel is a full-width block now. */
  panelBody: {
    alignSelf: 'stretch',
    gap: spacing.lg,
  },
  /**
   * NOT a sheet stage, deliberately.
   *
   * `assigned` and `tracking` publish their panels into the trip surface's one
   * morphing sheet (see `sheetSlot.tsx`). This stage does not, and the reason
   * is the `MorphTarget` above: it is the landing site for the home screen's
   * "looking for a driver" card, so the thing that grows out of that card has
   * to be the view this component renders. Move the body into a sheet hosted
   * by the trip surface and the morph lands on an empty full-screen view while
   * the real content appears, unannounced, somewhere else.
   *
   * The sheet takes over at `assigned`, which is the first stage with no
   * inbound morph of its own.
   */
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
