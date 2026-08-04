import { useEffect, useRef } from 'react';
import { connectDriverSocket, disconnectDriverSocket, driverSocketEvents, getDriverSocket } from '@eyego/api';
import { useQueryClient } from '@tanstack/react-query';
import { useDriverLocation, lastKnownReportedFix } from './useDriverLocation';
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
      /**
       * Re-announce position the instant the socket is back.
       *
       * BUGFIX: this was gated on `tripId`, so it only ran for a driver already
       * ON a trip — the one case where it barely matters, because a moving
       * vehicle produces a fresh fix within seconds anyway. The case it skipped
       * is the one that breaks: an online driver waiting for work, parked, whose
       * socket dropped. Their server-side presence key expires after 90s, the
       * watch fires only on 10m of movement, and a parked car never moves — so
       * they silently left the dispatch pool and stayed out of it, with the app
       * still showing "You're online".
       *
       * `lastKnownReportedFix()` rather than `locationRef` because the fix may
       * have come from the background task, which never touches React state.
       */
      if (useDriverStore.getState().isOnline) {
        const last = lastKnownReportedFix() ?? (locationRef.current && {
          lat: locationRef.current.latitude,
          lng: locationRef.current.longitude,
          heading: locationRef.current.heading ?? 0,
          speed: locationRef.current.speed ?? 0,
        });
        if (last) driverSocketEvents.emitLocation(last);
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
            // Reconnect the existing instance — do NOT call connectDriverSocket()
            // here, which would bump the refcount without a paired disconnect and
            // leak the ref (count never returns to 0 on logout).
            getDriverSocket().connect();
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
