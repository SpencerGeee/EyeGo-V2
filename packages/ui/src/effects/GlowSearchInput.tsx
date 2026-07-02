import React, { useRef, type ReactNode } from 'react';
import {
  TextInput,
  type TextInputProps,
  View,
  StyleSheet,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import { radii, spacing, withOpacity, fonts, fontSizes } from '@eyego/config';
import { useThemedColors } from '../ColorsContext';
import { Pressable } from '../Pressable';
import { GradientGlowBorder, type GradientGlowBorderHandle } from './GradientGlowBorder';

interface GlowSearchInputProps extends TextInputProps {
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
}

/**
 * Real-TextInput variant of the premium glow search bar: a thin ambient-
 * rotating gradient ring (via GradientGlowBorder) with a soft glow, that
 * bursts brighter on focus — the RN equivalent of the web sample's
 * hover/focus reaction.
 */
export function GlowSearchInput({
  leftIcon,
  rightIcon,
  containerStyle,
  onFocus,
  onBlur,
  style,
  ...props
}: GlowSearchInputProps) {
  const colors = useThemedColors();
  const ringRef = useRef<GradientGlowBorderHandle>(null);

  return (
    <GradientGlowBorder
      ref={ringRef}
      colors={[colors.primary, colors.secondary]}
      fillColor={colors.surfaceInput}
      borderRadius={radii['2xl']}
      thickness="thin"
      glow
      style={[styles.container, containerStyle]}
    >
      {leftIcon && <View style={styles.iconSlot}>{leftIcon}</View>}
      <TextInput
        style={[styles.input, { color: colors.onSurface }, style]}
        placeholderTextColor={colors.onSurfaceVariant}
        selectionColor={colors.primary}
        onFocus={(e) => {
          ringRef.current?.burst();
          onFocus?.(e);
        }}
        onBlur={onBlur}
        {...props}
      />
      {rightIcon && <View style={styles.iconSlot}>{rightIcon}</View>}
    </GradientGlowBorder>
  );
}

interface GlowSearchPressableProps {
  onPress: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

/**
 * Fake-search-bar variant (navigates on press rather than accepting input) —
 * used for home.tsx's "Where to?" entry point.
 */
export function GlowSearchPressable({
  onPress,
  children,
  style,
  accessibilityLabel,
}: GlowSearchPressableProps) {
  const colors = useThemedColors();
  const ringRef = useRef<GradientGlowBorderHandle>(null);

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => ringRef.current?.burst()}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <GradientGlowBorder
        ref={ringRef}
        colors={[colors.primary, colors.secondary]}
        fillColor={withOpacity(colors.surfaceCard, 0.6)}
        borderRadius={radii['2xl']}
        thickness="thin"
        glow
        style={[styles.container, style]}
      >
        {children}
      </GradientGlowBorder>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    minHeight: 56,
    gap: spacing.sm,
  },
  iconSlot: {
    marginHorizontal: spacing.xs,
  },
  input: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodyLarge,
    paddingVertical: 0,
  },
});
