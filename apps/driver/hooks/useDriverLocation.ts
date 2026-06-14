import { useState, useEffect, useRef, useCallback } from 'react';
import { Platform, AppState, AppStateStatus } from 'react-native';
import * as Location from 'expo-location';

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

export function useDriverLocation({ enabled = true, isOnTrip = false }: Options = {}) {
  const [location, setLocation] = useState<Coords | null>(null);
  const [hasPermission, setHasPermission] = useState(false);
  const [isMocked, setIsMocked] = useState(false);
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const cancelledRef = useRef(false);
  const permissionGranted = useRef(false);
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

      if (Platform.OS === 'android') {
        const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
        if (bgStatus !== 'granted') {
          console.warn('[DriverLocation] Background location denied — tracking may stop when backgrounded');
        }
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
    };
  }, [enabled, isOnTrip]);

  return { location, hasPermission, isMocked };
}
