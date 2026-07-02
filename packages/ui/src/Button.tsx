import React, { useRef } from 'react';
import { ActivityIndicator, StyleSheet, ViewStyle } from 'react-native';
import { Pressable } from './Pressable';
import { Text } from './Text';
import {
  GradientGlowBorder,
  type GradientGlowBorderHandle,
  PREMIUM_RING_COLORS,
  PREMIUM_RING_LOCATIONS,
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

const sizeStyles: Record<ButtonSize, { container: ViewStyle; fontSize: number }> = {
  sm: {
    container: { paddingVertical: spacing.sm, paddingHorizontal: spacing.base, minHeight: 44 },
    fontSize: fontSizes.label,
  },
  md: {
    container: { paddingVertical: 14, paddingHorizontal: spacing.xl, minHeight: 52 },
    fontSize: fontSizes.titleSmall,
  },
  lg: {
    container: { paddingVertical: spacing.base, paddingHorizontal: spacing['2xl'], minHeight: 52 },
    fontSize: fontSizes.titleMedium,
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

  const content = loading ? (
    <ActivityIndicator size="small" color={vStyle.textColor} />
  ) : (
    <>
      {icon}
      <Text
        style={{
          fontFamily: fonts.semiBold,
          fontSize: sStyle.fontSize,
          lineHeight: Math.round(sStyle.fontSize * 1.3),
          color: vStyle.textColor,
        }}
      >
        {label}
      </Text>
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
          colors={glowColors ?? PREMIUM_RING_COLORS}
          locations={glowColors ? undefined : PREMIUM_RING_LOCATIONS}
          fillColor={colors.surfaceContainerHigh}
          borderRadius={radii.full}
          glow
          glowColor={glowColors ? glowColors[0] : colors.premiumBlue}
          glowColorSecondary={glowColors ? undefined : colors.premiumOrange}
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
