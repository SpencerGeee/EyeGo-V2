import React, { useRef, useState, useCallback, useEffect } from 'react';
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
import { fonts, fontSizes, radii, spacing, type ColorTokens } from '@eyego/config';
import { useThemedColors } from './ColorsContext';

interface InputProps extends TextInputProps {
  label: string;
  error?: string;
  containerStyle?: ViewStyle;
  rightIcon?: React.ReactNode;
  leftIcon?: React.ReactNode;
}

const AnimatedText = Animated.Text;

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
  const colors = useThemedColors();
  const styles = getStyles(colors);
  // Gates the native placeholder separately from focus state — showing it the
  // instant the field is tapped meant it appeared at the same time the
  // floating label was still mid-spring on its way up from that exact spot,
  // so label and placeholder visibly overlapped for the ~300ms of the
  // animation. Only reveal the placeholder once the label has actually
  // cleared out of the way.
  const [showPlaceholder, setShowPlaceholder] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const hasValue = value != null && value !== '';
  const labelAnim = useSharedValue(hasValue ? 1 : 0);
  const focusAnim = useSharedValue(0);

  /**
   * The label floats whenever the field is focused OR holds a value — it is
   * NOT a focus-only affordance.
   *
   * BUGFIX ("the date of birth placeholder overlaps the result"): the float
   * used to be driven purely from `handleFocus`/`handleBlur`. Any field
   * populated WITHOUT ever being focused therefore kept its label parked at
   * the rest position — directly on top of the value. The date-of-birth field
   * hit this every time, because tapping the calendar icon opens the picker
   * and `onDateChange` writes the date straight into state without the
   * TextInput ever receiving focus, printing "Date of birth" over
   * "12 / 05 / 1998". The same applied to every pre-filled edit-profile field.
   *
   * Driving the float from state means programmatic writes, autofill and
   * pre-filled values all behave identically to typing.
   */
  useEffect(() => {
    const shouldFloat = focused || hasValue;
    labelAnim.value = withSpring(shouldFloat ? 1 : 0, { stiffness: 300, damping: 20 });
  }, [focused, hasValue, labelAnim]);

  // The placeholder is a hint for an EMPTY, FOCUSED field only, and is held
  // back until the label has cleared the space it would otherwise share.
  useEffect(() => {
    if (!focused || hasValue) {
      setShowPlaceholder(false);
      return;
    }
    const t = setTimeout(() => setShowPlaceholder(true), 180);
    return () => clearTimeout(t);
  }, [focused, hasValue]);

  const handleFocus = useCallback(
    (e: Parameters<NonNullable<TextInputProps['onFocus']>>[0]) => {
      setFocused(true);
      focusAnim.value = withTiming(1, { duration: 200 });
      onFocus?.(e);
    },
    [focusAnim, onFocus]
  );

  const handleBlur = useCallback(
    (e: Parameters<NonNullable<TextInputProps['onBlur']>>[0]) => {
      setFocused(false);
      focusAnim.value = withTiming(0, { duration: 200 });
      onBlur?.(e);
    },
    [focusAnim, onBlur]
  );

  const labelStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(labelAnim.value, [0, 1], [0, -22]) },
      { scale: interpolate(labelAnim.value, [0, 1], [1, 0.82]) },
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
      [error ? colors.error : colors.outlineVariant, error ? colors.error : colors.primary]
    ),
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
          {/* BUGFIX ("the placeholder overlaps the field label and reads as
              gibberish", seen on the business-profile fields): `placeholder` is
              NOT destructured out of props, so `{...props}` used to be spread
              AFTER the gated `placeholder` below and put the raw one straight
              back. The gate never took effect: every unfocused field rendered
              its placeholder at exactly the resting position of the floating
              label, printing two strings on top of each other.
              The spread now goes FIRST so the controlled props below always win;
              `style` gets the same protection (a caller's style is merged rather
              than replacing the input's own). */}
          <TextInput
            {...props}
            ref={inputRef}
            style={[styles.input, leftIcon ? { paddingLeft: 0 } : undefined, props.style]}
            onFocus={handleFocus}
            onBlur={handleBlur}
            value={value}
            placeholder={(!value && showPlaceholder) ? props.placeholder : undefined}
            placeholderTextColor={colors.onSurfaceVariant}
            selectionColor={colors.primary}
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

function getStyles(colors: ColorTokens) {
  return StyleSheet.create({
    container: {
      width: '100%',
    },
    inputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceInput,
      borderRadius: radii.lg,
      paddingHorizontal: spacing.base,
      minHeight: 56,
      borderWidth: 1.5,
      borderColor: colors.outlineVariant,
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
}
