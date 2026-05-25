import React, { useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { View, TextInput, Pressable, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors, fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text } from './Text';

interface OTPInputProps {
  length?: number;
  onComplete: (code: string) => void;
  hasError?: boolean;
  onErrorReset?: () => void;
}

export interface OTPInputRef {
  shake: () => void;
  clear: () => void;
}

export const OTPInput = forwardRef<OTPInputRef, OTPInputProps>(
  ({ length = 6, onComplete, hasError = false, onErrorReset }, ref) => {
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
        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={handleChangeText}
          keyboardType="number-pad"
          maxLength={length}
          style={styles.hiddenInput}
          autoFocus
          caretHidden
        />
      </Pressable>
    );
  }
);

OTPInput.displayName = 'OTPInput';

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
  },
  box: {
    width: 48,
    height: 56,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceContainerHigh,
    borderWidth: 1.5,
    borderColor: colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxActive: {
    borderColor: colors.primary,
  },
  boxError: {
    borderColor: colors.error,
  },
  digit: {
    fontFamily: fonts.monoBold,
    fontSize: 24,
    color: colors.onSurface,
    textAlign: 'center',
  },
  hiddenInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
});
