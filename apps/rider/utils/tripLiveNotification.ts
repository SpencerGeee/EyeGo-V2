import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Android "ongoing" trip notification — the Android-side equivalent of the
// iOS Live Activity (see native Live Activity work for iOS). Re-scheduling
// with the same `identifier` updates the existing tray notification in place
// rather than stacking a new one, giving a live-updating ETA while the app is
// backgrounded, matching Uber/Bolt's persistent trip notification on Android.
// iOS gets the real lock-screen Live Activity instead — this module no-ops there.
const NOTIFICATION_ID = 'eyego-trip-live';

/**
 * ITS OWN QUIET CHANNEL. Posted with no channel this landed on the default
 * one, and it is re-posted on every ETA and status change — so a ride could
 * chime or pop a heads-up banner every few seconds. LOW importance: it sits in
 * the shade and the status bar and updates in place, silently. The moments
 * worth a sound (driver arrived, ride ended) are their own pushes.
 */
const CHANNEL_ID = 'eyego-trip-live';
let channelReady: Promise<unknown> | null = null;
function ensureChannel() {
  channelReady ??= Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Live trip',
    description: 'Your ride in progress — where your driver is and when you arrive.',
    importance: Notifications.AndroidImportance.LOW,
    sound: null,
    vibrationPattern: null,
    enableVibrate: false,
    showBadge: false,
  }).catch(() => {});
  return channelReady;
}

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
    await ensureChannel();
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIFICATION_ID,
      content: {
        title,
        body,
        sticky: true,
        autoDismiss: false,
        color: '#4be277',
        data: { type: 'TRIP_LIVE' },
      },
      trigger: { channelId: CHANNEL_ID },
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
