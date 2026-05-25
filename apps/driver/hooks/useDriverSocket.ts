import { useEffect, useRef } from 'react';
import { connectDriverSocket, disconnectDriverSocket, driverSocketEvents } from '@eyego/api';
import { useQueryClient } from '@tanstack/react-query';
import { useDriverLocation } from './useDriverLocation';
import { useDriverStore } from '../stores/driver.store';

interface Options {
  tripId?: string;
  enabled?: boolean;
}

// Emit at most once every 4 seconds regardless of how often location updates fire
const EMIT_THROTTLE_MS = 4000;

export function useDriverSocket({ tripId, enabled = false }: Options) {
  const qc = useQueryClient();
  const { isOnline } = useDriverStore();
  const { location } = useDriverLocation({ enabled: enabled && isOnline });
  const lastEmitRef = useRef<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    connectDriverSocket();

    const cleanConnect = driverSocketEvents.onConnect(() => {
      console.log('[DriverSocket] Connected');
    });
    const cleanDisconnect = driverSocketEvents.onDisconnect(() => {
      console.log('[DriverSocket] Disconnected');
    });
    const cleanSeatUpdate = driverSocketEvents.onSeatUpdate(() => {
      if (tripId) {
        qc.invalidateQueries({ queryKey: ['driver', 'trip', tripId] });
      }
    });

    return () => {
      cleanConnect();
      cleanDisconnect();
      cleanSeatUpdate();
      disconnectDriverSocket();
    };
  }, [enabled]);

  // Throttled location emission — at most once per EMIT_THROTTLE_MS
  useEffect(() => {
    if (!enabled || !isOnline || !tripId || !location) return;

    const tryEmit = () => {
      const now = Date.now();
      if (now - lastEmitRef.current < EMIT_THROTTLE_MS) return;
      lastEmitRef.current = now;
      driverSocketEvents.emitLocation({
        lat: location.latitude,
        lng: location.longitude,
      });
    };

    // Emit immediately on mount (respects throttle)
    tryEmit();

    // Poll at throttle interval so we always emit within ~4s of a location change
    intervalRef.current = setInterval(tryEmit, EMIT_THROTTLE_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [enabled, isOnline, tripId, location?.latitude, location?.longitude]);
}
