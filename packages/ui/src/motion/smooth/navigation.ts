import { beginTransition } from './transitionClock';

/**
 * NAVIGATION THAT DOES NOT PILE UP.
 *
 * ── THE BUG THIS EXISTS FOR ─────────────────────────────────────────────────
 * "If I open 7 instances of manage trip → tracking then get redirected back to
 * manage trip, they all stack up, but it should be just 2 pages. They shouldn't
 * be stacked on each other making the app open about 7 other pages of the same
 * thing."
 *
 * Exactly right, and it was literal. The driver's manage screen pushed the
 * tracking screen; the tracking screen pushed the manage screen back. Both used
 * `router.push`, and `push` means "put another one on top" — so a driver
 * toggling between the two views of ONE trip built a stack seven screens deep,
 * every one of them a mounted MapLibre view holding a socket subscription.
 *
 * That is not only a back-button problem. Seven live maps is seven copies of
 * the heaviest node in the app, all re-rendering on every location fix, which
 * is a large part of why these two screens felt slow at all.
 *
 * ── THE DISTINCTION THE APPS WERE MISSING ───────────────────────────────────
 * There are two different intentions and the router has two different verbs:
 *
 *   DEEPER      You are going somewhere new that you will come back FROM.
 *               Trip → chat, trip → cancel. `push`. A back button is correct.
 *
 *   SIDEWAYS    You are switching between two views of the SAME thing.
 *               Manage ⇄ tracking. This is a tab swap wearing a route's
 *               clothes; there is no "back" to it, and pushing invents one.
 *
 * `goLateral` is the second verb. It uses `router.navigate`, whose React
 * Navigation semantics are "if this route is already in the stack, pop back to
 * it; otherwise push it once". Toggling manage ⇄ tracking therefore settles at
 * a stack depth of two forever, however many times the driver switches.
 *
 * ── AND IT STARTS THE CLOCK ─────────────────────────────────────────────────
 * Every helper here opens `transitionClock` before navigating, which is what
 * lets the arriving `SmoothScreen` know it is arriving mid-transition and hold
 * its heavy tree back. Navigating with a bare `router.push` still works — the
 * screen simply does not get the head start.
 */

// Optional peer, resolved the same way `screenFocus.ts` resolves navigation:
// packages/ui carries no router dependency of its own.
type RouterLike = {
  push: (href: unknown) => void;
  replace: (href: unknown) => void;
  navigate: (href: unknown) => void;
  back: () => void;
  canGoBack: () => boolean;
  dismissTo?: (href: unknown) => void;
};

let cachedRouter: RouterLike | null = null;

function getRouter(): RouterLike | null {
  if (cachedRouter) return cachedRouter;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cachedRouter = require('expo-router').router ?? null;
  } catch {
    cachedRouter = null;
  }
  return cachedRouter;
}

/**
 * SIDEWAYS. Switch between two views of the same subject without deepening the
 * stack. Pops back to the target if it is already open.
 */
export function goLateral(href: unknown): void {
  const router = getRouter();
  if (!router) return;
  beginTransition();
  router.navigate(href as never);
}

/**
 * DEEPER. A genuinely new destination you will return from.
 *
 * Guarded against the double-tap: two pushes fired inside one transition window
 * are the same intent expressed twice, and the second one is always an
 * accident. This is the cheap fix for "I tapped the card and it opened twice".
 */
let lastPush = { href: '', at: 0 };
export function goDeeper(href: unknown): void {
  const router = getRouter();
  if (!router) return;
  const key = typeof href === 'string' ? href : JSON.stringify(href);
  const now = Date.now();
  if (key === lastPush.href && now - lastPush.at < 600) return;
  lastPush = { href: key, at: now };
  beginTransition();
  router.push(href as never);
}

/**
 * Clear the double-tap memory.
 *
 * Called on every `goBack`, so a rider who opens a trip card, comes straight
 * back and taps the SAME card again is never swallowed by the guard. The guard
 * exists to stop one gesture opening two screens; it must not stop two
 * deliberate gestures, and returning to a screen is proof the first one landed.
 */
function clearPushGuard(): void {
  lastPush = { href: '', at: 0 };
}

/** Replace the current screen. For redirects and status-driven hand-offs. */
export function goInstead(href: unknown): void {
  const router = getRouter();
  if (!router) return;
  beginTransition();
  router.replace(href as never);
}

/**
 * OUT. Leave a whole flow and land on a root screen, without unwinding it
 * one push at a time.
 *
 * THE VERB THAT WAS MISSING. `goLateral`/`goDeeper`/`goInstead`/`goBack`
 * cover moving WITHIN a stack; nothing covered abandoning one. So every
 * "leave this flow" button in both apps reached past this module for a raw
 * `router.dismissTo(...)` — which is a correct navigation and a completely
 * silent one: the clock never arms, so the screen being landed on mounts,
 * refetches and runs its entrances on the same frames as the dismissal.
 * That is the "it just takes me to the homepage, no animation" report, and
 * it is the one transition in the app that had no owner.
 *
 * Arms the clock like every other helper, then dismisses. Falls back to a
 * replace where there is no stack to dismiss (a deep link straight into the
 * flow), so the destination is reached either way.
 */
export function goOut(href: unknown): void {
  const router = getRouter();
  if (!router) return;
  clearPushGuard();
  beginTransition();
  const dismissTo = (router as { dismissTo?: (h: never) => void }).dismissTo;
  if (typeof dismissTo === 'function' && router.canGoBack()) {
    dismissTo.call(router, href as never);
    return;
  }
  router.replace(href as never);
}
/**
 * BACK, with the clock started so the screen being returned TO knows not to
 * re-run its entrances. Falls back to a replace when there is nothing to pop —
 * a deep link into a detail screen has no history behind it, and a back button
 * that does nothing is worse than one that goes home.
 */
export function goBack(fallbackHref?: unknown): void {
  const router = getRouter();
  if (!router) return;
  clearPushGuard();
  beginTransition();
  if (router.canGoBack()) {
    router.back();
    return;
  }
  if (fallbackHref != null) router.replace(fallbackHref as never);
}
