import React, { useRef } from 'react';
import { StyleSheet, ViewStyle } from 'react-native';
import { Pressable } from './Pressable';
import { Text } from './Text';
import { ShinyText } from './ShinyText';
import { Loader } from './Loader';
import {
  GradientGlowBorder,
  type GradientGlowBorderHandle,
  PREMIUM_RING_COLORS,
  PREMIUM_RING_LOCATIONS,
  RING_PALETTES,
} from './effects/GradientGlowBorder';
import { radii, spacing, fonts, fontSizes, type ColorTokens } from '@eyego/config';
import { useThemedColors } from './ColorsContext';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'glow';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle | ViewStyle[];
  fullWidth?: boolean;
  icon?: React.ReactNode;
  accessibilityLabel?: string;
  accessibilityRole?: string;
  /** variant="glow" only — overrides the default green/blue ring sweep.
   * e.g. [colors.tertiary, colors.statusError] for a SOS/urgent CTA. */
  glowColors?: readonly [string, string, ...string[]];
  /** variant="glow" only — a named ring palette (`'gold'`, `'comfort'`, …).
   * Lower precedence than `glowColors`. Use this to make a CTA carry the tier
   * the rider just picked rather than the generic blue/orange premium sweep. */
  palette?: keyof typeof RING_PALETTES;
  /**
   * Sweeps a shine across the label. The step CTA in the rider's book-a-ride
   * flow is a hero moment and read flat and generic without it ("no shiny
   * text"). Kept opt-in — a masked gradient per button is not free, and body
   * buttons should stay plain.
   */
  shiny?: boolean;
  /** `shiny` only — the resting label colour under the sweep. */
  shinyBaseColor?: string;
}

function getVariantStyles(colors: ColorTokens): Record<ButtonVariant, { container: ViewStyle; textColor: string }> {
  return {
    primary: {
      container: {
        backgroundColor: colors.primary,
        shadowColor: colors.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 12,
        elevation: 8,
      },
      textColor: colors.onPrimary,
    },
    secondary: {
      container: {
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        borderColor: colors.primary,
      },
      textColor: colors.primary,
    },
    ghost: {
      container: {
        backgroundColor: 'transparent',
      },
      textColor: colors.onSurface,
    },
    destructive: {
      container: {
        backgroundColor: colors.statusError,
      },
      textColor: '#FFFFFF',
    },
    glow: {
      // Solid fill + glow shadow are rendered by GradientGlowBorder instead —
      // this container stays transparent so the animated ring is visible.
      container: {
        backgroundColor: 'transparent',
      },
      textColor: colors.onSurface,
    },
  };
}

// `lineHeight` travels with `fontSize`, always. Geist's ascenders clip against
// an implicit line box on iOS, which is the "top of the text is cut off" the
// driver app's forms showed — a button label is no different.
const sizeStyles: Record<ButtonSize, { container: ViewStyle; fontSize: number; lineHeight: number }> = {
  sm: {
    container: { paddingVertical: spacing.sm, paddingHorizontal: spacing.base, minHeight: 44 },
    fontSize: fontSizes.label,
    lineHeight: Math.round(fontSizes.label * 1.3),
  },
  md: {
    container: { paddingVertical: 14, paddingHorizontal: spacing.xl, minHeight: 52 },
    fontSize: fontSizes.titleSmall,
    lineHeight: Math.round(fontSizes.titleSmall * 1.3),
  },
  lg: {
    container: { paddingVertical: spacing.base, paddingHorizontal: spacing['2xl'], minHeight: 52 },
    fontSize: fontSizes.titleMedium,
    lineHeight: Math.round(fontSizes.titleMedium * 1.3),
  },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'lg',
  loading = false,
  disabled = false,
  style,
  fullWidth = true,
  icon,
  glowColors,
  palette,
  shiny = false,
  shinyBaseColor,
}: ButtonProps) {
  const colors = useThemedColors();
  const vStyle = getVariantStyles(colors)[variant];
  const sStyle = sizeStyles[size];
  const isDisabled = disabled || loading;
  const glowRef = useRef<GradientGlowBorderHandle>(null);
  const isGlow = variant === 'glow';

  const resolvedStyle: ViewStyle[] = [styles.base, vStyle.container, sStyle.container];
  if (fullWidth) resolvedStyle.push(styles.fullWidth);
  if (isDisabled) resolvedStyle.push(styles.disabled);
  if (style) {
    if (Array.isArray(style)) resolvedStyle.push(...style);
    else resolvedStyle.push(style);
  }

  const labelStyle = {
    fontFamily: fonts.semiBold,
    fontSize: sStyle.fontSize,
    lineHeight: sStyle.lineHeight,
    color: vStyle.textColor,
  };

  const content = loading ? (
    // The app's own loader, at a size that fits inside the button's line box —
    // so a pending button and a pending screen are visibly the same product.
    <Loader size={Math.round(sStyle.fontSize * 1.15)} color={vStyle.textColor} />
  ) : (
    <>
      {icon}
      {shiny ? (
        <ShinyText
          baseColor={shinyBaseColor ?? vStyle.textColor}
          textStyle={labelStyle}
        >
          {label}
        </ShinyText>
      ) : (
        <Text style={labelStyle}>{label}</Text>
      )}
    </>
  );

  if (isGlow) {
    return (
      <Pressable
        onPress={onPress}
        onPressIn={() => glowRef.current?.burst()}
        disabled={isDisabled}
        haptic="medium"
        style={fullWidth ? styles.fullWidth : undefined}
      >
        <GradientGlowBorder
          ref={glowRef}
          // Precedence: explicit colours > named palette > the default premium
          // sweep. `palette` handles its own glow tints, so the explicit
          // glowColor props are only passed when there is no palette to respect.
          palette={glowColors ? undefined : palette}
          colors={glowColors ?? (palette ? undefined : PREMIUM_RING_COLORS)}
          locations={glowColors || palette ? undefined : PREMIUM_RING_LOCATIONS}
          fillColor={colors.surfaceContainerHigh}
          borderRadius={radii.full}
          glow
          glowColor={glowColors ? glowColors[0] : palette ? undefined : colors.premiumBlue}
          glowColorSecondary={glowColors || palette ? undefined : colors.premiumOrange}
          style={resolvedStyle}
        >
          {content}
        </GradientGlowBorder>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      haptic="medium"
      style={resolvedStyle}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.full,
    gap: spacing.sm,
  },
  fullWidth: {
    width: '100%',
  },
  disabled: {
    opacity: 0.45,
  },
});
