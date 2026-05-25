import '../global.css';
import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
import * as Notifications from 'expo-notifications';
import { configureApiClient, configureSocket, driverApi } from '@eyego/api';
import { useDriverStore } from '../stores/driver.store';
import { driverColors, driverLightColors } from '../utils/useColors';

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

async function registerForPushNotifications() {
  try {
    // Android requires an explicit notification channel
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('trips', {
        name: 'Trip Notifications',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#3B82F6',
      });
    }

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return;

    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;

    // Register token with the backend so the server can push to this device
    await driverApi.updateFcmToken(token).catch(() => {
      // Non-fatal — token will sync on next login
      console.warn('[PushNotifications] Failed to register token with backend');
    });
  } catch (e) {
    console.warn('[PushNotifications] Setup failed:', e);
  }
}

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
    configureApiClient({
      getAccessToken: () => useDriverStore.getState().accessToken,
      getRefreshToken: () => useDriverStore.getState().refreshToken,
      onTokenRefreshed: ({ accessToken, refreshToken }) => {
        useDriverStore.getState().login({ accessToken, refreshToken });
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
  }, []);

  // Register for push notifications once the driver is logged in
  useEffect(() => {
    if (!isLoggedIn) return;
    registerForPushNotifications();
  }, [isLoggedIn]);

  // Handle notification taps — navigate to the relevant screen
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, any>;
      if (data?.type === 'TRIP_ASSIGNED' && data?.tripId) {
        router.push({
          pathname: '/(trip)/dispatch/[id]',
          params: {
            id: data.tripId,
            origin: data.routeOrigin ?? '',
            destination: data.routeDestination ?? '',
            departureTime: data.departureTime ?? '',
            expiresAt: data.expiresAt ?? '',
          },
        } as any);
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (isLoading) return;
    const inAuth = segments[0] === '(auth)';
    if (!isLoggedIn && !inAuth) {
      router.replace('/(auth)/phone');
    }
  }, [isLoggedIn, isLoading, segments]);

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <QueryClientProvider client={queryClient}>
        <StatusBar style={theme === 'light' ? 'dark' : 'light'} backgroundColor={colors.backgroundDeep} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
            animation: 'fade_from_bottom',
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
          <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
          <Stack.Screen
            name="(trip)/create"
            options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
          />
          <Stack.Screen
            name="(trip)/active/[id]"
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
            options={{ animation: 'fade', gestureEnabled: false }}
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
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
