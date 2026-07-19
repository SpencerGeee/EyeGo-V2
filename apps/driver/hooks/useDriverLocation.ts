import { useState, useEffect, useRef, useCallback } from 'react';
import { Platform, AppState, AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { driverSocketEvents } from '@eyego/api';

interface Coords {
  latitude: number;
  longitude: number;
  heading?: number | null;
  speed?: number | null;
}

interface Options {
  enabled?: boolean;
  /** true during an active trip → BestForNavigation; false when idle/online → Balanced */
  isOnTrip?: boolean;
}

const MAX_PLAUSIBLE_SPEED_KMH = 180;
// How old a cached position can be and still be used as a seed (5 min)
const MAX_LAST_KNOWN_AGE_MS = 5 * 60 * 1000;

// ── Background location task ─────────────────────────────────────────────
// expo-location's `startLocationUpdatesAsync` only keeps reporting positions
// while the app is backgrounded if it's wired to an expo-task-manager task —
// `watchPositionAsync` (used below in `startWatch`) is foreground-only and is
// suspended by the OS a few seconds after backgrounding. `defineTask` MUST be
// called at module scope (before any component mounts) — Expo re-invokes the
// registered task by name from a headless JS instance when the OS wakes the
// app for a location update, so this can't live inside the hook body.
export const DRIVER_LOCATION_TASK = 'EYEGO_DRIVER_LOCATION_TASK';

if (!TaskManager.isTaskDefined(DRIVER_LOCATION_TASK)) {
  TaskManager.defineTask(DRIVER_LOCATION_TASK, async ({ data, error }: any) => {
    if (error) {
      console.warn('[DriverLocation] Background task error:', error.message);
      return;
    }
    const locations = data?.locations as Location.LocationObject[] | undefined;
    const latest = locations?.[locations.length - 1];
    if (!latest) return;
    // Background execution: no React state/closures from the hook survive
    // here, so push straight to the same channel the foreground watch uses
    // (driverSocketEvents.emitLocation is a plain module export backed by a
    // lazily-created, already-connected socket — see useDriverSocket.ts and
    // app/(trip)/tracking/[id].tsx for the equivalent foreground emit).
    try {
      driverSocketEvents.emitLocation({
        lat: latest.coords.latitude,
        lng: latest.coords.longitude,
        heading: latest.coords.heading ?? 0,
        speed: latest.coords.speed ?? 0,
      });
    } catch (e) {
      console.warn('[DriverLocation] Background emitLocation failed:', e);
    }
  });
}

async function startBackgroundLocationTracking(isOnTrip: boolean) {
  try {
    const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK);
    if (alreadyStarted) return;
    await Location.startLocationUpdatesAsync(DRIVER_LOCATION_TASK, {
      accuracy: isOnTrip ? Location.Accuracy.BestForNavigation : Location.Accuracy.Balanced,
      timeInterval: 5000,
      distanceInterval: 15,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'EyeGo Driver is online',
        notificationBody: 'Sharing your location with passengers and dispatch.',
        notificationColor: '#3B82F6',
      },
      pausesUpdatesAutomatically: false,
    });
  } catch (err) {
    console.warn('[DriverLocation] Failed to start background location updates:', err);
  }
}

async function stopBackgroundLocationTracking() {
  try {
    const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK);
    if (alreadyStarted) await Location.stopLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  } catch (err) {
    console.warn('[DriverLocation] Failed to stop background location updates:', err);
  }
}

// ── Ref-count background tracking ────────────────────────────────────────
// This hook mounts on home + active + tracking simultaneously. Without a
// refcount, unmounting ONE of those screens (e.g. leaving the active-trip
// screen while still online on home) would call stopBackgroundLocationTracking
// and tear down location for ALL consumers. Mirror the socket refcount pattern:
// only stop when the last consumer releases.
let bgTrackingRefs = 0;

function releaseBackgroundTracking() {
  bgTrackingRefs = Math.max(0, bgTrackingRefs - 1);
  if (bgTrackingRefs === 0) {
    // fire-and-forget: React cleanup can't be async
    stopBackgroundLocationTracking();
  }
}

export function useDriverLocation({ enabled = true, isOnTrip = false }: Options = {}) {
  const [location, setLocation] = useState<Coords | null>(null);
  const [hasPermission, setHasPermission] = useState(false);
  const [isMocked, setIsMocked] = useState(false);
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const cancelledRef = useRef(false);
  const permissionGranted = useRef(false);
  // Whether THIS hook instance incremented the background-tracking refcount,
  // so cleanup only releases the ref it actually acquired.
  const bgAcquiredRef = useRef(false);
  // True when the OS reports a mock GPS provider is active — a persistent
  // condition that must NOT be cleared by a later plausible-speed fix.
  const osMockRef = useRef(false);

  const applyPosition = useCallback((pos: Location.LocationObject) => {
    if (cancelledRef.current) return;
    const speedMs = pos.coords.speed ?? 0;
    const speedKmh = speedMs * 3.6;
    if (speedKmh > MAX_PLAUSIBLE_SPEED_KMH) {
      console.warn(`[DriverLocation] Implausible speed: ${speedKmh.toFixed(1)} km/h`);
      setIsMocked(true);
    } else if (!osMockRef.current) {
      // A plausible fix arrived and the OS-level mock provider is not active —
      // clear the transient implausible-speed flag so the UI doesn't stay stuck.
      setIsMocked((prev) => (prev ? false : prev));
    }
    setLocation({
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      heading: pos.coords.heading,
      speed: pos.coords.speed,
    });
  }, []);

  const startWatch = useCallback(async () => {
    // Remove any existing watch before starting a new one
    watchRef.current?.remove();
    watchRef.current = null;

    // Use higher accuracy during active trips for reliable navigation;
    // use Balanced when idle to conserve battery.
    const watchAccuracy = isOnTrip
      ? Location.Accuracy.BestForNavigation
      : Location.Accuracy.Balanced;

    try {
      watchRef.current = await Location.watchPositionAsync(
        {
          accuracy: watchAccuracy,
          timeInterval: 3000,
          distanceInterval: 10,
        },
        applyPosition,
      );
    } catch (err) {
      console.warn('[DriverLocation] watchPositionAsync failed — retrying in 5s', err);
      setTimeout(() => {
        if (!cancelledRef.current && permissionGranted.current) startWatch();
      }, 5000);
    }
  }, [applyPosition]);

  useEffect(() => {
    if (!enabled) return;

    cancelledRef.current = false;

    (async () => {
      // ── 1. Permission ─────────────────────────────────────────────────
      // On Android, defer the permission dialog by 500ms so the UI has time to
      // render before the system dialog appears. Without this, the dialog can
      // appear before the screen is visible, causing a jarring UX.
      if (Platform.OS === 'android') {
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
      }
      if (cancelledRef.current) return;
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelledRef.current) return;
      if (status !== 'granted') {
        setHasPermission(false);
        return;
      }
      setHasPermission(true);
      permissionGranted.current = true;

      // Request background permission on both platforms — iOS needs its own
      // "Always" prompt (NSLocationAlwaysAndWhenInUseUsageDescription) just
      // like Android does, or startBackgroundLocationTracking() below will
      // silently fail to report positions once the app is backgrounded.
      const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
      if (bgStatus !== 'granted') {
        console.warn('[DriverLocation] Background location denied — tracking may stop when backgrounded');
      }

      // ── 2. Mock provider check ────────────────────────────────────────
      try {
        const { areMockProvidersEnabled } = await (Location as any).getMockProviderStatusAsync?.() ?? {};
        if (areMockProvidersEnabled) {
          osMockRef.current = true;
          setIsMocked(true);
          console.warn('[DriverLocation] Mock GPS provider detected');
        }
      } catch { /* not available on this platform */ }

      // ── 3. Seed with last-known position instantly ────────────────────
      // This gives us a non-null location immediately so the toggle never
      // blocks on a cold GPS fix.
      try {
        const last = await Location.getLastKnownPositionAsync({ maxAge: MAX_LAST_KNOWN_AGE_MS });
        if (last && !cancelledRef.current) applyPosition(last);
      } catch { /* no cached position — that's fine */ }

      // ── 4. Start the continuous watch immediately ────────────────────
      // Don't block on getCurrentPositionAsync first — the watch will
      // deliver a fresh high-accuracy fix within its first update.
      if (!cancelledRef.current) await startWatch();

      // ── 4b. Start the background task too ─────────────────────────────
      // watchPositionAsync above is foreground-only; this keeps location
      // updates (and the socket emit in the task handler) flowing while the
      // driver has the app backgrounded but is online/on a trip.
      if (!cancelledRef.current && bgStatus === 'granted') {
        bgTrackingRefs++;
        bgAcquiredRef.current = true;
        await startBackgroundLocationTracking(isOnTrip);
      }

      // ── 5. Force a fresh one-shot fix concurrently ───────────────────
      // Runs in parallel with the watch; overwrites the stale seed if the
      // watch is slow to fire its first update.
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        .then((pos) => { if (!cancelledRef.current) applyPosition(pos); })
        .catch(() => { /* watch will provide a fix soon */ });
    })();

    // ── 6. Re-start watch when app comes back to foreground ──────────
    //      Also re-check permissions — they may have been revoked mid-session.
    const handleAppState = async (next: AppStateStatus) => {
      if (next !== 'active' || cancelledRef.current) return;
      // Always re-check permission status; user may have revoked it in Settings
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') {
        setHasPermission(false);
        permissionGranted.current = false;
        watchRef.current?.remove();
        watchRef.current = null;
        return;
      }
      // Permission still granted — restart the watch if it was running
      if (permissionGranted.current) {
        startWatch();
      }
    };
    const appStateSub = AppState.addEventListener('change', handleAppState);

    return () => {
      cancelledRef.current = true;
      permissionGranted.current = false;
      watchRef.current?.remove();
      watchRef.current = null;
      appStateSub.remove();
      // Release this instance's background-tracking ref. Tracking only actually
      // stops when the LAST consumer (home/active/tracking) releases — so
      // leaving one screen while still online elsewhere won't kill location.
      if (bgAcquiredRef.current) {
        bgAcquiredRef.current = false;
        releaseBackgroundTracking();
      }
    };
  }, [enabled, isOnTrip]);

  return { location, hasPermission, isMocked };
}
