import '../global.css';
import React, { useEffect, useRef, useCallback, Component, useState } from 'react';
import { SplashAnimation } from '../components/SplashAnimation';
import { Platform, View, Pressable, Text as RNText, StyleSheet, AppState, Animated } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as Updates from 'expo-updates';
import { onlineManager } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ColorsProvider, AppBackground, AmbientRotationProvider, MorphProvider } from '@eyego/ui';
import {
  useFonts,
  Geist_300Light,
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
} from '@expo-google-fonts/geist';
import {
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import * as Haptics from 'expo-haptics';
import { configureApiClient, configureSocket, getDriverSocket, driverApi, driverSocketEvents, refreshDriverSocketAuth, setAuthReadyGate } from '@eyego/api';
import { useDriverStore } from '../stores/driver.store';
import { useDriverTripStore, subscribeDriverStatusToCaches } from '../stores/trip.store';
import { driverColors, driverLightColors } from '../utils/useColors';
import { initSentry, captureException } from '../lib/sentry';
import { DriverTripStatusListener } from '../components/DriverTripStatusListener';
import DispatchOfferSheet from '../components/DispatchOfferSheet';
import { isLiveTripStatus } from '@eyego/utils';
import { offlineQueue } from '../utils/offlineQueue';
import { useOtaUpdates } from '../hooks/useOtaUpdates';

// Initialize crash/error tracking as early as possible (no-op without DSN)
initSentry();

// Show notifications as banners while the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

SplashScreen.preventAutoHideAsync();

// D4: ErrorBoundary — catches render errors and shows a fallback screen
interface ErrorBoundaryState { hasError: boolean; error?: Error }
class AppErrorBoundary extends Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    captureException(error, { componentStack: info.componentStack, source: 'AppErrorBoundary' });
    console.error('[ErrorBoundary] Uncaught error:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <View style={errStyles.container}>
          <RNText style={errStyles.title}>Something went wrong</RNText>
          <RNText style={errStyles.message}>{this.state.error?.message ?? 'An unexpected error occurred.'}</RNText>
          <Pressable
            style={errStyles.button}
            onPress={() => Updates.reloadAsync().catch(() => this.setState({ hasError: false }))}
          >
            <RNText style={errStyles.buttonText}>Restart App</RNText>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const errStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060F1A', alignItems: 'center', justifyContent: 'center', padding: 32 },
  title: { fontFamily: 'Geist_700Bold', fontSize: 22, lineHeight: 29, color: '#fff', marginBottom: 12, textAlign: 'center' },
  message: { fontSize: 14, color: '#94A3B8', textAlign: 'center', marginBottom: 32, lineHeight: 20 },
  button: { backgroundColor: '#3B82F6', paddingHorizontal: 28, paddingVertical: 14, borderRadius: 12 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15, lineHeight: 20 },
});

async function registerForPushNotifications() {
  try {
    // Android requires an explicit notification channel. The id MUST match the
    // backend FCM payload (android.notification.channelId = 'eyego_default') or
    // Android 8+ silently drops the notification.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('eyego_default', {
        name: 'EyeGo Driver',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#3B82F6',
        sound: 'default',
      });
    }

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return;

    /**
     * THE TOKEN HAS TO BE AN *FCM* TOKEN, AND ON iOS IT WAS NOT.
     *
     * The backend pushes through Firebase Admin, which only accepts FCM
     * registration tokens. `Notifications.getDevicePushTokenAsync()` returns
     * the platform's native token — on Android that IS the FCM token, so
     * Android worked; on iOS it is an APNs device token, which Firebase Admin
     * rejects. Combined with `Driver.fcmToken` sitting at null in the database,
     * an iOS driver could only ever be reached over an open socket, so a
     * backgrounded app missed every dispatch offer. That is the last remaining
     * delivery gap behind "the driver never got it".
     *
     * `@react-native-firebase/messaging` performs the APNs → FCM exchange and
     * hands back a token Firebase Admin can actually send to. It is required
     * lazily and guarded: it is a native module, so it only exists in a build
     * made after it was added, and a JS-only OTA update landing on an older
     * binary must fall back rather than crash on import.
     */
    let token: string | undefined;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const messaging = require('@react-native-firebase/messaging').default;
      // iOS will not issue an FCM token until APNs has registered the device.
      await messaging().registerDeviceForRemoteMessages?.();
      token = await messaging().getToken();
    } catch {
      // No native module in this binary (or the exchange failed). Android's
      // device token is a valid FCM token, so this is a correct fallback there
      // and a known-degraded one on iOS.
      const tokenData = await Notifications.getDevicePushTokenAsync();
      token = tokenData?.data as string | undefined;
      if (Platform.OS === 'ios') {
        console.warn(
          '[PushNotifications] Falling back to the APNs device token — Firebase ' +
            'Admin cannot send to this. Rebuild with @react-native-firebase/messaging.',
        );
      }
    }
    if (!token) return;

    // Register token with the backend so the server can push to this device
    await driverApi.updateFcmToken(token).catch(() => {
      // Without the token on the server the driver gets NO pushes (dispatch,
      // trip events) — queue for retry; last-write-wins on the token.
      offlineQueue.enqueue('FCM_TOKEN', '/driver/fcm-token', 'POST', { fcmToken: token }, { replaceSameType: true });
    });
  } catch (e) {
    console.warn('[PushNotifications] Setup failed:', e);
  }
}

/** Fade-group screens show the shared root <AppBackground /> through their
 *  content view — mirrors the rider app so blur/glow surfaces read correctly
 *  against the ambient background instead of a flat fill. */
const TRANSPARENT_CONTENT = { backgroundColor: 'transparent' } as const;

/**
 * Native push for detail screens — the same constant the rider app has had.
 *
 * `slide_from_right` is react-native-screens' own re-implementation of a push.
 * On iOS it slides the incoming screen over a *stationary* outgoing one and
 * hands the back-swipe to a JS gesture. `'default'` hands the transition to
 * UINavigationController, which is where the parallax (the screen underneath
 * drifting at a third of the speed), the shadow under the leading edge and the
 * real interactive pop live. Every one of those is a thing a rider notices
 * without being able to name — and the driver app was the only one of the two
 * not getting them. Android has no equivalent, so it keeps the explicit slide.
 */
const detailPush = {
  animation: Platform.OS === 'ios' ? ('default' as const) : ('slide_from_right' as const),
  gestureEnabled: true,
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, staleTime: 1000 * 60 * 5 },
  },
});

export default function RootLayout() {
  // OTA updates: check on launch/foreground, download in background, offer restart
  useOtaUpdates();
  const { loadFromStorage, isLoggedIn, isLoading, theme } = useDriverStore();
  const colors = theme === 'light' ? driverLightColors : driverColors;
  const segments = useSegments();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Pause the background effect when an opaque detail screen covers it —
  // mirrors rider's _layout.tsx exactly (depth >= 3 = deeply pushed trip/
  // profile screens with no blur layer behind them to run for).
  const isOpaqueDetail = segments.length >= 3;

  const [splashDone, setSplashDone] = useState(false);
  const [inAppBanner, setInAppBanner] = React.useState<{ title: string; body: string } | null>(null);
  const bannerTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const showInAppBanner = React.useCallback((title: string, body: string) => {
    setInAppBanner({ title, body });
    if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current);
    bannerTimeoutRef.current = setTimeout(() => setInAppBanner(null), 4000);
  }, []);

  // DM2: sync React Query online state with device network connectivity
  useEffect(() => {
    return NetInfo.addEventListener(state => {
      onlineManager.setOnline(state.isConnected ?? true);
    });
  }, []);

  const [fontsLoaded] = useFonts({
    Geist_300Light,
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
  });

  useEffect(() => {
    // Intentionally runs once on mount — configures singleton API/socket clients
    // using store getters (not React state) so no deps are needed.
    configureApiClient({
      getAccessToken: () => useDriverStore.getState().accessToken,
      getRefreshToken: () => useDriverStore.getState().refreshToken,
      onTokenRefreshed: ({ accessToken, refreshToken }) => {
        useDriverStore.getState().refreshTokens({ accessToken, refreshToken });
        // The rider app has always done this and the driver app never did. The
        // socket's `auth` is a callback, so a RECONNECT picks up the rotated
        // token on its own — but a socket that is already down after failing to
        // authenticate with the expired one will not retry itself once
        // socket.io has run out of attempts. Nudging it here is what turns a
        // permanent "Reconnecting…" back into a live trip channel.
        refreshDriverSocketAuth();
      },
      onLogout: () => {
        useDriverStore.getState().logout();
      },
      getRefreshUrl: () => '/auth/driver/refresh',
    });

    configureSocket({
      getToken: () => useDriverStore.getState().accessToken,
      // A driver token is not allowed on `/user/me`, and a 403 never reaches the
      // refresh interceptor — so the socket's stale-token recovery has to probe
      // an endpoint this role can actually call.
      authProbeUrl: '/driver/me',
    });

    // Same cold-start race the rider app had: requests must not go out before
    // SecureStore has been read, or a token-less 401 is mistaken for an ended
    // session and signs the driver out mid-shift. See setAuthReadyGate.
    setAuthReadyGate(loadFromStorage());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Register for push notifications once the driver is logged in.
  // Also listen for token rotation so the backend always has the latest FCM token.
  useEffect(() => {
    if (!isLoggedIn) return;
    registerForPushNotifications();

    // Drain queued critical actions (SOS retries, FCM tokens) and keep
    // retrying periodically while logged in — mirrors the rider app.
    offlineQueue.flushQueue();
    offlineQueue.startPeriodicFlush(60000);

    const tokenSubscription = Notifications.addPushTokenListener(async (newToken) => {
      try {
        await driverApi.updateFcmToken(newToken.data);
      } catch (err) {
        // Rotated token lost = pushes silently stop. Queue it for retry.
        offlineQueue.enqueue('FCM_TOKEN', '/driver/fcm-token', 'POST', { fcmToken: newToken.data }, { replaceSameType: true });
      }
    });

    return () => {
      tokenSubscription.remove();
      offlineQueue.stopPeriodicFlush();
    };
  }, [isLoggedIn]);

  // Handle notification taps — navigate to the relevant screen
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, any>;
      const { type, tripId } = data ?? {};
      if (type === 'TRIP_OFFER') {
        // The dispatch cascade's own push. It had NO case here, so it fell
        // through to the catch-all below and opened `/(trip)/active/<id>` for
        // a trip this driver has not accepted and does not own — a dead screen
        // where the offer card should have been.
        //
        // Nothing to navigate to: `DispatchOfferSheet` is mounted at the root
        // and appears over whatever is on screen. Re-hydrating is what makes it
        // appear, because the offer is on `/rides/driver/state` now.
        void useDriverTripStore.getState().hydrate();
      // Admin dispatch assigned this driver a scheduled trip. It had no case,
      // so it fell to the catch-all at the bottom and opened the ACTIVE trip
      // screen for a trip the driver has not accepted yet — the same bug
      // TRIP_OFFER had. Both admin pushes land on the offer screen, which is
      // where the Accept button is.
      } else if ((type === 'TRIP_ASSIGNED' || type === 'ADMIN_TRIP_ASSIGNED') && tripId) {
        router.push({
          pathname: '/(trip)/dispatch/[id]',
          params: {
            id: tripId,
            origin: data.routeOrigin ?? '',
            destination: data.routeDestination ?? '',
            departureTime: data.departureTime ?? '',
            expiresAt: data.expiresAt ?? '',
          },
        } as any);
      } else if (type === 'TRIP_REQUEST_DISPATCH' && data.requestId) {
        // On-demand rider request — first driver to accept wins, unlike TRIP_ASSIGNED
        // which is already owned by another driver.
        router.push({
          pathname: '/(trip)/dispatch/[id]',
          params: {
            id: data.requestId,
            kind: 'REQUEST',
            destination: data.destination ?? '',
            departureTime: data.scheduledAt ?? '',
          },
        } as any);
      } else if (type === 'DISPATCH_REQUEST') {
        // Informational only — this trip already has an owning driver, so there's
        // nothing here for another driver to accept. Just surface high-demand areas.
        router.push('/(tabs)/home' as any);
      } else if (type === 'CHAT_MESSAGE' && tripId) {
        router.push({ pathname: '/(trip)/chat/[id]', params: { id: tripId } } as any);
      } else if (type === 'DRIVER_APPROVED') {
        router.push('/(tabs)/home' as any);
      } else if (type === 'LOW_WALLET' || type === 'TIP') {
        router.push('/(tabs)/earnings' as any);
      } else if (type === 'DRIVER_REJECTED') {
        router.push('/(profile)/documents' as any);
      } else if (type === 'DRIVER_RATING') {
        router.push('/(profile)/ratings' as any);
      } else if (type === 'SOS' && tripId) {
        router.push({ pathname: '/(trip)/active/[id]', params: { id: tripId } } as any);
      } else if (type === 'EXPRESS_MODE' && tripId) {
        router.push({ pathname: '/(trip)/active/[id]', params: { id: tripId } } as any);
      } else if (tripId) {
        // Fallback for any other trip-scoped push (e.g. DRIVER_ARRIVED-style events
        // that don't have a dedicated case above) — land on the active trip screen
        // rather than silently doing nothing on tap.
        router.push({ pathname: '/(trip)/active/[id]', params: { id: tripId } } as any);
      }
    });
    return () => sub.remove();
  }, [router]);

  // Foreground notification handler — shows in-app banner when push arrives while app is open
  useEffect(() => {
    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as Record<string, any> | undefined;
      if (data?.type === 'TRIP_OFFER') {
        // A push arriving in the foreground means the socket did not deliver
        // this — otherwise the sheet would already be up. Pull the offer over
        // REST and show the card rather than a banner the driver must read and
        // then go hunting for, with twenty seconds on the clock.
        void useDriverTripStore.getState().hydrate();
        return;
      }
      const title = notification.request.content.title ?? '';
      const body = notification.request.content.body ?? '';
      if (title || body) {
        showInAppBanner(title, body);
      }
    });
    return () => {
      receivedSub.remove();
      if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current);
    };
  }, [showInAppBanner]);

  /**
   * SOMEBODY JUST TOOK A SEAT — SAY SO.
   *
   * BUGFIX ("on the driver app, the driver should receive an alert when someone
   * books the place"). The server has emitted `trip:passenger_joined` on the
   * driver namespace since the invite-vs-direct-booking fix, and `@eyego/api`
   * exposes `onPassengerJoined` for it — but nothing in this app ever
   * subscribed. The only thing a booking produced on the driver phone was
   * `trip:seat_update`, which by design repaints the seat map and announces
   * nothing. A seat quietly changed colour on a screen the driver was probably
   * not looking at.
   *
   * Mounted at the root, not on the trip screen: the driver is most likely on
   * home or earnings when a passenger books, which is exactly the case the
   * trip-screen-only listener could not cover.
   */
  useEffect(() => {
    if (!isLoggedIn) return;
    const off = driverSocketEvents.onPassengerJoined(({ tripId, seatNumber, passengerName }) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showInAppBanner(
        'New passenger',
        seatNumber != null
          ? `${passengerName} booked seat ${seatNumber}`
          : `${passengerName} booked a seat`,
      );
      // The seat frame carries the new rows, but the trip queries hold fare and
      // occupancy the frame does not — reconcile them so the manage screen is
      // right the moment the driver taps through from the banner.
      if (tripId) {
        queryClient.invalidateQueries({ queryKey: ['driver', 'trip', 'active', tripId] });
        queryClient.invalidateQueries({ queryKey: ['driver', 'trip', 'tracking', tripId] });
        queryClient.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
      }
    });
    return () => { off(); };
  }, [isLoggedIn, showInAppBanner]);

  /**
   * A PASSENGER MOVED THEIR PICKUP POINT.
   *
   * BUGFIX ("i chose to update the pickup point to my selected one, but it's not
   * showing on the driver app that a new pickup point has been selected"). The
   * server now publishes `trip:pickup_changed` (see bookings.controller's
   * `updatePickup`); this is the end that turns it into something the driver
   * actually sees. Banner rather than a silent cache write, because the driver is
   * very likely already driving to the OLD point when this arrives.
   */
  useEffect(() => {
    if (!isLoggedIn) return;
    const off = driverSocketEvents.onPickupChanged(({ tripId, passengerName, pickupAddress }) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      showInAppBanner(
        'Pickup point changed',
        pickupAddress
          ? `${passengerName} is now waiting at ${pickupAddress}`
          : `${passengerName} changed where they want to be collected`,
      );
      if (tripId) {
        queryClient.invalidateQueries({ queryKey: ['driver', 'trip', 'active', tripId] });
        queryClient.invalidateQueries({ queryKey: ['driver', 'trip', 'tracking', tripId] });
        queryClient.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
      }
    });
    return () => { off(); };
  }, [isLoggedIn, showInAppBanner]);

  /**
   * ONE-CALL REHYDRATION + the single offer listener.
   *
   * `GET /rides/driver/state` answers "am I on a trip, and where is it" in one
   * request. Without it, a cold start after a force-quit rebuilt the trip from
   * whatever the current screen happened to query — the mechanism behind "the
   * app forgot I was on a trip".
   */
  useEffect(() => {
    if (!isLoggedIn) return;
    void useDriverTripStore.getState().hydrate();
    const stopOffers = useDriverTripStore.getState().listenForOffers();
    /**
     * SERVER-DRIVEN STATUS RECONCILIATION.
     *
     * The other half of the optimistic write in `applyDriverTripStatus`: the
     * sequenced `trip:event` channel is the authority, and this pushes whatever
     * it says into every screen's query cache from ONE place. Before this, each
     * screen discovered status changes by its own 30-second poll, so a
     * transition made anywhere else — the other screen, an admin correction, the
     * rider cancelling — took up to half a minute to appear and could appear on
     * the two screens at different times.
     */
    const stopStatusSync = subscribeDriverStatusToCaches(queryClient);

    /**
     * THE OFFER SAFETY NET — and the reason the driver side now syncs fast.
     *
     * BUGFIX ("i requested the trip on the rider app but on the driver app it's
     * not showing anything, even though i'm online and live… on the looking for
     * a driver page it says asking driver 1 of 1 but nothing shows on the driver
     * side"), and the direct answer to "increase the speed that it takes to sync
     * the driver side".
     *
     * An offer has exactly one live delivery path — a `trip:event` frame into
     * the `driver:<id>` room — and unlike every lifecycle event it carries no
     * trip seq, so there is NO replay for it. Anything that costs the socket
     * those twenty seconds (a carrier handover, a token rotation mid-flight, a
     * doze on Android, the app foregrounding a beat late) loses the offer
     * outright, and the rider watches "asking driver 1 of 1" count down against
     * a phone that was never told. The server logs this as "OFFER published to
     * an EMPTY room" — see trip-events.publisher.js — but the driver has no way
     * to recover from it, because the only other reads of `/rides/driver/state`
     * happen on cold start and on socket reconnect.
     *
     * So: while logged in and not already on a trip, ASK. `getDriverState` is
     * one indexed query plus a Redis GET, it is the same call the app already
     * makes on every foreground, and `hydrate` no-ops when the answer has not
     * changed (it only adopts an offer with real time left on it, and only if it
     * is not the one already held). At this cadence a socket-dropped offer costs
     * a few seconds of the offer window instead of the whole ride.
     *
     * Deliberately stopped once a trip is live: a driver mid-ride cannot take an
     * offer, `getDriverState` suppresses them in that case anyway, and the
     * sequenced `trip:event` channel is authoritative for a trip in progress.
     *
     * CADENCE. This was 5 s, chosen against a 20 s offer window. Both numbers
     * moved: the offer window is 45 s now, and the measured failure was not a
     * slow poll but a poll that never ran, so the interval is 2 s and the only
     * thing that stops it is an actual live trip. Two seconds of one indexed
     * query plus a Redis GET is nothing next to a driver missing the work.
     */
    const OFFER_POLL_MS = 2000;
    const poll = setInterval(() => {
      const s = useDriverTripStore.getState();
      // Only a genuinely live trip suppresses the poll. `snapshot` alone was too
      // broad: it stays populated after a trip ends until something clears it,
      // and a stale snapshot silently switched the safety net off for the rest
      // of the session — which is the state a driver is in for most of a shift.
      if (s.snapshot && isLiveTripStatus(s.snapshot.status)) return;
      void s.hydrate();
    }, OFFER_POLL_MS);

    return () => {
      clearInterval(poll);
      stopOffers();
      stopStatusSync();
    };
  }, [isLoggedIn]);

  // Reconnect driver socket when app returns to foreground (e.g. after phone lock)
  useEffect(() => {
    if (!isLoggedIn) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        // Reconnect the existing socket instance on foreground — do NOT call
        // connectDriverSocket() here (it bumps the refcount without a paired
        // disconnect, so the ref never returns to 0 on logout).
        getDriverSocket().connect();
        // Re-join the active trip room on foreground reconnect so live updates
        // (chat, seat, location) keep flowing — the socket dropped room
        // membership while backgrounded.
        const activeTripId = useDriverStore.getState().activeTripId;
        if (activeTripId) {
          driverSocketEvents.emitJoinTracking?.(activeTripId);
        }
        // Re-ask the server what is true. The trip channel replays anything
        // missed while backgrounded, but hydrating first means the UI is
        // correct immediately rather than after the replay lands.
        void useDriverTripStore.getState().hydrate();
      }
    });
    return () => sub.remove();
  }, [isLoggedIn]);

  useEffect(() => {
    if (isLoading) return;
    const inAuth = segments[0] === '(auth)';
    if (!isLoggedIn && !inAuth) {
      router.replace('/(auth)/phone');
    }
  }, [isLoggedIn, isLoading, segments, router]);

  if (!fontsLoaded) return null;

  if (!splashDone) {
    return <SplashAnimation onComplete={() => setSplashDone(true)} />;
  }

  return (
    <ColorsProvider value={colors}>
    <AppErrorBoundary>
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
    <KeyboardProvider>
    <AmbientRotationProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style={theme === 'light' ? 'dark' : 'light'} backgroundColor={colors.backgroundDeep} />
        {/* Ambient premium background — fade-group screens (transparent
            contentStyle above) show this instead of a flat fill. */}
        <AppBackground isDark={theme !== 'light'} paused={isOpaqueDetail} />
        {/* MorphProvider hosts the container-transform overlay for future
            morph transitions (trip-card → active-trip, etc.) — wraps the
            Stack so sources/targets living inside screens can register. */}
        <MorphProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
            animation: 'fade_from_bottom',
          }}
        >
          <Stack.Screen name="index" options={{ contentStyle: TRANSPARENT_CONTENT }} />
          <Stack.Screen name="(auth)" options={{ animation: 'fade', contentStyle: TRANSPARENT_CONTENT }} />
          <Stack.Screen name="(tabs)" options={{ animation: 'fade', contentStyle: TRANSPARENT_CONTENT }} />
          <Stack.Screen
            name="(trip)/create"
            options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
          />
          <Stack.Screen
            name="(trip)/active/[id]"
            options={detailPush}
          />
          <Stack.Screen
            name="(trip)/tracking/[id]"
            options={detailPush}
          />
          <Stack.Screen
            name="(trip)/detail/[id]"
            options={detailPush}
          />
          <Stack.Screen
            name="(trip)/chat/[id]"
            options={detailPush}
          />
          <Stack.Screen
            name="(trip)/complete/[id]"
            options={{ animation: 'fade', gestureEnabled: false }}
          />
          <Stack.Screen
            name="(trip)/add-passenger"
            options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
          />
          <Stack.Screen
            name="(trip)/dispatch/[id]"
            options={{ animation: 'slide_from_bottom', presentation: 'modal', gestureEnabled: false }}
          />
          <Stack.Screen
            name="(profile)"
            options={detailPush}
          />
          <Stack.Screen
            name="(profile)/payout-account"
            options={detailPush}
          />
          <Stack.Screen
            name="(profile)/account-deletion"
            options={detailPush}
          />
          <Stack.Screen
            name="(profile)/terms"
            options={detailPush}
          />
          <Stack.Screen
            name="(profile)/privacy"
            options={detailPush}
          />
          <Stack.Screen
            name="(onboarding)"
            options={{ animation: 'fade', gestureEnabled: false, contentStyle: TRANSPARENT_CONTENT }}
          />
          <Stack.Screen
            name="(trip)/cancel/[id]"
            options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
          />
          <Stack.Screen
            name="(trip)/report/[id]"
            options={detailPush}
          />
        </Stack>
        </MorphProvider>
        {/* Off-screen parity: app-wide socket banners (chat/dispatch/status) +
            cache invalidation, mirroring the rider TripStatusListener. */}
        {isLoggedIn && <DriverTripStatusListener />}
        {/* The dispatch offer's renderer. Root-mounted so an offer interrupts
            whatever screen the driver is on — the store has been collecting
            offers since the rewire with nothing on the other end. */}
        {isLoggedIn && <DispatchOfferSheet />}
        {/* Global foreground push notification banner */}
        {inAppBanner && (
          <Animated.View
            style={{
              position: 'absolute',
              top: insets.top + 8,
              left: 16,
              right: 16,
              backgroundColor: '#1e1e2e',
              borderRadius: 14,
              borderWidth: 1,
              borderColor: 'rgba(59,130,246,0.4)',
              padding: 14,
              gap: 4,
              zIndex: 9999,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 8,
              elevation: 10,
            }}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            <RNText style={{ color: '#fff', fontSize: 14, fontWeight: '600' }} numberOfLines={1}>{inAppBanner.title}</RNText>
            <RNText style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }} numberOfLines={2}>{inAppBanner.body}</RNText>
          </Animated.View>
        )}
      </QueryClientProvider>
    </AmbientRotationProvider>
    </KeyboardProvider>
    </GestureHandlerRootView>
    </AppErrorBoundary>
    </ColorsProvider>
  );
}
