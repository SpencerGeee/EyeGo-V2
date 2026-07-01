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
    },
    labelLarge: {
      fontFamily: fonts.medium,
      fontSize: fontSizes.label,
      color: colors.onSurface,
      letterSpacing: letterSpacings.label,
    },
    labelMedium: {
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodySmall,
      color: colors.onSurface,
      letterSpacing: letterSpacings.label,
    },
    labelSmall: {
      fontFamily: fonts.medium,
      fontSize: fontSizes.caption,
      color: colors.onSurfaceVariant,
      letterSpacing: letterSpacings.label,
    },
    caption: {
      fontFamily: fonts.regular,
      fontSize: fontSizes.caption,
      color: colors.onSurfaceVariant,
      letterSpacing: letterSpacings.label,
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
    },
    fareInline: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.fareInline,
      color: colors.primary,
    },
  };
}

interface EyeGoTextProps extends TextProps {
  variant?: TextVariant;
  color?: string;
}

export function Text({ variant = 'bodyMedium', color, style, ...props }: EyeGoTextProps) {
  const colors = useThemedColors();
  const variantStyles = useMemo(() => getVariantStyles(colors), [colors]);
  return (
    <RNText
      style={[
        variantStyles[variant],
        color ? { color } : undefined,
        style,
      ]}
      {...props}
    />
  );
}
