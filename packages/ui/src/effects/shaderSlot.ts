import { useEffect, useState } from 'react';
import { useScreenFocus } from './screenFocus';

/**
 * ONE SHADER CANVAS IN THE APP. EVER.
 *
 * `AppBackground` renders a full-screen Skia raymarch. It is also mounted by
 * nearly every screen, and — since the trip surface became a stack of stages
 * rather than a stack of routes — by several stages of the SAME screen at once.
 * SearchStage, ConfigureStage and RequestStage each mount one, on top of the
 * root layout's, and all of them are "visible" as far as navigation is
 * concerned. So the phone was compositing three or four independent
 * full-screen GPU surfaces, each running a raymarch per pixel.
 *
 * This is the structural fix rather than another constant to tune: exactly ONE
 * mounted background paints a Canvas. Everyone else paints a static gradient in
 * the same brand colours, which is a native view and costs nothing.
 *
 * THE OWNER IS THE MOST RECENTLY FOCUSED BACKGROUND — NOT THE LAST TO MOUNT.
 *
 * The previous rule was mount order, and mount order is only a proxy for "on
 * top" inside a stack. A tab navigator keeps every tab mounted forever, so the
 * first visit to Services mounted its background last and owned the shader for
 * the rest of the session; coming back to Home re-focused a screen that never
 * remounted and therefore never reclaimed the slot. Home was left painting the
 * static gradient — which is both flatter (read as "laggy"/dead) and darker
 * than the live shader — while an invisible tab ran the only live canvas.
 *
 * Claiming on FOCUS fixes both directions with one rule: every navigation, tab
 * switch and stage change hands the canvas to whatever the user is now looking
 * at, and hands it back when they return. A background with no navigation
 * context above it (the root layout's) counts as focused and simply sits at the
 * bottom of the claim order, so it owns the slot only when nothing else does.
 */

/**
 * A LIVE BACKGROUND OUTRANKS A FROZEN ONE. ALWAYS.
 *
 * BUGFIX ("the skia background on the driver app is frozen… it would work and
 * animate but go idle when it's covered or something").
 *
 * Recency alone was not enough. The app's ONE animated background is mounted by
 * the root layout, which has no navigation context above it, so it claims the
 * slot exactly once — at launch — and then sits at the BOTTOM of the claim
 * order forever. Every other mount is `variant="static"`, i.e. a background
 * that paints a deliberately FROZEN frame. So the first screen to mount one and
 * focus took the canvas off the live instance and painted a still image with
 * it, and the root was demoted to the flat gradient. On the rider that is five
 * pushed detail screens; on the driver it was five TAB screens, which never
 * unmount and which the driver is looking at all day. Net effect: the driver
 * app's animated background was almost never the thing on screen.
 *
 * Recency is still the right tie-breaker between two peers. It is the wrong
 * rule ACROSS the animated/static divide, because "static" already means "I do
 * not need the canvas to be alive". So claims carry a priority, and the owner
 * is the highest-priority claim, most recent first within a priority.
 *
 * The rule composes correctly with `paused`. A paused animated background drops
 * to static priority — which is exactly the case where an opaque detail screen
 * is covering it, and that screen SHOULD take the canvas and paint its frozen
 * pillar. Unpause and the live one takes it straight back.
 */

/** Higher wins. Live raymarch beats a frozen frame. */
/**
 * A SCREEN'S OWN BACKGROUND OUTRANKS THE ROOT'S. THAT IS THE WHOLE RULE.
 *
 * BUGFIX ("on the create trip page, the background is showing a blue background
 * (blue black) but its supposed to be showing the skia background").
 *
 * These two constants used to be STATIC=0 and ANIMATED=1, with the root layout
 * claiming ANIMATED and every pushed screen claiming STATIC. That ranking is
 * backwards, and it produced the blue-black in two separate ways:
 *
 *   1. The root's claim is permanent. It is mounted OUTSIDE the navigator, so
 *      `useScreenFocus()` is true for its entire life and it never relinquishes.
 *      Holding the highest priority forever meant a pushed screen's STATIC claim
 *      could never win, so that screen fell through to its flat `backgroundDeep`
 *      fallback — which IS the blue-black being reported.
 *
 *   2. When the root DID drop to STATIC (its `paused` path), `claim()` spliced it
 *      out and re-pushed it onto the end of the stack. `currentOwner()` breaks
 *      ties by recency, so the root became the newest STATIC claim and won the
 *      tie anyway. The yield the pause was written to perform never happened.
 *
 * The honest ranking is the physical one: whoever is on top of the screen should
 * paint it. The root background is the FLOOR — it exists to fill screens that
 * bring no background of their own. Any screen that mounts one is, by definition,
 * in front of the root and outranks it. Recency then only ever has to separate
 * two screen-level claims, and since a blurred screen relinquishes, there is
 * normally only one.
 */
/** The single root-layout background. Loses to any screen that brings its own. */
export const SHADER_PRIORITY_BASE = -1;
/** A screen's own background. Outranks the root floor. */
export const SHADER_PRIORITY_STATIC = 0;
/**
 * @deprecated Kept so existing call sites keep compiling. It is now an alias for
 * the BASE floor, because `variant="animated"` is by contract only ever the one
 * root-layout mount — see the note on AppBackgroundProps.
 */
export const SHADER_PRIORITY_ANIMATED = SHADER_PRIORITY_BASE;

interface Claim {
  id: symbol;
  priority: number;
}

/** Claim order, oldest first. Within one priority, the last entry wins. */
const stack: Claim[] = [];
const listeners = new Map<symbol, (isOwner: boolean) => void>();

/** The highest-priority claim, breaking ties by recency. */
function currentOwner(): symbol | undefined {
  let best: Claim | undefined;
  for (const claim of stack) {
    // `>=` so that later entries win ties — recency within a priority band.
    if (!best || claim.priority >= best.priority) best = claim;
  }
  return best?.id;
}

/** Recompute ownership and tell only the instances whose answer changed. */
function notifyAll() {
  const owner = currentOwner();
  listeners.forEach((notify, id) => notify(id === owner));
}

/** Move `id` to the top of the claim order (or add it there). */
function claim(id: symbol, priority: number) {
  const i = stack.findIndex((c) => c.id === id);
  if (i !== -1) {
    /**
     * ALREADY CLAIMED — RE-RANK IN PLACE, NEVER RE-PUSH.
     *
     * This used to splice the entry out and push it back onto the end, which
     * silently re-dated it. `currentOwner()` breaks ties by recency, so a
     * background that merely changed its OWN priority (the root does exactly
     * this when `paused` flips) leapfrogged screens that had claimed after it
     * and stole back a slot it was in the middle of yielding.
     *
     * Recency must mean "when did this background appear", not "when did it
     * last change its mind". Mutating in place preserves that.
     */
    if (stack[i].priority === priority) return;
    stack[i].priority = priority;
    notifyAll();
    return;
  }
  stack.push({ id, priority });
  notifyAll();
}

/** Drop `id` out of contention without unmounting it. */
function relinquish(id: symbol) {
  const i = stack.findIndex((c) => c.id === id);
  if (i === -1) return;
  stack.splice(i, 1);
  notifyAll();
}

/**
 * @param priority `SHADER_PRIORITY_ANIMATED` for the one instance that drives
 *        the clock, `SHADER_PRIORITY_STATIC` for every frozen-frame mount.
 * @returns true if this instance owns the shader slot and should render the
 *          Skia canvas; false if it should render the cheap static gradient.
 */
/**
 * @param enabled Pass `false` to stand down entirely rather than claim at a
 *   lower rank. A background that is fully covered (the root under an opaque
 *   pushed screen) cannot be seen, so holding the one Canvas only denies it to
 *   the screen the user is actually looking at. Standing down is what makes the
 *   yield real — dropping a rank was not enough, because the root outlives every
 *   screen and would simply win the next tie.
 */
export function useShaderSlot(
  priority: number = SHADER_PRIORITY_STATIC,
  enabled: boolean = true,
): boolean {
  const [id] = useState(() => Symbol('shaderSlot'));
  const focused = useScreenFocus();
  // Optimistically true: a newly mounted background is about to claim the slot,
  // and starting false would flash a frozen gradient for one commit.
  const [isOwner, setIsOwner] = useState(true);

  useEffect(() => {
    listeners.set(id, setIsOwner);
    return () => {
      listeners.delete(id);
      relinquish(id);
    };
  }, [id]);

  useEffect(() => {
    if (focused && enabled) claim(id, priority);
    else relinquish(id);
  }, [id, focused, priority, enabled]);

  return isOwner;
}

/** Test/diagnostic hook — how many backgrounds are mounted but not painting. */
export function shaderSlotWaiters(): number {
  return Math.max(0, stack.length - 1);
}
