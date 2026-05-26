import { useState, useEffect, useRef } from 'react';
import * as Location from 'expo-location';

interface Coords {
  latitude: number;
  longitude: number;
  heading?: number | null;
  speed?: number | null;
}

interface Options {
  enabled?: boolean;
}

// Maximum plausible speed for a road vehicle in km/h (flag above this)
const MAX_PLAUSIBLE_SPEED_KMH = 180;

export function useDriverLocation({ enabled = true }: Options = {}) {
  const [location, setLocation] = useState<Coords | null>(null);
  const [hasPermission, setHasPermission] = useState(false);
  const [isMocked, setIsMocked] = useState(false);
  const watchRef = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status !== 'granted') {
        setHasPermission(false);
        return;
      }
      setHasPermission(true);

      // Check if mock providers are active (Android only — always false on iOS)
      try {
        const { areMockProvidersEnabled } = await (Location as any).getMockProviderStatusAsync?.() ?? {};
        if (areMockProvidersEnabled) {
          setIsMocked(true);
          console.warn('[DriverLocation] Mock GPS provider detected');
        }
      } catch {
        // Not available on this platform — ignore
      }

      // Get initial location quickly
      const initial = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      if (!cancelled) {
        setLocation({
          latitude: initial.coords.latitude,
          longitude: initial.coords.longitude,
          heading: initial.coords.heading,
          speed: initial.coords.speed,
        });
      }

      // Watch for updates
      watchRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 3000,
          distanceInterval: 10,
        },
        (pos) => {
          if (cancelled) return;

          const speedMs = pos.coords.speed ?? 0;
          const speedKmh = speedMs * 3.6;

          // Flag suspiciously high speed
          if (speedKmh > MAX_PLAUSIBLE_SPEED_KMH) {
            console.warn(
              `[DriverLocation] Implausible speed detected: ${speedKmh.toFixed(1)} km/h — possible mock/simulation`
            );
            setIsMocked(true);
          }

          setLocation({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            heading: pos.coords.heading,
            speed: pos.coords.speed,
          });
        }
      );
    })();

    return () => {
      cancelled = true;
      watchRef.current?.remove();
    };
  }, [enabled]);

  return { location, hasPermission, isMocked };
}
