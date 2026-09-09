import React from 'react';
import { SheetContent as SharedSheetContent, useSheetSlots } from '@eyego/ui';
import type { TripStage } from '../../stores/tripFlow.store';

/**
 * SHIM. The implementation moved to `packages/ui/src/shell/sheetSlot.tsx` so
 * the driver's surface could be the same object instead of a second copy of it
 * — see the long note there for why the slot is a store and not a portal.
 *
 * Nothing about the rider's behaviour changed. This file survives for two
 * reasons worth keeping:
 *
 *   1. It re-narrows the stage type. The shared module takes a bare `string`,
 *      because two apps have different stage sets and it cannot know either.
 *      Rider call sites keep passing `TripStage`, so a typo in a stage name is
 *      still a compile error here rather than a silently empty sheet.
 *   2. Every rider import path stays exactly as it was, which is what makes
 *      this a lift rather than a refactor of the rider app.
 */

export { useSheetSlots };

export interface SheetContentProps {
  /** See the shared module: stated explicitly, never read from the flow store. */
  stage: TripStage;
  children: React.ReactNode;
}

/**
 * Marks a subtree as belonging in the trip surface's sheet. Renders nothing
 * where it is written; the content appears inside `TripSheetHost`.
 */
export function SheetContent({ stage, children }: SheetContentProps) {
  return <SharedSheetContent stage={stage}>{children}</SharedSheetContent>;
}
