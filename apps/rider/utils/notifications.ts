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
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;

  try {
    const token = (await Notifications.getExpoPushTokenAsync({
      projectId: 'eyego-v2', // replace with your EAS projectId from app.json/eas.json
    })).data;

    // Register token with backend
    if (token && accessToken) {
      try {
        await fetch(`${process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1'}/users/fcm-token`, {
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
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}
