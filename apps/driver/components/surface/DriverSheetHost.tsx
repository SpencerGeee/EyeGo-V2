import React from 'react';
import { MapSheetHost } from '@eyego/ui';
import { useColors } from '../../utils/useColors';
import { DRIVER_SHEET_CHROME, type DriverStage } from './driverStage';

/**
 * The driver's one sheet, hosted above every stage on the home surface.
 *
 * BUGFIX ("I feel like the rider app got upgrades but the driver app aesthetic
 * is still using the same thing that was done at the very beginning of the
 * project").
 *
 * It was, literally. Home's bottom panel was `InlayPanel`, the original sheet
 * component, while the rider had long since moved to `MorphSheet` — different
 * spring, different grabber, different corner treatment, no crossfade between
 * bodies and no ghost layer. Two sheet implementations in one product is what
 * "the driver looks older" actually was, and no amount of restyling `InlayPanel`
 * would have closed it, because the difference was the motion, not the paint.
 *
 * So the driver now renders the SAME host the rider does — `MapSheetHost`,
 * lifted into packages/ui for exactly this. What stays app-specific is the
 * chrome table and the palette, which is the only thing that was ever
 * legitimately different.
 *
 * `InlayPanel` is not deleted: other driver screens still use it, and replacing
 * them is a separate change with its own risk. This is the surface the user
 * looks at all day.
 */
export interface DriverSheetHostProps {
  current: DriverStage;
  previous: DriverStage | null;
}

export function DriverSheetHost({ current, previous }: DriverSheetHostProps) {
  const colors = useColors();
  return (
    <MapSheetHost<DriverStage>
      current={current}
      previous={previous}
      chromeFor={DRIVER_SHEET_CHROME}
      fallbackChrome={DRIVER_SHEET_CHROME.idle}
      auroraColor={colors.primary}
      solidBackground={colors.background}
      grabberColor={colors.outline}
    />
  );
}
