import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { bookingsApi, type AwayOutcome } from '@eyego/api';
import { useRideEnded, loadSeen, saveSeen } from '../stores/rideEnded.store';
import { noticeOf } from '../components/RideEndedSheet';

/** Endings of a specific trip — told live, they are not told again. */
const RIDE_ENDINGS = new Set<string>([
  'RIDER_NO_SHOW', 'DRIVER_CANCELLED', 'DRIVER_NO_SHOW', 'CANCELLED_BY_EYEGO',
  'NO_DRIVERS', 'EXPIRED', 'SEAT_RELEASED', 'COMPLETED',
]);
const KNOWN = new Set<string>([
  ...RIDE_ENDINGS, 'SCHEDULED_MATCHED', 'SCHEDULED_EXPIRED', 'REFUND_ISSUED', 'SUPPORT_REPLY', 'MONEY_RECEIVED',
  'CASH_CHANGE', 'REFERRAL_REWARD',
]);
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
 *
 * A fact from the last foreground stretch (`liveFrom`–`liveTo`) happened while
 * the rider was looking — the live path told it — so it is marked, not shown.
 * Without this a refund or a reply that arrived on screen came back as "while
 * you were away" on the next return. It stays in the inbox either way.
 */
export function useAwayOutcomes(enabled: boolean): void {
  const busy = useRef(false);
  const lastRun = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let foregroundSince = Date.now();
    const run = async () => {
      if (busy.current || Date.now() - lastRun.current < MIN_GAP_MS) return;
      busy.current = true;
      lastRun.current = Date.now();
      try {
        const seen = await loadSeen();
        // A few minutes of overlap: a fact written while we were asking is not lost.
        const res = await bookingsApi.outcomes(seen.lastAtMs ? seen.lastAtMs - 5 * 60_000 : undefined);
        const list: AwayOutcome[] = (res.data as any)?.data?.outcomes ?? [];
        const unseen = list.filter((o) => !seen.keys.includes(o.key));
        const whileLooking = (o: AwayOutcome) => {
          const t = Date.parse(o.at);
          return seen.liveTo > 0 && t >= seen.liveFrom && t <= seen.liveTo;
        };
        const fresh = unseen.filter(
          (o) =>
            KNOWN.has(o.kind) &&
            !(o.kind === 'COMPLETED' && o.rated) &&
            !whileLooking(o) &&
            !(RIDE_ENDINGS.has(o.kind) && o.tripId && seen.trips.includes(o.tripId)),
        );
        await saveSeen({ keys: [...seen.keys, ...unseen.map((o) => o.key)], lastAtMs: Date.now() });
        if (fresh.length) useRideEnded.getState().enqueue(fresh.map(noticeOf));
      } catch {
        // Offline or signed out mid-flight — the next foreground asks again.
      } finally {
        busy.current = false;
      }
    };
    void run();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        foregroundSince = Date.now();
        void run();
      } else if (s === 'background') {
        void saveSeen({ liveFrom: foregroundSince, liveTo: Date.now() });
      }
    });
    return () => sub.remove();
  }, [enabled]);
}
