import React, { useRef, useMemo, useEffect, useCallback, useState } from 'react';
import { formatGhs } from '@eyego/utils';
import {
  View,
  StyleSheet,
  Pressable,
  useWindowDimensions,
  BackHandler,
} from 'react-native';
import MapboxGL from '../../utils/mapbox';
import { useRouter, type Href } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { driverApi, walletApi, heatmapApi, connectDriverSocket, disconnectDriverSocket, getDriverSocket, driverSocketEvents } from '@eyego/api';
import * as Location from 'expo-location';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button, Entrance, GlassSurface, GradientGlowBorder, SkeletonValue, AnnouncementBanner, SheetContent, goDeeper, SmoothDefer, notify } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useDriverStore } from '../../stores/driver.store';
import { useDriverTripStore } from '../../stores/trip.store';
import { useNotificationsStore } from '../../stores/notifications.store';
import { useDriverLocation, beatPresenceNow } from '../../hooks/useDriverLocation';
import { DispatchBlockedBanner, describeDispatchBlock, dispatchBlockTripId } from '../../components/DispatchBlockedBanner';
import { DriverAlertBanner } from '../../components/DriverAlertBanner';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { usePlatformConfig } from '../../hooks/usePlatformConfig';
import { OnlineToggle } from '../../components/OnlineToggle';
import { DestinationModeCard } from '../../components/DestinationModeCard';
import { PendingDispatchList } from '../../components/PendingDispatchList';
import { LiveTripCard } from '../../components/LiveTripCard';
import DemandOverlay from '../../components/DemandOverlay';
import { DriverSheetHost } from '../../components/surface/DriverSheetHost';
import { DispatchOfferStage } from '../../components/surface/DispatchOfferStage';
import { deriveDriverStage, useDriverSurface, type DriverStage } from '../../components/surface/driverStage';
import { DriverSurfaceMap } from '../../components/surface/DriverSurfaceMap';
import { TripStages } from '../../components/surface/TripStages';
import mapStyles from '@eyego/map-styles';
import { setDriverWidgetData } from '../../modules/eyego-driver-widget';

/**
 * How long a dismissed dispatch block stays quiet before it speaks up again.
 *
 * Ten minutes is the compromise between the two ways this banner fails a
 * driver: it is undismissable (the reported bug — a permanent red bar over the
 * board), or it is dismissable forever, which is worse, because the banner is
 * the ONLY thing that explains why an online driver is being offered nothing.
 * A driver who waves it away and then sits idle gets told again before the idle
 * time is expensive.
 */
const BLOCK_DISMISS_TTL_MS = 10 * 60 * 1000;

export default function HomeScreen() {
  const colors = useColors();
  const platformConfig = usePlatformConfig();
  const theme = useDriverStore(s => s.theme);
  // Driver app uses blue highway accent (eyegoDriverDarkStyle) instead of
  // rider's brand-green dark style; light mode's highway accent is already
  // blue for both apps, so it's shared unchanged.
  const mapStyle = theme === 'light' ? mapStyles.eyegoLightStyle : mapStyles.eyegoDriverDarkStyle;
  const insets = useSafeAreaInsets();
  // The map camera is padded by the panel that covers it — see `mapPadding`.
  const { height: windowHeight } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const qc = useQueryClient();
  const driver = useDriverStore(s => s.driver);
  const isOnline = useDriverStore(s => s.isOnline);
  const activeTripId = useDriverStore(s => s.activeTripId);
  const setOnline = useDriverStore(s => s.setOnline);
  const setActiveTripId = useDriverStore(s => s.setActiveTripId);
  const updateDriver = useDriverStore(s => s.updateDriver);
  const mapRef = useRef<any>(null);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  // D14: reconnect retry counter
  const reconnectAttemptsRef = useRef(0);
  // FIX2: single ref for reconnect timer — prevents leaked timers on rapid disconnect/reconnect
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards goDeeper() calls fired from async socket callbacks (e.g. onTripAssigned)
  // against navigating on/after unmount — e.g. driver switches tabs the instant a
  // dispatch offer lands.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const { location, hasPermission } = useDriverLocation({ enabled: true, isOnTrip: false });
  const { isOffline } = useNetworkStatus();
  // The server's own verdict on whether this driver is in the candidate pool,
  // refreshed by the presence heartbeat. See the banner below.
  const dispatchStatus = useDriverStore((s) => s.dispatchStatus);
  const [showHeatmap, setShowHeatmap] = useState(false);
  /** In flight for the blocked banner's "Check now". Drives its spinner. */
  const [checkingDispatch, setCheckingDispatch] = useState(false);
  /**
   * The block the driver has waved away, as `reason` + when they did it.
   *
   * BUGFIX ("you cannot even dismiss that toast").
   *
   * Kept as the REASON rather than a bare boolean so that dismissing "dispatch
   * cannot see you" cannot also hide a later, different problem — an expired
   * document or an unfinished trip must still get through. Kept with a
   * timestamp rather than forever because this banner is the only thing telling
   * a driver why they are earning nothing; permanently silenceable is how a
   * driver sits offline all afternoon wondering where the work is.
   */
  const [dismissedBlock, setDismissedBlock] = useState<{ reason: string; at: number } | null>(null);

  /**
   * A dismissal covers THIS problem, for a while — not every problem, forever.
   *
   * It lapses after ten minutes so a driver who waved it away and then sat
   * earning nothing is told again, and it is keyed on the reason so a different
   * block re-announces itself immediately. `nowTick` is what re-evaluates the
   * ten minutes without a dedicated timer: the board already ticks once a
   * second for the offer countdowns.
   */
  const blockDismissed =
    dismissedBlock != null &&
    dismissedBlock.reason === (dispatchStatus?.reason ?? '') &&
    Date.now() - dismissedBlock.at < BLOCK_DISMISS_TTL_MS;

  /**
   * ── THE HOME SURFACE'S STAGE ────────────────────────────────────────────
   *
   * DERIVED, never stored — see `deriveDriverStage`. The only stored thing is
   * which row the driver tapped; whether that counts as an offer is decided by
   * the trip store, which is the one place that knows about held offers,
   * revokes and expiry.
   *
   * `previousStage` exists only so the sheet host can crossfade the outgoing
   * body against the incoming one. A ref rather than state: writing it must not
   * itself cause a render, or the crossfade would re-trigger on its own output.
   */
  const focusedTripId = useDriverSurface((s) => s.focusedTripId);
  const openOffer = useDriverSurface((s) => s.openOffer);
  const closeOffer = useDriverSurface((s) => s.closeOffer);
  const heldOffer = useDriverTripStore((s) => s.offer);
  const pendingRequests = useDriverTripStore((s) => s.pendingRequests);

  /**
   * Is the focused ride still something to decide on?
   *
   * True while it is either the driver's own live exclusive offer, or a row
   * still on the board. When it stops being both — taken, cancelled, passed —
   * the stage falls back to idle on its own rather than stranding the driver on
   * a panel about a ride that no longer exists.
   */
  const focusedOfferable = useMemo(() => {
    if (!focusedTripId) return false;
    if (heldOffer?.tripId === focusedTripId) return true;
    return pendingRequests.some((r) => r.tripId === focusedTripId);
  }, [focusedTripId, heldOffer?.tripId, pendingRequests]);

  const surfaceStage = deriveDriverStage(focusedTripId, focusedOfferable);
  const stageRef = useRef<DriverStage>(surfaceStage);
  const previousStage = stageRef.current === surfaceStage ? null : stageRef.current;
  useEffect(() => {
    stageRef.current = surfaceStage;
  }, [surfaceStage]);

  // A selection that outlived its ride is cleared, so the store cannot keep a
  // dangling id alive across the next offer.
  useEffect(() => {
    if (focusedTripId && !focusedOfferable) closeOffer();
  }, [focusedTripId, focusedOfferable, closeOffer]);

  /**
   * ── ANDROID'S HARDWARE BACK, WHICH THE STAGES BROKE ────────────────────────
   *
   * The offer and the driving stages are NOT routes — that is the whole point
   * of the surface, and it is why nothing lags when one opens. But the system
   * back button only knows about routes, so on Android it walked straight past
   * an open offer to the navigator underneath: the driver pressed back and left
   * the tab, or the app, with the stage still showing behind them. iOS has no
   * hardware back, so this was invisible on the device most of this work was
   * checked against. The rider app has handled its own stages this way for a
   * long time (see trip.tsx, SearchStage, SelectStage); the driver never needed
   * to until now.
   *
   *   offer    → back closes it and returns to the board, which is what a
   *              driver means by "not this one".
   *   driving  → back is SWALLOWED. A trip in progress is not something to
   *              accidentally exit, and there is nowhere to go: the surface is
   *              home. Returning true stops the event without doing anything.
   *   idle     → not handled, so the system does its normal thing (leave the
   *              app), which is correct on a home tab.
   */
  useEffect(() => {
    if (surfaceStage === 'idle') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (surfaceStage === 'offer') {
        closeOffer();
        return true;
      }
      return true;
    });
    return () => sub.remove();
  }, [surfaceStage, closeOffer]);

  /**
   * IS THERE WORK ON THE BOARD RIGHT NOW?
   *
   * Read straight from the trip store, which is the single place every
   * delivery path lands: the `trip:event` socket frame, the two-second REST
   * safety net in `_layout`, and the foreground resync. The board below shows
   * itself only when the answer is yes.
   *
   * ── WHAT WAS HERE BEFORE, AND WHY IT IS GONE ─────────────────────────────
   * A 20-second `getPendingTripRequests` poll that AUTO-NAVIGATED to
   * `/(trip)/dispatch/<id>` for the first request it had not seen. Three
   * problems, and the first is the one the driver felt:
   *
   *   - It hijacked the screen. A driver looking at the map, the heatmap or
   *     their earnings was thrown onto a full-screen offer for a ride that in
   *     most cases was not even exclusively theirs — and `seenDispatchIdsRef`
   *     meant a ride they backed out of could never bring them there again.
   *   - It was a SECOND dispatch client, with its own endpoint, its own cadence
   *     and its own idea of what a pending request is, sitting beside the store
   *     that already holds exactly this list. The two could and did disagree.
   *   - At 20 seconds against a 45-second offer window it was also the slowest
   *     of the three paths, which is the "it takes a while before that card
   *     loads up" half of the report. The store's poll is two seconds.
   *
   * The offer sheet still takes over the screen for an offer genuinely held for
   * this driver, which is the one case that has earned an interruption.
   */
  const pendingDispatchCount = useDriverTripStore((s) => s.pendingRequests.length);
  const hasPendingDispatch = pendingDispatchCount > 0;

  /** Trip ids the legacy `trip:assigned` socket event has already navigated for. */
  const seenAssignedIdsRef = useRef<Set<string>>(new Set());

  const { data: walletData, isPending: walletPending } = useQuery({
    queryKey: ['driver', 'me'],
    queryFn: () => driverApi.getMe(),
    select: (r) => {
      const d = (r.data as any).data?.driver ?? (r.data as any).data;
      // Show the spendable wallet balance (matches earnings screen), not lifetime totalEarned.
      return { balancePesewas: d?.walletBalancePesewas ?? d?.totalEarned ?? 0 };
    },
    staleTime: 30_000,
  });

  const { data: txData, isPending: txPending } = useQuery({
    queryKey: ['driver', 'wallet', 'transactions'],
    // Driver ledger lives at /driver/wallet/transactions and returns { transactions }.
    queryFn: () => driverApi.getWalletTransactions({ limit: 50 }),
    select: (r) => (r.data as any)?.data?.transactions ?? (r.data as any)?.data?.items ?? [],
  });

  // Driver earnings credit types (see earnings.tsx). Filtering only 'CREDIT' showed 0.
  const CREDIT_TYPES = ['CREDIT', 'TRIP_EARNING', 'EARNINGS_CREDIT', 'QUEST_BONUS'];

  const todayEarnings = useMemo(() => {
    if (!txData) return 0;
    const today = new Date().toDateString();
    return (txData as any[])
      .filter((t: any) => CREDIT_TYPES.includes(t.type) && new Date(t.createdAt).toDateString() === today)
      .reduce((sum: number, t: any) => sum + (t.amount ?? 0), 0);
  }, [txData]);

  const todayTrips = useMemo(() => {
    if (!txData) return 0;
    const today = new Date().toDateString();
    const tripIds = new Set(
      (txData as any[])
        .filter((t: any) => CREDIT_TYPES.includes(t.type) && t.tripId && new Date(t.createdAt).toDateString() === today)
        .map((t: any) => t.tripId)
    );
    return tripIds.size;
  }, [txData]);

  /**
   * ── FEED THE HOME-SCREEN WIDGET ─────────────────────────────────────────────
   *
   * The widget lives in another process and is woken by the launcher, usually
   * when this app is not running. It can never ask for anything — it can only
   * read what the app last left in SharedPreferences. So this pushes the same
   * numbers the driver is looking at right here, whenever they change.
   *
   * Strings, not numbers: `formatGhs` is the one definition of what money looks
   * like in this product, and re-implementing it in Kotlin is how the widget
   * and the app come to disagree about a symbol or a rounding rule.
   *
   * A no-op on iOS and on any build without the native module — see the guards
   * in `modules/eyego-driver-widget`. It is a convenience, and it must never be
   * the reason a driver's home screen fails.
   */
  useEffect(() => {
    setDriverWidgetData({
      earningsLabel: formatGhs(todayEarnings),
      tripsLabel: todayTrips === 1 ? '1 trip today' : `${todayTrips} trips today`,
      questLabel: '',
      online: isOnline,
    });
  }, [todayEarnings, todayTrips, isOnline]);

  const { data: heatmapData } = useQuery({
    queryKey: ['driver', 'heatmap', location?.latitude, location?.longitude],
    // BUGFIX: previously queried demand around a fixed Accra center whenever
    // the driver's own location wasn't known yet, silently showing "nearby"
    // demand cells that weren't actually near the driver. Gated on a real
    // location below instead of guessing one.
    queryFn: () => heatmapApi.getDemand(location!.latitude, location!.longitude, 5),
    select: (r) => r.data.data?.cells ?? [],
    refetchInterval: showHeatmap ? 60000 : false, // ~60s poll
    /**
     * NOT gated on `isOnline`.
     *
     * "Where is the work right now" is the question a driver asks BEFORE
     * deciding to go online. Requiring them to be online first meant an offline
     * driver tapped the flame and nothing happened — no cells, no error, no
     * explanation — which is indistinguishable from a broken feature and is
     * half of "the heatmap is half baked". The endpoint only needs a driver
     * token, not a driver in the pool.
     */
    enabled: showHeatmap && !!location,
  });

  const { data: activeTripData } = useQuery({
    queryKey: ['driver', 'activeTrip'],
    queryFn: () => driverApi.getActiveTrip(),
    select: (r) => r.data.data?.trip ?? null,
    refetchInterval: isOnline ? 10000 : false,
  });

  useEffect(() => {
    if (activeTripData?.id) {
      setActiveTripId(activeTripData.id);
    }
  }, [activeTripData, setActiveTripId]);

  // D17: cleanup map ref on unmount
  useEffect(() => {
    return () => {
      mapRef.current = null;
    };
  }, []);

  // FIX2: final safety net — clear reconnect timer if component unmounts while one is pending
  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, []);

  // Manage driver socket lifecycle — connect when online, disconnect when offline.
  // Ref-counted so the active-trip screen can also hold a connection simultaneously.
  useEffect(() => {
    if (!isOnline) return;
    reconnectAttemptsRef.current = 0;
    connectDriverSocket();
    // Surfaces the server's Ghana-geofence rejection instead of leaving the
    // driver silently invisible to dispatch with no indication why — only
    // alert once per online session so it doesn't spam on every ~3s update.
    let warnedLocationRejected = false;
    const cleanLocationRejected = driverSocketEvents.onLocationRejected((data) => {
      if (warnedLocationRejected) return;
      warnedLocationRejected = true;
      notify('Location outside service area', data.message);
    });
    const cleanDispatch = driverSocketEvents.onTripAssigned((data) => {
      // BUSY-DRIVER GUARD (client half of services/driver-availability.js). The
      // REST poll above is already gated on !activeTripId, but the socket path
      // wasn't — so a driver running their own created trip still got yanked
      // onto the dispatch screen for an unrelated rider. Read the store live
      // rather than closing over `activeTripId`, since this effect only
      // re-subscribes on isOnline changes.
      if (useDriverStore.getState().activeTripId) return;
      /*
       * ONE OFFER ON SCREEN AT A TIME.
       *
       * There are two dispatch paths into this app and they do not know about
       * each other: the sequential cascade, which publishes an OFFER over
       * `trip:event` and is rendered by the root-mounted DispatchOfferSheet,
       * and this older `trip:assigned` socket event, which NAVIGATES to the
       * dispatch screen. Nothing stopped both from happening, and a driver
       * holding a live cascade offer who was then pushed onto the legacy screen
       * would have had the sheet's Accept covered by a different screen's
       * Accept — two countdowns, two endpoints, one driver.
       *
       * The cascade holds an exclusive offer with a server deadline, so it
       * wins: this path stands down while one is live. (Today they cannot
       * actually collide — nothing creates TripRequests any more — but the two
       * systems are still both wired, and a latent double-offer is exactly the
       * bug the sequential cascade exists to prevent.)
       */
      if (useDriverTripStore.getState().offer) return;
      // Once per trip id. The dedupe set used to be shared with the 20-second
      // REST poll that also lived on this screen; that poll is gone (see
      // `hasPendingDispatch` above), so this owns it now.
      if (seenAssignedIdsRef.current.has(data.tripId)) return;
      seenAssignedIdsRef.current.add(data.tripId);
      useNotificationsStore.getState().addNotification({
        type: 'TRIP_ASSIGNED',
        title: data.kind === 'REQUEST' ? 'New ride request nearby' : 'New trip assigned',
        body: data.routeDestination ? `To ${data.routeDestination}` : '',
        tripId: data.tripId,
      });
      if (!isMountedRef.current) return; // home screen unmounted (e.g. driver switched tabs) — don't navigate
      goDeeper({
        pathname: '/(trip)/dispatch/[id]',
        params: {
          id: data.tripId,
          kind: data.kind,
          origin: data.routeOrigin,
          destination: data.routeDestination,
          departureTime: data.departureTime,
          expiresAt: data.expiresAt,
          // The server sends `estimatedEarningsPesewas` (admin.controller.js).
          // This read `data.estimatedEarnings`, a field that has never been on
          // the payload, so it was always undefined and the earnings card on
          // the dispatch screen never rendered — a driver being offered a trip
          // could not see what it paid, which is the one fact they decide on.
          estimatedEarnings:
            data.estimatedEarningsPesewas != null ? String(data.estimatedEarningsPesewas) : undefined,
        },
      } as any);
    });
    /**
     * RECONNECT FAST, AND KEEP TRYING.
     *
     * BUGFIX — "the time for it to reconnect if the dispatch can't see you
     * should be faster."
     *
     * The old curve was `3000 × 2^(n-1)`, capped at 60 s, and it gave up after
     * five attempts. In wall-clock terms a driver who lost the socket waited
     * 3 s, then 6, then 12, then 24, then 48 — a minute and a half of silence
     * before the app stopped trying altogether and left them online, invisible
     * to dispatch, with no further attempt for the rest of the session. That is
     * the single most expensive state this app has, and it was the one we backed
     * off out of.
     *
     * Now: 700 ms, then ×1.7 to a 10 s ceiling, and it never stops while the
     * driver is online. A tunnel or a lift is measured in seconds, so the first
     * few retries — the ones that actually recover a real-world dropout — all
     * land inside three seconds. The ceiling keeps a genuinely dead network from
     * spinning the radio flat, and the attempt counter now only shapes the
     * curve rather than terminating it: a driver who is online wants to be
     * reachable, indefinitely, and that is the whole job.
     */
    const cleanDisconnect = driverSocketEvents.onDisconnect(() => {
      if (useDriverStore.getState().isOnline) {
        reconnectAttemptsRef.current += 1;
        // FIX2: clear any pending reconnect before scheduling a new one
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        const delay = Math.min(700 * Math.pow(1.7, reconnectAttemptsRef.current - 1), 10000);
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          if (useDriverStore.getState().isOnline) {
            // Reconnect the existing instance — connectDriverSocket() would bump
            // the refcount without a paired disconnect and leak the ref.
            getDriverSocket().connect();
          }
        }, delay);
      }
    });
    return () => {
      cleanDispatch();
      cleanDisconnect();
      cleanLocationRejected();
      // FIX2: cancel any pending reconnect timer on cleanup
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      disconnectDriverSocket();
    };
  }, [isOnline, router]);

  const goOnline = useMutation({
    mutationFn: async () => {
      // D4/S21: refetch wallet/profile so the go-online gate checks a FRESH
      // balance, not a stale cache (a driver could otherwise go online below
      // the minimum). await the refetch before proceeding.
      await qc.invalidateQueries({ queryKey: ['driver', 'me'] });
      let coords = location;
      if (!coords) {
        try {
          const last = await Location.getLastKnownPositionAsync();
          if (last) coords = { latitude: last.coords.latitude, longitude: last.coords.longitude };
        } catch { /* no last-known position — proceed without coords */ }
      }
      return driverApi.goOnline(coords ? { lat: coords.latitude, lng: coords.longitude } : {});
    },
    onSuccess: () => {
      setOnline(true);
      setOnlineError(null);
      qc.invalidateQueries({ queryKey: ['driver'] });
      // DC3: re-fetch active trip state from server when going online
      qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
    },
    onError: (err: any) => {
      const status = err?.response?.status;
      const msg: string = err?.response?.data?.message ?? (err as Error).message ?? 'Could not go online';
      if (status === 403 || msg.toLowerCase().includes('approv') || msg.toLowerCase().includes('pending')) {
        setOnlineError('pending_review');
      } else if (msg.toLowerCase().includes('wallet') || msg.toLowerCase().includes('balance')) {
        setOnlineError('wallet');
      } else {
        setOnlineError(msg);
      }
    },
  });

  const goOffline = useMutation({
    mutationFn: () => driverApi.goOffline(),
    onSuccess: () => {
      setOnline(false);
      // DC3: only clear stale active trip if no trip is currently in progress
      const currentTripId = useDriverStore.getState().activeTripId;
      if (!currentTripId) {
        setActiveTripId(null); // no active trip, safe to clear
      }
      // If there IS an active trip, keep it — connectivity blips shouldn't lose the trip
      qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
    },
    onError: (err: any) => {
      // Don't flip local state — driver stays ONLINE so backend/store remain in sync.
      // Surface the failure so the driver knows the toggle didn't take effect.
      const msg: string = err?.response?.data?.message ?? (err as Error).message ?? 'Could not go offline. Please try again.';
      setOnlineError(msg);
    },
  });

  // Dev-only: activates a PENDING_REVIEW account then immediately retries go-online
  const devActivate = useMutation({
    mutationFn: () => driverApi.devActivate(),
    onSuccess: () => {
      updateDriver({ status: 'ACTIVE', isActive: true });
      setOnlineError(null);
      goOnline.mutate();
    },
    onError: () => notify('Activation Failed', 'Could not activate account. Is the server running?'),
  });

  /**
   * Un-pausing, from the banner.
   *
   * `REQUESTS_PAUSED` is the one blocked reason whose fix lives entirely on the
   * server and nowhere on this screen — the toggle for it is two taps away
   * under Profile. A banner that says "resume them" and leaves the driver to
   * find the switch is the same failure as the faint banner it replaced.
   */
  const resumeRequests = useMutation({
    mutationFn: () => driverApi.setRequestsPaused(false),
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      qc.invalidateQueries({ queryKey: ['driver'] });
      void beatPresenceNow().catch(() => {});
    },
    onError: () => notify('Could not resume', 'Try the switch under Profile → Settings.'),
  });

  /** What the blocked banner's button should do, per the server's reason code. */
  const dispatchBlockAction = useMemo(() => {
    if (!dispatchStatus || dispatchStatus.dispatchable) return null;
    switch (describeDispatchBlock(dispatchStatus.reason).action) {
      case 'DOCUMENTS':
        return { label: 'Finish my documents', onPress: () => goDeeper('/(profile)/documents' as Href) };
      case 'GO_ONLINE':
        return { label: 'Re-register me now', onPress: () => goOnline.mutate() };
      case 'RESUME':
        return { label: 'Resume requests', onPress: () => resumeRequests.mutate() };
      case 'ACTIVE_TRIP': {
        /**
         * THE TRIP THE SERVER NAMED, NOT THE ONE THIS PHONE REMEMBERS.
         *
         * BUGFIX ("when I mark as no-show, the toast shows as unfinished ride,
         * and when I open it, it shows the blank manage trip page with the
         * cancelled thing"). This read `activeTripId` — a persisted local value
         * that survives the trip it points at — so the button under a
         * server-generated reason opened whatever this install last wrote,
         * which after a no-show is the trip that was just killed.
         *
         * The reason string carries the id; see `dispatchBlockTripId`. Falling
         * back to `activeTripId` would reintroduce exactly the bug, so an
         * unparseable reason offers a refresh instead of a guess.
         */
        const blockingTripId = dispatchBlockTripId(dispatchStatus.reason);
        return blockingTripId
          ? {
              label: 'Open my trip',
              onPress: () =>
                goDeeper({ pathname: '/(trip)/active/[id]', params: { id: blockingTripId } } as Href),
            }
          : { label: 'Refresh', onPress: () => void beatPresenceNow().catch(() => {}) };
      }
      case 'SIGN_OUT':
        return { label: 'Sign out', onPress: () => goDeeper('/(profile)/settings' as Href) };
      default:
        /**
         * CHECK NOW HAS TO ANSWER, EVEN WHEN THE ANSWER IS "STILL NO".
         *
         * BUGFIX ("when you click on check now, nothing happens").
         *
         * The old body fired `beatPresenceNow()` un-awaited, swallowed every
         * outcome, and invalidated the `['driver']` QUERY — which is not where
         * this banner reads from. `dispatchStatus` lives in the zustand store,
         * so the invalidation could not have refreshed it even if the beat had
         * worked. And the beat frequently could not work: it returns early
         * without a GPS fix, which is the very condition the banner names.
         *
         * Three outcomes, three different things the driver sees:
         *   cleared  — the banner disappears. That IS the feedback; a dialogue
         *              on top of it would just be noise.
         *   still no — the banner stays, but `checkedAt` has moved, so it now
         *              reads "Checked just now". The driver can tell it ran.
         *   failed   — a real sentence, because nothing on screen would change
         *              otherwise and that is the case being reported.
         */
        return {
          label: 'Check now',
          onPress: async () => {
            setCheckingDispatch(true);
            try {
              const beat = await beatPresenceNow();
              qc.invalidateQueries({ queryKey: ['driver'] });
              if (beat.ok && beat.dispatchable) {
                void Haptics.notificationAsync(
                  Haptics.NotificationFeedbackType.Success,
                ).catch(() => {});
                return;
              }
              void Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Warning,
              ).catch(() => {});
              if (beat.failure === 'NO_FIX') {
                notify(
                  'Still waiting for your location',
                  'Dispatch needs a GPS fix before it can put you back in the pool. Check that Location is set to Always and that you are not indoors.',
                );
              } else if (beat.failure === 'NETWORK' || beat.failure === 'BAD_RESPONSE') {
                notify(
                  'Could not reach dispatch',
                  'Your connection dropped mid-check. Try again in a moment.',
                );
              }
              // `ok && !dispatchable` deliberately says nothing: the banner
              // itself now shows when it was last checked.
            } finally {
              setCheckingDispatch(false);
            }
          },
        };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatchStatus?.reason, dispatchStatus?.dispatchable, activeTripId, router, qc]);

  const handleToggleOnline = useCallback(async () => {
    if (isOnline) {
      goOffline.mutate();
      return;
    }
    // Guard: platform-wide maintenance window. The server refuses go-online with
    // 503 DRIVER_ONLINE_DISABLED (middleware/killSwitch.js) — this only says so
    // before the round trip, and deliberately never blocks going OFFLINE.
    if (!platformConfig.driverOnlineEnabled) {
      notify(
        'Temporarily Unavailable',
        'Going online is paused while EyeGo is under maintenance. Please try again shortly.'
      );
      return;
    }
    // Guard: negative wallet balance = account suspended
    const walletBalancePesewas = walletData?.balancePesewas ?? 0;
    if (walletBalancePesewas < 0) {
      notify(
        'Account Suspended',
        `Account suspended — ${formatGhs(Math.abs(walletBalancePesewas))} outstanding. Top up your wallet to go back online.`
      );
      return;
    }
    // Guard: location permission must be granted before going online
    if (!hasPermission) {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        notify(
          'Location Required',
          'EyeGo needs your location to go online and accept trips. Please enable location access in your device settings.');
        return;
      }
    }
    goOnline.mutate();
  }, [isOnline, hasPermission, location, walletData, goOnline, goOffline, platformConfig.driverOnlineEnabled]);

  const initialCenter: [number, number] = useMemo(
    () => (location ? [location.longitude, location.latitude] : [-0.187, 5.6037]),
    [location?.latitude, location?.longitude]
  );
  const initialZoom = location ? 14 : 13;

  /**
   * CENTRE ON THE VISIBLE MAP, NOT ON THE MAP.
   *
   * BUGFIX ("the driver's current location defaults to sitting UNDER the home
   * card — the only way to see it is to manually adjust the map").
   *
   * The camera had no `padding`, so `centerCoordinate` put the driver in the
   * middle of the MapView — and the MapView is full-bleed while the bottom 56%
   * of it is covered by the panel below (`snapPointsPct[0]`). The puck was
   * therefore centred inside the panel, every launch, with nothing on screen to
   * explain why the driver could not find themselves.
   *
   * The camera's padding is what tells it which part of the surface is actually
   * being looked at. Derived from the SAME constant the panel rests on, so the
   * two cannot drift; the tab bar is already inside that fraction.
   *
   * Note the key shape: a declarative `<Camera padding>` takes
   * `paddingTop/paddingBottom/…`, NOT the `top/right/bottom/left` that
   * `fitBounds` takes. Mixing them silently drops all padding.
   */
  const PANEL_REST_FRACTION = 0.56;
  const mapPadding = useMemo(
    () => ({
      paddingTop: insets.top + 8,
      paddingBottom: Math.round(windowHeight * PANEL_REST_FRACTION),
      paddingLeft: 0,
      paddingRight: 0,
    }),
    [insets.top, windowHeight],
  );

  const cameraRef = useRef<any>(null);
  /**
   * ── THE OFFER FRAMES THE APPROACH, NOT THE RIDE ─────────────────────────
   *
   * BUGFIX ("when the dispatch page appears, the map should be showing heading
   * to the pickup point and not the destination cuz the driver doesn't need to
   * know... all they need to know is how long it is from where they are").
   *
   * Driver + PICKUP only. The drop-off is deliberately absent from this frame:
   * on a long ride it dominates the box, shrinking the pickup to a dot and
   * hiding the one leg the driver is being asked to judge in 45 seconds. It is
   * also gated for its own sake until the ride starts — the same rule
   * `revealDropoff` enforces on the offer map, here expressed as a camera.
   *
   * ── WHY THERE ARE NO CAMERA EFFECTS ON THIS SCREEN ANY MORE ──────────────
   *
   * There used to be two: a follow-me `setCamera` keyed on a rounded GPS fix,
   * and a `fitBounds` for the offer, each with its own padding arithmetic and
   * a guard so they did not fight each other. Both are gone. `DriverTripMap`
   * runs the ONE frame loop (`useMapCamera`), it pads itself against the
   * sheet's live top edge rather than a guessed fraction, and it releases the
   * camera to `free` when the driver pans — none of which the hand-written
   * pair did. This screen now only says WHAT to frame, never how.
   */
  const focusedPickup = useMemo(() => {
    if (surfaceStage !== 'offer' || !focusedTripId) return null;
    if (heldOffer?.tripId === focusedTripId) {
      const la = (heldOffer as any).pickupLat;
      const ln = (heldOffer as any).pickupLng;
      return Number.isFinite(la) && Number.isFinite(ln) ? { lat: la as number, lng: ln as number } : null;
    }
    const row = pendingRequests.find((r) => r.tripId === focusedTripId);
    return row && Number.isFinite(row.pickupLat) && Number.isFinite(row.pickupLng)
      ? { lat: row.pickupLat as number, lng: row.pickupLng as number }
      : null;
  }, [surfaceStage, focusedTripId, heldOffer, pendingRequests]);

  /**
   * The pair the camera must hold while an offer is open: where the driver is,
   * and where the pickup is. `useMapCamera` refuses a degenerate box on its own
   * (a collapsed pair is the MLRNCamera crash, not NaN), so a driver standing
   * on the pickup needs no special case here.
   */
  const approachFit = useMemo(() => {
    if (surfaceStage !== 'offer' || !focusedPickup) return null;
    const pickup: [number, number] = [focusedPickup.lng, focusedPickup.lat];
    if (!location) return [pickup];
    return [[location.longitude, location.latitude] as [number, number], pickup];
  }, [surfaceStage, focusedPickup, location]);

  /**
   * The legs the map draws for the CURRENT stage.
   *
   * On `offer` the drop-off is deliberately null — the gate above. Once the
   * trip is live the real coordinates come from the trip itself, and the map's
   * own status logic picks which leg to frame.
   */
  const stagePickup = useMemo(() => {
    if (surfaceStage === 'offer' && focusedPickup) {
      return [focusedPickup.lng, focusedPickup.lat] as [number, number];
    }
    const t: any = activeTripData;
    const la = t?.pickupLat ?? t?.route?.originLat;
    const ln = t?.pickupLng ?? t?.route?.originLng;
    return Number.isFinite(la) && Number.isFinite(ln) ? ([ln, la] as [number, number]) : null;
  }, [surfaceStage, focusedPickup, activeTripData]);

  const stageDropoff = useMemo(() => {
    // Never during an offer. See the gate above.
    if (surfaceStage === 'offer' || surfaceStage === 'idle') return null;
    const t: any = activeTripData;
    const la = t?.dropoffLat ?? t?.route?.destLat;
    const ln = t?.dropoffLng ?? t?.route?.destLng;
    return Number.isFinite(la) && Number.isFinite(ln) ? ([ln, la] as [number, number]) : null;
  }, [surfaceStage, activeTripData]);


  return (
    <View style={styles.container}>
      {/* MAP — full-bleed, mirrors the rider app's map screens (ride/[id].tsx,
          tracking.tsx) instead of a boxed card. AppBackground (mounted in
          _layout.tsx) only shows through the loading/error veil now. */}
      {/* THE MAP ARRIVES A BEAT AFTER THE TAB DOES.
          A MapLibre GL surface is the most expensive node either app mounts, and
          the driver's home tab mounts it on every cold start and every return
          from a trip. `SmoothDefer` lets the tab paint its panel and header
          first; the map fills in behind them. See packages/ui/src/motion/smooth. */}
      <SmoothDefer
        delayMs={140}
        placeholder={<View style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.backgroundDeep }]} />}
      >
      {/*
        ── ONE MAP, THE WHOLE SHIFT ──────────────────────────────────────────
        This was a bare `MapboxGL.MapView` with its own `Camera` and two hand-
        written framing effects. It is now `DriverSurfaceMap`, which wraps the
        SAME `DriverTripMap` the trip screens use, so accepting a ride no longer
        tears a GL surface down and builds another one while the driver is
        pulling into traffic.

        The camera effects that used to live on this screen are gone with it:
        `useMapCamera` inside DriverTripMap owns the only frame loop, pads
        itself against the sheet's published top edge, and releases to `free`
        when the driver pans. Three things this screen used to get wrong.
      */}
      <DriverSurfaceMap
        stage={surfaceStage}
        trip={activeTripData ? { id: activeTripData.id, status: activeTripData.status } : null}
        pickup={stagePickup}
        dropoff={stageDropoff}
        location={location}
        puckColor={isOnline ? colors.online : colors.offline}
        fitOverride={approachFit}
        styleURL={mapStyle}
      >
        {location && (
          <MapboxGL.MarkerView coordinate={[location.longitude, location.latitude]}>
            <View style={[styles.driverMarker, { backgroundColor: isOnline ? colors.online : colors.offline }]}>
              <Ionicons name="car" size={16} color="#fff" />
            </View>
          </MapboxGL.MarkerView>
        )}

        {/*
          Demand heat map — real ground, not screen-space blobs. See DemandOverlay.

          NOT gated on `isOnline` any more. "Where is the work right now" is the
          question a driver asks BEFORE deciding to go online, and hiding the
          answer until they already have is the wrong way round — it made the
          flame toggle appear broken to an offline driver, which is half of
          "the heatmap is half baked".
        */}
        <DemandOverlay
          cells={heatmapData ?? []}
          primaryColor={colors.primary}
          visible={showHeatmap}
        />
      </DriverSurfaceMap>
      </SmoothDefer>

      {/* Header overlay — glass */}
      <Entrance animation="slideUp" delay={100} style={[styles.header, { top: insets.top + 12 }]}>
        <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii['2xl']} />
        <View>
          <Text style={styles.headerLogo}>EyeGo</Text>
          {!!driver?.name && (
            <Text variant="caption" color={colors.onSurfaceVariant}>
              {driver.name.split(' ')[0]}
            </Text>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          {/*
            THE FLAME IS ALWAYS THERE, AND IT ALWAYS ANSWERS.

            It used to render only while online — see the note on the query's
            `enabled`; the driver most in need of knowing where the work is, is
            the one deciding whether to start. And a toggle that silently draws
            nothing when there is no demand is a toggle the driver concludes is
            broken, so turning it ON with an empty result says so out loud.
          */}
          <Pressable
            onPress={() => {
              const next = !showHeatmap;
              setShowHeatmap(next);
              void Haptics.selectionAsync().catch(() => {});
              if (next && (heatmapData?.length ?? 0) === 0) {
                notify(
                  'No demand nearby yet',
                  'Nobody has requested a ride within 5 km in the last day. The map updates every minute.',
                  { tone: 'info' },
                );
              }
            }}
            style={{
              width: 36, height: 36,
              borderRadius: 18,
              backgroundColor: showHeatmap ? `${colors.primary}22` : 'transparent',
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 1, borderColor: showHeatmap ? colors.primary : colors.outline,
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ selected: showHeatmap }}
            accessibilityLabel="Show where demand is high"
          >
            <Ionicons name={showHeatmap ? 'flame' : 'flame-outline'} size={16} color={showHeatmap ? colors.primary : colors.onSurfaceVariant} />
          </Pressable>
          <OnlineToggle
            isOnline={isOnline}
            loading={goOnline.isPending || goOffline.isPending}
            onToggle={handleToggleOnline}
          />
        </View>
      </Entrance>

      {/*
        ── THE STATUS COLUMN ──────────────────────────────────────────────────

        BUGFIX — "the toast notification thing isn't fixed, it's still showing
        the old thing", and "when the toast notification comes up it takes a
        while to go".

        Every banner on this screen used to position itself absolutely and work
        out its own `top` by adding up guessed heights for whatever might be
        above it — `insets.top + 64 + (onlineError ? 48 : 0) + (isOffline ? 40 :
        0) + (announcement ? 64 : 0)`. Four sources of truth for one column, each
        one wrong the moment a banner wrapped to a second line, which is exactly
        how they ended up on top of each other.

        One absolutely-positioned column with a gap. Layout does the arithmetic,
        the order is the order of the JSX, and adding a fifth banner costs
        nothing. See DriverAlertBanner for why the two hand-rolled pills that
        used to live here are gone.
      */}
      <View style={[styles.bannerColumn, { top: insets.top + 64 }]} pointerEvents="box-none">
        {!!onlineError && (
          <DriverAlertBanner
            tone={onlineError === 'pending_review' ? 'warn' : 'error'}
            icon={onlineError === 'pending_review' ? 'time' : 'warning'}
            title={
              onlineError === 'pending_review'
                ? 'Your account is still being reviewed'
                : onlineError === 'wallet'
                  ? 'We could not read your wallet'
                  : 'You could not be brought online'
            }
            detail={
              onlineError === 'pending_review'
                ? 'You cannot take trips until an operator approves you. We will notify you the moment that happens.'
                : onlineError === 'wallet'
                  ? 'Check your balance — a negative wallet blocks new trips.'
                  : onlineError
            }
            /* Transient: it describes an attempt that failed, not a state the
               driver is in. Nine seconds is long enough to read two lines. */
            autoDismissMs={9000}
            onDismiss={() => setOnlineError(null)}
            action={
              onlineError === 'pending_review'
                ? __DEV__
                  ? { label: devActivate.isPending ? 'Activating…' : 'Activate account (dev)', onPress: () => devActivate.mutate() }
                  : { label: 'Open my documents', onPress: () => goDeeper('/(profile)/documents' as any) }
                : onlineError === 'wallet'
                  ? { label: 'Open my wallet', onPress: () => goDeeper('/(tabs)/earnings' as any) }
                  : { label: 'Try going online again', onPress: () => { setOnlineError(null); goOnline.mutate(); } }
            }
            busy={devActivate.isPending || goOnline.isPending}
          />
        )}

        {/*
          THE OFFLINE BANNER MOVED OUT OF THIS SCREEN.

          It was right here, and that was the bug: a driver who lost signal on
          Earnings, Alerts, Quests or mid-trip was told nothing, because the only
          surface that could tell them was mounted on Home. `NoticeHost` at the
          root layout covers every screen in both apps, and `NetworkReporter`
          feeds it. See packages/ui/src/notify/notice.ts.
        */}

      {/*
        The operator's announcement banner.

        `APP_ANNOUNCEMENT_TEXT` is set from the admin console and reaches the
        phone through `GET /v1/config/public` on foreground — no store release.
        Just another child of the status column: it stacks under whatever is
        already showing because it comes after it in the JSX, which is the whole
        point of the column replacing the hand-summed offsets.
      */}
      {platformConfig.announcement ? (
        <Entrance
          animation="slideUp"
        >
          <AnnouncementBanner
            text={platformConfig.announcement.text}
            level={platformConfig.announcement.level}
            surfaceColor={colors.surfaceContainer}
          />
        </Entrance>
      ) : null}

      {/*
        WHY NO REQUESTS ARE ARRIVING.

        "I'm online and live and nothing shows on the driver side" has been
        reported across several sweeps, and every time the server knew the
        answer and the driver did not: `explainIneligible` names the exact
        condition that removed them from the candidate list, and until now it
        only ever reached a log line. The presence heartbeat gets that verdict
        back on every beat (see useDriverLocation.beatPresenceOverHttp), so the
        driver can now read it.

        Only shown when the driver believes they are working — an offline
        driver getting no offers is not a fault — and never before the first
        beat has answered, so a cold start does not flash a warning.
      */}
      {isOnline && dispatchStatus && !dispatchStatus.dispatchable && !blockDismissed && (
        /* No `top`: it is the last child of the column above and layout places
           it. See DispatchBlockedBannerProps for why the hand-summed offset
           had to go. */
        <DispatchBlockedBanner
          reason={dispatchStatus.reason}
          action={dispatchBlockAction}
          checkedAt={dispatchStatus.checkedAt}
          onDismiss={() =>
            setDismissedBlock({ reason: dispatchStatus.reason ?? '', at: Date.now() })
          }
          busy={
            goOnline.isPending ||
            goOffline.isPending ||
            resumeRequests.isPending ||
            checkingDispatch
          }
        />
      )}
      </View>

      {/*
        Bottom panel.

        The resting snap has to clear the TAB BAR, not just the bottom of the
        screen. The panel is anchored to the screen edge and the tab bar floats
        over its last ~84 pt, so the old 0.42 left roughly 270 pt of usable
        height for ~320 pt of content — the driver opened the app and had to
        drag the sheet up before the Create Trip button was reachable. "It kills
        the aesthetics, the drivers should see the vision immediately."

        0.56 leaves the stats row, the destination card and the hero CTA all
        sitting clear above the tab bar on launch; the upper snap stays for the
        fuller stats view.
      */}
      {/*
        THE SAME SHEET THE RIDER USES.

        This was `<InlayPanel snapPointsPct={[0.56, 0.82]}>` — the original sheet
        component, resting at 56% of the screen. Two problems, one of which is
        the whole of "the driver app aesthetic is still using the same thing
        that was done at the very beginning": the rider moved to MorphSheet a
        long time ago, so the two apps had different sheet physics, no shared
        crossfade and no ghost layer, and the driver's felt older because it WAS
        older. The other is 0.56 — on a map screen that leaves the driver 44% of
        the display to answer "where is the work", which is the only question
        home exists to answer.

        `SheetContent` publishes this body into the slot store rather than
        rendering it here; `DriverSheetHost` below is what draws it. That
        indirection is what lets the offer stage swap the body without this
        screen re-rendering — see the note in driverStage.ts.
      */}
      <SheetContent stage="idle">
        <View style={styles.sheetContent}>
          {/*
            ── LIVE WORK, FIRST THING ──────────────────────────────────────
            "Can you relocate the dispatch tab? Where it is, it might be harder
            for new drivers to see it. It's in the alerts page. Make it more
            reachable — the homepage wouldn't be bad actually."

            Right, and worse than a discoverability problem: a driver waiting
            for work sits on THIS screen, and the one surface that says whether
            any work exists lived two taps away behind a category filter on a
            page named after notifications. A new driver had no reason to ever
            open it.

            Rendered above the day's earnings because a live request outranks a
            settled number, and only while there is actually something to show —
            an empty board every time you open the app is noise, and the empty
            state still has its home on Alerts → Dispatch, which keeps working
            exactly as before.

            `compact` drops the horizontal padding: the panel already has its
            own, and the board's default gutter is sized for a full screen.
          */}
          {hasPendingDispatch && (
            <Entrance animation="slideDown" delay={120}>
              {/* `onOpenInPlace` is what turns a tap into a stage change
                  instead of a push — see the note in PendingDispatchList.open.
                  Home is the only caller that can supply it, because home is
                  the only screen that already has the map and the sheet. */}
              <PendingDispatchList compact onOpenInPlace={openOffer} />
            </Entrance>
          )}

          {/* Status row */}
          <Entrance animation="slideDown" delay={150} style={styles.statsRow}>
            <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.xl} intensity="low" />
            <View style={styles.statCard}>
              <Text variant="caption" color={colors.onSurfaceVariant}>Today</Text>
              {/* A driver reading "GH₵0.00" for the day's earnings while the ledger
                  is still loading has every reason to panic. Skeleton until real. */}
              <SkeletonValue loading={txPending} width={78} height={22}>
                <Text style={styles.statValue}>{formatGhs(todayEarnings)}</Text>
              </SkeletonValue>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCard}>
              <Text variant="caption" color={colors.onSurfaceVariant}>Trips</Text>
              <SkeletonValue loading={txPending} width={30} height={22}>
                <Text style={styles.statValue}>{todayTrips}</Text>
              </SkeletonValue>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCard}>
              <Text variant="caption" color={colors.onSurfaceVariant}>Balance</Text>
              <SkeletonValue loading={walletPending} width={78} height={22}>
                <Text style={styles.statValue}>{formatGhs(walletData?.balancePesewas ?? 0)}</Text>
              </SkeletonValue>
            </View>
          </Entrance>

          {/* "I'm heading home" — only shown while online and free, because it
              is a dispatch preference and there is nothing for it to affect
              otherwise. */}
          {isOnline && !activeTripData && (
            <Entrance animation="slideDown" delay={175} style={styles.ctaWrapper}>
              <DestinationModeCard />
            </Entrance>
          )}

          {/**
            * ── THE HERO SLOT ────────────────────────────────────────────────
            *
            * Two completely different states used to share one ring and one
            * `Button`: "you are in the middle of a ride" and "you have nothing
            * on". A live trip is not a call to action, it is a situation, and it
            * now gets a surface that says what phase it is in, who is aboard and
            * what it pays — see `LiveTripCard`. The empty state keeps the ringed
            * button, which is the right shape for the one thing there is to do.
            */}
          <Entrance animation="slideDown" delay={200} style={styles.ctaWrapper}>
            {activeTripData ? (
              <LiveTripCard
                trip={activeTripData}
                onPress={() => goDeeper(`/(trip)/active/${activeTripData.id}` as Href)}
              />
            ) : (
              <GradientGlowBorder
                palette="driver"
                fillColor={colors.surfaceContainerHigh}
                borderRadius={radii['2xl']}
                glow
                disabled={!isOnline}
                style={styles.ctaGlow}
              >
                <Button
                  label="+ Create Trip"
                  onPress={() => goDeeper('/(trip)/create')}
                  disabled={!isOnline}
                />
              </GradientGlowBorder>
            )}
            {!isOnline && !activeTripData && (
              <Text variant="caption" color={colors.onSurfaceVariant} style={styles.offlineHint}>
                Go online to start accepting trips
              </Text>
            )}
          </Entrance>
        </View>
      </SheetContent>

      {/*
        The sheet itself — one instance, above every stage, never unmounted.
        `idle` publishes into it above; `offer` publishes into it from
        DispatchOfferStage. Swapping between them is a crossfade on a spring,
        not a navigation, which is the whole point (see driverStage.ts).
      */}
      {/* Publishes the `offer` body into the same slot. Renders nothing itself
          and owns no map — home's map is the map. */}
      <DispatchOfferStage />

      {/* The driving stages — enroute / arrived / intrip — publish into the same
          sheet. Like the offer, they own no map: the surface map above is the
          map, and it is never rebuilt between them. */}
      <TripStages
        stage={surfaceStage}
        trip={activeTripData}
        onManage={() =>
          activeTripData?.id
            ? goDeeper({ pathname: '/(trip)/active/[id]', params: { id: activeTripData.id } } as Href)
            : undefined
        }
      />

      <DriverSheetHost current={surfaceStage} previous={previousStage} />
    </View>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    // Transparent — the map is full-bleed and AppBackground (mounted in
    // _layout.tsx) only needs to show through the map's own loading/error
    // veil, not get blocked by an opaque fill here.
    container: { flex: 1, backgroundColor: 'transparent' },
    header: {
      position: 'absolute',
      left: spacing['2xl'],
      right: spacing['2xl'],
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderRadius: radii['2xl'],
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.sm,
      overflow: 'hidden',
    },
    headerLogo: {
      fontFamily: fonts.displayBold,
      fontSize: 18,
      lineHeight: 23,
      color: colors.primary,
      letterSpacing: -0.5,
    },
    driverMarker: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: '#fff',
    },
    sheetBg: {
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
    },
    sheetContent: {
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing.md,
      paddingBottom: 120,
      gap: spacing.xl,
    },
    statsRow: {
      flexDirection: 'row',
      borderRadius: radii.xl,
      padding: spacing.base,
      overflow: 'hidden',
    },
    statCard: { flex: 1, alignItems: 'center', gap: 4 },
    statDivider: { width: 1, backgroundColor: colors.outline, marginVertical: 4 },
    statValue: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.titleMedium,
      lineHeight: Math.round(fontSizes.titleMedium * 1.3),
      color: colors.onSurface,
    },
    ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    ctaWrapper: { gap: spacing.md },
    ctaGlow: { padding: spacing.base, gap: spacing.sm },
    // `activeTripBanner` / `activeDot` / `activeTripText` lived here for the
    // one-line "Active trip: X → Y" strip. That is now `LiveTripCard`, which
    // owns its own styles.
    offlineHint: { textAlign: 'center', marginTop: spacing.xs },
    /**
     * ONE COLUMN FOR EVERY STATUS SURFACE ON THIS SCREEN.
     *
     * `gap` rather than four hand-computed `top` offsets — see the render.
     * `box-none` on the container so the map underneath still takes pans
     * between the cards; only the cards themselves are hit targets.
     */
    bannerColumn: {
      position: 'absolute',
      left: spacing.lg,
      right: spacing.lg,
      gap: spacing.md,
      zIndex: 20,
    },
    errorBanner: {
      position: 'absolute',
      left: spacing['2xl'],
      right: spacing['2xl'],
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: `${colors.error}18`,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: `${colors.error}44`,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.sm,
    },
    offlineBanner: {
      position: 'absolute',
      left: spacing['2xl'],
      right: spacing['2xl'],
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: '#334155',
      borderRadius: radii.lg,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.sm,
    },
  });
