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

/** Claim order, oldest first. The last entry is the owner. */
const stack: symbol[] = [];
const listeners = new Map<symbol, (isOwner: boolean) => void>();

/** Recompute ownership and tell only the instances whose answer changed. */
function notifyAll() {
  const owner = stack[stack.length - 1];
  listeners.forEach((notify, id) => notify(id === owner));
}

/** Move `id` to the top of the claim order (or add it there). */
function claim(id: symbol) {
  const i = stack.indexOf(id);
  if (i === stack.length - 1 && i !== -1) return;
  if (i !== -1) stack.splice(i, 1);
  stack.push(id);
  notifyAll();
}

/** Drop `id` out of contention without unmounting it. */
function relinquish(id: symbol) {
  const i = stack.indexOf(id);
  if (i === -1) return;
  stack.splice(i, 1);
  notifyAll();
}

/**
 * @returns true if this instance owns the shader slot and should render the
 *          Skia canvas; false if it should render the cheap static gradient.
 */
export function useShaderSlot(): boolean {
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
    if (focused) claim(id);
    else relinquish(id);
  }, [id, focused]);

  return isOwner;
}

/** Test/diagnostic hook — how many backgrounds are mounted but not painting. */
export function shaderSlotWaiters(): number {
  return Math.max(0, stack.length - 1);
}
