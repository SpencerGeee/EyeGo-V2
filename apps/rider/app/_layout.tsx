import '../global.css';
import '../i18n';
import React, { useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n';
import MapboxGL from '../utils/mapbox';

MapboxGL.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? 'pk.eyJ1Ijoic3BlbmNlcmdlZWUiLCJhIjoiY21wYmIycDA3MDNjZTMyc2Jqb3Y4dHpkdyJ9.ddGHkuKhBnc2dooWiIVjWQ');
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform, View } from 'react-native';
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
import { configureApiClient, configureSocket, userApi } from '@eyego/api';
import { useColors } from '../utils/useColors';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { offlineQueue } from '../utils/offlineQueue';
import { TripStatusListener } from '../components/TripStatusListener';

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
  console.log('[EyeGo] RootLayout mounting — isExpoGo:', isExpoGo, 'appOwnership:', Constants.appOwnership);
  const { loadFromStorage, accessToken, refreshToken, logout, login, isLoggedIn, isLoading } = useAuthStore();
  const segments = useSegments();
  const { load: loadTheme, isDark } = useThemeStore();
  const colors = useColors();
  const router = useRouter();

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

  useEffect(() => {
    // Flush the offline queue on app boot
    offlineQueue.flushQueue();

    // Wire up API client token callbacks
    configureApiClient({
      getAccessToken: () => useAuthStore.getState().accessToken,
      getRefreshToken: () => useAuthStore.getState().refreshToken,
      onTokenRefreshed: ({ accessToken, refreshToken }) => {
        const user = useAuthStore.getState().user!;
        login(user, { accessToken, refreshToken });
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
  }, [isLoggedIn, isLoading, segments]);

  // Register for push notifications after user is logged in
  useEffect(() => {
    if (isLoggedIn) {
      registerForPushNotifications();
    }
  }, [isLoggedIn]);

  // Handle notification tap → deep link
  useEffect(() => {
    if (isExpoGo) return;
    try {
      const Notifications = require('expo-notifications');
      const subscription = Notifications.addNotificationResponseReceivedListener((response: any) => {
        const data = response.notification.request.content.data as any;
        if (data?.tripId) {
          router.push(`/ride/${data.tripId}/tracking` as any);
        } else if (data?.screen) {
          router.push(data.screen as any);
        } else if (data?.deepLink) {
          router.push(data.deepLink as any);
        }
      });
      return () => subscription.remove();
    } catch (e) {
      console.warn('[Notifications] Error in response listener:', e);
    }
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
    console.log('[EyeGo] Waiting for fonts…');
    return <View style={{ flex: 1, backgroundColor: colors.backgroundDeep ?? '#0a0a0a' }} />;
  }
  console.log('[EyeGo] Fonts loaded — rendering Stack');

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
          {/* Global trip-status banner — rendered AFTER Stack so it layers above all screens */}
          <TripStatusListener />
        </QueryClientProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
    </I18nextProvider>
  );
}
