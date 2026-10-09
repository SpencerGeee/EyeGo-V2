import React, { useCallback, useMemo, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Pressable, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { expectTripSurfaceReturn } from '../../../utils/tripSurfaceReturn';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii, withOpacity } from '@eyego/config';
import {
  Text, Button, GlassSurface, MorphTarget, AppBackground, GradientGlowBorder,
  goDeeper, goBack, notify, goOut, goFresh, Pressable as HapticPressable, getTierTheme, useSheetMetrics,
} from '@eyego/ui';
import * as Haptics from 'expo-haptics';
import { formatGhs, shortDateTime } from '@eyego/utils';
import { useThemeStore } from '../../../stores/theme.store';
import { SearchingPanel } from '../SearchingPanel';
import { FareBoostRow, type BoostStep } from '../FareBoostRow';
import { tripsApi, ridesApi, queryKeys, secondsRemaining } from '@eyego/api';
import { useColors, Colors } from '../../../utils/useColors';
import { useTripFlow } from '../../../stores/tripFlow.store';
import { useShallow } from 'zustand/react/shallow';
import { useRideStore } from '../../../stores/ride.store';
import { useTripStore, isTerminal } from '../../../stores/trip.store';
import { useRideEnded } from '../../../stores/rideEnded.store';
import { shareSearchingTrip } from '../../../utils/safety';
import { consumePickedPlace } from '../../../utils/placePickerResult';
import { byDeparture, departureLabel, seatsLeft } from '../../../utils/tripGroups';
import type { GeocodeResult } from '../../../utils/geocoding';

/** A place as the ride store holds it. */
type Place = { latitude: number; longitude: number; address: string };

const freshIdempotencyKey = () => `ride-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

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
 * Context, not tracking — the dispatch result arrives over the socket, so this
 * never gates the outcome. 5 s rather than 12: the map glides each car to its
 * new fix, and a car that moves once every twelve seconds still reads as a
 * screenshot.
 */
const NEARBY_REFRESH_MS = 5_000;

/** When the boost chips appear if drivers ARE around but nobody has taken it. */
const BOOST_OFFER_AFTER_MS = 20_000;

/** One of the three things a rider can do while the search runs. */
function ActionTile({
  icon,
  label,
  onPress,
  disabled,
  tone,
  styles,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <HapticPressable
      onPress={onPress}
      disabled={disabled}
      haptic="light"
      style={[styles.tile, disabled && styles.tileDisabled]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={[styles.tileIcon, { backgroundColor: withOpacity(tone, 0.1) }]}>
        <Ionicons name={icon} size={18} color={tone} />
      </View>
      <Text style={[styles.tileLabel, { color: tone }]} numberOfLines={1}>
        {label}
      </Text>
    </HapticPressable>
  );
}

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
  /** The ride the refusal was about, so "Open my ride" opens THAT one. */
  const [conflictTripId, setConflictTripId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  /**
   * "Cancel request?" asked INLINE, not with `Alert.alert`.
   *
   * A native alert lands above the root overlays and freezes the live map
   * behind a system sheet at the most anxious moment of the flow. Uber and
   * Bolt both confirm in the sheet itself, with "keep searching" as the
   * primary — leaving should be the deliberate choice, not the default.
   */
  const [confirmCancel, setConfirmCancel] = useState(false);
  /**
   * The money on the table: what the ride was requested at, and how much the
   * rider has added since. Null until known (a resumed search reads it back
   * from the trip's own events — see below).
   */
  const [fare, setFare] = useState<{ requestedPesewas: number; boostPesewas: number } | null>(null);
  const [boosting, setBoosting] = useState(false);
  /** The pickup may move once per request. Hidden after that, not refused. */
  const [pickupMoved, setPickupMoved] = useState(false);
  const [movingPickup, setMovingPickup] = useState(false);
  /** True between opening the picker for the pickup and coming back from it. */
  const editingPickupRef = useRef(false);
  /** Set by "Try again"; the effect below sends once the journey is re-seeded. */
  const [retryQueued, setRetryQueued] = useState(false);
  /** The boost (% of the requested fare) a retry carries into the new request. */
  const carryBoostPctRef = useRef(0);
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

  // A tick in the hand each time the search reaches a new driver — the map
  // draws the road to them at the same moment, so the two land together.
  const askedDriverId = dispatchOffer?.driverId ?? null;
  useEffect(() => {
    if (askedDriverId) Haptics.selectionAsync().catch(() => {});
  }, [askedDriverId]);

  /**
   * THE CARD TELLS THE CAMERA WHERE IT IS.
   *
   * The card floats over a full-screen map, and how tall it is depends on what
   * it holds (the boost row, the cancel confirmation). It publishes its top
   * edge into the surface's sheet channel — the same one the assigned and
   * tracking sheets use — so the map frames the pickup in the strip above it
   * rather than against a guessed fraction. Handed back on the way out only
   * if nobody has taken the channel over since (the next stage's sheet).
   */
  const sheetMetrics = useSheetMetrics();
  const { height: screenH } = useWindowDimensions();
  const cardTopRef = useRef<number | null>(null);
  const onCardLayout = useCallback(
    (e: LayoutChangeEvent) => {
      if (mode !== 'stage') return;
      const top = screenH - (insets.bottom + spacing.sm) - e.nativeEvent.layout.height;
      cardTopRef.current = top;
      sheetMetrics.retired.value = false;
      sheetMetrics.top.value = top;
    },
    [mode, screenH, insets.bottom, sheetMetrics],
  );
  useEffect(
    () => () => {
      if (cardTopRef.current != null && sheetMetrics.top.value === cardTopRef.current) {
        sheetMetrics.top.value = sheetMetrics.screenHeight.value;
        sheetMetrics.retired.value = true;
      }
    },
    [sheetMetrics],
  );

  /**
   * THE JOURNEY, KEPT BY THE SCREEN THAT IS SHOWING IT.
   *
   * "Nobody found" is answered IN PLACE now — the map stays, with Try again,
   * Schedule and the group bus — but TripStatusListener's terminal branch still
   * runs `clearRideState()` underneath it, wiping the very pickup and
   * destination this screen is describing. The last complete pair is held here
   * so the itinerary, the retry and the schedule hand-off all still have it.
   */
  const journeyRef = useRef<{ origin: Place; destination: Place } | null>(null);
  if (origin && storeDestination && Number.isFinite(storeDestination.latitude)) {
    journeyRef.current = { origin, destination: storeDestination };
  }
  const originLabel = origin?.address ?? journeyRef.current?.origin.address ?? snapshot?.pickup?.address ?? null;
  const destinationLabel =
    destination ?? journeyRef.current?.destination.address ?? snapshot?.dropoff?.address ?? null;

  const searching = mode === 'stage' && status === 'searching';
  const currentFarePesewas = fare ? fare.requestedPesewas + fare.boostPesewas : null;
  /** One timer, not a ticking clock: the stage only needs to know "20 s in". */
  const [boostOffered, setBoostOffered] = useState(false);
  useEffect(() => {
    if (!searching) {
      setBoostOffered(false);
      return;
    }
    const t = setTimeout(() => setBoostOffered(true), BOOST_OFFER_AFTER_MS);
    return () => clearTimeout(t);
  }, [searching]);

  /**
   * A RESUMED SEARCH READS ITS MONEY BACK FROM THE TRIP.
   *
   * The live snapshot is a room frame and carries no personal fare, so a
   * search re-opened from Home (or after a cold start) had no price to show
   * and nothing to boost from. The events endpoint answers with the RIDER'S
   * snapshot — their own fare, boosts included — plus every FARE_BOOSTED and
   * PICKUP_MOVED, which is the same arithmetic the server uses: requested =
   * current − Σ boosts.
   */
  const liveTripId = snapshot?.tripId ?? null;
  useEffect(() => {
    if (!liveTripId || fare != null || status !== 'searching') return;
    let cancelled = false;
    ridesApi
      .events(liveTripId, 0)
      .then((r) => {
        if (cancelled) return;
        const events = Array.isArray(r?.events) ? r.events : [];
        const current = Number(r?.snapshot?.fare?.amountPesewas);
        if (!Number.isFinite(current) || current <= 0) return;
        const boost = events
          .filter((e: any) => e?.type === 'FARE_BOOSTED')
          .reduce((n: number, e: any) => n + (Number(e?.payload?.addedPesewas) || 0), 0);
        setFare({ requestedPesewas: current - boost, boostPesewas: boost });
        setPickupMoved(events.some((e: any) => e?.type === 'PICKUP_MOVED'));
      })
      .catch(() => {
        // The fare line is information, not a gate — the search goes on without it.
      });
    return () => {
      cancelled = true;
    };
  }, [liveTripId, fare, status]);

  /**
   * THE RIDER IS ALREADY LOOKING AT THE NEWS.
   *
   * The terminal listener raises a "no drivers" notice for Home to present.
   * When this screen answers it in place, that notice is a second copy of
   * news already read — and would greet the rider again on Home. Cleared
   * whenever it appears while the in-place answer is on screen; the listener's
   * frame and the channel's can land in either order.
   */
  const endedNotice = useRideEnded((s) => s.notice);
  useEffect(() => {
    if (mode !== 'stage' || status !== 'timeout' || !endedNotice) return;
    if (endedNotice.reason === 'NO_DRIVERS' || endedNotice.reason === 'EXPIRED') {
      useRideEnded.getState().clear();
    }
  }, [mode, status, endedNotice]);

  /**
   * A GROUP BUS GOING THE SAME WAY — offered only when one exists.
   *
   * The same proximity search the browse pages use (origin and destination
   * each within the server's default radius of a route or one of its stops).
   * An option that leads to "no rides found" is worse than no option.
   */
  const busJourney = status === 'timeout' ? journeyRef.current : null;
  const { data: busTrips = [] } = useQuery({
    queryKey: [
      'trips', 'group-near',
      busJourney?.origin.latitude, busJourney?.origin.longitude,
      busJourney?.destination.latitude, busJourney?.destination.longitude,
    ],
    queryFn: () =>
      tripsApi.search({
        originLat: busJourney!.origin.latitude,
        originLng: busJourney!.origin.longitude,
        destinationLat: busJourney!.destination.latitude,
        destinationLng: busJourney!.destination.longitude,
      }),
    enabled: busJourney != null,
    staleTime: 60_000,
    // Two envelopes deep: axios → { success, data: { trips } }. See home.tsx.
    select: (r): any[] => {
      const body = (r as any)?.data?.data;
      const trips = body?.trips ?? body;
      return Array.isArray(trips) ? [...trips].sort(byDeparture) : [];
    },
  });
  // "next 07:40 · 6 seats left" — the soonest one, so the option is a choice
  // with facts in it rather than a link to a list.
  const nextBus = busTrips[0] ?? null;

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
      // The one moment in the flow that earns a success tap — once per match.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
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

        /**
         * ONE PARTY SIZE, QUOTED AND REQUESTED.
         *
         * BUGFIX ("when I book for multiple seats it tells me couldn't request
         * ride, but individual goes through").
         *
         * The party size is inside the quote's HMAC signature, and
         * `rides.service` refuses a request whose party differs from the one
         * that was priced — deliberately, so nobody can quote for two and
         * travel with eight. This call omitted `seatCount`, so the server
         * defaulted the QUOTE to a party of one while `ridesApi.request` below
         * sent the rider's real choice. Every party of two or more therefore
         * failed its own price check with a 409 `FARE_EXPIRED`, surfaced as
         * "Couldn't request ride". A solo hail passed because 1 === 1.
         *
         * Both calls now read the SAME value — `chosenSeats` — so the two can
         * never drift again. Note this is `chosenSeatsRef` first for the same
         * reason `request` uses it: `clearRideState()` resets the store copy to
         * 1 mid-flight, and a retry must not silently re-quote for one person.
         */
        /**
         * READ AT CALL TIME, NOT CLOSURE TIME.
         *
         * `sendRequest` is a `useCallback` whose dependency list deliberately
         * omits the store fields (see the eslint-disable at its foot), so the
         * `requestSeatCount` visible inside it is the value from whichever
         * render minted this callback — which is not necessarily the render
         * after the rider moved the stepper. `getState()` is the live store, so
         * the fallback is the rider's actual answer rather than a snapshot of
         * it, and the ref still wins so a mid-flight `clearRideState()` cannot
         * reset the party to one between the quote and the request.
         */
        const chosenSeats =
          chosenSeatsRef.current ?? useRideStore.getState().requestSeatCount ?? requestSeatCount;

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
          seatCount: chosenSeats,
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
            // THE SAME value the quote above was signed for. See `chosenSeats`.
            seatCount: chosenSeats,
            ...(opts?.allowConcurrent ? { allowConcurrent: true } : {}),
            ...(opts?.passenger ? { passenger: opts.passenger } : {}),
          } as any,
          idempotencyKeyRef.current,
        );

        tripIdRef.current = tripId;
        // The signed price IS the requested fare — the base every boost step is
        // a percentage of.
        setFare({ requestedPesewas: quote.amountPesewas, boostPesewas: 0 });
        setPickupMoved(false);
        /**
         * TRY AGAIN KEEPS THE BOOST. The rider already said they would pay more
         * to be found faster; a retry re-asks at the new price, raised by the
         * same percentage, in the server's own +30/+20/+10 steps.
         */
        const carryPct = carryBoostPctRef.current;
        carryBoostPctRef.current = 0;
        if (carryPct > 0) {
          void (async () => {
            let left = carryPct;
            for (const step of [30, 20, 10] as const) {
              while (left >= step) {
                try {
                  const r = await ridesApi.boost(tripId, step);
                  setFare({ requestedPesewas: r.requestedPesewas, boostPesewas: r.totalBoostPesewas });
                } catch {
                  return; // the search runs on at the price it has
                }
                left -= step;
              }
            }
          })();
        }
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
          setConflictTripId(err?.response?.data?.details?.activeTripId ?? null);
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
        /**
         * `PARTY_SIZE_MISMATCH` joins the list for the same reason and with the
         * same one-shot guard: the re-entry prices from scratch, and both calls
         * on that attempt read one `chosenSeats`, so a party that had drifted
         * between the two is corrected by the retry rather than reported to a
         * rider who cannot do anything about it. If it fails twice the message
         * below names both numbers, which is a bug report rather than a riddle.
         */
        if (
          (code === 'FARE_EXPIRED' || code === 'FARE_ALREADY_USED' || code === 'PARTY_SIZE_MISMATCH') &&
          !opts?.refreshedFare
        ) {
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

  // ── While searching: boost, move the pickup, share ───────────────────────

  const searchingTripId = () => tripIdRef.current ?? snapshot?.tripId ?? null;

  /** +10/20/30 % of the requested fare; the driver being asked sees it at once. */
  const boostFare = async (pct: BoostStep) => {
    const tripId = searchingTripId();
    if (!tripId || boosting) return;
    setBoosting(true);
    try {
      const r = await ridesApi.boost(tripId, pct);
      setFare({ requestedPesewas: r.requestedPesewas, boostPesewas: r.totalBoostPesewas });
      notify('Fare raised', `Drivers now see ${formatGhs(r.farePesewas)}. All of the extra goes to them.`, {
        tone: 'success',
      });
    } catch (err: any) {
      notify("Couldn't raise the fare", err?.response?.data?.message ?? 'Please try again in a moment.');
    } finally {
      setBoosting(false);
    }
  };

  /**
   * EDIT PICKUP — the map picker, opened on the current pin.
   *
   * Uber's rule: once, within ~200 m, before anyone accepts. The server holds
   * the rule and words the refusal; the picker only has to say it up front.
   */
  const editPickup = () => {
    const at = origin ?? journeyRef.current?.origin ?? null;
    editingPickupRef.current = true;
    expectTripSurfaceReturn();
    goDeeper({
      pathname: '/profile/place-picker',
      params: {
        title: 'Move pickup (up to 200 m)',
        ...(at
          ? { initialLat: String(at.latitude), initialLng: String(at.longitude), initialAddress: at.address }
          : { focusSearch: '1' }),
      },
    } as any);
  };

  const movePickupTo = React.useCallback(
    async (p: GeocodeResult) => {
      const tripId = tripIdRef.current ?? useTripStore.getState().snapshot?.tripId ?? null;
      if (!tripId) return;
      const address = p.name?.trim() || p.fullAddress?.trim() || 'Pinned location';
      setMovingPickup(true);
      try {
        await ridesApi.movePickup(tripId, { lat: p.latitude, lng: p.longitude, address });
        useRideStore.getState().setOrigin({ latitude: p.latitude, longitude: p.longitude, address });
        setPickupCoord([p.longitude, p.latitude]);
        setPickupMoved(true);
        notify('Pickup moved', 'Drivers will come to the new spot.', { tone: 'success' });
      } catch (err: any) {
        notify("Couldn't move your pickup", err?.response?.data?.message ?? 'Please try again.');
      } finally {
        setMovingPickup(false);
      }
    },
    [setPickupCoord],
  );

  useFocusEffect(
    React.useCallback(() => {
      if (!editingPickupRef.current) return;
      editingPickupRef.current = false;
      const picked = consumePickedPlace();
      if (picked) void movePickupTo(picked);
    }, [movePickupTo]),
  );

  // ── Nobody found: Try again / Schedule / group bus, with the map still up ──

  /** Put the journey back where the booking screens read it. */
  const reseedJourney = () => {
    const j = journeyRef.current;
    if (!j) return false;
    const ride = useRideStore.getState();
    ride.setOrigin(j.origin);
    ride.setDestination(j.destination);
    return true;
  };

  /** Stop following a trip that is over, so nothing re-reads it. */
  const releaseEndedTrip = () => {
    useRideEnded.getState().clear();
    useTripStore.getState().unwatch();
  };

  const tryAgain = () => {
    if (!reseedJourney()) {
      releaseEndedTrip();
      goOut('/(tabs)/home');
      return;
    }
    releaseEndedTrip();
    navigatedRef.current = false;
    tripIdRef.current = null;
    // Nearest whole step of 10, capped like the server's +50 %.
    carryBoostPctRef.current =
      fare && fare.requestedPesewas > 0
        ? Math.min(50, Math.round((fare.boostPesewas / fare.requestedPesewas) * 10) * 10)
        : 0;
    setFare(null);
    setPickupMoved(false);
    setConfirmCancel(false);
    // A new attempt is a new intent: the old key would replay the old trip.
    idempotencyKeyRef.current = freshIdempotencyKey();
    setRetryQueued(true);
  };
  // Sent from an effect so it runs with the re-seeded journey, not the closure
  // that saw a cleared store.
  useEffect(() => {
    if (!retryQueued || origin?.latitude == null || storeDestination?.latitude == null) return;
    setRetryQueued(false);
    void sendRequest();
  }, [retryQueued, origin?.latitude, storeDestination?.latitude, sendRequest]);

  const scheduleInstead = () => {
    reseedJourney();
    releaseEndedTrip();
    goFresh('/ride/schedule');
  };

  const takeGroupBus = () => {
    releaseEndedTrip();
    goFresh(busTrips.length === 1 ? `/ride/${busTrips[0].id}` : '/browse/all');
  };

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

    /*
     * MOUNTED BY THE PROJECTION, NOT BY A NEW INTENT.
     *
     * BUGFIX ("I chose to open my ride and it took me to 'you already have a
     * ride — book for myself / for someone else'"). The surface derives this
     * stage from a live search's status too (opening an existing request from
     * anywhere); with a destination still in the ride store this effect then
     * POSTed a SECOND request, the server refused it, and the rider was asked
     * about a conflict with the very ride they had asked to see. A search the
     * store is already following IS the request — follow it.
     */
    const following = useTripStore.getState().snapshot;
    if (following && ['REQUESTED', 'MATCHING', 'REASSIGNING'].includes(String(following.status))) {
      tripIdRef.current = following.tripId;
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
      if (status === 'timeout') releaseEndedTrip();
      goOut('/(tabs)/home');
      return;
    }
    // Asked in the sheet — see `confirmCancel`.
    setConfirmCancel(true);
  };

  const formattedTime = scheduledAt
    ? shortDateTime(scheduledAt)
    : null;

  const body = (variant: 'route' | 'stage') => (
    <>
      {/*
        Back — ROUTE MODE ONLY.

        BUGFIX ("remove the back button that is seen on top of the text that
        says we couldn't send that, because there's already a back button at
        the top so it makes that redundant").

        This used to render in both modes and merely turn `pointerEvents` off
        for the stage, which is the worst of the three options: the arrow was
        still drawn, directly above the headline, so the rider saw two back
        arrows on one screen and the nearer one did nothing at all. An
        affordance that is visible and inert is worse than no affordance.
        Stage mode floats its own over the map — see the render.
      */}
      {variant === 'route' && (
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
      )}

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
            originText={originLabel}
            destinationText={destinationLabel}
            attempt={dispatchAttempt}
            // The price is only news while it is being offered; a retry re-quotes.
            farePesewas={status === 'searching' ? currentFarePesewas : null}
            boostedPesewas={fare?.boostPesewas ?? 0}
            waiting={dispatch?.waiting === true}
            // Server deadline → this phone's clock (skew = server − local).
            searchEndsAtMs={
              dispatch?.searchExpiresAtServerMs != null ? dispatch.searchExpiresAtServerMs - clockSkewMs : null
            }
            /**
             * HOW FAR AWAY THE DRIVER BEING ASKED ACTUALLY IS.
             *
             * BUGFIX ("redesign the page so it accurately shows the map with
             * the nearest driver, so the user knows if he's getting matched
             * with someone close or far").
             *
             * The map half of this was already built — `TripMap` highlights
             * the candidate's pin and draws a real road route from the pickup
             * to them. What was missing was the number. The server has sent
             * `etaSeconds` on every DISPATCH_PROGRESS frame all along and the
             * store has kept it; nothing rendered it, so the panel could say
             * "asking driver 2 of 5" without ever saying whether driver 2 was
             * two minutes away or twenty.
             */
            etaSeconds={dispatch?.etaSeconds ?? null}
            // The same number the map's search ring is drawn from, so the words
            // and the picture can never disagree. See `searchRing` in TripMap.
            radiusKm={dispatch?.radiusKm ?? null}
            offerPending={!!dispatchOffer}
            // The trip's own tier once it exists; the rider's pick before that.
            tierLabel={getTierTheme(colors, snapshot?.tier ?? useRideStore.getState().rideTier).label}
            // On-demand requests are paid in cash: `requestRide` defaults to it
            // and this screen never sends another method.
            paymentLabel="Cash"
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
            {/* The obvious answer first: go and look at the ride you are on. */}
            {conflictTripId ? (
              <Button
                label="Open my ride"
                onPress={() => goFresh(`/trip?stage=assigned&tripId=${conflictTripId}`)}
                style={{ width: '100%' }}
              />
            ) : null}
            <Button
              label="Book a trip for myself"
              variant={conflictTripId ? 'secondary' : 'primary'}
              onPress={bookConcurrentForSelf}
              style={{ width: '100%' }}
            />
            <Button
              label="Book for someone else"
              variant={conflictTripId ? 'ghost' : 'secondary'}
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

        {/* RAISE THE FARE. Offered once the wait has started to bite (or at
            once when nobody is in range at all) — a boost chip in the first
            seconds reads as an upsell, not as help. */}
        {searching && fare != null && currentFarePesewas != null && (dispatch?.waiting === true || boostOffered) && !confirmCancel ? (
          <FareBoostRow
            farePesewas={currentFarePesewas}
            requestedPesewas={fare.requestedPesewas}
            boostPesewas={fare.boostPesewas}
            busy={boosting}
            onBoost={boostFare}
          />
        ) : null}

        {status === 'searching' ? (
          confirmCancel ? (
            <View style={styles.confirmBox}>
              <Text style={styles.confirmTitle}>Cancel this request?</Text>
              <Text style={styles.confirmBody}>It’s free — no driver has accepted it yet.</Text>
              <View style={styles.confirmRow}>
                <Button
                  label="Cancel request"
                  variant="ghost"
                  onPress={handleCancel}
                  loading={cancelling}
                  disabled={cancelling}
                  style={{ flex: 1 }}
                />
                <Button
                  label="Keep searching"
                  onPress={() => setConfirmCancel(false)}
                  disabled={cancelling}
                  style={{ flex: 1.3 }}
                />
              </View>
            </View>
          ) : (
            <>
              {variant === 'stage' ? (
                <View style={styles.actionRow}>
                  {!pickupMoved && (
                    <ActionTile
                      icon="location-outline"
                      label={movingPickup ? 'Moving…' : 'Edit pickup'}
                      onPress={editPickup}
                      disabled={movingPickup}
                      tone={colors.onSurface}
                      styles={styles}
                    />
                  )}
                  <ActionTile
                    icon="share-outline"
                    label="Share"
                    onPress={() => void shareSearchingTrip(snapshot?.shortId, destinationLabel)}
                    tone={colors.onSurface}
                    styles={styles}
                  />
                  <ActionTile
                    icon="close"
                    label="Cancel"
                    onPress={() => setConfirmCancel(true)}
                    tone={colors.error}
                    styles={styles}
                  />
                </View>
              ) : (
                <Button
                  label="Cancel request"
                  variant="ghost"
                  onPress={() => setConfirmCancel(true)}
                  style={{ width: '100%', marginTop: spacing.xl }}
                />
              )}
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
          )
        ) : variant === 'stage' && (status === 'timeout' || (status === 'error' && !conflict)) && journeyRef.current ? (
          /* NOBODY FOUND, ANSWERED WHERE IT HAPPENED. The map stays; the
             rider gets the three things worth doing next instead of a bounce
             to Home and a sheet about it. */
          <View style={styles.endActions}>
            <Button label="Try again" onPress={tryAgain} style={{ width: '100%' }} />
            {status === 'timeout' && (
              <>
                <Button
                  label="Schedule this ride"
                  variant="secondary"
                  onPress={scheduleInstead}
                  style={{ width: '100%' }}
                />
                {nextBus && (
                  <>
                    <Button
                      label="Book a seat on a group bus"
                      variant="secondary"
                      onPress={takeGroupBus}
                      style={{ width: '100%' }}
                    />
                    <Text style={styles.hint}>
                      {[
                        `Next bus ${departureLabel(nextBus).replace(/^./, (c) => c.toLowerCase())}`,
                        seatsLeft(nextBus) != null ? `${seatsLeft(nextBus)} seat${seatsLeft(nextBus) === 1 ? '' : 's'} left` : null,
                        busTrips.length > 1 ? `${busTrips.length} going your way` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </>
                )}
              </>
            )}
            <Pressable
              style={styles.activityBtn}
              onPress={handleBack}
              accessibilityRole="button"
              accessibilityLabel="Back to home"
            >
              <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ textDecorationLine: 'underline' }}>
                Back to home
              </Text>
            </Pressable>
          </View>
        ) : (
          <Button
            label="Back to home"
            onPress={() => {
              if (status === 'timeout' && mode === 'stage') releaseEndedTrip();
              goOut('/(tabs)/home');
            }}
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
   *   THE MAP IS UNCOVERED   All of it, edge to edge, with the card floating
   *                          over it (and the camera tilting and turning round
   *                          the pickup — see `searchOrbit` in TripMap). Pannable, because the
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
    <View style={styles.safe} pointerEvents="box-none">
      <Pressable
        onPress={handleBack}
        style={[styles.floatingBack, { top: insets.top + spacing.sm }]}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
      </Pressable>

      {/* THE CARD FLOATS. Full-bleed map behind it, edge to edge — no scrims
          and no docked half-screen — with the search in one card the camera
          frames around. It rises in once; every change after that happens
          inside it. */}
      <Animated.View
        entering={FadeInDown.duration(380).reduceMotion(ReduceMotion.System)}
        style={[styles.panelDock, { bottom: insets.bottom + spacing.sm }]}
        pointerEvents="box-none"
        onLayout={onCardLayout}
      >
        <View style={styles.panel}>
          {body('stage')}
        </View>
      </Animated.View>
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
  /** The floating card's frame, inset from the screen edges. */
  panelDock: { position: 'absolute', left: spacing.md, right: spacing.md },
  /**
   * The opaque card. Not glass — see the note at the render site: map tiles
   * are bright and moving, and a translucent panel is a different colour
   * everywhere it sits.
   */
  panel: {
    backgroundColor: colors.backgroundDeep,
    borderRadius: radii['3xl'],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withOpacity(colors.onSurface, 0.12),
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.32,
    shadowRadius: 24,
    elevation: 16,
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
    alignSelf: 'center',
  },

  /** Edit pickup · Share · Cancel — equal thirds, one row. */
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  tile: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outline,
    backgroundColor: colors.surfaceContainer,
  },
  tileDisabled: { opacity: 0.45 },
  tileIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontFamily: fonts.semiBold, fontSize: 12.5 },

  /** The inline "cancel?" — sits where the actions were. */
  confirmBox: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withOpacity(colors.error, 0.45),
    backgroundColor: colors.surfaceContainer,
  },
  confirmTitle: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyLarge, color: colors.onSurface },
  confirmBody: { fontFamily: fonts.regular, fontSize: fontSizes.bodySmall, color: colors.onSurfaceVariant },
  confirmRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },

  /** Try again · Schedule · group bus, stacked full-width. */
  endActions: { gap: spacing.sm, marginTop: spacing.sm },
});
