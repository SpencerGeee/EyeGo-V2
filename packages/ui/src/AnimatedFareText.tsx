import React, { useMemo } from 'react';
import { fonts, fontSizes } from '@eyego/config';
import { formatGhs } from '@eyego/utils';
import { ShinyText } from './ShinyText';
import { RollingDigits } from './RollingDigits';
import { useThemedColors } from './ColorsContext';
import type { TextVariant } from './Text';

const FARE_SIZE: Partial<Record<TextVariant, number>> = {
  fareLarge: fontSizes.fareLarge,
  fareMedium: fontSizes.fareMedium,
  fareSmall: fontSizes.fareSmall,
  fareInline: fontSizes.fareInline,
};

// Mirrors Text.tsx's per-variant fare lineHeight ratios so the shiny path
// (which bypasses the shared Text component) doesn't clip its own glyphs.
const FARE_LINE_HEIGHT_RATIO: Partial<Record<TextVariant, number>> = {
  fareLarge: 1.15,
  fareMedium: 1.2,
  fareSmall: 1.3,
  fareInline: 1.3,
};

interface AnimatedFareTextProps {
  /**
   * INTEGER PESEWAS — the unit every money field on the wire uses.
   *
   * This prop used to be `value` and used to mean cedis: it rendered
   * `value.toFixed(2)` behind a "GH₵ " prefix. When the API migrated to
   * pesewas every call site kept compiling and started rendering a GH₵4.80
   * fare as "GH₵ 480.00" and a GH₵20.00 driver balance as "GHS 2000.00".
   * The rename is deliberate — it makes the compiler visit every call site
   * rather than letting a wrong unit pass silently a second time.
   */
  pesewas: number;
  variant?: TextVariant;
  color?: string;
  /** Adds a premium shine sweep — reserved for a single hero fare number
   * (e.g. ride confirmation), not every fare row in a list. */
  shiny?: boolean;
}

/**
 * The canonical way a fare appears in either app.
 *
 * Formatting is `formatGhs`, so the symbol, the thousands separator and the
 * two-decimal tail are identical to every other money string in the product —
 * no screen invents its own "GHS " prefix any more.
 *
 * Motion is `RollingDigits`: each digit rolls in its own clipped slot on the
 * UI thread. The previous implementation tweened with a `setInterval` firing
 * 20 `setState`s over 400ms, which re-rendered the whole subtree 20 times per
 * fare change on the JS thread — the single worst offender on any screen that
 * showed a live-updating price.
 */
export function AnimatedFareText({
  pesewas,
  variant = 'fareLarge',
  color,
  shiny = false,
}: AnimatedFareTextProps) {
  const colors = useThemedColors();
  const formatted = useMemo(() => formatGhs(pesewas), [pesewas]);

  const fontSize = FARE_SIZE[variant] ?? fontSizes.fareLarge;
  const lineHeight = fontSize * (FARE_LINE_HEIGHT_RATIO[variant] ?? 1.15);

  if (shiny) {
    // The shine sweep needs one continuous string to mask, so the hero fare
    // swaps instantly instead of rolling. It is a headline that settles once,
    // not a meter that ticks.
    return (
      <ShinyText
        baseColor={color ?? colors.primary}
        textStyle={{ fontFamily: fonts.monoBold, fontSize, lineHeight }}
      >
        {formatted}
      </ShinyText>
    );
  }

  return (
    <RollingDigits
      text={formatted}
      value={pesewas}
      fontSize={fontSize}
      color={color ?? colors.onSurface}
      fontFamily={fonts.monoBold}
    />
  );
}
