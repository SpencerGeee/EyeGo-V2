import React, { useEffect, type ReactNode } from 'react';

import { beginTransition, isTransitioning, subscribeTransition } from './transitionClock';

/**
 * ARMING THE CLOCK FOR *EVERY* NAVIGATION, NOT JUST THE ONES WE ROUTED.
 *
 * ── WHY THE ROUTER HELPERS ARE NOT ENOUGH ───────────────────────────────────
 * `goDeeper` / `goLateral` / `goBack` open `transitionClock` before they
 * navigate, which is how an arriving `SmoothScreen` knows to hold its heavy
 * tree back. That works, and it only works for navigations THIS codebase
 * initiated through those helpers. It misses:
 *
 *   • the iOS interactive swipe-back and the Android hardware back;
 *   • a deep link or a push-notification tap;
 *   • a tab press;
 *   • every `router.push` in the ~90 screens that have not been migrated;
 *   • anything React Navigation does on its own (a `reset`, a redirect).
 *
 * All of those produce exactly the same problem — a screen mounting into a
 * running transition — and none of them go through our helpers. So the clock is
 * armed from the fact itself instead: the navigation container's `state` event,
 * which fires once per navigation, whatever caused it.
 *
 * The helpers stay: arming the clock a few milliseconds BEFORE the state change
 * (rather than on it) gives the incoming screen its head start on the very
 * first frame, and `goDeeper`'s double-tap guard and `goLateral`'s
 * stack-flattening are separate jobs worth keeping. This provider is the floor
 * under them, not a replacement.
 *
 * ── AND THE OTHER HALF: QUERIES ─────────────────────────────────────────────
 * A React Query focus event fires on the same beat as a screen transition and
 * kicks off every refetch on the arriving screen at once. Their responses land
 * mid-flight and commit again. `SmoothQueryFocus` below holds the focus signal
 * until the transition is over — the queries still run, a few hundred
 * milliseconds later, into a thread that is free.
 */

type NavigationRefLike = {
  addListener?: (event: string, cb: (...args: unknown[]) => void) => (() => void) | undefined;
  isReady?: () => boolean;
};

/** Optional peer, resolved the way `screenFocus.ts` resolves navigation. */
function useNavigationRef(): NavigationRefLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useNavigationContainerRef } = require('expo-router');
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useNavigationContainerRef?.() ?? null;
  } catch {
    return null;
  }
}

export interface SmoothNavigationProviderProps {
  children?: ReactNode;
  /**
   * The QueryClient whose focus signal should wait out transitions. Optional —
   * omit it and only the clock is armed.
   */
  queryClient?: unknown;
}

export function SmoothNavigationProvider({ children, queryClient }: SmoothNavigationProviderProps) {
  const navRef = useNavigationRef();

  useEffect(() => {
    if (!navRef?.addListener) return;
    /**
     * `state` fires once the navigator has committed the new state, which is
     * the same frame the native transition starts on. `beginTransition` releases
     * itself on a timer, so a listener that fires and never "ends" cannot wedge
     * the app.
     */
    const off = navRef.addListener('state', () => {
      beginTransition();
    });
    return () => off?.();
  }, [navRef]);

  useEffect(() => {
    if (!queryClient) return;
    let focusManager: { setEventListener?: (cb: (h: (f?: boolean) => void) => () => void) => void } | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      focusManager = require('@tanstack/react-query').focusManager ?? null;
    } catch {
      return;
    }
    if (!focusManager?.setEventListener) return;

    /**
     * REFETCH AFTER THE TRANSITION, NOT DURING IT.
     *
     * React Query's default focus listener marks the app focused the instant
     * `AppState` says so. On a phone that is also the instant a screen is
     * arriving, and every `refetchOnWindowFocus` query on it fires at once. The
     * requests are fine; the COMMITS they cause a few hundred milliseconds
     * later are what land in the middle of the animation.
     *
     * This wraps the same signal in the clock: focused is reported immediately
     * when nothing is transitioning, and deferred until the clock idles when
     * something is. No query is cancelled and no staleness rule changes — only
     * the moment the work starts.
     */
    let offTransition: (() => void) | null = null;
    focusManager.setEventListener((handleFocus) => {
      const onChange = (state: { match?: (s: string) => boolean } | string) => {
        const s = typeof state === 'string' ? state : String(state);
        const focused = s === 'active';
        if (!focused) {
          handleFocus(false);
          return;
        }
        if (!isTransitioning()) {
          handleFocus(true);
          return;
        }
        offTransition?.();
        offTransition = subscribeTransition((busy) => {
          if (busy) return;
          offTransition?.();
          offTransition = null;
          handleFocus(true);
        });
      };

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { AppState } = require('react-native');
      const sub = AppState.addEventListener('change', onChange);
      return () => {
        sub?.remove?.();
        offTransition?.();
        offTransition = null;
      };
    });
  }, [queryClient]);

  return <>{children}</>;
}

export default SmoothNavigationProvider;
