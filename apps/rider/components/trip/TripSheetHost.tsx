import React from 'react';
import { MapSheetHost, type SheetChrome } from '@eyego/ui';
import { useColors } from '../../utils/useColors';
import type { TripStage } from '../../stores/tripFlow.store';

/**
 * SHIM. The host itself moved to `packages/ui/src/shell/MapSheetHost.tsx` so
 * the driver's surface is the same object rather than a second implementation.
 *
 * What stays here is the only thing that was ever rider-specific: the chrome
 * table below, and the palette it is expressed in. The host is generic over the
 * stage union precisely so each app can keep its own table.
 *
 * Rider behaviour is unchanged — same radii, same detents, same aurora
 * intensities, same glass decisions as before the lift.
 */

/**
 * Per-stage sheet chrome. Only what genuinely differs between stages.
 *
 * `collapsed` is a resting height for the two stages whose panel is a summary
 * with detail underneath — it is what the old InlayPanel's first detent was,
 * and dropping it would mean the tracking panel opens at full height and buries
 * the map the rider is watching the car move across. Every other stage is
 * content-sized, which is what lets the sheet morph between them.
 */
const SHEET_STYLE: Record<TripStage, SheetChrome> = {
  // The search sheet is the tallest and the most "surface"-like — glass lets
  // the ambient shader read through the empty space below its content.
  search: { radius: 32, glass: true },
  configure: { radius: 32, glass: true },
  select: { radius: 32, glass: true },
  // Once a ride exists the panel carries money and identity: solid, so nothing
  // behind it competes with a fare or a plate number.
  request: { radius: 28, glass: false },
  assigned: { radius: 28, glass: false, collapsed: 0.44, aurora: 0.13 },
  // Less than `assigned`: the map earns more room once the rider is moving
  // through it rather than waiting at a kerb.
  tracking: { radius: 28, glass: false, collapsed: 0.34, aurora: 0.15 },
};

export interface TripSheetHostProps {
  current: TripStage;
  previous: TripStage | null;
  /**
   * The trip is over and the surface is being torn down. The sheet leaves
   * rather than sitting over a screen that is already navigating away.
   */
  retired?: boolean;
}

export function TripSheetHost({ current, previous, retired = false }: TripSheetHostProps) {
  const colors = useColors();
  return (
    <MapSheetHost<TripStage>
      current={current}
      previous={previous}
      retired={retired}
      chromeFor={SHEET_STYLE}
      fallbackChrome={SHEET_STYLE.tracking}
      auroraColor={colors.primary}
      solidBackground={colors.background}
    />
  );
}
