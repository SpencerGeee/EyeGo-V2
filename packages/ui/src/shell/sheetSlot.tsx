import React, { useEffect } from 'react';
import { create } from 'zustand';

/**
 * THE SLOT — how N stages share one sheet without unmounting it.
 *
 * Lifted verbatim (behaviour-for-behaviour) out of `apps/rider/components/trip`
 * so the driver can have the same surface. The rider's module is now a shim
 * that re-exports this one, which is what keeps "lift" honest: there is exactly
 * one implementation, and the rider's is it.
 *
 * The only change is the stage type. It was the rider's `TripStage` union;
 * here it is a bare string, because the two apps have different stage sets and
 * a shared module cannot know either. Call sites keep their own unions — a
 * string union is assignable to `string`, so the rider's `TripStage` and the
 * driver's `DriverStage` both narrow correctly at their own boundaries.
 *
 * ── WHY A STORE AND NOT A PORTAL ────────────────────────────────────────────
 *
 * The architecture wants a single bottom surface that deforms between stages.
 * That surface therefore cannot live inside a stage, because a stage unmounts.
 * It has to be hoisted above all of them — and then every stage needs a way to
 * put its content into a container that is not its parent.
 *
 * The obvious hoist is to lift each stage's panel body into the surface as a
 * prop. It does not work: the panel body is derived from the stage's own state
 * (a fare that just arrived, an ETA that ticked), so the surface would have to
 * own that state too, and every stage would collapse into one enormous
 * component — which is the file this pattern exists to avoid.
 *
 * The second obvious answer is a React portal via context. That does not work
 * either, and the reason is worth writing down: publishing a node into context
 * re-renders the context provider, the provider is an ancestor of the stages,
 * so every stage re-renders, so every stage republishes. An infinite loop with
 * a spring running through it.
 *
 * So the slot is a store instead. A stage publishes into it; only the sheet
 * host subscribes. The stages are not subscribers and never re-render because
 * of a publish, which breaks the cycle structurally rather than by guarding it.
 *
 * Publishing a React element into a store is unusual and safe: an element is an
 * inert description, and the description a stage produces on any given render
 * already closes over exactly the props and state that render saw. Rendering it
 * under the sheet host means its hooks run in the host's tree — fine, because
 * stages consume app-level contexts (colours, stores, router) that sit above
 * both, and provide none of their own.
 */

interface SheetSlotState {
  slots: Record<string, React.ReactNode>;
  publish: (stage: string, node: React.ReactNode) => void;
  clear: (stage: string) => void;
}

export const useSheetSlots = create<SheetSlotState>((set) => ({
  slots: {},
  publish: (stage, node) => set((s) => ({ slots: { ...s.slots, [stage]: node } })),
  clear: (stage) =>
    set((s) => {
      if (!(stage in s.slots)) return s;
      const next = { ...s.slots };
      delete next[stage];
      return { slots: next };
    }),
}));

export interface SheetContentProps {
  /**
   * Which stage this content belongs to — stated explicitly rather than read
   * from a flow store, because during a transition the OUTGOING stage is still
   * rendering and must keep publishing under its own name. Reading the current
   * stage would make it overwrite the incoming stage's content and the sheet
   * would show the wrong panel for the length of the crossfade.
   */
  stage: string;
  children: React.ReactNode;
}

/**
 * Marks a subtree as belonging in the surface's sheet. Renders nothing where it
 * is written; the content appears inside `MapSheetHost`.
 */
export function SheetContent({ stage, children }: SheetContentProps) {
  const publish = useSheetSlots((s) => s.publish);
  const clear = useSheetSlots((s) => s.clear);

  // An effect, not a render-phase write: setting store state during render of
  // another component is the one thing zustand cannot make safe.
  useEffect(() => {
    publish(stage, children);
  }, [stage, children, publish]);

  useEffect(() => () => clear(stage), [stage, clear]);

  return null;
}
