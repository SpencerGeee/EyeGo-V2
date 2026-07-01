import '../global.css';
import '../i18n';
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n';
import { Stack, useRouter, useSegments, type Href } from 'expo-router';
import { SplashAnimation } from '../components/SplashAnimation';
import { StatusBar } from 'expo-status-bar';
import { Platform, View, Animated, AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient, QueryClientProvider, QueryCache } from '@tanstack/react-query';
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
import { configureApiClient, configureSocket, refreshSocketAuth, setApiBaseUrl, userApi } from '@eyego/api';
import { resolveApiUrl } from '../stores/api.store';
import { useColors } from '../utils/useColors';
import { Text, ColorsProvider } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { initSentry, captureException, setUser as setSentryUser } from '../lib/sentry';
import { offlineQueue } from '../utils/offlineQueue';

// Initialize crash/error tracking as early as possible (no-op without DSN)
initSentry();
import { TripStatusListener } from '../components/TripStatusListener';
import { GlobalToast } from '../components/GlobalToast';
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

    // The backend pushes via Firebase Admin (FCM), which requires the NATIVE
    // device token — NOT an Expo push token. getDevicePushTokenAsync() returns
    // the FCM registration token on Android / APNs token on iOS. (Requires a
    // dev/EAS build with google-services.json — see NOTIFICATIONS_SETUP.md.)
    const tokenData = await Notifications.getDevicePushTokenAsync();
    if (tokenData?.data) {
      await userApi.updateFcmToken?.({ fcmToken: tokenData.data }).catch(() => {});
    }
  } catch (err) {
    // Non-fatal — push token registration can fail in Expo Go or simulators
  }
}

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error: any) => {
      const status = error?.response?.status ?? error?.status;
      if (status === 401) {
        // Token expired or invalid — clear auth state so the redirect
        // useEffect in RootLayout sends the user back to the phone screen.
        useAuthStore.getState().logout().catch(() => {});
      }
    },
  }),
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
  // isExpoGo is derived above — used for conditional logic throughout
  const { loadFromStorage, accessToken, refreshToken, logout, login, isLoggedIn, isLoading } = useAuthStore();
  const segments = useSegments();
  const { load: loadTheme, isDark } = useThemeStore();
  const colors = useColors();
  const router = useRouter();

  const insets = useSafeAreaInsets();

  const [splashDone, setSplashDone] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const offlineAnim = useRef(new Animated.Value(0)).current;

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
      Animated.timing(offlineAnim, {
        toValue: offline ? 1 : 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
    });
    globalNetInfoUnsubscribe = unsub;
    return () => { unsub(); globalNetInfoUnsubscribe = null; };
  }, [offlineAnim]);

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
        const user = useAuthStore.getState().user!;
        login(user, { accessToken, refreshToken });
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

    loadFromStorage();
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
        if (type === 'TRIP_CONFIRMED' && bookingId) {
          router.push(`/ride/${bookingId}` as Href);
        } else if ((type === 'DRIVER_EN_ROUTE' || type === 'ARRIVED_AT_PICKUP') && bookingId) {
          router.push(`/ride/${bookingId}/tracking` as Href);
        } else if ((type === 'CHAT_MESSAGE' || type === 'PRIVATE_CHAT') && tripId) {
          router.push(`/ride/${tripId}/chat` as Href);
        } else if (type === 'TRIP_COMPLETED' && bookingId) {
          router.push(`/ride/${bookingId}/complete` as Href);
        } else if (type === 'SOS_RESOLVED' && tripId) {
          router.push(`/ride/${tripId}/tracking` as Href);
        } else if (tripId) {
          router.push(`/ride/${tripId}/tracking` as Href);
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

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#091009' }} />;
  }

  if (!splashDone) {
    return <SplashAnimation onComplete={() => setSplashDone(true)} />;
  }

  return (
    <ColorsProvider value={colors}>
    <I18nextProvider i18n={i18n}>
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
        <QueryClientProvider client={queryClient}>
          <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={colors.backgroundDeep} />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background },
              animation: 'fade_from_bottom',
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
            <Stack.Screen name="(onboarding)" options={{ animation: 'fade' }} />
            <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
            <Stack.Screen
              name="where-to"
              options={{ animation: 'slide_from_bottom', presentation: 'modal', gestureEnabled: true }}
            />
            <Stack.Screen
              name="ride/select"
              options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
            />
            <Stack.Screen
              name="ride/[id]"
              options={{ animation: 'slide_from_right' }}
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
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="ride/[id]/invite"
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="ride/[id]/chat"
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="ride/[id]/sos"
              options={{ animation: 'fade', gestureEnabled: false }}
            />
            <Stack.Screen
              name="profile/edit"
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="profile/help"
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="profile/privacy"
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="profile/wallet"
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="profile/settings"
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="profile/promotions"
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="profile/saved-places"
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="profile/business"
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="profile/payment-methods"
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="profile/emergency-contacts"
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="profile/notification-preferences"
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="profile/terms"
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="profile/account-deletion"
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="ride/schedule"
              options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
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
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="ride/reserve"
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="ride/guest-selection"
              options={{ animation: 'slide_from_right' }}
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
              options={{ animation: 'fade' }}
            />
          </Stack>
          {/* Connectivity banner — slides down from top when offline */}
          <Animated.View
            style={{
              position: 'absolute',
              top: 54,
              left: 16,
              right: 16,
              zIndex: 100,
              transform: [{
                translateY: offlineAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-60, 0],
                }),
              }],
              opacity: offlineAnim,
            }}
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
      </GestureHandlerRootView>
    </ErrorBoundary>
    </I18nextProvider>
    </ColorsProvider>
  );
}
