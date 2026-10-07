import React, { useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { View, TextInput, Pressable, StyleSheet, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { fonts, spacing, radii, type ColorTokens } from '@eyego/config';
import { Text } from './Text';
import { useThemedColors } from './ColorsContext';

interface OTPInputProps {
  length?: number;
  onComplete: (code: string) => void;
  hasError?: boolean;
  onErrorReset?: () => void;
}

export interface OTPInputRef {
  shake: () => void;
  clear: () => void;
  focus: () => void;
}

/**
 * One hidden input owns the whole code; the boxes only draw it. That is what
 * lets the SMS code iOS offers above the keyboard, Android's SMS autofill, and
 * a paste land in one go — the screens used six maxLength-1 inputs that kept
 * only the last digit of anything longer than one.
 */

export const OTPInput = forwardRef<OTPInputRef, OTPInputProps>(
  ({ length = 6, onComplete, hasError = false, onErrorReset }, ref) => {
    const colors = useThemedColors();
    const styles = getStyles(colors);
    const [code, setCode] = useState('');
    const inputRef = useRef<TextInput>(null);
    const translateX = useSharedValue(0);

    useImperativeHandle(ref, () => ({
      shake: () => {
        translateX.value = withSequence(
          withTiming(-8, { duration: 50 }),
          withTiming(8, { duration: 50 }),
          withTiming(-6, { duration: 50 }),
          withTiming(6, { duration: 50 }),
          withTiming(-4, { duration: 50 }),
          withTiming(0, { duration: 50 })
        );
      },
      clear: () => setCode(''),
      focus: () => inputRef.current?.focus(),
    }));

    const animatedStyle = useAnimatedStyle(() => ({
      transform: [{ translateX: translateX.value }],
    }));

    const handleChangeText = (text: string) => {
      const cleaned = text.replace(/\D/g, '').slice(0, length);
      setCode(cleaned);
      if (hasError && onErrorReset) onErrorReset();
      if (cleaned.length === length) onComplete(cleaned);
    };

    return (
      <Pressable onPress={() => inputRef.current?.focus()}>
        <Animated.View style={[styles.row, animatedStyle]}>
          {Array.from({ length }).map((_, i) => {
            const char = code[i] ?? '';
            const isActive = i === code.length && !hasError;
            return (
              <View
                key={i}
                style={[
                  styles.box,
                  isActive && styles.boxActive,
                  hasError && styles.boxError,
                ]}
              >
                <Text style={styles.digit}>{char}</Text>
              </View>
            );
          })}
        </Animated.View>
        <TextInput maxFontSizeMultiplier={1.4}
          ref={inputRef}
          value={code}
          onChangeText={handleChangeText}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
          importantForAutofill="yes"
          maxLength={length}
          style={styles.hiddenInput}
          autoFocus
          caretHidden
          selectionColor="transparent"
          accessibilityLabel={`Verification code, ${length} digits`}
        />
      </Pressable>
    );
  }
);

OTPInput.displayName = 'OTPInput';

function getStyles(colors: ColorTokens) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      gap: spacing.sm,
      justifyContent: 'center',
    },
    // flex + maxWidth: six fixed 52pt boxes overflowed a 360dp Android screen.
    box: {
      flex: 1,
      maxWidth: 52,
      height: 60,
      borderRadius: radii.lg,
      backgroundColor: colors.surfaceInput,
      borderWidth: 1.5,
      borderColor: colors.outlineVariant,
      alignItems: 'center',
      justifyContent: 'center',
    },
    boxActive: {
      borderColor: colors.primary,
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.25,
      shadowRadius: 8,
      elevation: 4,
    },
    boxError: {
      borderColor: colors.statusError,
    },
    digit: {
      fontFamily: fonts.monoBold,
      fontSize: 24,
      lineHeight: Math.round(24 * 1.3),
      color: colors.onSurface,
      textAlign: 'center',
    },
    // Over the boxes, near-transparent (some Android builds skip autofill for
    // a 1×1 or fully transparent field).
    hiddenInput: {
      ...StyleSheet.absoluteFillObject,
      opacity: 0.015,
      color: 'transparent',
    },
  });
}
