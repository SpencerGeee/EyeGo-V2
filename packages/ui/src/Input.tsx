import React, { useRef, useState, useCallback } from 'react';
import {
  TextInput,
  TextInputProps,
  View,
  StyleSheet,
  ViewStyle,
  Pressable,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  interpolateColor,
} from 'react-native-reanimated';
import { colors, fonts, fontSizes, radii, spacing } from '@eyego/config';

interface InputProps extends TextInputProps {
  label: string;
  error?: string;
  containerStyle?: ViewStyle;
  rightIcon?: React.ReactNode;
  leftIcon?: React.ReactNode;
}

const AnimatedText = Animated.createAnimatedComponent(
  require('react-native').Text
);

export function Input({
  label,
  error,
  containerStyle,
  rightIcon,
  leftIcon,
  value,
  onFocus,
  onBlur,
  ...props
}: InputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const labelAnim = useSharedValue(value ? 1 : 0);
  const focusAnim = useSharedValue(0);

  const handleFocus = useCallback(
    (e: Parameters<NonNullable<TextInputProps['onFocus']>>[0]) => {
      setIsFocused(true);
      labelAnim.value = withSpring(1, { stiffness: 300, damping: 20 });
      focusAnim.value = withTiming(1, { duration: 200 });
      onFocus?.(e);
    },
    [labelAnim, focusAnim, onFocus]
  );

  const handleBlur = useCallback(
    (e: Parameters<NonNullable<TextInputProps['onBlur']>>[0]) => {
      setIsFocused(false);
      if (!value) {
        labelAnim.value = withSpring(0, { stiffness: 300, damping: 20 });
      }
      focusAnim.value = withTiming(0, { duration: 200 });
      onBlur?.(e);
    },
    [labelAnim, focusAnim, value, onBlur]
  );

  const labelStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: interpolate(labelAnim.value, [0, 1], [0, -22]),
      },
      {
        scale: interpolate(labelAnim.value, [0, 1], [1, 0.82]),
      },
    ],
    color: interpolateColor(
      focusAnim.value,
      [0, 1],
      [colors.onSurfaceVariant, colors.primary]
    ),
  }));

  const borderStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      focusAnim.value,
      [0, 1],
      [error ? colors.error : colors.outline, error ? colors.error : colors.primary]
    ),
    borderWidth: interpolate(focusAnim.value, [0, 1], [1, 2]),
  }));

  return (
    <View style={[styles.container, containerStyle]}>
      <Animated.View style={[styles.inputContainer, borderStyle]}>
        {leftIcon && <View style={styles.leftIcon}>{leftIcon}</View>}
        <View style={styles.innerContainer}>
          <AnimatedText
            style={[styles.label, labelStyle]}
            onPress={() => inputRef.current?.focus()}
          >
            {label}
          </AnimatedText>
          <TextInput
            ref={inputRef}
            style={[styles.input, leftIcon ? { paddingLeft: 0 } : undefined]}
            onFocus={handleFocus}
            onBlur={handleBlur}
            value={value}
            placeholder={(!value && isFocused) ? props.placeholder : undefined}
            placeholderTextColor={colors.onSurfaceVariant}
            selectionColor={colors.primary}
            {...props}
          />
        </View>
        {rightIcon && <View style={styles.rightIcon}>{rightIcon}</View>}
      </Animated.View>
      {error ? (
        <Animated.Text style={styles.errorText}>{error}</Animated.Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.base,
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.outline,
  },
  innerContainer: {
    flex: 1,
    paddingTop: 16,
    paddingBottom: 8,
    justifyContent: 'flex-end',
  },
  label: {
    position: 'absolute',
    top: 18,
    left: 0,
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodyMedium,
    transformOrigin: 'left center',
  },
  input: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodyLarge,
    color: colors.onSurface,
    paddingVertical: 0,
    margin: 0,
  },
  leftIcon: {
    marginRight: spacing.sm,
  },
  rightIcon: {
    marginLeft: spacing.sm,
  },
  errorText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.caption,
    color: colors.error,
    marginTop: spacing.xs,
    marginLeft: spacing.xs,
  },
});
