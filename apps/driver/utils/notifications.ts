import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotifications(accessToken?: string): Promise<string | null> {
  if (Platform.OS === 'android') {
    // Channel id MUST match the backend FCM payload (channelId 'eyego_default'
    // in push.service.js) or Android 8+ silently drops the notification.
    await Notifications.setNotificationChannelAsync('eyego_default', {
      name: 'EyeGo Driver',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      sound: 'default',
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;

  try {
    // Backend pushes via Firebase Admin (FCM) → needs the NATIVE device token,
    // not an Expo push token. The authoritative registration lives in
    // _layout.tsx; this util mirrors it so a future caller can't reintroduce
    // the Expo-token mismatch.
    const token = (await Notifications.getDevicePushTokenAsync()).data;

    // Send token to backend so server can push when app is backgrounded.
    // Works once Firebase Admin credentials are configured on the server.
    // Backend serves /v1 (NOT /api/v1) — the old default 404'd in dev.
    const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/v1';
    const isSecure = apiUrl.startsWith('https://');
    const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
    if (token && accessToken && (isDev || isSecure)) {
      try {
        // Driver tokens register at /driver/fcm-token (the /users/* route is the
        // rider endpoint and would 404 for a driver session).
        await fetch(`${apiUrl}/driver/fcm-token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ fcmToken: token }),
        });
      } catch {
        // Non-blocking — will retry on next session
      }
    }
    return token;
  } catch {
    return null;
  }
}

/** Fire an immediate local notification. Works in both foreground and background. */
export function scheduleLocalNotification(
  title: string,
  body: string,
  data?: Record<string, any>,
) {
  return Notifications.scheduleNotificationAsync({
    content: { title, body, data: data ?? {}, sound: 'default' },
    trigger: null,
  });
}
