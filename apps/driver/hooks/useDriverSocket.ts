import { useEffect, useRef } from 'react';
import { connectDriverSocket, disconnectDriverSocket, driverSocketEvents, getDriverSocket } from '@eyego/api';
import { useQueryClient } from '@tanstack/react-query';
import { useDriverLocation } from './useDriverLocation';
import { useDriverStore } from '../stores/driver.store';

interface Options {
  tripId?: string;
  enabled?: boolean;
}

export function useDriverSocket({ tripId, enabled = false }: Options) {
  const qc = useQueryClient();
  const { isOnline } = useDriverStore();
  const { location } = useDriverLocation({ enabled: enabled && isOnline });
  // DC2: keep a ref to latest location so the onConnect closure can access it
  const locationRef = useRef(location);
  useEffect(() => { locationRef.current = location; }, [location]);
  // DM3: reconnect attempt counter
  const reconnectAttemptsRef = useRef(0);
  // DM3b: track the auth-retry timer so it can be cleared on unmount (leak fix)
  const authRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    connectDriverSocket();

    const cleanConnect = driverSocketEvents.onConnect(() => {
      console.log('[DriverSocket] Connected');
      // DM3: reset reconnect counter on successful connect
      reconnectAttemptsRef.current = 0;
      // D3: join the trip room on (re)connect so seat_update events are received
      if (tripId) {
        driverSocketEvents.emitJoinTracking(tripId);
      }
      // DC2: re-emit current location immediately on reconnect so server isn't stale
      if (tripId && useDriverStore.getState().isOnline && locationRef.current) {
        driverSocketEvents.emitLocation({
          lat: locationRef.current.latitude,
          lng: locationRef.current.longitude,
          heading: locationRef.current.heading ?? 0,
          speed: locationRef.current.speed ?? 0,
        });
      }
    });
    const cleanDisconnect = driverSocketEvents.onDisconnect(() => {
      console.log('[DriverSocket] Disconnected');
    });

    // D11: handle auth failure / token expiry on socket connect
    const handleConnectError = (err: Error) => {
      const msg = err?.message ?? '';
      if (msg.toLowerCase().includes('auth') || msg.toLowerCase().includes('token') || msg.toLowerCase().includes('unauthorized')) {
        console.warn('[DriverSocket] Auth error on connect — attempting token refresh');
        // The API client's onTokenRefreshed callback will update the store;
        // reconnect after a short delay to pick up the new token.
        if (authRetryTimerRef.current) clearTimeout(authRetryTimerRef.current);
        authRetryTimerRef.current = setTimeout(() => {
          authRetryTimerRef.current = null;
          if (useDriverStore.getState().accessToken) {
            connectDriverSocket();
          }
        }, 1000);
      }
    };
    getDriverSocket().on('connect_error', handleConnectError);

    // D3: join trip room immediately if already connected when this effect runs
    if (tripId && getDriverSocket().connected) {
      driverSocketEvents.emitJoinTracking(tripId);
    }

    let seatUpdateTimer: ReturnType<typeof setTimeout> | null = null;
    const cleanSeatUpdate = driverSocketEvents.onSeatUpdate(() => {
      if (tripId) {
        if (seatUpdateTimer) clearTimeout(seatUpdateTimer);
        seatUpdateTimer = setTimeout(() => {
          qc.invalidateQueries({ queryKey: ['driver', 'trip', tripId] });
        }, 500);
      }
    });

    return () => {
      cleanConnect();
      cleanDisconnect();
      cleanSeatUpdate();
      if (seatUpdateTimer) clearTimeout(seatUpdateTimer);
      if (authRetryTimerRef.current) { clearTimeout(authRetryTimerRef.current); authRetryTimerRef.current = null; }
      getDriverSocket().off('connect_error', handleConnectError);
      disconnectDriverSocket();
    };
  }, [enabled, tripId, qc]);

}
