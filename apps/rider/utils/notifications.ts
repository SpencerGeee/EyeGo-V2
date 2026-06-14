import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// BUGFIX: Removed duplicate Notifications.setNotificationHandler() call —
// _layout.tsx already registers this handler before this module is loaded.
// Having two handlers register causes unpredictable behavior: the second one
// wins, making the first dead code. The layout's handler is the authoritative one.

export async function registerForPushNotifications(accessToken?: string): Promise<string | null> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;

  try {
    // The backend pushes via Firebase Admin (FCM) → it needs the NATIVE device
    // token (FCM registration token on Android / APNs token on iOS), NOT an Expo
    // push token. Requires a dev/EAS build with google-services.json. The
    // authoritative registration lives in _layout.tsx; this util mirrors it so a
    // future caller can't reintroduce the Expo-token mismatch.
    const token = (await Notifications.getDevicePushTokenAsync()).data;

    // Register token with backend — only over HTTPS in production.
    // Backend serves /v1 (NOT /api/v1) and the rider FCM route is /user/fcm-token
    // (singular). The previous '/api/v1' default + '/users' path both 404'd.
    const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/v1';
    const isSecure = apiUrl.startsWith('https://');
    const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
    if (token && accessToken && (isDev || isSecure)) {
      try {
        await fetch(`${apiUrl}/user/fcm-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ fcmToken: token }),
        });
      } catch {
        // Non-blocking — token will be registered on next login
      }
    }
    return token;
  } catch {
    // Development — Expo push token requires a real device and EAS projectId
    return null;
  }
}

export function scheduleLocalNotification(title: string, body: string, data?: Record<string, any>) {
  return Notifications.scheduleNotificationAsync({
    content: { title, body, data: data ?? {} },
    trigger: null, // immediate
  });
}

export function setupNotificationHandlers() {
  // BUGFIX: No-op to prevent duplicate handler registration.
  // The handler is set up in _layout.tsx with proper try/catch and module-load guard.
}
