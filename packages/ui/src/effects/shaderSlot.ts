import { useEffect, useState } from 'react';

/**
 * ONE SHADER CANVAS IN THE APP. EVER.
 *
 * `AppBackground` renders a full-screen Skia raymarch. It is also mounted by
 * nearly every screen, and — since the trip surface became a stack of stages
 * rather than a stack of routes — by several stages of the SAME screen at once.
 * SearchStage, ConfigureStage and RequestStage each mount one, on top of the
 * root layout's, and all of them are "visible" as far as navigation is
 * concerned. So the phone was compositing three or four independent
 * full-screen GPU surfaces, each running a 28-iteration-per-pixel raymarch.
 *
 * That is the whole of "you made both apps' Skia background very and extremely
 * laggy". Every per-frame optimisation in `LightPillarBackground` — the reduced
 * resolution, the 24 fps clock, the scroll pause, the dwell decay — makes ONE
 * canvas cheap. None of them stop N canvases from existing, and N was not 1.
 *
 * This is the structural fix rather than another constant to tune: the FIRST
 * mounted background claims the single shader slot and is the only one that
 * paints a Canvas. Everyone else paints a static gradient in the same brand
 * colours, which is a native view and costs nothing. Visually the stack is
 * unchanged — the layers underneath were never visible through the topmost
 * opaque background anyway, which is exactly why the cost was invisible in
 * review and obvious on a device.
 *
 * NEWEST WINS, IN BOTH DIRECTIONS. The instance that just mounted is the one on
 * top of the stack, so it is the one the user can actually see — it PREEMPTS the
 * current owner, which drops to the static gradient it was invisible behind
 * anyway. When it unmounts, the slot goes back to the most recent instance still
 * mounted, i.e. the screen now revealed underneath.
 *
 * If the slot were simply first-come, the root layout would hold it forever and
 * every pushed screen and trip stage would show the frozen gradient instead of
 * the live brand background — the effect would be paid for once and seen almost
 * nowhere.
 */

/** Mount order, oldest first. The last entry is the owner. */
const stack: symbol[] = [];
const listeners = new Map<symbol, (isOwner: boolean) => void>();

/** Tell the top of the stack it owns the slot; nobody else does. */
function notifyOwner(previous: symbol | undefined) {
  const next = stack[stack.length - 1];
  if (previous === next) return;
  if (previous) listeners.get(previous)?.(false);
  if (next) listeners.get(next)?.(true);
}

/**
 * @returns true if this instance owns the shader slot and should render the
 *          Skia canvas; false if it should render the cheap static gradient.
 */
export function useShaderSlot(): boolean {
  const [id] = useState(() => Symbol('shaderSlot'));
  // Optimistically true: a newly mounted background is about to become the top
  // of the stack, and starting false would flash a frozen frame for one commit.
  const [isOwner, setIsOwner] = useState(true);

  useEffect(() => {
    listeners.set(id, setIsOwner);
    const previous = stack[stack.length - 1];
    stack.push(id);
    notifyOwner(previous);

    return () => {
      const wasOwner = stack[stack.length - 1] === id;
      const i = stack.indexOf(id);
      if (i !== -1) stack.splice(i, 1);
      listeners.delete(id);
      if (wasOwner) notifyOwner(undefined);
    };
  }, [id]);

  return isOwner;
}

/** Test/diagnostic hook — how many backgrounds are mounted but not painting. */
export function shaderSlotWaiters(): number {
  return Math.max(0, stack.length - 1);
}
