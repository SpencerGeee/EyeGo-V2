import React, { useMemo } from 'react';
import { Text as RNText, TextProps, TextStyle } from 'react-native';
import { fonts, fontSizes, colors, letterSpacings } from '@eyego/config';
import { useColors } from '../../../apps/rider/utils/useColors';

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
  | 'caption'
  | 'fareLarge'
  | 'fareMedium'
  | 'fareSmall'
  | 'fareInline';

const variantStyles: Record<TextVariant, TextStyle> = {
  hero: {
    fontFamily: fonts.displayExtraBold,
    fontSize: fontSizes.hero,
    letterSpacing: letterSpacings.tight,
    color: colors.onSurface,
  },
  display: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.display,
    letterSpacing: letterSpacings.tight,
    color: colors.onSurface,
  },
  headlineLarge: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.headlineLarge,
    letterSpacing: letterSpacings.tight,
    color: colors.onSurface,
  },
  headlineMedium: {
    fontFamily: fonts.displaySemiBold,
    fontSize: fontSizes.headlineMedium,
    letterSpacing: letterSpacings.tight,
    color: colors.onSurface,
  },
  titleLarge: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.titleLarge,
    color: colors.onSurface,
  },
  titleMedium: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.titleMedium,
    color: colors.onSurface,
  },
  titleSmall: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.titleSmall,
    color: colors.onSurface,
  },
  bodyLarge: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodyLarge,
    color: colors.onSurface,
  },
  bodyMedium: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodyMedium,
    color: colors.onSurface,
  },
  bodySmall: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodySmall,
    color: colors.onSurfaceVariant,
  },
  label: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.label,
    color: colors.onSurface,
  },
  caption: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.caption,
    color: colors.onSurfaceVariant,
    letterSpacing: letterSpacings.wide,
  },
  fareLarge: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.fareLarge,
    letterSpacing: letterSpacings.tight,
    color: colors.primary,
  },
  fareMedium: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.fareMedium,
    letterSpacing: letterSpacings.tight,
    color: colors.primary,
  },
  fareSmall: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.fareSmall,
    color: colors.primary,
  },
  fareInline: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.fareInline,
    color: colors.primary,
  },
};

interface EyeGoTextProps extends TextProps {
  variant?: TextVariant;
  color?: string;
}

export function Text({ variant = 'bodyMedium', color, style, ...props }: EyeGoTextProps) {
  let dynamicColors: any;
  try {
    dynamicColors = useColors();
  } catch (e) {
    // fallback
  }

  const defaultColor = useMemo(() => {
    if (!dynamicColors) return undefined;
    if (variant === 'bodySmall' || variant === 'caption') {
      return dynamicColors.onSurfaceVariant;
    }
    if (variant.startsWith('fare')) {
      return dynamicColors.primary;
    }
    return dynamicColors.onSurface;
  }, [variant, dynamicColors]);

  return (
    <RNText
      style={[
        variantStyles[variant],
        defaultColor ? { color: defaultColor } : undefined,
        color ? { color } : undefined,
        style,
      ]}
      {...props}
    />
  );
}
