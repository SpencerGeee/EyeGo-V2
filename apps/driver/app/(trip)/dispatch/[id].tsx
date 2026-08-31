import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, Alert, ActivityIndicator, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { driverApi } from '@eyego/api';
import { originLabel, destinationLabel } from '@eyego/utils';
import { fonts, fontSizes, spacing, radii, withOpacity } from '@eyego/config';
import { Text, AppBackground, MorphTarget, useMorph, GlassSurface, getTierTheme, notify } from '@eyego/ui';
import type { Coord } from '@eyego/maps';

import { useColors, type DriverColors } from '../../../utils/useColors';
import { useDriverStore } from '../../../stores/driver.store';
import { useDriverTripStore } from '../../../stores/trip.store';
import { lastKnownReportedFix } from '../../../hooks/useDriverLocation';
import { DispatchOfferCard, type DispatchOfferView } from '../../../components/dispatch/DispatchOfferCard';
import { DispatchLiveMap, type DispatchLiveMapHandle } from '../../../components/dispatch/DispatchLiveMap';
import { morphIdFor } from '../../../components/PendingDispatchList';

/**
 * FIRST-FRAME GUESS AT THE SHEET'S HEIGHT — THEN IT IS MEASURED.
 *
 * BUGFIX ("there are so many things overlapping each other on the dispatch page
 * (the swipe to accept). The frame-this-camera is overlapping the map").
 *
 * This used to be a constant, and both the map's `fitBounds` bottom padding and
 * the "Frame the ride" control were positioned off it. The offer card is not a
 * fixed height — the address block wraps, the reassignment banner appears and
 * disappears, the expiry note is added on expiry — so on any offer whose card
 * ran past 430 pt the control sat ON the sheet it was supposed to clear, and
 * the ride was framed into a window that did not exist.
 *
 * The sheet now publishes its real height on layout and everything that has to
 * clear it reads that. This value survives only as the value for the frames
 * before the first `onLayout`, which is why it is a floor rather than a guess.
 */
const SHEET_RESERVE_FALLBACK = 380;
/** Hard ceiling on the sheet so the map is never fully covered on a small phone. */
const SHEET_MAX_HEIGHT = 560;

/**
 * Fallback window when the payload carries no deadline (the REASSIGNMENT path).
 *
 * Was 30 s, against a server that now holds an offer for 45 (see
 * `DISPATCH_OFFER_TTL_SECONDS`). A client that counts down faster than the
 * server's own deadline shows a ring hitting zero on an offer that is still
 * live — "the dispatch timer is very fast and short" is partly this number and
 * partly the server's old 20 s. Both are 45 now, so the ring and the hold agree.
 */
const DEFAULT_WINDOW_S = 45;

/**
 * The only trip statuses this screen has anything to say about.
 *
 * Mirrors the server's own claim paths (`drivers.service.claimTrip`): MATCHING
 * is a live cascade, REASSIGNING is up for grabs, and SCHEDULED/FILLING is a
 * trip already assigned to this driver awaiting their accept. Anything else —
 * CANCELLED, COMPLETED, EXPIRED, NO_DRIVERS_FOUND, or a ride already IN_PROGRESS
 * under somebody else — is not an offer and must not render as one.
 */
const CLAIMABLE_STATUSES = ['MATCHING', 'REASSIGNING', 'SCHEDULED', 'FILLING', 'REQUESTED'];

/**
 * THE OFFER SCREEN — what the Dispatch list opens.
 *
 * ── THE THREE BUGS THIS REWRITE CLOSES ──────────────────────────────────────
 *
 * 1. "the pickup and destination was blank like nothing to show"
 *    The screen read `origin` and `destination` out of NAVIGATION PARAMS.
 *    `PendingDispatchList` pushes `/(trip)/dispatch/<tripId>` and passes no
 *    params at all, so both were `undefined` and rendered as em-dashes. The
 *    offer is now read from the trip store, which already holds the server's
 *    own copy — addresses, coordinates, fare, deadline — for exactly this
 *    trip, and falls back to a REST re-read if the store is cold.
 *
 * 2. "when I clicked on the accept button, it said failed to accept"
 *    It called `driverApi.acceptDispatch`, whose first line is
 *    `findFirst({ id, driverId })`. On a cascade offer the trip's `driverId`
 *    is still NULL, so that found nothing and answered 404. The correct verb
 *    depended on a `kind` string the list also did not pass. The server now
 *    routes it — `drivers.service.claimTrip` reads the trip row and picks —
 *    so this screen has one accept call and cannot pick the wrong one.
 *
 * 3. "when I waited for it to expire, it brought me to unmatched route
 *    (eyego-driver:///)"
 *    `router.replace('/(tabs)')`. A group is not a route; expo-router has
 *    nothing to match and renders its unmatched screen. Every exit here now
 *    names the actual screen, `/(tabs)/home`.
 */
export default function DispatchScreen() {
  const colors = useColors();
  const theme = useDriverStore((s) => s.theme);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // The chrome floats over a full-bleed map, so the safe area is applied per
  // element rather than by a SafeAreaView that would inset the map itself.
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const setActiveTripId = useDriverStore((s) => s.setActiveTripId);

  const params = useLocalSearchParams<{
    id: string;
    origin?: string;
    destination?: string;
    estimatedEarnings?: string;
    expiresAt?: string;
    kind?: string;
  }>();
  const id = params.id;

  const serverNow = useDriverTripStore((s) => s.now);
  const heldOffer = useDriverTripStore((s) => s.offer);
  const pendingRequests = useDriverTripStore((s) => s.pendingRequests);
  const resync = useDriverTripStore((s) => s.resync);

  /**
   * THE OFFER, FROM THE SERVER'S OWN COPY.
   *
   * Three sources, in descending order of authority: the exclusive offer this
   * driver holds; the live-search row for this trip; and finally the navigation
   * params, which are kept only because the FCM notification handler still
   * builds a link with them and a push that arrives before the socket does is
   * the one case where params are the only thing we have.
   */
  const [fetched, setFetched] = useState<DispatchOfferView | null>(null);
  const [loading, setLoading] = useState(false);

  const offer: DispatchOfferView | null = useMemo(() => {
    if (heldOffer?.tripId === id) {
      return {
        tripId: id,
        pickupAddress: heldOffer.pickupAddress,
        dropoffAddress: heldOffer.dropoffAddress,
        pickup: coordOf(heldOffer.pickupLng, heldOffer.pickupLat),
        dropoff: coordOf(heldOffer.dropoffLng, heldOffer.dropoffLat),
        driverEarningsPesewas: heldOffer.driverEarningsPesewas,
        farePesewas: heldOffer.farePesewas,
        walletRequiredPesewas: heldOffer.walletRequiredPesewas ?? null,
        tier: heldOffer.tier,
        etaSeconds: heldOffer.etaSeconds,
        expiresAtServerMs: heldOffer.expiresAtServerMs,
        attempt: heldOffer.attempt,
        totalCandidates: heldOffer.totalCandidates,
        kind: params.kind ?? 'DISPATCH',
      };
    }

    const row = pendingRequests.find((r) => r.tripId === id);
    if (row) {
      return {
        tripId: id,
        pickupAddress: row.pickupAddress,
        dropoffAddress: row.dropoffAddress,
        pickup: coordOf(row.pickupLng, row.pickupLat),
        dropoff: coordOf(row.dropoffLng, row.dropoffLat),
        driverEarningsPesewas: row.driverEarningsPesewas,
        farePesewas: row.farePesewas,
        walletRequiredPesewas: (row as any).walletRequiredPesewas ?? null,
        tier: row.tier,
        expiresAtServerMs: row.expiresAtServerMs,
        kind: row.status === 'REASSIGNING' ? 'REASSIGNMENT' : (params.kind ?? 'DISPATCH'),
      };
    }

    if (fetched) return fetched;

    if (params.origin || params.destination) {
      return {
        tripId: id,
        pickupAddress: params.origin ?? null,
        dropoffAddress: params.destination ?? null,
        driverEarningsPesewas: params.estimatedEarnings
          ? Math.round(parseFloat(params.estimatedEarnings) * 100)
          : null,
        expiresAtServerMs: params.expiresAt ? new Date(params.expiresAt).getTime() : null,
        kind: params.kind ?? 'DISPATCH',
      };
    }
    return null;
  }, [heldOffer, pendingRequests, fetched, id, params.kind, params.origin, params.destination, params.estimatedEarnings, params.expiresAt]);

  /**
   * Cold store — the phone was asleep, or this is a deep link from a push.
   * `resync` is the cheapest way back: one call rebuilds the offer, the live
   * searches and the clock skew together.
   */
  useEffect(() => {
    if (offer || !id || loading) return;
    setLoading(true);
    void (async () => {
      try {
        await resync();
        // The trip itself, as a last resort — this covers a REASSIGNMENT, which
        // is not in `pendingRequests` for a driver who has not been offered it.
        const trip: any = await driverApi.getTripById(id).catch(() => null);
        const t = trip?.data?.data?.trip ?? trip?.trip ?? trip;
        /**
         * A DEAD TRIP IS NOT AN OFFER.
         *
         * BUGFIX ("I clicked on the notification and it took me to a cancelled
         * trip that's stale — the map is blank and all. You need to make sure
         * this page isn't even accessible in the first place").
         *
         * This branch rendered whatever `getTripById` returned. A trip that has
         * been cancelled, completed or expired still returns 200 with a row, and
         * a cancelled row's coordinates are frequently null — which is exactly
         * the "blank map with an offer card on it" that was reported. Only the
         * statuses a driver can actually claim from get through; everything else
         * falls to the "This offer is gone" state, which already exists below
         * and says the true thing.
         */
        if (t?.id && CLAIMABLE_STATUSES.includes(String(t.status))) {
          setFetched({
            tripId: id,
            pickupAddress: originLabel(t),
            dropoffAddress: destinationLabel(t),
            pickup: coordOf(t.pickupLng ?? t.route?.originLng, t.pickupLat ?? t.route?.originLat),
            dropoff: coordOf(t.dropoffLng ?? t.route?.destLng, t.dropoffLat ?? t.route?.destLat),
            farePesewas: t.pricing?.totalTripCostPesewas ?? null,
            driverEarningsPesewas: t.pricing?.driverEarningsPerSeatPesewas ?? null,
            tier: t.tier ?? null,
            expiresAtServerMs: null,
            kind: t.status === 'REASSIGNING' ? 'REASSIGNMENT' : 'DISPATCH',
          });
        }
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, offer]);

  // ── The clock ───────────────────────────────────────────────────────────
  // Declared before the memo that reads it: a useMemo factory runs during the
  // same render, so a ref declared below it is still in its temporal dead zone.
  const firstSeenRef = useRef(Date.now());

  const expiresAtMs = useMemo(() => {
    if (offer?.expiresAtServerMs) return offer.expiresAtServerMs;
    if (params.expiresAt) {
      const t = new Date(params.expiresAt).getTime();
      if (Number.isFinite(t)) return t;
    }
    return null;
  }, [offer?.expiresAtServerMs, params.expiresAt]);

  const windowMs = useMemo(() => {
    if (!expiresAtMs) return DEFAULT_WINDOW_S * 1000;
    // Measured from FIRST SIGHT rather than assumed, so a driver who opens the
    // offer with eight seconds left sees a ring that starts at eight seconds —
    // not one that claims to be nearly full.
    return Math.max(1000, expiresAtMs - firstSeenRef.current);
  }, [expiresAtMs]);

  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!expiresAtMs) {
      setSecondsLeft(null);
      return;
    }
    const tick = () => setSecondsLeft(Math.max(0, Math.round((expiresAtMs - serverNow()) / 1000)));
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [expiresAtMs, serverNow]);

  const { morphBack } = useMorph();

  /**
   * The reverse flight — the card shrinks back into the row it came from.
   *
   * `morphBack` no-ops into a plain navigation when nothing is in flight (a
   * push notification opened this screen directly, so there is no source row to
   * return to), which is exactly the fallback this needs.
   *
   * NOT '/(tabs)'. That is a group with no screen of its own, and routing to it
   * is what produced "Unmatched Route · eyego-driver:///".
   */
  const goHome = useCallback(() => {
    morphBack(() => router.replace('/(tabs)/home' as Href));
  }, [router, morphBack]);

  // Guard an id that is not a string at all (a malformed deep link).
  useEffect(() => {
    if (!id || typeof id !== 'string') goHome();
  }, [id, goHome]);

  // Expired: hold the dead card for a beat so the driver sees WHY it went away.
  const expired = secondsLeft != null && secondsLeft <= 0;
  useEffect(() => {
    if (!expired) return;
    const t = setTimeout(goHome, 2200);
    return () => clearTimeout(t);
  }, [expired, goHome]);

  // ── Accept / decline ────────────────────────────────────────────────────
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [accepted, setAccepted] = useState(false);

  const handleAccept = useCallback(async () => {
    if (!id || busy) return;
    setBusy('accept');
    try {
      // ONE call. `POST /driver/trips/:id/accept` now resolves which of the
      // three claim paths applies from the trip row itself.
      const res: any = await driverApi.acceptDispatch(id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      const trip = res?.data?.data?.trip ?? res?.data?.trip ?? res?.trip ?? null;
      const tripId = trip?.id ?? id;
      setAccepted(true);
      setActiveTripId(tripId);
      qc.invalidateQueries({ queryKey: ['driver', 'trips', 'all'] });
      qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
      // A beat on "Yours" before the trip screen takes over — the swipe
      // control holds its confirmed state and the transition reads as one move.
      setTimeout(
        () => router.replace({ pathname: '/(trip)/active/[id]', params: { id: tripId } } as Href),
        450,
      );
    } catch (err: any) {
      setBusy(null);
      const status = err?.response?.status;
      const code = err?.response?.data?.code;
      /**
       * "SOMEBODY IS BEING ASKED RIGHT NOW" IS NOT "GONE".
       *
       * The board deliberately lists rides that are not exclusively yours, and
       * the server refuses a claim only while another driver is inside their
       * own countdown (`OFFER_HELD_BY_ANOTHER`). Folding that into the generic
       * "gone already" copy and bouncing the driver home told them the ride was
       * lost when in most cases it is back on their board seconds later.
       */
      /**
       * "INSUFFICIENT FUNDS" BELONGS HERE, NOT AT THE KERB.
       *
       * BUGFIX ("I accepted a trip and got to the pickup point, but when I
       * tried to mark the passenger as boarded, THAT is when I got insufficient
       * funds"). The server now refuses the claim itself (`assertCanAffordTrip`)
       * and sends the numbers with it, so this can say what to do rather than
       * what went wrong — and it offers the one action that fixes it.
       */
      if (code === 'INSUFFICIENT_WALLET_FOR_TRIP' || status === 402) {
        const short = err?.response?.data?.details?.shortfallPesewas;
        Alert.alert(
          'Top up to take this one',
          err?.response?.data?.message ??
            'This ride is paid in cash, and the commission comes out of your wallet when you board.',
          [
            { text: 'Not now', style: 'cancel' },
            {
              text: short ? `Add GH₵${(short / 100).toFixed(2)}` : 'Top up',
              // Earnings is where the wallet and its top-up sheet live.
              onPress: () => router.replace('/(tabs)/earnings' as Href),
            },
          ],
        );
      } else if (code === 'OFFER_HELD_BY_ANOTHER') {
        notify(
          'Being decided',
          err?.response?.data?.message ??
            'Another driver is being asked about this ride right now. If they pass, it comes straight back to your board.',
        );
      } else if (status === 409 || status === 410 || status === 404) {
        notify(
          'Gone already',
          'Another driver took this one, or the offer expired. You are still online.',
          // The verb has to survive: without it the driver is left looking at a
          // dead offer with no way off it.
          { action: { label: 'Back to home', onPress: goHome } },
        );
      } else {
        notify(
          'Could not accept',
          err?.response?.data?.message ?? 'Something went wrong. Try again, or pull to refresh on Home.',
        );
      }
    }
  }, [id, busy, qc, router, setActiveTripId, goHome]);

  const handleDecline = useCallback(async () => {
    if (!id || busy) return;
    setBusy('decline');
    /**
     * DROP THE ROW BEFORE THE REQUEST LANDS.
     *
     * BUGFIX (item 5: "if I click on the cancel button on the dispatch cards,
     * nothing happens"). The screen awaited the round trip and then navigated
     * home, so on a slow link the sequence a driver saw was: tap, tap, nothing,
     * nothing, home — with the passed ride still sitting on the board when they
     * got there, because `pendingRequests` is only rebuilt by the next poll.
     *
     * The decision is the driver's and it is already made; the request is how
     * the server finds out. Removing the row locally is what makes the tap
     * produce a result on the frame it happened.
     */
    useDriverTripStore.setState((s) => ({
      pendingRequests: s.pendingRequests.filter((r) => r.tripId !== id),
      offer: s.offer?.tripId === id ? null : s.offer,
    }));
    try {
      await driverApi.declineDispatch(id);
    } catch {
      // A decline that fails is not worth a dialogue: the offer times out on
      // its own a few seconds later and the cascade moves on regardless. The
      // next poll re-adds the row if the server disagreed.
    } finally {
      goHome();
    }
  }, [id, busy, goHome]);

  const driverAt = useMemo<Coord | null>(() => {
    const fix = lastKnownReportedFix();
    return fix ? coordOf(fix.lng, fix.lat) : null;
  }, []);

  /**
   * The map has been panned away from the ride. Drives the framing control —
   * see `DispatchLiveMap`.
   */
  const [framed, setFramed] = useState(true);
  const mapRef = useRef<DispatchLiveMapHandle | null>(null);

  /**
   * The sheet's REAL height, published on layout.
   *
   * Rounded to 8 pt before it is stored: `onLayout` fires on sub-pixel changes
   * during the morph, and re-framing the camera on a 0.4 pt difference is a map
   * that twitches for the whole of the entrance animation.
   */
  const [sheetHeight, setSheetHeight] = useState(SHEET_RESERVE_FALLBACK);
  const onSheetLayout = useCallback((e: { nativeEvent: { layout: { height: number } } }) => {
    const h = Math.round(e.nativeEvent.layout.height / 8) * 8;
    if (h > 0) setSheetHeight((cur) => (Math.abs(cur - h) < 8 ? cur : h));
  }, []);
  /** Everything that must clear the sheet reads this one number. */
  const sheetClearance = Math.max(SHEET_RESERVE_FALLBACK, sheetHeight);

  /**
   * The road line, when the server has one for this trip.
   *
   * A dispatch offer is pre-assignment, so `path` is usually absent and the map
   * draws its bowed hint instead. When it IS there — a reassignment on a trip
   * that already had geometry — drawing the real road costs nothing and is
   * strictly better than the hint.
   */
  const routeGeoJson = useMemo(() => {
    const g = (heldOffer as any)?.geometry ?? (fetched as any)?.geometry ?? null;
    if (!g?.coordinates || !Array.isArray(g.coordinates) || g.coordinates.length < 2) return null;
    return { type: 'Feature', properties: {}, geometry: g } as GeoJSON.Feature;
  }, [heldOffer, fetched]);

  const tier = getTierTheme(colors as any, offer?.tier);
  const urgent = secondsLeft != null && secondsLeft <= 5;
  const warning = secondsLeft != null && secondsLeft <= 10 && !urgent;
  const accent = urgent ? colors.error : warning ? colors.statusWarning : tier.accent;

  /**
   * ── THE DISPATCH SCREEN, REBUILT ───────────────────────────────────────────
   *
   * "The way the glow borders and all is done, it's not nice… the page needs to
   * show the map so the driver can pan the map and see how far out the pickup
   * point is and all. Right now it's looking basic and not well thought of."
   *
   * What was actually on the screen before: a scroll view containing ONE card.
   * That card had a glow ring around it, a 208pt frozen map inside it with its
   * own vignette, and a glass panel under the map with its own top rim. Stacked
   * within twenty points of each other, that is four competing edges, and the
   * outer glow was the loudest of them — hence "the glow borders and all". And
   * the map, the one element that answers the only question a driver has about
   * an offer, was a postage stamp that could not be touched.
   *
   * The rebuild inverts the composition:
   *
   *   THE MAP IS THE PAGE.        Full-bleed, pannable, zoomable. The pickup pin
   *                               breathes so it is findable at a glance.
   *   THE OFFER IS AN ISLAND.     Docked at the bottom, glass, top corners only,
   *                               a grabber, and a draining rail on its top edge.
   *                               No ring: over a live map a glow smears, and the
   *                               map already separates the panel from the world.
   *   PANNING IS SAFE.            The camera is never yanked back. Instead, the
   *                               moment the driver moves it, a "Frame the ride"
   *                               control fades in above the sheet, and the map
   *                               is padded so `fitBounds` frames into the space
   *                               ABOVE the sheet rather than behind it.
   *   ONE ACCENT.                 The tier's colour drives the route line, the
   *                               pickup pin, the rail, the ring and the swipe
   *                               track together, and urgency overrides all of
   *                               them at once at ten and five seconds.
   */
  return (
    <View style={styles.safe}>
      {offer ? (
        <DispatchLiveMap
          ref={mapRef}
          pickup={offer.pickup}
          dropoff={offer.dropoff}
          driver={driverAt}
          routeGeoJson={routeGeoJson}
          accent={accent}
          // Framed into the space the sheet does not cover. Without the bottom
          // inset, half the ride sits behind the panel and the map looks like it
          // is refusing to show the pickup. `sheetClearance` is the sheet's
          // MEASURED height, so this is the real window and not an assumption.
          padding={{
            top: insets.top + 96,
            bottom: sheetClearance + spacing.lg,
            left: 52,
            right: 52,
          }}
          onFramedChange={setFramed}
        />
      ) : (
        <AppBackground isDark={theme !== 'light'} />
      )}

      {/* ── Floating chrome ── */}
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]} pointerEvents="box-none">
        <Pressable
          onPress={goHome}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back to home"
          style={styles.back}
        >
          <GlassSurface style={StyleSheet.absoluteFill} borderRadius={18} intensity="high" />
          <Ionicons name="chevron-down" size={20} color={colors.onSurface} />
        </Pressable>
        {/*
          THE HEADER SAYS WHAT KIND OF OFFER THIS IS, AND HOW HARD IT IS HELD.

          It read "New offer" for everything, which is the one thing a driver
          already knows — a dispatch screen is on their phone. What they cannot
          tell by looking is whether the ride is THEIRS for the next forty-five
          seconds or whether they are racing every other driver for it, and that
          changes how fast they have to decide. The dot breathes on the ones
          that are a race.
        */}
        <View style={styles.topTitleWrap}>
          <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.full} intensity="high" />
          <View style={[styles.topDot, { backgroundColor: accent }]} />
          <Text style={styles.topTitle}>
            {offer?.kind === 'REASSIGNMENT'
              ? 'Up for grabs · first to accept'
              : offer?.kind === 'REQUEST'
                ? 'Open request'
                : 'Held for you'}
          </Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      {offer ? (
        <>
          {/* Re-frame. Only offered once the driver has actually moved the
              camera — a control that is always there is a control that says the
              map is broken. */}
          {!framed && (
            <Animated.View
              entering={FadeIn.duration(160)}
              exiting={FadeOut.duration(120)}
              // Measured, not assumed. See `sheetClearance`: this used to sit at
              // a fixed 446 pt and any offer with a taller card put it behind
              // the panel it exists to clear.
              style={[styles.frameFabWrap, { bottom: sheetClearance + spacing.md }]}
              pointerEvents="box-none"
            >
              <Pressable
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  mapRef.current?.frame(true);
                  setFramed(true);
                }}
                accessibilityRole="button"
                accessibilityLabel="Frame the whole ride on the map"
                style={styles.frameFab}
              >
                <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.full} intensity="high" />
                <Ionicons name="scan-outline" size={15} color={accent} />
                <Text style={[styles.frameFabText, { color: colors.onSurface }]}>Frame the ride</Text>
              </Pressable>
            </Animated.View>
          )}

          {/**
           * THE CARD THE DRIVER TAPPED IS THE CARD THAT LANDS HERE.
           *
           * BUGFIX (item 14: "when you tap on the live dispatch card on the
           * homepage of the driver app, it should morph into the newly designed
           * dispatch page like the way the live trip card does on the rider
           * homepage").
           *
           * `MorphSource` on the board row flies a clone of that row into this
           * target, so the offer grows out of the row rather than a new screen
           * sliding over it — §7 `shared-element-transition` / `continuity`.
           *
           * The id MUST come from `morphIdFor`, not be spelled here: a target
           * whose id does not match its source never receives the clone, and the
           * failure is silent — the screen simply appears without animating.
           *
           * `Entrance` is gone from this branch. Two entrance animations on one
           * element fight: the morph is already animating position, size and
           * radius, and a slide-up underneath it was the jitter on arrival.
           */}
          <View style={styles.sheetDock} pointerEvents="box-none" onLayout={onSheetLayout}>
            {/* A scrim under the sheet's top edge. The panel is glass, so
                without it the map's brightest tiles read straight through the
                card's own top rows — which is the "everything is overlapping"
                on the busiest part of this screen. `box-none` so it never eats
                a pan meant for the map. */}
            {/*
              THE SCRIM WAS A HARDCODED NAVY.

              `rgba(3,12,24,…)` is this app's dark background written out by
              hand, which means in light mode the screen painted a dark smear
              across the bottom of a light map — and if the palette ever moves,
              this one gradient stays behind. It is the app's own
              `backgroundDeep` now, faded from nothing to near-opaque, so it
              belongs to whatever theme is running.

              It also carries a breath of the offer's accent at its midpoint.
              That is not decoration: the sheet below it is tinted with the same
              accent, so a scrim that steps straight from map to panel reads as
              two materials butted together, and one that passes through the
              accent reads as one surface lifting off the map.
            */}
            <LinearGradient
              pointerEvents="none"
              colors={[
                withOpacity(colors.backgroundDeep, 0),
                withOpacity(accent, 0.1),
                withOpacity(colors.backgroundDeep, 0.72),
                withOpacity(colors.backgroundDeep, 0.94),
              ]}
              locations={[0, 0.3, 0.62, 1]}
              style={styles.sheetScrim}
            />
            <MorphTarget id={morphIdFor(id)} borderRadius={radii['3xl']}>
              <ScrollView
                style={{ maxHeight: SHEET_MAX_HEIGHT }}
                contentContainerStyle={{ paddingBottom: insets.bottom + spacing.base }}
                showsVerticalScrollIndicator={false}
                bounces={false}
              >
                <DispatchOfferCard
                  variant="sheet"
                  offer={offer}
                  driverAt={driverAt}
                  nowMs={serverNow()}
                  windowMs={windowMs}
                  secondsLeft={secondsLeft}
                  onAccept={handleAccept}
                  onDecline={handleDecline}
                  busy={busy}
                  accepted={accepted}
                />
                {expired ? (
                  <View style={[styles.expiredNote, { borderColor: colors.outline }]}>
                    <Ionicons name="time-outline" size={15} color={colors.onSurfaceVariant} />
                    <Text variant="bodySmall" color={colors.onSurfaceVariant}>
                      Offer expired, taking you back
                    </Text>
                  </View>
                ) : null}
              </ScrollView>
            </MorphTarget>
          </View>
        </>
      ) : (
        <View style={styles.empty}>
          {loading ? (
            <>
              <ActivityIndicator color={colors.accent} />
              <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.emptyText}>
                Pulling this ride up…
              </Text>
            </>
          ) : (
            <>
              <Ionicons name="cloud-offline-outline" size={30} color={colors.onSurfaceVariant} />
              <Text style={styles.emptyTitle}>This offer is gone</Text>
              <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.emptyText}>
                It expired, or another driver took it. You are still online and still in the pool.
              </Text>
              <Pressable onPress={goHome} style={[styles.emptyBtn, { borderColor: colors.outline }]} accessibilityRole="button">
                <Text style={{ fontFamily: fonts.semiBold, color: colors.accent }}>Back to home</Text>
              </Pressable>
            </>
          )}
        </View>
      )}
    </View>
  );
}

/** `[lng, lat]`, or null unless BOTH are real finite numbers. */
function coordOf(lng: unknown, lat: unknown): Coord | null {
  if (typeof lng !== 'number' || typeof lat !== 'number') return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    // The map is full-bleed underneath everything, so this must not paint.
    safe: { flex: 1, backgroundColor: colors.background },

    /** Floating chrome over the map — glass pills, not a bar. */
    topBar: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 4,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
    },
    back: {
      width: 36, height: 36, borderRadius: 18,
      alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.rimLight,
    },
    topTitleWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.base,
      minHeight: 36,
      borderRadius: radii.full,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.rimLight,
    },
    topDot: { width: 6, height: 6, borderRadius: 3 },
    topTitle: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyMedium,
      color: colors.onSurface,
      letterSpacing: 0.2,
    },

    /** "Frame the ride" — appears only once the driver has panned away. */
    frameFabWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 3 },
    frameFab: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      // 44pt minimum touch target, reached for without looking.
      minHeight: 44,
      paddingHorizontal: spacing.lg,
      borderRadius: radii.full,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.rimLight,
    },
    frameFabText: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium },

    /** Where the offer docks. `box-none` so the map stays draggable around it. */
    sheetDock: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 2 },
    /** Darkens the map behind the glass panel's top edge — see the note there. */
    sheetScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 132 },

    empty: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing['4xl'],
      paddingHorizontal: spacing.xl,
    },
    emptyTitle: {
      fontFamily: fonts.displayBold,
      fontSize: 20,
      lineHeight: 26,
      color: colors.onSurface,
    },
    emptyText: { textAlign: 'center', lineHeight: 20 },
    emptyBtn: {
      marginTop: spacing.sm,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.md,
      borderRadius: radii.full,
      borderWidth: 1,
    },

    expiredNote: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      marginHorizontal: spacing.lg,
      marginTop: spacing.md,
      paddingVertical: spacing.md,
      borderRadius: radii.full,
      borderWidth: StyleSheet.hairlineWidth,
      backgroundColor: colors.surfaceCard,
    },
  });
