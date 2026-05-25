import React from 'react';
import { ActivityIndicator, StyleSheet, ViewStyle } from 'react-native';
import { MotiView } from 'moti';
import { Pressable } from './Pressable';
import { Text } from './Text';
import { colors, radii, spacing, fonts, fontSizes } from '@eyego/config';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  fullWidth?: boolean;
  icon?: React.ReactNode;
}

const variantStyles: Record<ButtonVariant, { container: ViewStyle; textColor: string }> = {
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
      backgroundColor: colors.errorContainer,
    },
    textColor: colors.error,
  },
};

const sizeStyles: Record<ButtonSize, { container: ViewStyle; fontSize: number }> = {
  sm: { container: { paddingVertical: spacing.sm, paddingHorizontal: spacing.base }, fontSize: fontSizes.label },
  md: { container: { paddingVertical: 14, paddingHorizontal: spacing.xl }, fontSize: fontSizes.titleSmall },
  lg: { container: { paddingVertical: spacing.base, paddingHorizontal: spacing['2xl'] }, fontSize: fontSizes.titleMedium },
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
  const vStyle = variantStyles[variant];
  const sStyle = sizeStyles[size];
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      haptic="medium"
      style={[
        styles.base,
        vStyle.container,
        sStyle.container,
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' ? colors.onPrimary : colors.primary}
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
    borderRadius: radii['3xl'],
    gap: spacing.sm,
  },
  fullWidth: {
    width: '100%',
  },
  disabled: {
    opacity: 0.5,
  },
});
