import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { formatGhs, originLabel, destinationLabel, seatsOf } from '@eyego/utils';
import {
  View,
  StyleSheet,
  Pressable,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { MotiView, goDeeper, goBack, notify, callNumber } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import * as KeepAwake from 'expo-keep-awake';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { driverApi, driverSocketEvents, connectDriverSocket, disconnectDriverSocket } from '@eyego/api';
import { fonts, fontSizes, spacing, radii, springs, durations, TRIP_STATUS_COPY, driverStatusLabel } from '@eyego/config';
import { Text, Button, Entrance, Skeleton, GlassSurface, GradientGlowBorder, InlayPanel, AppBackground, ChromeBlur, goLateral, SmoothScreen } from '@eyego/ui';
import { useChatUnread } from '../../../stores/chatUnread.store';
import { applyDriverTripStatus } from '../../../stores/trip.store';
import { useColors, type DriverColors } from '../../../utils/useColors';
import { usePlatformConfig } from '../../../hooks/usePlatformConfig';
import { openExternalNavigation } from '../../../utils/externalNav';
import { StopTimelineSurface } from '../../../components/trip/StopTimelineSurface';
import { StopTimeline, CabinStrip } from '../../../components/trip/StopTimeline';
import { useTripStops } from '../../../components/trip/useTripStops';
import { useDriverStore } from '../../../stores/driver.store';
import { useNotificationsStore } from '../../../stores/notifications.store';
// Driver app uses the blue-highway dark variant, not rider's brand-green default export.
import { useDriverLocation } from '../../../hooks/useDriverLocation';
import { offlineQueue } from '../../../utils/offlineQueue';
import { DriverTripMap } from '../../../components/trip/DriverTripMap';
import type { TripBooking } from '@eyego/types';

/**
 * Must cover every status `advanceStatus` below can act on, and must agree with
 * the copy on `(trip)/active/[id].tsx`. Both were false.
 *
 * `CONFIRMED` and `DRIVER_ASSIGNED` were missing, so the lookup at the render
 * site fell through to its `?? STATUS_FLOW.FILLING` default and drew a "Start
 * Trip" button for a status the mutation had no branch for — a button that
 * looked right and threw as soon as it was tapped. That is the whole of "I
 * tried to start the trip and it said cannot advance from the current status",
 * and of "starting from the manage page worked but from the tracking page
 * nothing happened".
 */
const STATUS_FLOW: Record<string, { label: string; next: string | null; action: string }> = {
  CONFIRMED:          { label: 'Confirmed',           next: 'start',  action: 'Start Trip'     },
  SCHEDULED:          { label: 'Scheduled',           next: 'start',  action: 'Start Trip'     },
  FILLING:            { label: 'Boarding Open',       next: 'start',  action: 'Start Trip'     },
  DRIVER_ASSIGNED:    { label: 'Assigned',            next: 'start',  action: 'Head to Pickup' },
  DRIVER_EN_ROUTE:    { label: 'En Route to Stop',    next: 'arrive', action: "I've Arrived"   },
  ARRIVED_AT_PICKUP:  { label: 'Arrived at Pickup',   next: 'depart', action: 'Start Ride'     },
  // Not 'Mark Arrived'. `driverApi.arriveTrip` is IN_PROGRESS → COMPLETED, so
  // this button ends the ride and opens the receipt. The manage page was
  // corrected for exactly this ("i'm in the trip in progress state and when i
  // swipe again, the trip is done") and this copy of the map was left behind.
  IN_PROGRESS:        { label: 'In Progress',         next: 'finish', action: 'Complete Trip'  },
  COMPLETED:          { label: 'Completed',           next: null,     action: ''               },
  CANCELLED:          { label: 'Cancelled',           next: null,     action: ''               },
};

export default function DriverTrackingScreen() {
  // One emergency number for both apps, editable in the console without a
  // release. Falls back to Ghana’s unified line, so it is never empty even
  // before the first config fetch answers.
  const { emergencyNumber } = usePlatformConfig();
  const colors = useColors();
  const theme = useDriverStore(s => s.theme);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { setActiveTripId, isOnline } = useDriverStore();
  const { addNotification } = useNotificationsStore();

  const { data: trip, isLoading } = useQuery({
    queryKey: ['driver', 'trip', 'tracking', id],
    // Use getTripById so the screen stays populated through all status transitions.
    // getActiveTrip() returns null after ARRIVED_AT_PICKUP, causing an infinite skeleton.
    queryFn: () => driverApi.getTripById(id),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (r: any) => r.data?.data?.trip ?? null,
    // Safety net behind the trip channel, not the delivery mechanism — see the
    // same note on the active screen. Live movement arrives over the socket.
    refetchInterval: 30000,
    enabled: !!id,
  });

  const isActiveTrip = !!trip && !['COMPLETED', 'CANCELLED'].includes(trip.status);

  // Live driver location. `useDriverLocation` already emits every fix to the
  // socket, which is why this screen no longer runs its own 4 s emit interval —
  // that was doubling the location traffic for every driver on the road.
  const { location: driverLocation } = useDriverLocation({ enabled: isActiveTrip });

  // ETA state — fed ENTIRELY by the server (route-geometry.service.js) through
  // DriverTripMap's `onEta`. This screen used to call Directions itself and
  // route to the trip's final destination in every phase, so "12 min" during
  // pickup was the time to the rider's DESTINATION, a number unrelated to the
  // wait. The server knows which leg is live; the client no longer guesses.
  const [etaMinutes, setEtaMinutes] = useState<number | null>(null);
  const [etaDistanceKm, setEtaDistanceKm] = useState<number | null>(null);
  const [etaMessage, setEtaMessage] = useState<string | null>(null);
  /**
   * WHICH JOURNEY THE ETA MEASURES.
   *
   * BUGFIX ("i started the trip and the tracking page says i'm moving to the
   * destination, meanwhile the rider app says i'm on my way to them"). This
   * defaulted to 'toDropoff' — so between mount and the FIRST `trip:eta` frame
   * the screen asserted the destination leg no matter what the trip status
   * was. The rider was right and the driver's own app was wrong, about the
   * driver, which is the worst way round for it to be.
   *
   * `null` until the server says, and until then the leg is derived from the
   * status, which both apps already agree on. There is no state in which
   * guessing beats reading.
   */
  const [etaLeg, setEtaLeg] = useState<'toPickup' | 'toDropoff' | null>(null);

  /**
   * The leg to render RIGHT NOW: whatever the server last said, or — before it
   * has said anything — whatever the trip's own status implies. This is the
   * same rule the server applies in `route-geometry.activeLeg`, so the two
   * cannot disagree: the driver is fetching the rider until they are aboard.
   */
  /**
   * ONCE THE DRIVER IS AT THE KERB, THE PICKUP LEG IS OVER.
   *
   * BUGFIX ("if the driver is already at the pickup when starting, the tracking
   * page should skip the heading-to-pickup phase — and it's stuck on
   * calculating ETA").
   *
   * The status wins over `etaLeg` here rather than the other way round. A driver
   * who accepts a dispatch while already standing at the pickup — or who marks
   * arrived — has nothing left to be routed TO: the remaining journey is the
   * drop-off. The old rule kept whatever leg the last `trip:eta` frame named,
   * and the last frame before arrival is always `toPickup`, so the card went on
   * describing a leg with zero distance left in it. Worse, a zero-length leg
   * produces no useful route and therefore no further `trip:eta`, which is the
   * second half of the same report: the number never arrives and the label sits
   * on its placeholder for the rest of the trip.
   */
  const statusSaysPickupDone = trip?.status === 'ARRIVED_AT_PICKUP' || trip?.status === 'IN_PROGRESS';

  const unreadChats = useChatUnread((s) => (id ? s.counts[id] ?? 0 : 0));

  const handleEta = useCallback(
    (eta: { leg: 'toPickup' | 'toDropoff'; minutes: number; distanceKm: number | null; rerouted: boolean }) => {
      setEtaMinutes(eta.minutes);
      setEtaDistanceKm(eta.distanceKm);
      setEtaLeg(eta.leg);
      setEtaMessage(
        eta.rerouted
          ? 'Route updated'
          : eta.distanceKm != null
            ? `${eta.distanceKm} km ${eta.leg === 'toPickup' ? 'to pickup' : 'to destination'}`
            : null,
      );
    },
    [],
  );

  // Keep screen on while trip is active
  useEffect(() => {
    if (isActiveTrip) {
      KeepAwake.activateKeepAwake();
    } else {
      KeepAwake.deactivateKeepAwake();
    }
    return () => { KeepAwake.deactivateKeepAwake(); };
  }, [isActiveTrip]);

  // Socket setup — connect to driver namespace for ETA + events
  useEffect(() => {
    if (!trip || !isActiveTrip) return;

    connectDriverSocket();

    /**
     * JOIN THE TRIP ROOM NOW, NOT ONLY ON THE NEXT `connect`.
     *
     * BUGFIX ("on the driver app the eta is stuck on calculating eta").
     *
     * `trip:eta` is emitted by the server into `trip:<tripId>`, and this screen
     * is the only thing that asks to be in that room. The ask lived exclusively
     * inside `onConnect`, which fires when the socket transitions to connected —
     * and by the time a driver opens a trip the socket has been up since app
     * launch (`listenForOffers` dials it as soon as they log in). So on the
     * normal path the handler was registered and never called, the driver never
     * joined, no `trip:eta` frame could ever be addressed to them, and the ETA
     * sat on its placeholder for the life of the trip.
     *
     * The server does auto-rejoin the room on CONNECTION for a driver who
     * already has an active trip, which is why this ever appeared to work — but
     * that only helps if the socket connects AFTER the trip is assigned, i.e.
     * only if the app was restarted mid-trip. Accepting a dispatch on a running
     * app misses it every time.
     *
     * Joining is idempotent server-side (`socket.join` on a room you are already
     * in is a no-op), so asking on mount AND on every reconnect is safe and
     * covers both orderings.
     */
    driverSocketEvents.emitJoinTracking(id);

    const unsubConnect = driverSocketEvents.onConnect(() => {
      console.log('[DriverTracking] Socket connected');
      driverSocketEvents.emitJoinTracking(id);
    });

    // `trip:eta` / `trip:route` are handled by DriverTripMap (which owns the
    // line as well as the number) — subscribing here too would mean two
    // listeners racing to interpret the same payload differently.

    const unsubPayment = driverSocketEvents.onPaymentConfirmed((data) => {
      if (data.tripId === id) {
        addNotification({
          type: 'PAYMENT_CONFIRMED',
          title: 'Payment Confirmed',
          body: 'A passenger just completed their payment.',
          tripId: id,
        });
        qc.invalidateQueries({ queryKey: ['driver', 'trip', 'tracking', id] });
      }
    });

    const unsubSeat = driverSocketEvents.onSeatUpdate(() => {
      qc.invalidateQueries({ queryKey: ['driver', 'trip', 'tracking', id] });
    });

    // There was a 4-second `emitLocation` interval here. It duplicated what
    // `useDriverLocation.applyPosition` already does on every GPS fix, so every
    // driver on this screen sent their position twice — once per fix and again
    // on a timer that re-sent a stale one in between. The hook is the single
    // emitter now.

    return () => {
      unsubConnect();
      unsubPayment();
      unsubSeat();
      disconnectDriverSocket();
    };
  }, [trip?.id, isActiveTrip, id, qc, addNotification]);

  // The camera lives in DriverTripMap now — one state machine, shared with the
  // rider app (packages/maps/src/camera.ts). What was here instead:
  //
  //   - a `setCamera` call re-issued on EVERY GPS fix, with no user-gesture
  //     release at all. Pan away to look at a junction and the next fix yanked
  //     you back; there was no rule for who owned the camera.
  //   - the Re-center button as the only way out, and only because it re-issued
  //     the same call with `heading: 0`.
  //   - screen-local `zoomLevel: 17` / `pitch: 55` constants, which is why this
  //     screen and the sibling active-trip screen framed one trip differently.
  //
  // BUGFIX kept from the old code and now encoded in `camera.ts`: the map stays
  // course-up via the camera's own heading, never by rotating the marker — the
  // marker's rotation is a TRUE bearing that @eyego/maps compensates against
  // the live map bearing.

  // BUGFIX: these used to default a missing route coordinate to a fixed Accra
  // centre, which rendered a fake pin and fed a fabricated point into the ETA
  // fetch. If a trip genuinely has no coordinate, stay null and let every
  // consumer skip rendering rather than show made-up data.
  /**
   * THE TRIP'S OWN ENDPOINTS FIRST, THE ROUTE'S SECOND.
   *
   * Same rule as the manage page (`active/[id].tsx`), and for the same reason:
   * a `Route` is the group/bus product, and an ON-DEMAND ride carries its
   * endpoints as `pickupLat/Lng` / `dropoffLat/Lng` columns on the trip itself
   * with no route at all. Reading only `trip.route.*` left every hailed ride
   * with null coordinates here — no pins, and nothing to measure the "am I
   * already at the pickup" test below against.
   */
  const destCoord: [number, number] | null = useMemo(() => {
    const t = trip as any;
    const lat = typeof t?.dropoffLat === 'number' ? t.dropoffLat : trip?.route?.destLat;
    const lng = typeof t?.dropoffLng === 'number' ? t.dropoffLng : trip?.route?.destLng;
    if (typeof lat === 'number' && typeof lng === 'number') return [lng, lat];
    return null;
  }, [trip]);

  const pickupCoord: [number, number] | null = useMemo(() => {
    const t = trip as any;
    const lat = typeof t?.pickupLat === 'number' ? t.pickupLat : trip?.route?.originLat;
    const lng = typeof t?.pickupLng === 'number' ? t.pickupLng : trip?.route?.originLng;
    if (typeof lat === 'number' && typeof lng === 'number') return [lng, lat];
    return destCoord;
  }, [trip, destCoord]);

  /**
   * ALREADY AT THE KERB — SKIP THE PICKUP LEG.
   *
   * BUGFIX ("when I start the trip the heading-to-pickup shows Calculating ETA,
   * which makes sense because I'm literally at the pickup. When the driver is at
   * the pickup, the pickup leg on the tracking page should be skipped").
   *
   * Status alone cannot see this. A driver who accepts a dispatch while already
   * parked at the pickup sits at DRIVER_EN_ROUTE with a zero-length `toPickup`
   * leg: no useful route, therefore no `trip:eta` frame, therefore a label stuck
   * on its placeholder for the rest of the trip.
   *
   * The same rule the server applies in `route-geometry.liveLeg`, written here
   * too so the card is right on the very first frame rather than waiting for
   * the server's answer to arrive — and the same number in both places so the
   * two cannot name different legs for the same moment.
   *
   * 75 m, not the 150 it was. See `AT_PICKUP_METERS` on the server: 150 claimed
   * a driver was standing on a pickup that was a one-minute walk away, which is
   * exactly what was reported for a driver-created trip whose pickup is the next
   * street over. 75 is the same radius the arrival geofence uses, so "at the
   * pickup" now means one thing in the router, in this copy, and in the trip.
   */
  const AT_PICKUP_M = 75;
  const atPickupNow = useMemo(() => {
    if (!driverLocation || !pickupCoord || !destCoord) return false;
    const [plng, plat] = pickupCoord;
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(plat - driverLocation.latitude);
    const dLng = toRad(plng - driverLocation.longitude);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(driverLocation.latitude)) * Math.cos(toRad(plat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a))) <= AT_PICKUP_M;
  }, [driverLocation?.latitude, driverLocation?.longitude, pickupCoord, destCoord]);

  /**
   * THE LEG FOLLOWS THE STATUS. PROXIMITY IS NOT A STATUS.
   *
   * BUGFIX — "on the tracking page it now shows driving to destination instead
   * of pickup for that status."
   *
   * This was `statusSaysPickupDone || atPickupNow`, and `atPickupNow` is true
   * from 75 m out. So the instant the driver pulled up — before they had swiped
   * anything, while the chip above still read "Heading to pickup" — the card
   * underneath started describing the drop-off leg. One screen, two answers to
   * "where am I going", which is exactly what was reported.
   *
   * Being NEAR the pickup is not the same event as having FINISHED with it: the
   * driver still has to stop, find the passenger and board them. So the leg is
   * decided by the trip's status alone, and `atPickupNow` keeps its own, more
   * honest job below — saying "you're at the pickup point" instead of counting
   * down a distance that is already zero.
   */
  const pickupLegDone = statusSaysPickupDone;
  /**
   * The leg to render RIGHT NOW: the drop-off once the pickup is behind us
   * (by status OR by position), otherwise whatever the server last said, and
   * only then the status's implication. Position and status win over `etaLeg`
   * because the last frame before arrival is always `toPickup`, and keeping it
   * is what left the card describing a leg with nothing left in it.
   */
  const effectiveLeg: 'toPickup' | 'toDropoff' = pickupLegDone
    ? 'toDropoff'
    : (etaLeg ?? 'toPickup');

  // The leg choice (pickup first, then destination) and the road geometry both
  // live on the SERVER now — route-geometry.service.js computes one line per
  // leg, caches it, and re-routes after three consecutive off-route fixes.
  // What was here: a `fetchRoute` call keyed on the driver's own position, a
  // reset effect for the phase switch, and a 60 s interval to refetch. Three
  // moving parts to reproduce, per screen, a line the server already had — and
  // because each screen fetched independently, the driver and the rider could
  // be following two different lines for one ride.

  // ── In-app banner ──
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);
  // Reanimated shared value — one animation system across both apps.
  const bannerY = useSharedValue(-80);
  const bannerStyle = useAnimatedStyle(() => ({ transform: [{ translateY: bannerY.value }] }));
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showBanner = useCallback((msg: string) => {
    setBannerMsg(msg);
    bannerY.value = withSpring(0, springs.standard);
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => {
      bannerY.value = withTiming(-80, { duration: durations.standard }, (finished) => {
        if (finished) runOnJS(setBannerMsg)(null);
      });
    }, 4000);
  }, [bannerY]);

  // ── Trip status management ──
  const pendingFromStatus = useRef<string | null>(null);

  const advanceStatus = useMutation({
    /**
     * THE SAME STEP LIST AS THE MANAGE PAGE. It was not, and that was bug 7.
     *
     * "i tried to start the trip on the driver app but it's telling me cannot
     *  update the trip, cannot advance from the current status" — and then:
     * "when I started from the manage page it actually worked, but when I start
     *  from the tracking page nothing happens."
     *
     * Two screens drive one state machine, and this one knew about four of its
     * statuses while `(trip)/active/[id].tsx` knew about six. `CONFIRMED` is
     * what payments.service.js promotes a fully-paid trip to, and
     * `DRIVER_ASSIGNED` is what an assigned-but-not-departed trip sits at —
     * both perfectly ordinary, both legal starts server-side
     * (`CONFIRMED → DRIVER_EN_ROUTE` and `DRIVER_ASSIGNED → DRIVER_EN_ROUTE`
     * are in the transition table), and neither listed here. So the mutation
     * threw before it ever reached the network, on a trip the manage page
     * could start perfectly well.
     *
     * The throw at the bottom is now genuinely unreachable for any startable
     * status, and says what to do if it is ever hit anyway.
     */
    mutationFn: async () => {
      const status = trip?.status;
      pendingFromStatus.current = status ?? null;
      if (
        status === 'CONFIRMED' ||
        status === 'DRIVER_ASSIGNED' ||
        status === 'SCHEDULED' ||
        status === 'FILLING'
      ) {
        return driverApi.startTrip(id);
      }
      if (status === 'DRIVER_EN_ROUTE') return driverApi.arriveAtPickup(id);
      if (status === 'ARRIVED_AT_PICKUP') return driverApi.departTrip(id);
      if (status === 'IN_PROGRESS') return driverApi.arriveTrip(id);
      throw new Error(
        `This trip is ${driverStatusLabel(status ?? 'UNKNOWN').toLowerCase()} — there's no next step to take from here. Open Manage trip to see what's available.`,
      );
    },
    onSuccess: (res) => {
      const fromStatus = pendingFromStatus.current;
      let toStatus: string | null = null;
      if (
        fromStatus === 'CONFIRMED' ||
        fromStatus === 'DRIVER_ASSIGNED' ||
        fromStatus === 'SCHEDULED' ||
        fromStatus === 'FILLING'
      ) toStatus = 'DRIVER_EN_ROUTE';
      else if (fromStatus === 'DRIVER_EN_ROUTE') toStatus = 'ARRIVED_AT_PICKUP';
      else if (fromStatus === 'ARRIVED_AT_PICKUP') toStatus = 'IN_PROGRESS';
      else if (fromStatus === 'IN_PROGRESS') toStatus = 'COMPLETED';

      /*
       * These banners are the DRIVER's own feedback and nothing more. The
       * rider's copy of this news — socket event, push, Live Activity — is fanned
       * out by the server from the transition the `driverApi.*` call above
       * committed, so there is nothing for this screen to announce.
       *
       * The old comment here recorded that this screen "emitted NOTHING" while
       * its sibling `active/[id].tsx` did, and that riders therefore missed the
       * arrival step. That asymmetry is exactly the failure mode of letting
       * clients announce status: it can only ever be fixed one screen at a time,
       * and there is no way to tell which screens are still wrong.
       */
      /**
       * INSTANT, AND ON EVERY SCREEN — not just this one.
       *
       * BUGFIX ("i tapped I've arrived here, went to the manage page, and it
       * still said heading to pickup").
       *
       * This handler used to invalidate only `['driver','trip','tracking',id]`
       * (below) and never `['driver','trip','active',id]` — the manage page's
       * key. Its `onError` handler invalidated 'active', which is the exact
       * inverse of what was needed. So a SUCCESSFUL arrival was the one case
       * that left the sibling screen with no idea, and the app-wide 5-minute
       * `staleTime` meant navigating to it did not even trigger a refetch: its
       * own 30-second `refetchInterval` was the only thing that would ever
       * correct it.
       *
       * One write, all three caches, optimistically — the server's `trip:event`
       * reconciles them underneath. See `applyDriverTripStatus`.
       */
      if (toStatus) {
        applyDriverTripStatus(qc, id, toStatus);
      }

      if (toStatus === 'DRIVER_EN_ROUTE') {
        driverSocketEvents.emitTripStarted(id); // room join only
        showBanner('Trip started — en route to pickup');
      }
      if (toStatus === 'ARRIVED_AT_PICKUP') {
        showBanner('Arrived at pickup — ready to depart');
      }
      if (toStatus === 'IN_PROGRESS') {
        showBanner('Trip is now in progress');
      }
      if (toStatus === 'COMPLETED') {
        setActiveTripId(null);
        qc.invalidateQueries({ queryKey: ['driver', 'trip', 'tracking', id] });
        qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
        qc.invalidateQueries({ queryKey: ['driver', 'trips', 'all'] });
        qc.invalidateQueries({ queryKey: ['driver', 'me'] });
        qc.invalidateQueries({ queryKey: ['driver', 'quests'] });
        // Refresh wallet balance + transactions so home/earnings update.
        qc.invalidateQueries({ queryKey: ['driver', 'wallet'] });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = (res as any)?.data;
        const earningsThisTrip = raw?.data?.earningsThisTrip ?? raw?.data?.totalEarningsPesewas ?? 0;
        addNotification({
          type: 'COMPLETED',
          title: 'Trip completed!',
          body: `You earned ${formatGhs(Number(earningsThisTrip))}`,
          tripId: id,
        });
        router.replace({ pathname: '/(trip)/complete/[id]', params: { id, earnings: String(earningsThisTrip) } } as Href);
        return;
      }

      qc.invalidateQueries({ queryKey: ['driver', 'trip', 'tracking', id] });
      // The manage page's own key. Its absence here is the whole of bug 20.
      qc.invalidateQueries({ queryKey: ['driver', 'trip', 'active', id] });
      qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
    },
    // A 409 means this step already landed — see the long note on the same
    // handler in `(trip)/active/[id].tsx`. Resync rather than alarm the driver.
    onError: async (err) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      qc.invalidateQueries({ queryKey: ['driver', 'trip', 'active', id] });
      qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
      if (status === 409) return;
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err as Error).message ??
        'Please try again.';

      /**
       * A DEAD END OFFERS THE WAY OUT, IT DOESN'T JUST NAME ITSELF.
       *
       * "you should make the message clear so they know what to do — or better
       *  still, when they tap it, it should automatically take them to the
       *  manage page for them to swipe it there."
       *
       * `response` is undefined only when the mutation threw locally, i.e. this
       * screen decided there was no next step. Every other failure came from the
       * server and belongs in a plain alert. In the local case the manage page
       * is where the full set of actions lives, so offer to go there rather than
       * leaving the driver holding a button that does nothing.
       */
      if (status == null) {
        Alert.alert("Can't do that from here", message, [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Open Manage trip',
            onPress: () => goLateral({ pathname: '/(trip)/active/[id]', params: { id } }),
          },
        ]);
        return;
      }
      notify("Couldn't update the trip", message);
    },
  });

  const cancelTrip = useMutation({
    mutationFn: () => driverApi.cancelTrip(id),
    onSuccess: () => {
      setActiveTripId(null);
      qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
      qc.invalidateQueries({ queryKey: ['driver', 'trips', 'all'] });
      router.replace('/(tabs)/home');
    },
    onError: (err: any) => notify('Could not update the trip', err?.response?.data?.message ?? (err as Error).message),
  });

  const handleCancel = () => {
    Alert.alert(
      'Cancel Trip',
      'Are you sure you want to cancel this trip? All passenger bookings will also be cancelled.',
      [
        { text: 'Keep Trip', style: 'cancel' },
        { text: 'Cancel Trip', style: 'destructive', onPress: () => cancelTrip.mutate() },
      ],
    );
  };

  /**
   * A SECOND hand-rolled maps hand-off, which is how the coordinates bug
   * survived the first fix.
   *
   * This built its own URLs and had all the same faults plus one of its own: on
   * iOS it used `maps://?ll=` — drop a pin — rather than `daddr=`, so it did not
   * even start navigation, and on Android it sent bare coordinates. It also read
   * only `trip.route.*`, which is null on an on-demand trip.
   *
   * It now goes through the same `openExternalNavigation` the manage screen
   * uses, so the driver's remembered choice of map app applies here too, and the
   * destination arrives as a searchable address. Nothing in this app should
   * build a maps URL by hand again — see @eyego/utils/geo-links.
   */
  const handleOpenMaps = () => {
    const t = trip as any;
    void openExternalNavigation({
      latitude: t?.dropoff?.lat ?? t?.dropoffLat ?? t?.route?.destLat ?? NaN,
      longitude: t?.dropoff?.lng ?? t?.dropoffLng ?? t?.route?.destLng ?? NaN,
      address:
        destinationLabel(t),
      label: 'Destination',
    });
  };

  // Navigate home when trip disappears (deleted/cancelled upstream).
  // Must be in a useEffect — calling router.replace() during render causes
  // "Cannot update NavigationContainerInner while rendering DriverTrackingScreen".
  useEffect(() => {
    if (!isLoading && !trip && id) {
      router.replace('/(tabs)/home');
    }
  }, [isLoading, trip, id, router]);

  // ── Computed values ──
  const statusInfo = STATUS_FLOW[trip?.status] ?? STATUS_FLOW.FILLING;
  const rawBookings = trip?.bookings ?? [];
  const activeBookings = rawBookings.filter((b: TripBooking) => b.status !== 'CANCELLED');
  /**
   * PEOPLE, NOT BOOKING ROWS.
   *
   * BUGFIX (items 2 and 4: "on the rider app I chose to book 3 seats but the
   * driver's tracking page shows 1/1 boarded", and "it says passengers boarded
   * are 1/3 — but I booked all 3 seats, so if I'm on board they are too").
   *
   * Both numbers came from `activeBookings.length`, and an on-demand ride is
   * deliberately ONE booking however many people are travelling: one payment,
   * one cancellation, one person to phone. The party size lives on the row
   * (`Booking.seats`) and this counted rows, so a car with three people in it
   * reported one — and boarding that single row therefore read as "1 boarded"
   * rather than "all three are in".
   *
   * `seatsOf` is 1 for a group seat and N for an on-demand party, so summing it
   * is the count that is right for both products. Boarding is per booking and
   * always was: the party got in together, so marking their row BOARDED puts
   * all of them in the car — which is exactly what the report asked for.
   */
  const passengers = activeBookings.reduce((n: number, b: any) => n + seatsOf(b), 0);
  const total = trip?.maxSeats ?? passengers ?? 14;
  const fare = trip?.farePerSeatPesewas ?? 0;
  const boarded = activeBookings.reduce(
    (n: number, b: any) => n + (b.status === 'BOARDED' || b.status === 'COMPLETED' ? seatsOf(b) : 0),
    0,
  );

  /**
   * The trip as a list of places, which is what the redesigned surface renders.
   * Derivation lives in one hook so this screen and the manage screen cannot
   * form two different opinions of the same route — see useTripStops.ts.
   */
  const { stops } = useTripStops(trip);
  const statusLabel = TRIP_STATUS_CONFIG[trip?.status]?.label ?? statusInfo.label ?? '';

  // ── Render ──
  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          {[80, 160, 120].map((w, i) => (
            <Skeleton key={i} width={w} height={16} borderRadius={radii.md} />
          ))}
        </View>
      </SafeAreaView>
    );
  }

  if (!trip) return null;

  return (
    /**
     * ── TRACKING, AS A STOP TIMELINE ─────────────────────────────────────────
     *
     * REDESIGN ("you need to completely redesign the manage trip page and the
     * tracking page of the driver app… I don't want to see the same design
     * you've made of those two pages — take a whole different approach").
     *
     * This screen was a full-bleed map with a draggable sheet over it, which is
     * the RIDER's surface wearing the driver's colours. That arrangement is
     * right for a passenger — one journey, no decisions, the map is the story —
     * and wrong for a driver, who has several stops, several people, and a
     * decision at each of them. The old layout forced the two to fight for the
     * screen, which is the reported symptom on the sibling dispatch page: "the
     * map is shown just a little at the top and the texts cover all the space".
     *
     * The new shape inverts it. The map is a PANE with a real, draggable share
     * of the screen; under it the trip is a vertical timeline of stops with the
     * people who board or alight at each one nested beneath; one action is
     * pinned at the bottom and never scrolls away. See
     * components/trip/StopTimelineSurface.tsx and StopTimeline.tsx.
     *
     * WHAT DID NOT CHANGE: every mutation, socket handler, query key and
     * transition above this line. This is the presentation layer only — the
     * long tail of "I tapped arrived on tracking and manage disagreed" was
     * fixed by giving manage sole ownership of transitions, and that stays.
     */
    <StopTimelineSurface
      onBack={() => goBack()}
      title={`${originLabel(trip) ?? 'Pickup'} → ${destinationLabel(trip) ?? 'Destination'}`}
      subtitle={statusLabel}
      map={
        <DriverTripMap
          tripId={id}
          status={trip?.status}
          pickup={pickupCoord}
          dropoff={destCoord}
          location={driverLocation}
          puckColor={colors.primary}
          /**
           * The map is no longer under a sheet, so it has its whole pane. 0
           * tells the camera to frame against the full surface instead of
           * reserving room for a panel that is not there any more.
           */
          sheetFraction={0}
          active={isActiveTrip}
          onEta={handleEta}
        />
      }
      mapOverlay={
        /**
         * ONE PILL, NOT THREE.
         *
         * The old screen floated a LIVE badge, an ETA pill and a boarded-count
         * pill over the map, plus a header and a status badge — five chrome
         * objects on a surface whose entire job is to show a road. The count
         * moved into the timeline (it is the cabin strip, where the seats are)
         * and LIVE became the pulsing dot on this pill, so the map keeps one.
         */
        etaMinutes != null ? (
          <View style={styles.etaPill}>
            <ChromeBlur intensity={60} tint="dark" fallbackColor="rgba(8,10,18,0.9)" style={StyleSheet.absoluteFill} />
            <MotiView
              from={{ opacity: 0.45 }}
              animate={{ opacity: 1 }}
              transition={{ type: 'timing', duration: 900, loop: true }}
              style={styles.liveDot}
            />
            <Text style={styles.etaPillText} numberOfLines={1}>
              {etaMinutes < 2
                ? 'Arriving now'
                : `${etaMinutes} min ${etaLeg === 'toPickup' ? 'to pickup' : 'to destination'}`}
            </Text>
          </View>
        ) : null
      }
      action={
        /**
         * TRACKING DOES NOT DRIVE THE TRIP — it says what happens next and
         * takes the driver to where it happens. Manage owns every transition;
         * see the note that used to sit on this button.
         */
        statusInfo.next ? (
          <Button
            label={`${statusInfo.action} — open Manage`}
            onPress={() => goLateral(`/(trip)/active/${id}`)}
          />
        ) : (
          <Button label="Open Manage" onPress={() => goLateral(`/(trip)/active/${id}`)} />
        )
      }
    >
      {/* In-app banner, inside the scroller so it never covers the map. */}
      {bannerMsg != null && (
        <Animated.View style={[styles.inlineBanner, bannerStyle]}>
          <Ionicons name="notifications" size={15} color={colors.primary} />
          <Text style={styles.inlineBannerText} numberOfLines={2}>
            {bannerMsg}
          </Text>
        </Animated.View>
      )}

      <StopTimeline
        stops={stops}
        onNavigate={handleOpenMaps}
        // Tapping a passenger goes to Manage, which owns per-passenger actions
        // (board, PIN, no-show). Two screens owning one mutation is exactly the
        // class of bug this screen was cured of.
        onPassenger={() => goLateral(`/(trip)/active/${id}`)}
        currentStopAccessory={
          <CabinStrip
            seatsTotal={total}
            seatsTaken={passengers}
            boarded={boarded}
            onPress={() => goLateral(`/(trip)/active/${id}`)}
          />
        }
      />

      {/* Secondary actions — a row, under the timeline, out of the way. */}
      <View style={styles.secondaryActions}>
        <Pressable
          style={styles.secondaryBtn}
          onPress={() => goDeeper(`/(trip)/chat/${id}`)}
          accessibilityRole="button"
          accessibilityLabel="Open chat"
        >
          <Ionicons name="chatbubble-outline" size={18} color={colors.onSurfaceVariant} />
          <Text style={[styles.secondaryBtnText, { color: colors.onSurfaceVariant }]}>Chat</Text>
          {unreadChats > 0 && (
            <View style={[styles.chatBadge, { backgroundColor: colors.primary }]}>
              <Text style={[styles.chatBadgeText, { color: colors.onPrimary ?? '#0A0D14' }]}>
                {unreadChats > 9 ? '9+' : unreadChats}
              </Text>
            </View>
          )}
        </Pressable>
        <Pressable
          style={styles.secondaryBtn}
          onPress={handleOpenMaps}
          accessibilityRole="button"
          accessibilityLabel="Navigate"
        >
          <Ionicons name="navigate-outline" size={18} color={colors.primary} />
          <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>Navigate</Text>
        </Pressable>
        <Pressable
          style={styles.secondaryBtn}
          onPress={() => goLateral(`/(trip)/active/${id}`)}
          accessibilityRole="button"
          accessibilityLabel="Manage the trip"
        >
          <Ionicons name="grid-outline" size={18} color={colors.primary} />
          <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>Manage</Text>
        </Pressable>
      </View>
    </StopTimelineSurface>
  );
}

// ── Status badge ──
/** Colours are this app's palette; labels come from the shared vocabulary, so
 *  this screen and the manage screen can no longer disagree about what a
 *  status is called. See packages/config/src/tripStatus.ts. */
const STATUS_TONE_COLOR: Record<string, string> = {
  SCHEDULED:          '#94A3B8',
  FILLING:            '#3B82F6',
  DRIVER_EN_ROUTE:    '#F59E0B',
  ARRIVED_AT_PICKUP:  '#A78BFA',
  IN_PROGRESS:        '#22C55E',
  COMPLETED:          '#60A5FA',
  CANCELLED:          '#F87171',
};

const TRIP_STATUS_CONFIG: Record<string, { label: string; color: string }> =
  Object.fromEntries(
    Object.keys(TRIP_STATUS_COPY).map((key) => [
      key,
      { label: driverStatusLabel(key), color: STATUS_TONE_COLOR[key] ?? '#94A3B8' },
    ]),
  );

function TripStatusBadge({ status, colors }: { status: string; colors: DriverColors }) {
  const cfg = TRIP_STATUS_CONFIG[status] ?? { label: status, color: colors.onSurfaceVariant };
  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: `${cfg.color}22`,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: `${cfg.color}55`,
      paddingHorizontal: 10,
      paddingVertical: 4,
    }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: cfg.color }} />
      <Text style={{ fontFamily: fonts.semiBold, fontSize: 11, color: cfg.color }}>{cfg.label}</Text>
    </View>
  );
}

// The pulsing pickup marker moved into DriverTripMap with the rest of the map's
// furniture — a pin that only this screen could draw was half the reason the two
// trip screens looked like different apps.

// ── Styles ──
const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    /** The one chrome object on the map — see `mapOverlay` in the render. */
    etaPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      alignSelf: 'flex-start',
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.sm,
      borderRadius: radii.full,
      borderWidth: 1,
      borderColor: colors.rimLightSubtle,
      overflow: 'hidden',
      minHeight: 36,
    },
    etaPillText: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodySmall,
      color: colors.onSurface,
      fontVariant: ['tabular-nums'],
    },
    /**
     * The trip-update banner, INSIDE the scroller.
     *
     * It used to be absolutely positioned over the map, which on a surface
     * whose map is now a fixed pane meant it covered the road exactly when
     * something had changed about the road. In the list it pushes the timeline
     * down for a moment and is gone, which is what a transient notice should do.
     */
    inlineBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      padding: spacing.md,
      marginBottom: spacing.base,
      borderRadius: radii.lg,
      backgroundColor: colors.surfaceContainer,
      borderWidth: 1,
      borderColor: `${colors.primary}44`,
    },
    inlineBannerText: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodySmall,
      color: colors.onSurface,
      lineHeight: 18,
    },
    container: { flex: 1, backgroundColor: 'transparent' },
    loadingContainer: { padding: spacing['2xl'], gap: spacing.lg },
    skeleton: { height: 20, borderRadius: 10, backgroundColor: colors.surfaceContainerHigh },
    headerOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      paddingTop: 50,
      paddingHorizontal: spacing.xl,
      zIndex: 10,
    },
    // Sits above the bottom panel and clear of the header; 48pt is the minimum
    // comfortable target for a thumb on a phone in a cradle.
    // The Re-center control lives in DriverTripMap, next to the camera that
    // knows whether the user has actually taken it — this screen used to render
    // the button unconditionally, so it was there even when it did nothing.
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: 'rgba(6,15,26,0.9)',
      borderRadius: radii['2xl'],
      borderWidth: 1,
      borderColor: colors.outline,
      padding: spacing.sm,
    },
    headerBtn: {
      width: 36,
      height: 36,
      borderRadius: 12,
      backgroundColor: colors.surfaceContainer,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerRouteInfo: { flex: 1 },
    headerRoute: {
      fontFamily: fonts.displaySemiBold,
      fontSize: fontSizes.bodySmall,
      lineHeight: Math.round(fontSizes.bodySmall * 1.3),
      color: colors.onSurface,
    },
    liveBadge: {
      position: 'absolute',
      top: 110,
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      backgroundColor: 'rgba(6,15,26,0.85)',
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.xs,
      borderRadius: radii.full,
      borderWidth: 1,
      borderColor: colors.primary + '40',
      zIndex: 10,
    },
    liveDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.primary,
    },
    liveText: {
      fontFamily: fonts.semiBold,
      fontSize: 11,
      lineHeight: Math.round(11 * 1.3),
      color: colors.primary,
      letterSpacing: 1.5,
    },
    pillStack: {
      position: 'absolute',
      left: spacing.xl,
      // The stack is bounded on BOTH sides. Left-only positioning let a pill
      // grow to whatever its text needed, and "12 min to destination" reached
      // far enough right to slide under the map's re-center button — which
      // sits at `right: 16` and overlaps this stack's vertical band. Moving
      // the pills to the left was supposed to have settled that; it only did
      // for short strings. 76 = the button's 44 plus its 16 inset and a 16
      // gap, so nothing in here can reach it however long the label gets.
      right: 76,
      top: 155,
      zIndex: 10,
      gap: spacing.sm,
      // Left-aligned so a short pill and a long one share a left edge rather
      // than centring against each other.
      alignItems: 'flex-start',
    },
    etaPillBlur: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.sm,
      borderRadius: radii.full,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.primary + '30',
    },
    statusBanner: {
      position: 'absolute',
      top: 150,
      left: spacing.base,
      right: spacing.base,
      zIndex: 20,
      borderRadius: radii['2xl'],
      overflow: 'hidden',
    },
    statusBannerBlur: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.sm,
      borderWidth: 1.5,
      borderColor: colors.primary + '60',
      borderRadius: radii['2xl'],
      overflow: 'hidden',
    },
    statusBannerIcon: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    statusBannerLabel: {
      fontFamily: fonts.semiBold,
      fontSize: 9,
      lineHeight: Math.round(9 * 1.3),
      color: colors.primary,
      letterSpacing: 1.5,
      marginBottom: 1,
    },
    statusBannerText: {
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodySmall,
      lineHeight: Math.round(fontSizes.bodySmall * 1.3),
      color: colors.onSurface,
    },
    sheetBackground: {
      borderTopLeftRadius: radii['3xl'],
      borderTopRightRadius: radii['3xl'],
    },
    sheetHandle: { backgroundColor: colors.outline, width: 40, height: 4 },
    /** Content spacing only. Padding and the top glow gap now live in the
     *  shared shell (components/trip/TripSurfaceShell), so both driver trip
     *  screens get them from one place. */
    sheetInner: {
      gap: spacing.lg,
    },
    sheetContent: {
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing.lg,
      paddingBottom: spacing['2xl'],
      gap: spacing.base,
    },
    etaSection: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: radii.xl,
      padding: spacing.base,
      overflow: 'hidden',
    },
    glassInset: StyleSheet.absoluteFillObject,
    etaLeft: { alignItems: 'center', flex: 1 },
    etaValue: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.titleLarge,
      lineHeight: Math.round(fontSizes.titleLarge * 1.4),
      color: colors.primary,
    },
    etaDivider: { width: 1, height: 40, backgroundColor: colors.outlineVariant },
    etaRight: { flex: 2, paddingLeft: spacing.base },
    etaStatus: {
      fontFamily: fonts.displaySemiBold,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
      color: colors.onSurface,
    },
    /* No border or fill of its own now: GradientGlowBorder paints both, and a
       flat border under the ring reads as a doubled edge. */
    passengerListCard: {
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.base,
      gap: spacing.sm,
    },
    passengerListHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    passengerListTitle: {
      fontFamily: fonts.displaySemiBold,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.3),
      color: colors.onSurface,
    },
    passengerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.xs,
    },
    passengerAvatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surfaceContainerHigh,
      alignItems: 'center',
      justifyContent: 'center',
    },
    passengerInitial: {
      fontFamily: fonts.semiBold,
      fontSize: 13,
      lineHeight: Math.round(13 * 1.3),
      color: colors.onSurface,
    },
    passengerName: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodySmall,
      lineHeight: Math.round(fontSizes.bodySmall * 1.3),
      color: colors.onSurface,
    },
    boardedBadge: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: radii.full,
    },
    boardedText: {
      fontFamily: fonts.semiBold,
      fontSize: 9,
      lineHeight: Math.round(9 * 1.3),
      letterSpacing: 0.3,
    },
    secondaryActions: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    chatBadge: {
      position: 'absolute',
      top: 4,
      right: 10,
      minWidth: 17,
      height: 17,
      borderRadius: 8.5,
      paddingHorizontal: 4,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chatBadgeText: {
      fontFamily: fonts.semiBold,
      fontSize: 10,
      lineHeight: Math.round(10 * 1.4),
    },
    secondaryBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outline,
      paddingVertical: spacing.sm,
    },
    secondaryBtnText: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.caption,
      lineHeight: Math.round(fontSizes.caption * 1.3),
    },
    cancelRow: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    cancelBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.error + '55',
      paddingVertical: spacing.sm,
    },
    // The puck, pin and destination-marker styles moved into DriverTripMap —
    // they were duplicated, with slightly different numbers, in both trip
    // screens, which is why one ride looked like two.
  });
