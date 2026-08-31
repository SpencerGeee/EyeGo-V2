import { useEffect } from 'react';
import { reportNetwork } from '@eyego/ui';

import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { offlineQueue } from '../utils/offlineQueue';

/**
 * TELLS THE NOTICE SYSTEM WHETHER THERE IS A NETWORK.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * `useNetworkStatus.ts` has been in this app for a long time with **zero
 * consumers** — written, wired to nothing. `offlineQueue` has five callers, so
 * writes were already being queued while the rider was never told. The result
 * was an app that silently stopped working in a tunnel and then, once
 * `notify()` replaced 143 alerts, would have thrown fifteen different toasts at
 * the rider about one fact.
 *
 * `packages/ui` deliberately carries no dependency on either app's networking,
 * so the truth is pushed in from here rather than pulled from there. Six lines
 * per app, and the shared banner works everywhere in both.
 *
 * Renders nothing. It is a bridge, and it lives at the root layout so it is
 * mounted for the life of the session rather than for the life of one screen —
 * the mistake the driver's inlined offline pill made.
 */
export function NetworkReporter() {
  const { isOffline } = useNetworkStatus();

  useEffect(() => {
    let cancelled = false;

    // The count is read at the moment the state flips, not polled: the banner
    // only needs to be right when it appears and when it leaves, and a timer
    // reading AsyncStorage every second to keep a number fresh would cost more
    // than the number is worth.
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
