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
import { configureApiClient, configureSocket, connectDriverSocket, driverApi, driverSocketEvents } from '@eyego/api';
import { useDriverStore } from '../stores/driver.store';
import { driverColors, driverLightColors } from '../utils/useColors';
import { initSentry, captureException } from '../lib/sentry';
import { DriverTripStatusListener } from '../components/DriverTripStatusListener';

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
  title: { fontFamily: 'Geist_700Bold', fontSize: 22, color: '#fff', marginBottom: 12, textAlign: 'center' },
  message: { fontSize: 14, color: '#94A3B8', textAlign: 'center', marginBottom: 32, lineHeight: 20 },
  button: { backgroundColor: '#3B82F6', paddingHorizontal: 28, paddingVertical: 14, borderRadius: 12 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
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

    // Backend pushes via Firebase Admin (FCM) → needs the NATIVE device token,
    // not an Expo push token. (Requires a dev/EAS build with google-services.json
    // — see NOTIFICATIONS_SETUP.md.)
    const tokenData = await Notifications.getDevicePushTokenAsync();
    const token = tokenData?.data;
    if (!token) return;

    // Register token with the backend so the server can push to this device
    await driverApi.updateFcmToken(token).catch(() => {
      // Non-fatal — token will sync on next login
      console.warn('[PushNotifications] Failed to register token with backend');
    });
  } catch (e) {
    console.warn('[PushNotifications] Setup failed:', e);
  }
}

/** Fade-group screens show the shared root <AppBackground /> through their
 *  content view — mirrors the rider app so blur/glow surfaces read correctly
 *  against the ambient background instead of a flat fill. */
const TRANSPARENT_CONTENT = { backgroundColor: 'transparent' } as const;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, staleTime: 1000 * 60 * 5 },
  },
});

export default function RootLayout() {
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
      },
      onLogout: () => {
        useDriverStore.getState().logout();
      },
      getRefreshUrl: () => '/auth/driver/refresh',
    });

    configureSocket({
      getToken: () => useDriverStore.getState().accessToken,
    });

    loadFromStorage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Register for push notifications once the driver is logged in.
  // Also listen for token rotation so the backend always has the latest FCM token.
  useEffect(() => {
    if (!isLoggedIn) return;
    registerForPushNotifications();

    const tokenSubscription = Notifications.addPushTokenListener(async (newToken) => {
      try {
        await driverApi.updateFcmToken(newToken.data);
      } catch (err) {
        console.warn('[FCM] Token refresh failed:', err);
      }
    });

    return () => {
      tokenSubscription.remove();
    };
  }, [isLoggedIn]);

  // Handle notification taps — navigate to the relevant screen
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, any>;
      const { type, tripId } = data ?? {};
      if (type === 'TRIP_ASSIGNED' && tripId) {
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
      } else if (type === 'DISPATCH_REQUEST' && tripId) {
        router.push({ pathname: '/(trip)/dispatch/[id]', params: { id: tripId } } as any);
      } else if (type === 'CHAT_MESSAGE' && tripId) {
        router.push({ pathname: '/(trip)/chat/[id]', params: { id: tripId } } as any);
      }
    });
    return () => sub.remove();
  }, [router]);

  // Foreground notification handler — shows in-app banner when push arrives while app is open
  useEffect(() => {
    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
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

  // Reconnect driver socket when app returns to foreground (e.g. after phone lock)
  useEffect(() => {
    if (!isLoggedIn) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        connectDriverSocket();
        // Re-join the active trip room on foreground reconnect so live updates
        // (chat, seat, location) keep flowing — the socket dropped room
        // membership while backgrounded.
        const activeTripId = useDriverStore.getState().activeTripId;
        if (activeTripId) {
          driverSocketEvents.emitJoinTracking?.(activeTripId);
        }
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
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="(trip)/tracking/[id]"
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="(trip)/detail/[id]"
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="(trip)/chat/[id]"
            options={{ animation: 'slide_from_right' }}
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
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="(profile)/payout-account"
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="(profile)/account-deletion"
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="(profile)/terms"
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="(profile)/privacy"
            options={{ animation: 'slide_from_right' }}
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
            options={{ animation: 'slide_from_right' }}
          />
        </Stack>
        </MorphProvider>
        {/* Off-screen parity: app-wide socket banners (chat/dispatch/status) +
            cache invalidation, mirroring the rider TripStatusListener. */}
        {isLoggedIn && <DriverTripStatusListener />}
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
