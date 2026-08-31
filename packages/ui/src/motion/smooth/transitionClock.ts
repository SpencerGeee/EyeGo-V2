import { InteractionManager, Platform } from 'react-native';

/**
 * THE ONE CLOCK THAT KNOWS WHETHER A SCREEN TRANSITION IS IN FLIGHT.
 *
 * ── THE PROBLEM THIS SOLVES ─────────────────────────────────────────────────
 * "On some sections the animations are fast and laggy and don't seem smooth at
 * all… clicking on a trip card of the homepage and going back to the homepage,
 * it's laggy and jumps back."
 *
 * Both halves of that are the SAME bug, and it is not a slow animation. Every
 * screen transition in these apps is driven natively by `react-native-screens`
 * — it runs on the UI thread at 60/120 fps and is essentially free. What makes
 * it stutter is everything the JS thread decides to do AT THE SAME INSTANT:
 *
 *   • the incoming screen mounts its whole tree (a 2 000-line home screen, a
 *     MapLibre view, a FlashList) in one synchronous commit;
 *   • React Query sees a focus event and fires refetches, whose responses land
 *     mid-flight and commit again;
 *   • every `entering={FadeIn.delay(i * 60)}` in the incoming tree registers a
 *     SECOND animation describing the same arrival as the native one;
 *   • the outgoing screen un-freezes and flushes whatever updates it queued
 *     while it was blurred.
 *
 * Four sources of work, all racing one 300 ms window. The native transition
 * keeps its frames; the content inside it does not — which reads exactly as
 * "fast and laggy", and on a pop as a screen that "jumps back" into place.
 *
 * ── THE FIX ─────────────────────────────────────────────────────────────────
 * Nothing here makes anything faster. It makes the expensive work happen at a
 * different TIME: after the transition has finished, when there is a whole
 * frame budget to spend on it. That is the entire idea, and it is what Uber,
 * Bolt and Yango all do — their list screens paint a skeleton during the push
 * and fill in a beat later, which is why they feel calm.
 *
 * This module is the shared clock the rest of the system reads. It is a plain
 * module singleton on purpose: React context cannot be read from the places
 * that need it (a router helper, a query client's focus manager), and there is
 * only ever one navigator running one transition.
 */

type Listener = (busy: boolean) => void;

const listeners = new Set<Listener>();

/** How many transitions are currently open. Nested navigators can overlap. */
let openCount = 0;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * How long a native push/pop takes before its content is safe to build.
 *
 * iOS `UINavigationController` pushes over ~350 ms; Android's
 * `slide_from_right` is ~300 ms. We wait slightly past the longer of the two
 * rather than trying to observe completion: `react-native-screens` exposes
 * `onTransitionEnd` only on some presentations, and a transition we mis-detect
 * as finished is worse than one we hold 60 ms too long.
 */
export const TRANSITION_MS = Platform.OS === 'ios' ? 380 : 340;

function emit() {
  const busy = openCount > 0;
  for (const l of listeners) {
    try {
      l(busy);
    } catch {
      /* a listener must never break the clock for the others */
    }
  }
}

/** True while a screen transition is believed to be running. */
export function isTransitioning(): boolean {
  return openCount > 0;
}

/**
 * Called by the router helpers immediately before they navigate.
 *
 * Returns a release function, but callers normally ignore it — the clock
 * releases itself on `TRANSITION_MS`, because a caller that forgets to release
 * would wedge the whole app in "busy" forever.
 */
export function beginTransition(durationMs: number = TRANSITION_MS): () => void {
  openCount += 1;
  if (openCount === 1) emit();

  let done = false;
  const release = () => {
    if (done) return;
    done = true;
    openCount = Math.max(0, openCount - 1);
    if (openCount === 0) emit();
  };

  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    // Collapse the counter rather than decrementing: if several navigations
    // stacked up, they all finished by now and a leaked +1 is unrecoverable.
    if (openCount > 0) {
      openCount = 0;
      emit();
    }
    done = true;
  }, durationMs);

  return release;
}

export function subscribeTransition(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Resolve once the transition has ended AND the JS thread has drained.
 *
 * `InteractionManager` alone is not enough — it resolves as soon as no
 * *registered* interaction handle is open, and a native-stack transition never
 * registers one. So we wait out the clock first and then let
 * `runAfterInteractions` clear whatever gestures or animations the arriving
 * screen started.
 */
export function afterTransition(fn: () => void): () => void {
  let cancelled = false;
  let interaction: { cancel: () => void } | null = null;

  const run = () => {
    if (cancelled) return;
    interaction = InteractionManager.runAfterInteractions(() => {
      interaction = null;
      if (!cancelled) fn();
    });
  };

  if (!isTransitioning()) {
    run();
    return () => {
      cancelled = true;
      interaction?.cancel();
    };
  }

  const off = subscribeTransition((busy) => {
    if (busy) return;
    off();
    run();
  });

  return () => {
    cancelled = true;
    off();
    interaction?.cancel();
  };
}
