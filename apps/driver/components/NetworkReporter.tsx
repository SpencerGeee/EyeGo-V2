import { useEffect } from 'react';
import { reportNetwork } from '@eyego/ui';

import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { offlineQueue } from '../utils/offlineQueue';

/**
 * TELLS THE NOTICE SYSTEM WHETHER THERE IS A NETWORK.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * `useNetworkStatus` existed here already and had exactly one consumer —
 * `(tabs)/home.tsx` — which drew an offline pill inline. So a driver who lost
 * signal on Earnings, Alerts, Quests or mid-trip was told nothing at all. A
 * status surface that only exists on one screen is not a status surface, and
 * that inline pill is gone: `NoticeHost` at the root covers every screen.
 *
 * It also matters more here than on the rider side. A driver believing they are
 * online while dispatch cannot reach them is the single most expensive state
 * either app has — they sit there earning nothing, and the app looked fine.
 *
 * `packages/ui` deliberately carries no dependency on either app's networking,
 * so the truth is pushed in from here rather than pulled from there.
 *
 * Renders nothing. It is a bridge, and it lives at the root layout so it is
 * mounted for the life of the session.
 */
export function NetworkReporter() {
  const { isOffline } = useNetworkStatus();

  useEffect(() => {
    let cancelled = false;

    // Read at the moment the state flips, not polled: the banner only needs to
    // be right when it appears and when it leaves, and a timer reading
    // AsyncStorage every second to keep a number fresh would cost more than the
    // number is worth.
    void offlineQueue
      .count()
      .then((pending) => {
        if (!cancelled) reportNetwork({ offline: isOffline, pending });
      })
      .catch(() => {
        // A queue we cannot count is still a network state worth reporting.
        if (!cancelled) reportNetwork({ offline: isOffline });
      });

    return () => {
      cancelled = true;
    };
  }, [isOffline]);

  return null;
}

export default NetworkReporter;
