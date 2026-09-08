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
export const SHADER_PRIORITY_STATIC = 0;
export const SHADER_PRIORITY_ANIMATED = 1;

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
    // Already on top with the same weight — nothing to recompute.
    if (i === stack.length - 1 && stack[i].priority === priority) return;
    stack.splice(i, 1);
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
export function useShaderSlot(priority: number = SHADER_PRIORITY_STATIC): boolean {
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
    if (focused) claim(id, priority);
    else relinquish(id);
  }, [id, focused, priority]);

  return isOwner;
}

/** Test/diagnostic hook — how many backgrounds are mounted but not painting. */
export function shaderSlotWaiters(): number {
  return Math.max(0, stack.length - 1);
}
