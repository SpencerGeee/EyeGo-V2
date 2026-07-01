import React from 'react';
import { ActivityIndicator, StyleSheet, ViewStyle } from 'react-native';
import { Pressable } from './Pressable';
import { Text } from './Text';
import { radii, spacing, fonts, fontSizes, type ColorTokens } from '@eyego/config';
import { useThemedColors } from './ColorsContext';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
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
}: ButtonProps) {
  const colors = useThemedColors();
  const vStyle = getVariantStyles(colors)[variant];
  const sStyle = sizeStyles[size];
  const isDisabled = disabled || loading;

  const resolvedStyle: ViewStyle[] = [styles.base, vStyle.container, sStyle.container];
  if (fullWidth) resolvedStyle.push(styles.fullWidth);
  if (isDisabled) resolvedStyle.push(styles.disabled);
  if (style) {
    if (Array.isArray(style)) resolvedStyle.push(...style);
    else resolvedStyle.push(style);
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      haptic="medium"
      style={resolvedStyle}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={vStyle.textColor}
        />
      ) : (
        <>
          {icon}
          <Text
            style={{
              fontFamily: fonts.semiBold,
              fontSize: sStyle.fontSize,
              color: vStyle.textColor,
            }}
          >
            {label}
          </Text>
        </>
      )}
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
