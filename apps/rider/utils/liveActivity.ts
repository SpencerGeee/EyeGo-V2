import { Platform } from 'react-native';
import { tripsApi } from '@eyego/api';
import * as LiveActivity from '../modules/eyego-live-activity';
import type { EyeGoTripContentState, EyeGoTripStatus } from '../modules/eyego-live-activity';

/**
 * Trip-domain wrapper around the native eyego-live-activity bridge.
 *
 * Owns the lifecycle: DRIVER_EN_ROUTE starts the activity, driver-location /
 * ETA ticks update it (throttled), and COMPLETED / CANCELLED / NO_SHOW /
 * REFUNDED end it. Wired from components/TripStatusListener.tsx, which is
 * the one listener mounted app-wide (tracking.tsx only exists while that
 * screen is on-screen — Live Activities matter most once the rider has
 * backgrounded the app, so the app-wide listener is the correct hook point).
 *
 * All calls are best-effort no-ops on Android / older iOS — see
 * modules/eyego-live-activity/index.ts.
 */

let currentActivityId: string | null = null;
let currentTripId: string | null = null;
let pushTokenSub: { remove: () => void } | null = null;
let lastUpdateAt = 0;
const UPDATE_THROTTLE_MS = 8_000; // matches the backend's ETA cadence (see driver.socket.js)

function nowIso(): number {
  return Date.now();
}

interface TripStaticInfo {
  routeName: string;
  driverName: string;
  driverPhotoURL?: string;
  vehicleDescription: string;
  tripShortId: string;
}

/** Starts (or re-starts, if a stale activity is already running for a different trip) the Live Activity. */
export async function startTripLiveActivity(tripId: string, info: TripStaticInfo, status: EyeGoTripStatus) {
  if (Platform.OS !== 'ios') return;

  const enabled = await LiveActivity.areActivitiesEnabled();
  if (!enabled) return;

  // Already running for this exact trip — don't double-start.
  if (currentActivityId && currentTripId === tripId) return;

  // Stale activity from a previous trip (e.g. app relaunched mid-trip and
  // this is a fresh start) — end it first so the lock screen never shows
  // two EyeGo activities at once.
  if (currentActivityId && currentTripId && currentTripId !== tripId) {
    await endTripLiveActivity('CANCELLED');
  }

  const contentState: EyeGoTripContentState = {
    status,
    statusText: status === 'DRIVER_EN_ROUTE' ? 'Driver is on the way' : 'Trip in progress',
    etaMinutes: null,
    distanceKm: null,
    driverLat: null,
    driverLng: null,
    updatedAt: nowIso(),
  };

  const activityId = await LiveActivity.startActivity(
    {
      routeName: info.routeName,
      driverName: info.driverName,
      driverPhotoURL: info.driverPhotoURL,
      vehicleDescription: info.vehicleDescription,
      tripShortId: info.tripShortId,
    },
    contentState
  );

  if (!activityId) return; // unsupported device/OS, or user declined — silently no-op

  currentActivityId = activityId;
  currentTripId = tripId;

  // Subscribe to push-token updates for THIS activity and relay to the
  // backend so it can push lock-screen updates via direct APNs while the
  // app is backgrounded/killed. See eyego-api trips.routes.js
  // POST /:id/live-activity-token + services/live-activity-push.service.js.
  pushTokenSub?.remove();
  pushTokenSub = LiveActivity.addPushTokenListener((event) => {
    if (event.activityId !== currentActivityId) return;
    tripsApi.submitLiveActivityToken(tripId, {
      pushToken: event.pushToken,
      activityId: event.activityId,
    }).catch((err) => {
      console.warn('[liveActivity] failed to submit push token to backend', err);
    });
  });
}

/** Throttled update — call on every driver-location / ETA socket tick. Safe to call at full socket cadence. */
export function updateTripLiveActivity(tripId: string, patch: Partial<Omit<EyeGoTripContentState, 'updatedAt'>>) {
  if (Platform.OS !== 'ios') return;
  if (!currentActivityId || currentTripId !== tripId) return;

  const now = Date.now();
  if (now - lastUpdateAt < UPDATE_THROTTLE_MS) return;
  lastUpdateAt = now;

  const contentState: EyeGoTripContentState = {
    status: patch.status ?? 'IN_PROGRESS',
    statusText: patch.statusText ?? (patch.status === 'IN_PROGRESS' ? 'Trip in progress' : 'Driver is on the way'),
    etaMinutes: patch.etaMinutes ?? null,
    distanceKm: patch.distanceKm ?? null,
    driverLat: patch.driverLat ?? null,
    driverLng: patch.driverLng ?? null,
    updatedAt: nowIso(),
  };

  LiveActivity.updateActivity(currentActivityId, contentState);
}

/** Immediate (non-throttled) status transition, e.g. DRIVER_EN_ROUTE -> IN_PROGRESS. */
export function setTripLiveActivityStatus(tripId: string, status: EyeGoTripStatus, statusText: string) {
  if (Platform.OS !== 'ios') return;
  if (!currentActivityId || currentTripId !== tripId) return;
  lastUpdateAt = 0; // force the next tick through immediately after a status change
  LiveActivity.updateActivity(currentActivityId, {
    status,
    statusText,
    updatedAt: nowIso(),
  } as EyeGoTripContentState);
}

/** Ends the activity — call on COMPLETED / CANCELLED / NO_SHOW / REFUNDED. */
export async function endTripLiveActivity(finalStatus: EyeGoTripStatus) {
  if (Platform.OS !== 'ios') return;
  if (!currentActivityId) return;

  await LiveActivity.endActivity(currentActivityId, {
    status: finalStatus,
    statusText: finalStatus === 'COMPLETED' ? 'You have arrived' : 'Trip cancelled',
    etaMinutes: null,
    distanceKm: null,
    driverLat: null,
    driverLng: null,
    updatedAt: nowIso(),
  });

  pushTokenSub?.remove();
  pushTokenSub = null;
  currentActivityId = null;
  currentTripId = null;
}

/** Cold-start safety net — call once at app boot (see app/_layout.tsx) in case the process was killed mid-trip. */
export function cleanupStaleLiveActivities() {
  if (Platform.OS !== 'ios') return;
  LiveActivity.endAllActivities().catch(() => {});
}
