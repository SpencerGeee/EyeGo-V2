import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  Pressable,
  Alert,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MotiView } from 'moti';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  withSpring,
} from 'react-native-reanimated';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '@eyego/api';
import { useAuthStore } from '../../stores/auth.store';
import { fonts, fontSizes, spacing, radii, withOpacity } from '@eyego/config';
import { Text, Button } from '@eyego/ui';
import { maskPhone } from '@eyego/utils';
import { useColors, Colors } from '../../utils/useColors';

const OTP_LENGTH = 6;
const RESEND_SECONDS = 60;

export default function OtpScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { phone: rawPhone, devOtp } = useLocalSearchParams<{ phone: string; devOtp?: string }>();
  // Normalize phone: ensure '+' prefix (URL encoding can eat the '+' sign)
  const phone = rawPhone ? `+${rawPhone.replace(/^\+/, '')}` : '';
  const router = useRouter();
  const { login } = useAuthStore();

  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [activeIndex, setActiveIndex] = useState(0);
  const [countdown, setCountdown] = useState(RESEND_SECONDS);
  const inputRefs = useRef<TextInput[]>([]);
  const shakeX = useSharedValue(0);

  // Countdown timer
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const verifyOtp = useMutation({
    mutationFn: async (code: string) =>
      authApi.verifyOtp({ phone: phone ?? '', otp: code }),
    onSuccess: async ({ data }) => {
      const { user, accessToken, refreshToken, isNewUser } = data.data;
      await login(user, { accessToken, refreshToken });
      if (isNewUser || !user.name) {
        router.replace('/(auth)/register');
      } else {
        router.replace('/(onboarding)');
      }
    },
    onError: () => {
      // Shake animation on wrong code
      shakeX.value = withSequence(
        withTiming(-10, { duration: 60 }),
        withTiming(10, { duration: 60 }),
        withTiming(-8, { duration: 60 }),
        withTiming(8, { duration: 60 }),
        withTiming(-4, { duration: 60 }),
        withTiming(0, { duration: 60 })
      );
      setOtp(Array(OTP_LENGTH).fill(''));
      setActiveIndex(0);
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    },
  });

  const [currentDevOtp, setCurrentDevOtp] = useState(devOtp ?? '');

  const resendOtp = useMutation({
    mutationFn: () => authApi.sendOtp({ phone: phone ?? '' }),
    onSuccess: (res) => {
      const newDevOtp = (res as any)?.data?.data?._dev_otp;
      if (newDevOtp) setCurrentDevOtp(newDevOtp);
      setOtp(Array(OTP_LENGTH).fill(''));
      setActiveIndex(0);
      setCountdown(RESEND_SECONDS);
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    },
    onError: (err: any) => {
      const status = err?.response?.status ?? err?.status;
      if (status === 429) {
        setCountdown(RESEND_SECONDS);
        Alert.alert('Too many attempts', 'Please wait 60 seconds before requesting a new code.');
      } else {
        Alert.alert('Failed to Resend', 'Could not resend the code. Please try again.');
      }
    },
  });

  const handleKeyPress = useCallback(
    (index: number, key: string) => {
      if (key === 'Backspace') {
        if (otp[index]) {
          const newOtp = [...otp];
          newOtp[index] = '';
          setOtp(newOtp);
        } else if (index > 0) {
          const newOtp = [...otp];
          newOtp[index - 1] = '';
          setOtp(newOtp);
          setActiveIndex(index - 1);
          inputRefs.current[index - 1]?.focus();
        }
      }
    },
    [otp]
  );

  const handleChange = useCallback(
    (index: number, value: string) => {
      const digit = value.slice(-1);
      if (!/^\d$/.test(digit)) return;

      const newOtp = [...otp];
      newOtp[index] = digit;
      setOtp(newOtp);

      if (index < OTP_LENGTH - 1) {
        setActiveIndex(index + 1);
        inputRefs.current[index + 1]?.focus();
      } else {
        // Auto-submit when last digit entered
        const code = newOtp.join('');
        if (code.length === OTP_LENGTH) {
          verifyOtp.mutate(code);
        }
      }
    },
    [otp, verifyOtp]
  );

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  const isComplete = otp.every((d) => d !== '');

  return (
    <SafeAreaView style={styles.safe}>
      {/* Back button */}
      <MotiView
        from={{ opacity: 0, translateX: -6 }}
        animate={{ opacity: 1, translateX: 0 }}
        transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        style={styles.backButton}
      >
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Text variant="bodyMedium" color={colors.onSurfaceVariant}>← Back</Text>
        </Pressable>
      </MotiView>

      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
      >
      <View style={styles.container}>
        {/* Headline */}
        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 50 }}
        >
          <Text variant="headlineLarge" style={styles.headline}>
            Enter the code
          </Text>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.subtext}>
            Sent to {maskPhone(phone ?? '')}
          </Text>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Change phone number">
            <Text variant="label" color={colors.primary} style={{ marginTop: spacing.xs }}>
              Change number
            </Text>
          </Pressable>
          {!!currentDevOtp && (
            <View style={styles.devBanner}>
              <Text variant="caption" color={colors.onSurfaceVariant}>Dev OTP: </Text>
              <Text variant="label" color={colors.primary}>{currentDevOtp}</Text>
            </View>
          )}
        </MotiView>

        {/* OTP boxes */}
        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 100 }}
        >
          <Animated.View style={[styles.otpRow, shakeStyle]}>
            {Array.from({ length: OTP_LENGTH }).map((_, i) => (
              <OtpCell
                key={i}
                index={i}
                value={otp[i]}
                isActive={activeIndex === i}
                isSuccess={isComplete && !verifyOtp.isError && verifyOtp.isSuccess}
                inputRef={(ref) => { if (ref) inputRefs.current[i] = ref; }}
                onChange={(val) => handleChange(i, val)}
                onKeyPress={(key) => handleKeyPress(i, key)}
                onFocus={() => setActiveIndex(i)}
              />
            ))}
          </Animated.View>
        </MotiView>

        {/* Error */}
        {verifyOtp.isError && (
          <MotiView
            from={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={styles.errorContainer}
          >
            <Text variant="caption" color={colors.error} style={{ textAlign: 'center' }}>
              Invalid code. Please try again.
            </Text>
          </MotiView>
        )}

        {/* Loading indicator */}
        {verifyOtp.isPending && (
          <MotiView
            from={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={styles.verifyingRow}
          >
            <Text variant="bodySmall" color={colors.onSurfaceVariant}>
              Verifying...
            </Text>
          </MotiView>
        )}

        {/* Resend */}
        <MotiView
          from={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ type: 'timing', duration: 400, delay: 150 }}
          style={styles.resendContainer}
        >
          {countdown > 0 ? (
            <Text variant="bodySmall" color={colors.onSurfaceVariant}>
              Resend code in{' '}
              <Text variant="bodySmall" color={colors.primary}>
                {countdown}s
              </Text>
            </Text>
          ) : (
            <Pressable onPress={() => resendOtp.mutate()} disabled={resendOtp.isPending} accessibilityRole="button" accessibilityLabel="Resend verification code">
              <Text variant="label" color={colors.primary}>
                {resendOtp.isPending ? 'Sending...' : 'Resend code'}
              </Text>
            </Pressable>
          )}
        </MotiView>
      </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

// Individual OTP cell component
interface OtpCellProps {
  index: number;
  value: string;
  isActive: boolean;
  isSuccess: boolean;
  inputRef: (ref: TextInput | null) => void;
  onChange: (val: string) => void;
  onKeyPress: (key: string) => void;
  onFocus: () => void;
}

function OtpCell({ value, isActive, isSuccess, inputRef, onChange, onKeyPress, onFocus }: OtpCellProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const scale = useSharedValue(1);

  useEffect(() => {
    if (value) {
      scale.value = withSequence(
        withSpring(1.1, { stiffness: 400, damping: 20 }),
        withSpring(1, { stiffness: 400, damping: 20 })
      );
    }
  }, [value, scale]);

  const cellStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      style={[
        styles.cell,
        isActive && styles.cellActive,
        value && styles.cellFilled,
        isSuccess && styles.cellSuccess,
        cellStyle,
      ]}
    >
      <TextInput
        ref={inputRef}
        style={styles.cellInput}
        value={value}
        onChangeText={onChange}
        onKeyPress={({ nativeEvent }) => onKeyPress(nativeEvent.key)}
        onFocus={onFocus}
        keyboardType="number-pad"
        maxLength={1}
        textAlign="center"
        selectionColor={colors.primary}
        caretHidden
      />
    </Animated.View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  backButton: {
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing.base,
  },
  container: {
    flex: 1,
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing['3xl'],
  },
  headline: {
    letterSpacing: -1,
  },
  subtext: {
    marginTop: spacing.sm,
  },
  devBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.base,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: withOpacity(colors.primary, 0.08),
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: withOpacity(colors.primary, 0.2),
    alignSelf: 'flex-start',
  },
  otpRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing['3xl'],
    marginBottom: spacing.xl,
    justifyContent: 'center',
  },
  cell: {
    width: 48,
    height: 60,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.outline,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellActive: {
    borderColor: colors.primary,
    borderWidth: 2,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  cellFilled: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceContainerHigh,
  },
  cellSuccess: {
    borderColor: colors.primary,
    backgroundColor: withOpacity(colors.primary, 0.15),
  },
  cellInput: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.titleLarge,
    lineHeight: Math.round(fontSizes.titleLarge * 1.3),
    color: colors.onSurface,
    width: '100%',
    height: '100%',
    textAlign: 'center',
  },
  errorContainer: {
    marginBottom: spacing.md,
  },
  verifyingRow: {
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  resendContainer: {
    alignItems: 'center',
    marginTop: spacing.sm,
  },
});
