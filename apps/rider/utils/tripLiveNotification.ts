import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Android "ongoing" trip notification — the Android-side equivalent of the
// iOS Live Activity (see native Live Activity work for iOS). Re-scheduling
// with the same `identifier` updates the existing tray notification in place
// rather than stacking a new one, giving a live-updating ETA while the app is
// backgrounded, matching Uber/Bolt's persistent trip notification on Android.
// iOS gets the real lock-screen Live Activity instead — this module no-ops there.
const NOTIFICATION_ID = 'eyego-trip-live';

const STATUS_LABEL: Record<string, string> = {
  DRIVER_EN_ROUTE: 'Driver is on the way',
  ARRIVED_AT_PICKUP: 'Driver has arrived',
  IN_PROGRESS: 'Trip in progress',
};

let currentStatus: string | null = null;
let currentEta: number | null = null;

async function present(status: string, etaMinutes: number | null) {
  if (Platform.OS !== 'android') return;
  const title = STATUS_LABEL[status] ?? 'Your EyeGo trip';
  const body =
    status === 'IN_PROGRESS'
      ? 'Enjoy your ride'
      : etaMinutes != null
        ? `Arriving in ~${etaMinutes} min`
        : 'Tracking your trip…';

  try {
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIFICATION_ID,
      content: {
        title,
        body,
        sticky: true,
        autoDismiss: false,
        data: { type: 'TRIP_LIVE' },
      },
      trigger: null,
    });
  } catch {
    // Non-critical — the app-wide TripStatusListener banner already covers this.
  }
}

export async function startTripLiveNotification(status: string, etaMinutes?: number | null) {
  currentStatus = status;
  currentEta = etaMinutes ?? null;
  await present(status, currentEta);
}

export async function updateTripLiveETA(etaMinutes: number) {
  currentEta = etaMinutes;
  if (!currentStatus) return;
  await present(currentStatus, currentEta);
}

export async function updateTripLiveStatus(status: string) {
  currentStatus = status;
  await present(status, currentEta);
}

export async function endTripLiveNotification() {
  currentStatus = null;
  currentEta = null;
  if (Platform.OS !== 'android') return;
  await Notifications.dismissNotificationAsync(NOTIFICATION_ID).catch(() => {});
}
