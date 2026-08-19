import '../global.css';
import '../i18n';
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n';
import { Stack, useRouter, useSegments, type Href } from 'expo-router';
import { ThemeProvider, DarkTheme, type Theme } from '@react-navigation/native';
import { SplashAnimation } from '../components/SplashAnimation';
import { StatusBar } from 'expo-status-bar';
import { Platform, View, AppState } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { springs } from '@eyego/config';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Constants from 'expo-constants';
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
import { useAuthStore, registerLogoutCleanup } from '../stores/auth.store';
import { useThemeStore } from '../stores/theme.store';
import { configureApiClient, configureSocket, refreshSocketAuth, setApiBaseUrl, setAuthReadyGate, userApi } from '@eyego/api';
import { resolveApiUrl } from '../stores/api.store';
import { useColors } from '../utils/useColors';
import { Text, ColorsProvider, AppBackground, AmbientRotationProvider, MorphProvider } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { initSentry, captureException, setUser as setSentryUser } from '../lib/sentry';
import { offlineQueue } from '../utils/offlineQueue';
import { useOtaUpdates } from '../hooks/useOtaUpdates';

// Initialize crash/error tracking as early as possible (no-op without DSN)
initSentry();
import { TripStatusListener } from '../components/TripStatusListener';
import { GlobalToast } from '../components/GlobalToast';
import BoardingPinSheet from '../components/BoardingPinSheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import * as Linking from 'expo-linking';

// Global JS Exception Handler for robust dev logging
// BUGFIX: Captures to Sentry instead of just console.error in dev
const GlobalErrorUtils = globalThis as unknown as { ErrorUtils?: { getGlobalHandler: () => any; setGlobalHandler: (h: any) => void } };
if (GlobalErrorUtils.ErrorUtils && __DEV__) {
  const previousHandler = GlobalErrorUtils.ErrorUtils.getGlobalHandler();
  GlobalErrorUtils.ErrorUtils.setGlobalHandler((error: any, isFatal: any) => {
    console.warn('[GlobalHandler] Caught:', isFatal ? 'Fatal' : 'Non-fatal', error?.message);
    captureException(error, { isFatal: !!isFatal, source: 'globalHandler' });
    if (previousHandler) {
      previousHandler(error, isFatal);
    }
  });
}

// SDK 54: appOwnership === 'expo' is the reliable Expo Go signal
const isExpoGo =
  Constants.appOwnership === 'expo' ||
  // Constants.executionEnvironment is available on SDK 50+ but typed loosely
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Constants as { executionEnvironment?: string }).executionEnvironment === 'storeClient';

// ── Global connectivity observer ──
let globalNetInfoUnsubscribe: (() => void) | null = null;
let globalIsOffline = false;
// Exported so any screen or component can read the latest value synchronously
export function isGloballyOffline(): boolean { return globalIsOffline; }
export function getGlobalNetInfoUnsubscribe(): (() => void) | null { return globalNetInfoUnsubscribe; }

// BUGFIX: Removed duplicate Notifications.setNotificationHandler() call.
// The module-level handler in notifications.ts previously registered first,
// then this one registered second — overwriting it. The authoritative handler
// is now only registered here to avoid the race.
import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
} as Parameters<typeof Notifications.setNotificationHandler>[0]);

async function registerForPushNotifications() {
  if (isExpoGo) return;
  try {
    const Notifications = require('expo-notifications');
    if (Platform.OS === 'android') {
      // Channel id MUST match the backend FCM payload (android.notification.channelId
      // = 'eyego_default' in push.service.js) or Android 8+ silently drops the push.
      await Notifications.setNotificationChannelAsync('eyego_default', {
        name: 'EyeGo',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#4be277',
        sound: 'default',
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') return;

    /**
     * AN FCM TOKEN, NOT WHATEVER THE PLATFORM HANDS OUT.
     *
     * The comment this replaces described the bug without noticing it:
     * `getDevicePushTokenAsync()` returns "the FCM registration token on
     * Android / APNs token on iOS", and the backend pushes through Firebase
     * Admin, which accepts only the former. So every iOS rider registered a
     * token Firebase could not send to, and silently received no pushes — no
     * "your driver has arrived", no trip updates — while the server logged a
     * successful registration. The driver app had the identical defect, found
     * first because a missed dispatch offer is louder than a missed arrival.
     *
     * `@react-native-firebase/messaging` does the APNs → FCM exchange. Required
     * lazily and guarded because it is a native module: a JS-only OTA update
     * landing on an older binary must fall back, not crash on import.
     */
    let pushToken: string | undefined;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const messaging = require('@react-native-firebase/messaging').default;
      await messaging().registerDeviceForRemoteMessages?.();
      pushToken = await messaging().getToken();
    } catch {
      const tokenData = await Notifications.getDevicePushTokenAsync();
      pushToken = tokenData?.data as string | undefined;
      if (Platform.OS === 'ios') {
        console.warn(
          '[PushNotifications] Falling back to the APNs device token — Firebase ' +
            'Admin cannot send to this. Rebuild with @react-native-firebase/messaging.',
        );
      }
    }
    if (pushToken) {
      await userApi.updateFcmToken?.({ fcmToken: pushToken }).catch(() => {
        // Without the token on the server the rider receives NO pushes at all.
        // Queue it for retry; last-write-wins so a stale queued token never
        // overwrites a newer one.
        offlineQueue.enqueue('FCM_TOKEN', '/user/fcm-token', 'POST', { fcmToken: pushToken }, { replaceSameType: true });
      });
    }
  } catch (err) {
    // Non-fatal — push token registration can fail in Expo Go or simulators
  }
}

SplashScreen.preventAutoHideAsync();

/** Screens that show the shared root <AppBackground /> through their content
 *  view. ONLY safe on fade-animated screens — slide transitions over a
 *  transparent content view expose the native window (white) mid-flight. */
const TRANSPARENT_CONTENT = { backgroundColor: 'transparent' } as const;

/** Native push for detail screens: real iOS parallax slide + interactive
 *  swipe-back; explicit slide on Android. Requires opaque contentStyle. */
const detailPush = {
  animation: Platform.OS === 'ios' ? ('default' as const) : ('slide_from_right' as const),
  gestureEnabled: true,
};

const queryClient = new QueryClient({
  /**
   * NO LOGOUT LIVES HERE ANY MORE.
   *
   * BUGFIX ("i force-closed the app while my driver was coming and it made me
   * sign in with my number and the OTP all over again").
   *
   * This cache used to call `logout()` — which DELETES all three SecureStore
   * keys — on ANY query that ended in a 401. That single line quietly overrode
   * the whole of the refresh interceptor's carefully-drawn distinction between
   * "the server rejected your session" and "we could not reach the server", and
   * it did so from the one place that sees only the FINAL error of a query.
   *
   * The mechanism, exactly:
   *   1. The rider had the app open for a while, so the 15-minute access token
   *      was expired by the time they force-quit and reopened.
   *   2. The first authenticated query on cold start 401s. The interceptor takes
   *      over and tries to refresh — correctly, and with its own 3-attempt
   *      ladder.
   *   3. That refresh could not reach the server (this rider's network was bad
   *      enough that the tracking page was stuck reconnecting — see bug 19).
   *      Per its own contract the interceptor then leaves the credentials ALONE
   *      and rejects with the ORIGINAL error, which is a 401.
   *   4. React Query saw a 401, landed here, and wiped the session that step 3
   *      had just deliberately preserved. The refresh token was valid for 30
   *      days the whole time.
   *
   * `client.ts` is the single authority on session death: it is the only code
   * that knows whether the server actually answered, and it already calls
   * `onLogout()` (wired below) on a definitive 401/403 from `/auth/refresh`.
   * A 401 seen out here is either that same event arriving second-hand, or a
   * transient failure — and in neither case is tearing down the session this
   * layer's decision to make.
   */
  defaultOptions: {
    queries: {
      retry: (failureCount, error: any) => {
        // Never retry 401 — auth errors are permanent until re-login
        if ((error?.response?.status ?? error?.status) === 401) return false;
        return failureCount < 2;
      },
      staleTime: 1000 * 60 * 5, // 5 min
    },
  },
});

export default function RootLayout() {
  // OTA updates: check on launch/foreground, download in background, offer restart
  useOtaUpdates();
  // isExpoGo is derived above — used for conditional logic throughout
  const { loadFromStorage, accessToken, refreshToken, logout, login, isLoggedIn, isLoading } = useAuthStore();
  const segments = useSegments();
  const { load: loadTheme, isDark } = useThemeStore();
  const colors = useColors();
  const router = useRouter();

  const insets = useSafeAreaInsets();

  const [splashDone, setSplashDone] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  // Low Power Mode is deliberately NOT wired to the performance tier any more.
  // Forcing 'low' here killed the shader background, glow borders, glass blur
  // and morph animations in one go, so the rider app went visibly flat below
  // 20% battery while the driver app — which never had this hook — stayed
  // rich on the same phone. iOS already throttles animation under Low Power
  // Mode; see the note in packages/ui/src/effects/usePerformanceTier.ts.

  // Pause the Skia shader when a detailPush or opaque screen covers the root
  // background. All transparent-content screens (where-to, auth, join) sit at
  // depth ≤ 2 inside the root Stack; detailPush screens (profile/settings,
  // ride/[id]/seat, etc.) are at depth ≥ 3 — no blur layer behind them to run.
  const isOpaqueDetail = segments.length >= 3;
  /**
   * Offline banner, on Reanimated like everything else that moves in this app.
   *
   * It arrives on a spring and leaves on a timing curve: losing connectivity is
   * an event the rider should feel, regaining it should just clear. `springs` is
   * the shared token set, so this banner and the sheets it appears over move to
   * the same physics — see packages/config/src/motion.ts.
   */
  const offlineProgress = useSharedValue(0);
  const offlineBannerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -60 + offlineProgress.value * 60 }],
    opacity: offlineProgress.value,
  }));

  const [inAppBanner, setInAppBanner] = useState<{ title: string; body: string } | null>(null);
  const bannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showInAppBanner = useCallback((title: string, body: string) => {
    setInAppBanner({ title, body });
    if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current);
    bannerTimeoutRef.current = setTimeout(() => setInAppBanner(null), 4000);
  }, []);

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      const offline = !(state.isConnected ?? true);
      globalIsOffline = offline;
      setIsOffline(offline);
      offlineProgress.value = offline
        ? withSpring(1, springs.standard)
        : withTiming(0, { duration: 220 });
    });
    globalNetInfoUnsubscribe = unsub;
    return () => { unsub(); globalNetInfoUnsubscribe = null; };
  }, [offlineProgress]);

  const [fontsLoaded] = useFonts({
    Geist_300Light,
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
  });

  // RC2: Catch unhandled fatal errors in production (dev is handled above at module level)
  // BUGFIX: Captures to Sentry instead of console.error (which doesn't help prod users)
  useEffect(() => {
    if (!__DEV__ && GlobalErrorUtils.ErrorUtils) {
      const previousHandler = GlobalErrorUtils.ErrorUtils.getGlobalHandler();
      GlobalErrorUtils.ErrorUtils.setGlobalHandler((error: any, isFatal: any) => {
        if (isFatal) {
          captureException(error, { isFatal: true, source: 'globalHandler' });
        }
        if (previousHandler) previousHandler(error, isFatal);
      });
    }
  }, []);

  useEffect(() => {
    // RC3 / RM4: Configure API client first, THEN flush the offline queue
    // so queued requests have auth headers attached when replayed.
    // Intentionally runs once on mount — configures singleton API/socket clients
    // using store getters (not React state) so no deps are needed.
    //
    // RC6: In sideloaded production builds the compiled EXPO_PUBLIC_API_URL
    // points at a PC LAN IP that was unknown at build time.  Resolve it from
    // SecureStore so the user can set it once inside the app.
    resolveApiUrl().then((url) => {
      setApiBaseUrl(url);
    });

    configureApiClient({
      getAccessToken: () => useAuthStore.getState().accessToken,
      getRefreshToken: () => useAuthStore.getState().refreshToken,
      onTokenRefreshed: ({ accessToken, refreshToken }) => {
        // Rotation only — see auth.store's refreshTokens(). Calling login()
        // here cleared the ride store mid-trip.
        useAuthStore.getState().refreshTokens({ accessToken, refreshToken });
        // RC1: Re-authenticate socket with the new token
        refreshSocketAuth();
      },
      onLogout: () => {
        useAuthStore.getState().logout();
      },
    });

    configureSocket({
      getToken: () => useAuthStore.getState().accessToken,
    });

    // SECURITY: on logout, auth.store calls this to purge cross-user state that
    // it cannot reach itself — the module-scoped React Query cache and Sentry's
    // user context. Combined with ride-store clear + socket teardown in logout(),
    // this guarantees the next user inherits nothing from the previous session.
    registerLogoutCleanup(() => {
      queryClient.clear();
      setSentryUser(null);
    });

    // Hold outgoing requests until the stored session is back in memory. Without
    // this the first query of a cold start races SecureStore, goes out with no
    // Authorization header, 401s, and the refresh path reads the not-yet-loaded
    // refresh token as "there isn't one" — a definitive rejection, i.e. a
    // logout. See setAuthReadyGate.
    setAuthReadyGate(loadFromStorage());
    loadTheme();

    // RM4: Flush after configureApiClient so queued requests have auth headers
    offlineQueue.flushQueue();
    // R2: keep retrying queued actions on an interval — a single startup flush
    // leaves actions stuck if the first attempt fails while still offline.
    offlineQueue.startPeriodicFlush(60000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // R1: Refresh server state when the app returns to the foreground. Without
  // this, ride/trip data can be stale for minutes after the app was backgrounded
  // (the rider could miss a status change that happened while away).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      offlineQueue.flushQueue();
      queryClient.invalidateQueries({ queryKey: ['bookings', 'active'] });
      queryClient.invalidateQueries({ queryKey: ['bookings', 'active-root-listener'] });
      queryClient.invalidateQueries({ queryKey: ['trips'] });
    });
    return () => sub.remove();
  }, []);

  // Guard: once storage has loaded, if user is not authenticated and not already
  // on a public screen, redirect to phone auth. This catches the case where
  // React Navigation restores a cached (tabs) state while the session is invalid.
  useEffect(() => {
    if (isLoading) return;
    const inPublicArea = segments[0] === '(auth)' || segments[0] === '(onboarding)';
    if (!isLoggedIn && !inPublicArea) {
      router.replace('/(auth)/phone');
    }
  }, [isLoggedIn, isLoading, segments, router]);

  // Register for push notifications after user is logged in
  useEffect(() => {
    if (isLoggedIn) {
      registerForPushNotifications();
    }
  }, [isLoggedIn]);

  // Handle notification tap → deep link + foreground banner
  useEffect(() => {
    if (isExpoGo) return;
    try {
      const Notifications = require('expo-notifications');

      // Foreground banner handler — shows in-app banner when notification arrives while app is open
      const receivedSub = Notifications.addNotificationReceivedListener((notification: any) => {
        const title = notification.request.content.title ?? '';
        const body = notification.request.content.body ?? '';
        if (title || body) {
          showInAppBanner(title, body);
        }
      });

      const responseSub = Notifications.addNotificationResponseReceivedListener((response: any) => {
        const data = response.notification.request.content.data as Record<string, string | undefined>;
        const { type, tripId, bookingId, screen, deepLink } = data ?? {};
        // NOTE: the backend's actual push types are RIDE_CONFIRMED / RIDE_COMPLETE
        // (see eyego-api/src/services/push.service.js `notifications` wrappers) —
        // not TRIP_CONFIRMED / TRIP_COMPLETED. Keep these in sync with that file.
        if (type === 'RIDE_CONFIRMED' && bookingId) {
          router.push(`/ride/${bookingId}` as Href);
        } else if ((type === 'DRIVER_EN_ROUTE' || type === 'ARRIVED_AT_PICKUP' || type === 'DRIVER_ARRIVED') && (bookingId || tripId)) {
          // The persistent surface, not the retired tracking route. It carries
          // no id because it rehydrates from the server's active trip — which
          // is more reliable than this payload, where `bookingId` and `tripId`
          // were used interchangeably.
          router.push('/trip?stage=assigned' as Href);
        } else if ((type === 'CHAT_MESSAGE' || type === 'PRIVATE_CHAT') && tripId) {
          router.push(`/ride/${tripId}/chat` as Href);
        } else if (type === 'RIDE_COMPLETE' && bookingId) {
          router.push(`/ride/${bookingId}/complete` as Href);
        } else if (type === 'TRIP_CANCELLED_NO_SHOW') {
          router.push('/(tabs)/trips' as Href);
        } else if (tripId) {
          router.push('/trip?stage=assigned' as Href);
        } else if (screen) {
          router.push(screen as Href);
        } else if (deepLink) {
          router.push(deepLink as Href);
        }
      });

      return () => {
        responseSub.remove();
        receivedSub.remove();
        if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current);
      };
    } catch (e) {
      console.warn('[Notifications] Error in response listener:', e);
    }
  }, [router, showInAppBanner]);

  // Handle invite deep links (e.g. eyego://join/abc123 or https://eyego.app/invite/abc123)
  useEffect(() => {
    const handleUrl = ({ url }: { url: string }) => {
      try {
        const parsed = Linking.parse(url);
        const path = parsed.path ?? '';
        // Match both /invite/:token and /join/:token path formats
        const inviteMatch = path.match(/(?:invite|join)\/([a-zA-Z0-9]+)/);
        if (inviteMatch) {
          router.push(`/join/${inviteMatch[1]}` as Href);
        }
      } catch (e) {
        console.warn('[Linking] Failed to parse URL:', e);
      }
    };

    // Handle links that open the app from cold start
    Linking.getInitialURL().then((url) => {
      if (url) handleUrl({ url });
    });

    // Handle links while app is running
    const sub = Linking.addEventListener('url', handleUrl);
    return () => sub.remove();
  }, [router]);

  // React Navigation theme — the LAST line of defense behind every screen.
  // Without this, expo-router falls back to the default light theme and any
  // transparent scene (tabs) or in-flight transition exposes a WHITE fill.
  const navTheme = useMemo<Theme>(
    () => ({
      ...DarkTheme,
      dark: isDark,
      colors: {
        ...DarkTheme.colors,
        primary: colors.primary,
        background: colors.backgroundDeep,
        card: colors.backgroundDeep,
        text: colors.onSurface,
        border: colors.rimLightSubtle,
        notification: colors.primary,
      },
    }),
    [isDark, colors]
  );

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#0A0A0B' }} />;
  }

  if (!splashDone) {
    return <SplashAnimation onComplete={() => setSplashDone(true)} />;
  }

  return (
    <ColorsProvider value={colors}>
    <ThemeProvider value={navTheme}>
    <I18nextProvider i18n={i18n}>
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.backgroundDeep }}>
      <KeyboardProvider>
        <AmbientRotationProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={colors.backgroundDeep} />
          {/* Ambient premium background — fade-group screens (transparent
              contentStyle below) show this instead of a flat fill. */}
          <AppBackground isDark={isDark} paused={isOpaqueDetail} />
          {/* MorphProvider hosts the container-transform overlay: it must
              wrap the Stack (sources/targets live inside screens) and its
              overlay renders above every screen but below toasts/banners. */}
          <MorphProvider>
          <Stack
            screenOptions={{
              headerShown: false,
              // Opaque by default: pushed screens MUST NOT be transparent or
              // iOS native-stack slide transitions expose the window behind
              // them mid-flight (the "white flash / covering lag" bug).
              contentStyle: { backgroundColor: colors.backgroundDeep },
              animation: 'fade',
            }}
          >
            {/* Fade-group screens share the root AppBackground through a
                transparent content view — safe because fades never slide. */}
            <Stack.Screen name="index" options={{ contentStyle: TRANSPARENT_CONTENT }} />
            <Stack.Screen name="(auth)" options={{ animation: 'fade', contentStyle: TRANSPARENT_CONTENT }} />
            <Stack.Screen name="(onboarding)" options={{ animation: 'fade', contentStyle: TRANSPARENT_CONTENT }} />
            <Stack.Screen name="(tabs)" options={{ animation: 'fade', contentStyle: TRANSPARENT_CONTENT }} />
            <Stack.Screen
              name="trip"
              options={{
                // The persistent trip surface (search → … → tracking stages).
                // Morph target: the where-to pill flies into this screen via
                // the MorphProvider overlay, so the route itself must not
                // animate. transparentModal keeps home mounted beneath while
                // the screen's own entrance fade runs.
                animation: 'none',
                presentation: 'transparentModal',
                contentStyle: TRANSPARENT_CONTENT,
                gestureEnabled: false,
              }}
            />
            {/* Legacy deep-link stub — redirects to /trip. */}
            <Stack.Screen
              name="where-to"
              options={{ animation: 'none', presentation: 'transparentModal', contentStyle: TRANSPARENT_CONTENT }}
            />
            <Stack.Screen
              name="ride/select"
              options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
            />
            <Stack.Screen
              name="ride/[id]"
              options={{
                /**
                 * A MORPH TARGET RUNS NO ROUTE ANIMATION OF ITS OWN.
                 *
                 * BUGFIX (the inconsistency half of "some morphs are fast and
                 * barely seen, some are super laggy — make it consistent
                 * app-wide"). This was `'fade'`, which is react-native-screens
                 * running its own ~350 ms cross-fade of the WHOLE destination
                 * screen at the same time as, and out of step with, the clone
                 * flying across it. Two uncoordinated animations describing the
                 * same navigation is what reads as mush.
                 *
                 * `'none'` is what the `/trip` surface — the one morph that was
                 * reported as feeling right — has always used. The clone owns
                 * the forward motion; MorphTarget fades the real content in
                 * against the same progress value, so the handover is one
                 * animation with one clock. `gestureEnabled` still gives the
                 * native swipe-back.
                 */
                animation: 'none',
                gestureEnabled: true,
              }}
            />
            <Stack.Screen
              name="ride/[id]/payment"
              options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
            />
            <Stack.Screen
              name="ride/[id]/tracking"
              options={{ animation: 'fade', gestureEnabled: false }}
            />
            <Stack.Screen
              name="ride/[id]/complete"
              options={{ animation: 'fade', gestureEnabled: false }}
            />
            <Stack.Screen
              name="ride/[id]/seat"
              options={detailPush}
            />
            <Stack.Screen
              name="ride/[id]/invite"
              options={detailPush}
            />
            <Stack.Screen
              name="ride/[id]/chat"
              options={detailPush}
            />
            <Stack.Screen
              name="ride/[id]/sos"
              options={{ animation: 'fade', gestureEnabled: false }}
            />
            <Stack.Screen
              name="profile/edit"
              options={{
                // Morph target: the profile avatar flies into this screen via
                // the MorphProvider overlay. `'none'`, not `'fade'` — see the
                // note on ride/[id]: a route animation running alongside the
                // clone is a second, unsynchronised description of the same
                // navigation, and it is most of why this particular morph was
                // reported as "really bad".
                animation: 'none',
                gestureEnabled: true,
              }}
            />
            <Stack.Screen
              name="profile/help"
              options={detailPush}
            />
            <Stack.Screen
              name="profile/privacy"
              options={detailPush}
            />
            <Stack.Screen
              name="profile/wallet"
              options={detailPush}
            />
            <Stack.Screen
              name="profile/settings"
              options={detailPush}
            />
            <Stack.Screen
              name="profile/promotions"
              options={detailPush}
            />
            <Stack.Screen
              name="profile/saved-places"
              options={detailPush}
            />
            <Stack.Screen
              name="profile/business"
              options={detailPush}
            />
            <Stack.Screen
              name="profile/payment-methods"
              options={detailPush}
            />
            <Stack.Screen
              name="profile/emergency-contacts"
              options={detailPush}
            />
            <Stack.Screen
              name="profile/notification-preferences"
              options={detailPush}
            />
            <Stack.Screen
              name="profile/terms"
              options={detailPush}
            />
            <Stack.Screen
              name="profile/account-deletion"
              options={detailPush}
            />
            <Stack.Screen
              name="ride/schedule"
              options={{
                animation: 'slide_from_bottom',
                presentation: 'modal',
                gestureEnabled: true,
              }}
            />
            <Stack.Screen
              name="ride/request"
              options={{ animation: 'slide_from_bottom', presentation: 'modal', gestureEnabled: false }}
            />
            <Stack.Screen
              name="ride/[id]/cancel"
              options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
            />
            <Stack.Screen
              name="ride/[id]/dispute"
              options={detailPush}
            />
            <Stack.Screen
              name="ride/reserve"
              options={detailPush}
            />
            <Stack.Screen
              name="ride/guest-selection"
              // Edge-swipe-back was silently discarding typed guest name/phone
              // (handleContinue never runs, no confirmation) — this is a form
              // with its own header back button and Continue action, so the
              // redundant swipe gesture is disabled rather than guarded.
              options={{ ...detailPush, gestureEnabled: false }}
            />
            <Stack.Screen
              name="ride/[id]/rate-tip"
              options={{ animation: 'fade', gestureEnabled: false }}
            />
            <Stack.Screen
              name="payment/add-card"
              options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
            />
            <Stack.Screen
              name="join/[token]"
              options={{ animation: 'fade', contentStyle: TRANSPARENT_CONTENT }}
            />
          </Stack>
          </MorphProvider>
          {/* Connectivity banner — slides down from top when offline */}
          <Animated.View
            style={[
              {
                position: 'absolute',
                top: 54,
                left: 16,
                right: 16,
                zIndex: 100,
              },
              offlineBannerStyle,
            ]}
            pointerEvents={isOffline ? 'auto' : 'none'}
          >
            <View
              style={{
                backgroundColor: '#EF4444',
                borderRadius: 12,
                paddingHorizontal: 16,
                paddingVertical: 10,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                shadowColor: '#EF4444',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.3,
                shadowRadius: 8,
                elevation: 6,
              }}
            >
              <Ionicons name="cloud-offline-outline" size={16} color="#fff" />
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontFamily: 'Geist_600SemiBold',
                    fontSize: 12,
                    lineHeight: Math.round(12 * 1.3),
                    color: '#fff',
                    letterSpacing: 0.5,
                  }}
                >
                  No internet connection
                </Text>
                <Text
                  style={{
                    fontFamily: 'Geist_400Regular',
                    fontSize: 11,
                    lineHeight: Math.round(11 * 1.3),
                    color: 'rgba(255,255,255,0.8)',
                    marginTop: 2,
                  }}
                >
                  Some features may be unavailable
                </Text>
              </View>
            </View>
          </Animated.View>
          {/* Global trip-status banner — rendered AFTER Stack so it layers above all screens */}
          <TripStatusListener />
          {/* "Verify My Ride" — the rider's boarding code, raised when the
              driver arrives or asks for it. Root-mounted so it can appear over
              the tracking surface, the chat, or anything else. */}
          <BoardingPinSheet />
          {/* Global error / success toast — sits above all other overlays */}
          <GlobalToast />
          {/* Global foreground push notification banner */}
          {inAppBanner && (
            <View
              style={{
                position: 'absolute',
                top: insets.top + 8,
                left: 16,
                right: 16,
                backgroundColor: '#1e1e2e',
                borderRadius: 14,
                borderWidth: 1,
                borderColor: 'rgba(75,226,119,0.4)',
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
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }} numberOfLines={1}>{inAppBanner.title}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }} numberOfLines={2}>{inAppBanner.body}</Text>
            </View>
          )}
        </QueryClientProvider>
        </AmbientRotationProvider>
      </KeyboardProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
    </I18nextProvider>
    </ThemeProvider>
    </ColorsProvider>
  );
}
