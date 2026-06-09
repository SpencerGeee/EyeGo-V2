import '../global.css';
import '../i18n';
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n';
import MapboxGL from '../utils/mapbox';

MapboxGL.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? 'pk.eyJ1Ijoic3BlbmNlcmdlZWUiLCJhIjoiY21wYmIycDA3MDNjZTMyc2Jqb3Y4dHpkdyJ9.ddGHkuKhBnc2dooWiIVjWQ');
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform, View, Animated } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Constants from 'expo-constants';
import {
  useFonts,
  SpaceGrotesk_300Light,
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import {
  Inter_300Light,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import * as SplashScreen from 'expo-splash-screen';
import { useAuthStore } from '../stores/auth.store';
import { useThemeStore } from '../stores/theme.store';
import { configureApiClient, configureSocket, refreshSocketAuth, userApi } from '@eyego/api';
import { useColors } from '../utils/useColors';
import { Text } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { initSentry, captureException } from '../lib/sentry';
import { offlineQueue } from '../utils/offlineQueue';

// Initialize crash/error tracking as early as possible (no-op without DSN)
initSentry();
import { TripStatusListener } from '../components/TripStatusListener';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import * as Linking from 'expo-linking';

// Global JS Exception Handler for robust dev logging
if (global.ErrorUtils && __DEV__) {
  const previousHandler = global.ErrorUtils.getGlobalHandler();
  global.ErrorUtils.setGlobalHandler((error: any, isFatal: any) => {
    console.error('🚨 [FATAL GLOBAL EXCEPTION] React Native crashed:', error, 'isFatal:', isFatal);
    if (previousHandler) {
      previousHandler(error, isFatal);
    }
  });
}

// SDK 54: appOwnership === 'expo' is the reliable Expo Go signal
const isExpoGo =
  Constants.appOwnership === 'expo' ||
  (Constants as any).executionEnvironment === 'storeClient';

// ── Global connectivity observer ──
let globalNetInfoUnsubscribe: (() => void) | null = null;
let globalIsOffline = false;
// Exported so any screen or component can read the latest value synchronously
export function isGloballyOffline(): boolean { return globalIsOffline; }
export function getGlobalNetInfoUnsubscribe(): (() => void) | null { return globalNetInfoUnsubscribe; }

// Handle foreground notifications
if (!isExpoGo) {
  try {
    const Notifications = require('expo-notifications');
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });
  } catch (e) {
    console.warn('[Notifications] Failed to load module:', e);
  }
}

async function registerForPushNotifications() {
  if (isExpoGo) return;
  try {
    const Notifications = require('expo-notifications');
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') return;

    const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    await (userApi as any).updateFcmToken?.({ fcmToken: tokenData.data }).catch(() => {});
  } catch (err) {
    // Non-fatal — push token registration can fail in Expo Go or simulators
  }
}

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
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
    SpaceGrotesk_300Light,
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
    Inter_300Light,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  // RC2: Catch unhandled fatal errors in production (dev is handled above at module level)
  useEffect(() => {
    if (!__DEV__ && global.ErrorUtils) {
      const previousHandler = global.ErrorUtils.getGlobalHandler();
      global.ErrorUtils.setGlobalHandler((error: any, isFatal: any) => {
        if (isFatal) {
          captureException(error, { isFatal: true, source: 'globalHandler' });
          console.error('Fatal error:', error);
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

    loadFromStorage();
    loadTheme();

    // RM4: Flush after configureApiClient so queued requests have auth headers
    offlineQueue.flushQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        const data = response.notification.request.content.data as any;
        const { type, tripId, bookingId, screen, deepLink } = data ?? {};
        if (type === 'TRIP_CONFIRMED' && bookingId) {
          router.push(`/ride/${bookingId}` as any);
        } else if ((type === 'DRIVER_EN_ROUTE' || type === 'ARRIVED_AT_PICKUP') && bookingId) {
          router.push(`/ride/${bookingId}/tracking` as any);
        } else if ((type === 'CHAT_MESSAGE' || type === 'PRIVATE_CHAT') && tripId) {
          router.push(`/ride/${tripId}/chat` as any);
        } else if (type === 'TRIP_COMPLETED' && bookingId) {
          router.push(`/ride/${bookingId}/complete` as any);
        } else if (type === 'SOS_RESOLVED' && tripId) {
          router.push(`/ride/${tripId}/tracking` as any);
        } else if (tripId) {
          router.push(`/ride/${tripId}/tracking` as any);
        } else if (screen) {
          router.push(screen as any);
        } else if (deepLink) {
          router.push(deepLink as any);
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
          router.push(`/join/${inviteMatch[1]}` as any);
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

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded]);

  // Safety net: if fonts never load (edge case on some Android devices),
  // force-hide the splash after 4 seconds so the app is never permanently stuck.
  useEffect(() => {
    const timer = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => {});
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: colors.backgroundDeep ?? '#0a0a0a' }} />;
  }

  return (
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
                    fontFamily: 'SpaceGrotesk_600SemiBold',
                    fontSize: 12,
                    color: '#fff',
                    letterSpacing: 0.5,
                  }}
                >
                  No internet connection
                </Text>
                <Text
                  style={{
                    fontFamily: 'Inter_400Regular',
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
  );
}
