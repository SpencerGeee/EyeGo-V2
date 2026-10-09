import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { bookingsApi, type AwayOutcome } from '@eyego/api';
import { useRideEnded, loadSeen, saveSeen, type RideEndedReason } from '../stores/rideEnded.store';

/** Endings of a specific trip — told live, they are not told again. */
const RIDE_ENDINGS = new Set<string>([
  'RIDER_NO_SHOW', 'DRIVER_CANCELLED', 'DRIVER_NO_SHOW', 'CANCELLED_BY_EYEGO',
  'NO_DRIVERS', 'EXPIRED', 'SEAT_RELEASED', 'COMPLETED',
]);
const KNOWN = new Set<string>([...RIDE_ENDINGS, 'SCHEDULED_MATCHED', 'SCHEDULED_EXPIRED', 'REFUND_ISSUED']);
const MIN_GAP_MS = 30_000;

/**
 * WHAT HAPPENED WHILE THE APP WAS CLOSED, TOLD ON THE WAY BACK IN.
 *
 * BUGFIX ("if the driver marks a no-show and the rider app is closed, when it
 * gets to the homepage it should bring a screen to account for that so it
 * doesn't look like it never existed"). On cold start and every return to the
 * foreground: read the server's 48 h of facts, drop what this device has already
 * told (by key, or by trip for endings the live path announced), queue the rest
 * on the ride-ended sheet. Marked as told when queued, so a second foreground
 * can never queue the same fact twice.
 */
export function useAwayOutcomes(enabled: boolean): void {
  const busy = useRef(false);
  const lastRun = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const run = async () => {
      if (busy.current || Date.now() - lastRun.current < MIN_GAP_MS) return;
      busy.current = true;
      lastRun.current = Date.now();
      try {
        const seen = await loadSeen();
        // A few minutes of overlap: a fact written while we were asking is not lost.
        const res = await bookingsApi.outcomes(seen.lastAtMs ? seen.lastAtMs - 5 * 60_000 : undefined);
        const list: AwayOutcome[] = (res.data as any)?.data?.outcomes ?? [];
        const fresh = list.filter(
          (o) =>
            KNOWN.has(o.kind) &&
            !seen.keys.includes(o.key) &&
            !(RIDE_ENDINGS.has(o.kind) && o.tripId && seen.trips.includes(o.tripId)),
        );
        await saveSeen({ keys: [...seen.keys, ...fresh.map((o) => o.key)], lastAtMs: Date.now() });
        if (!fresh.length) return;
        useRideEnded.getState().enqueue(
          fresh.map((o) => ({
            reason: o.kind as RideEndedReason,
            refunded: o.money === 'REFUNDED',
            money: o.money,
            destinationLabel: o.destination ?? null,
            journey: null,
            tripId: o.tripId ?? null,
            bookingId: o.bookingId ?? null,
            amountPesewas: o.amountPesewas,
            scheduledAt: o.scheduledAt ?? null,
          })),
        );
      } catch {
        // Offline or signed out mid-flight — the next foreground asks again.
      } finally {
        busy.current = false;
      }
    };
    void run();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void run();
    });
    return () => sub.remove();
  }, [enabled]);
}
