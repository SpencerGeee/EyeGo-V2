import * as Notifications from 'expo-notifications';

// The authoritative Notifications.setNotificationHandler() call and push-token
// registration both live in _layout.tsx. A second module-scope handler here
// (this file used to have one) raced it on import — whichever ran last won,
// silently dropping the other's fields. Same bug class rider hit and fixed;
// this file now only exports what nothing else already owns.

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
