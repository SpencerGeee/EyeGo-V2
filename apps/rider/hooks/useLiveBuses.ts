import { useEffect } from 'react';
import { AppState } from 'react-native';
import { tripsApi } from '@eyego/api';
import { useTripFlow } from '../stores/tripFlow.store';

const REFRESH_MS = 8_000;

/**
 * LIVE BUSES ON THE MAP FROM THE FIRST SCREEN (Yango `LiveVehiclesPoller`).
 *
 * The request stage already polls nearby buses while it searches; the rider
 * deciding where to go saw an empty map. This keeps the same `nearbyDrivers`
 * pins (TripMap draws them whenever no driver is assigned) fresh around the
 * pickup while a planning stage is on screen. Paused in the background —
 * a poll nobody can see is battery and data for nothing.
 */
export function useLiveBuses(lat: number | null | undefined, lng: number | null | undefined) {
  useEffect(() => {
    if (lat == null || lng == null) return;
    let cancelled = false;
    const load = async () => {
      if (AppState.currentState !== 'active') return;
      try {
        const res = await tripsApi.getNearbyDrivers(lat, lng);
        if (cancelled) return;
        const rows: any[] = Array.isArray(res.data?.data) ? (res.data.data as any[]) : [];
        useTripFlow.getState().setNearbyDrivers(
          rows
            .filter((d) => Number.isFinite(d?.latitude) && Number.isFinite(d?.longitude))
            .map((d) => ({ id: String(d.id), latitude: d.latitude, longitude: d.longitude })),
        );
      } catch {
        // Ambient only: keep whatever pins were drawn.
      }
    };
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [lat, lng]);
}
