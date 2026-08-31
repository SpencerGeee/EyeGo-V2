import React, { useMemo } from 'react';
import { Text as RNText, TextProps, TextStyle } from 'react-native';
import { fonts, fontSizes, letterSpacings, type ColorTokens } from '@eyego/config';
import { useThemedColors } from './ColorsContext';

export type TextVariant =
  | 'hero'
  | 'display'
  | 'headlineLarge'
  | 'headlineMedium'
  | 'titleLarge'
  | 'titleMedium'
  | 'titleSmall'
  | 'bodyLarge'
  | 'bodyMedium'
  | 'bodySmall'
  | 'label'
  | 'labelLarge'
  | 'labelMedium'
  | 'labelSmall'
  | 'labelCaps'
  | 'priceDisplay'
  | 'caption'
  | 'fareLarge'
  | 'fareMedium'
  | 'fareSmall'
  | 'fareInline'
  | 'headlineSmall';

function getVariantStyles(colors: ColorTokens): Record<TextVariant, TextStyle> {
  return {
    hero: {
      fontFamily: fonts.displayExtraBold,
      fontSize: fontSizes.hero,
      letterSpacing: letterSpacings.display,
      color: colors.onSurface,
      lineHeight: fontSizes.hero * 1.15,
    },
    display: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.display,
      letterSpacing: letterSpacings.display,
      color: colors.onSurface,
      lineHeight: fontSizes.display * 1.15,
    },
    headlineLarge: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.headlineLarge,
      letterSpacing: letterSpacings.headline,
      color: colors.onSurface,
      lineHeight: fontSizes.headlineLarge * 1.25,
    },
    headlineMedium: {
      fontFamily: fonts.displaySemiBold,
      fontSize: fontSizes.headlineMedium,
      letterSpacing: letterSpacings.headline,
      color: colors.onSurface,
      lineHeight: fontSizes.headlineMedium * 1.25,
    },
    headlineSmall: {
      fontFamily: fonts.displaySemiBold,
      fontSize: fontSizes.headlineSmall,
      letterSpacing: letterSpacings.headline,
      color: colors.onSurface,
      lineHeight: fontSizes.headlineSmall * 1.3,
    },
    titleLarge: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.titleLarge,
      color: colors.onSurface,
      lineHeight: fontSizes.titleLarge * 1.4,
    },
    titleMedium: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.titleMedium,
      color: colors.onSurface,
      lineHeight: fontSizes.titleMedium * 1.4,
    },
    titleSmall: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.titleSmall,
      color: colors.onSurface,
      lineHeight: fontSizes.titleSmall * 1.4,
    },
    bodyLarge: {
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodyLarge,
      color: colors.onSurface,
      lineHeight: fontSizes.bodyLarge * 1.5,
    },
    bodyMedium: {
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodyMedium,
      color: colors.onSurface,
      lineHeight: fontSizes.bodyMedium * 1.5,
    },
    bodySmall: {
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodySmall,
      color: colors.onSurfaceVariant,
      lineHeight: fontSizes.bodySmall * 1.5,
    },
    label: {
      fontFamily: fonts.medium,
      fontSize: fontSizes.label,
      color: colors.onSurface,
      letterSpacing: letterSpacings.label,
      lineHeight: fontSizes.label * 1.4,
    },
    labelLarge: {
      fontFamily: fonts.medium,
      fontSize: fontSizes.label,
      color: colors.onSurface,
      letterSpacing: letterSpacings.label,
      lineHeight: fontSizes.label * 1.4,
    },
    labelMedium: {
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodySmall,
      color: colors.onSurface,
      letterSpacing: letterSpacings.label,
      lineHeight: fontSizes.bodySmall * 1.4,
    },
    labelSmall: {
      fontFamily: fonts.medium,
      fontSize: fontSizes.caption,
      color: colors.onSurfaceVariant,
      letterSpacing: letterSpacings.label,
      lineHeight: fontSizes.caption * 1.4,
    },
    labelCaps: {
      fontFamily: fonts.labelCaps,
      fontSize: fontSizes.bodySmall,
      color: colors.onSurfaceVariant,
      letterSpacing: letterSpacings.label,
      lineHeight: 16,
      textTransform: 'uppercase',
    },
    priceDisplay: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.fareMedium,
      letterSpacing: letterSpacings.headline,
      color: colors.onSurface,
      lineHeight: fontSizes.fareMedium * 1.35,
    },
    caption: {
      fontFamily: fonts.regular,
      fontSize: fontSizes.caption,
      color: colors.onSurfaceVariant,
      letterSpacing: letterSpacings.label,
      lineHeight: fontSizes.caption * 1.4,
    },
    fareLarge: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.fareLarge,
      letterSpacing: letterSpacings.display,
      color: colors.primary,
      lineHeight: fontSizes.fareLarge * 1.15,
    },
    fareMedium: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.fareMedium,
      letterSpacing: letterSpacings.display,
      color: colors.primary,
      lineHeight: fontSizes.fareMedium * 1.2,
    },
    fareSmall: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.fareSmall,
      color: colors.primary,
      lineHeight: fontSizes.fareSmall * 1.3,
    },
    fareInline: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.fareInline,
      color: colors.primary,
      lineHeight: fontSizes.fareInline * 1.3,
    },
  };
}

interface EyeGoTextProps extends TextProps {
  variant?: TextVariant;
  color?: string;
}

/**
 * ── THE TEXT-SCALING CEILING ────────────────────────────────────────────────
 *
 * Neither app had a font-scaling policy of any kind — no `allowFontScaling`, no
 * `maxFontSizeMultiplier`, anywhere — against 142 hardcoded fixed heights in
 * the rider app alone. So a user who had turned up their phone's text size got
 * type scaling without limit inside containers that did not move, and buttons,
 * rows and chips clipped.
 *
 * That population is not small and it is not incidental to this product: large
 * text is the default accessibility setting for a lot of older users, and
 * Android's Display Size setting scales type too. Neither the E2E harness nor a
 * developer running default settings can see any of it.
 *
 * ── WHY 1.4 AND NOT MORE, OR LESS ───────────────────────────────────────────
 * iOS goes to roughly 3.1x at the accessibility sizes. 1.4 is about where a
 * two-line fare card becomes three lines and still fits its container. Below
 * 1.3 we would be overriding the user's stated preference hard enough to be
 * rude; above 1.5 the clipping comes back.
 *
 * This is the CEILING, not the fix. It stops the breakage everywhere at once,
 * including in screens nobody has looked at. The honest half — `height` becoming
 * `minHeight` on the primitives that actually contain text — is the pass that
 * follows, and it is what lets 1.4 actually be reached rather than merely
 * survived.
 *
 * A caller can still pass its own `maxFontSizeMultiplier` to opt out: a number
 * in a fixed-width tabular column sometimes genuinely must not grow.
 */
export const MAX_FONT_SCALE = 1.4;

export function Text({
  variant = 'bodyMedium',
  color,
  style,
  maxFontSizeMultiplier = MAX_FONT_SCALE,
  ...props
}: EyeGoTextProps) {
  const colors = useThemedColors();
  const variantStyles = useMemo(() => getVariantStyles(colors), [colors]);
  return (
    <RNText
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[
        variantStyles[variant],
        color ? { color } : undefined,
        style,
      ]}
      {...props}
    />
  );
}
