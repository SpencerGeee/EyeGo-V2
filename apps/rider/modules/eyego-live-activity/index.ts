import { requireNativeModule, EventEmitter, type EventSubscription } from 'expo-modules-core';
import { Platform } from 'react-native';

// Lazily resolved — requireNativeModule throws on Android / when the native
// module hasn't been linked (e.g. Expo Go, or before the first
// `expo prebuild` + dev-client rebuild after this module was added).
let nativeModule: any = null;
function getNativeModule() {
  if (Platform.OS !== 'ios') return null;
  if (nativeModule) return nativeModule;
  try {
    nativeModule = requireNativeModule('EyeGoLiveActivityModule');
  } catch {
    nativeModule = null;
  }
  return nativeModule;
}

// Mirrors EyeGoTripAttributes (Swift) field-for-field — see
// apps/rider/targets/live-activity/EyeGoTripActivityAttributes.swift.
export interface EyeGoTripAttributes {
  routeName: string;
  driverName: string;
  driverPhotoURL?: string;
  vehicleDescription: string;
  tripShortId: string;
}

// Mirrors EyeGoTripAttributes.ContentState (Swift).
export type EyeGoTripStatus = 'DRIVER_EN_ROUTE' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface EyeGoTripContentState {
  status: EyeGoTripStatus;
  statusText: string;
  etaMinutes?: number | null;
  distanceKm?: number | null;
  driverLat?: number | null;
  driverLng?: number | null;
  updatedAt: number; // epoch millis
}

export interface PushTokenEvent {
  activityId: string;
  pushToken: string; // hex-encoded APNs device token for THIS activity
}

/** iOS 16.2+ AND the user hasn't disabled Live Activities in Settings. */
export async function areActivitiesEnabled(): Promise<boolean> {
  const mod = getNativeModule();
  if (!mod) return false;
  try {
    return await mod.areActivitiesEnabled();
  } catch {
    return false;
  }
}

/** Starts a new Live Activity. Returns the native activity id, or null if unsupported/failed. */
export async function startActivity(
  attributes: EyeGoTripAttributes,
  contentState: EyeGoTripContentState
): Promise<string | null> {
  const mod = getNativeModule();
  if (!mod) return null;
  try {
    return await mod.startActivity(attributes, contentState);
  } catch (err) {
    console.warn('[eyego-live-activity] startActivity failed', err);
    return null;
  }
}

export async function updateActivity(activityId: string, contentState: EyeGoTripContentState): Promise<void> {
  const mod = getNativeModule();
  if (!mod) return;
  try {
    await mod.updateActivity(activityId, contentState);
  } catch (err) {
    console.warn('[eyego-live-activity] updateActivity failed', err);
  }
}

export async function endActivity(activityId: string, finalContentState: EyeGoTripContentState): Promise<void> {
  const mod = getNativeModule();
  if (!mod) return;
  try {
    await mod.endActivity(activityId, finalContentState);
  } catch (err) {
    console.warn('[eyego-live-activity] endActivity failed', err);
  }
}

/** Safety net for app cold-start after a killed process mid-trip. */
export async function endAllActivities(): Promise<void> {
  const mod = getNativeModule();
  if (!mod) return;
  try {
    await mod.endAllActivities();
  } catch (err) {
    console.warn('[eyego-live-activity] endAllActivities failed', err);
  }
}

// `EventEmitter`'s exported type and exported value resolve to two
// structurally-incompatible class declarations in this expo-modules-core
// version (its own ts-declarations vs build output disagree on `prototype`)
// — an upstream typing bug, not fixable from call sites. `any` sidesteps it;
// the real runtime contract (native module → EventSubscription) is unaffected.
let emitter: any = null;
function getEmitter(): any {
  const mod = getNativeModule();
  if (!mod) return null;
  if (!emitter) emitter = new EventEmitter(mod);
  return emitter;
}

/**
 * Fires whenever ActivityKit (re)issues a push token for a running
 * activity — on start, and periodically thereafter. Forward every event to
 * tripsApi.submitLiveActivityToken() (see apps/rider/utils/liveActivity.ts)
 * so the backend can push updates via direct APNs.
 */
export function addPushTokenListener(listener: (event: PushTokenEvent) => void): EventSubscription | null {
  const em = getEmitter();
  if (!em) return null;
  return em.addListener('onPushTokenUpdate', listener);
}
