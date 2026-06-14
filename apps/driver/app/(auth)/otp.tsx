import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  Pressable,
} from 'react-native';
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
import { driverAuthApi, driverApi } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button } from '@eyego/ui';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useDriverStore } from '../../stores/driver.store';

const OTP_LENGTH = 6;
const RESEND_SECONDS = 60;

export default function DriverOtpScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { phone: rawPhone, devOtp } = useLocalSearchParams<{ phone: string; devOtp?: string }>();
  // Normalize phone: ensure '+' prefix (URL encoding can eat the '+' sign)
  const phone = rawPhone ? `+${rawPhone.replace(/^\+/, '')}` : '';
  const router = useRouter();
  const { login, setDriver } = useDriverStore();

  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [activeIndex, setActiveIndex] = useState(0);
  const [countdown, setCountdown] = useState(RESEND_SECONDS);
  const [currentDevOtp, setCurrentDevOtp] = useState(devOtp ?? '');
  const inputRefs = useRef<TextInput[]>([]);
  // D15: hold interval ID in a ref for reliable cleanup
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shakeX = useSharedValue(0);

  useEffect(() => {
    if (countdown <= 0) return;
    // D15: store interval in ref and always clear on cleanup
    countdownIntervalRef.current = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
  }, [countdown]);

  const verifyOtp = useMutation({
    mutationFn: async (code: string) =>
      driverAuthApi.verifyOtp({ phone: phone ?? '', otp: code }),
    onSuccess: async ({ data }) => {
      const { accessToken, refreshToken, isNewDriver } = data.data;
      await login({ accessToken, refreshToken });
      if (!isNewDriver) {
        try {
          const profileRes = await driverApi.getMe();
          const body = (profileRes.data as any).data;
          // Backend wraps driver data in { driver: ... } — unwrap it
          const pd = body?.driver ?? body;
          setDriver(pd);
        } catch {
          // profile fetch failed — will retry on next app load
        }
      }
      if (isNewDriver) {
        router.replace('/(auth)/register');
      } else {
        router.replace('/(tabs)/home');
      }
    },
    onError: () => {
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

  const resendOtp = useMutation({
    mutationFn: () => driverAuthApi.requestOtp({ phone: phone ?? '' }),
    onSuccess: (res) => {
      const newDevOtp = (res as any)?.data?.data?._dev_otp;
      if (newDevOtp) setCurrentDevOtp(newDevOtp);
      setOtp(Array(OTP_LENGTH).fill(''));
      setActiveIndex(0);
      setCountdown(RESEND_SECONDS);
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
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

  // Mask phone: +233 24X XXX -> +233 ••• •••• 34
  const maskedPhone = phone
    ? phone.slice(0, 5) + '•'.repeat(Math.max(0, phone.length - 7)) + phone.slice(-2)
    : '';

  return (
    <SafeAreaView style={styles.safe}>
      {/* Back */}
      <MotiView
        from={{ opacity: 0, translateX: -6 }}
        animate={{ opacity: 1, translateX: 0 }}
        transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        style={styles.backButton}
      >
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant}>← Back</Text>
        </Pressable>
      </MotiView>

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
            Sent to {maskedPhone}
          </Text>
          <Pressable onPress={() => router.back()}>
            <Text variant="label" color={colors.primary} style={{ marginTop: spacing.xs }}>
              Change number
            </Text>
          </Pressable>

          {/* Dev OTP banner — only shown in development builds */}
          {__DEV__ && !!currentDevOtp && (
            <View style={styles.devBanner}>
              <Text variant="caption" color={colors.onSurfaceVariant}>Dev OTP: </Text>
              <Text variant="label" color={colors.primary}>{currentDevOtp}</Text>
            </View>
          )}
        </MotiView>

        {/* OTP cells */}
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
                colors={colors}
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

        {/* Verifying */}
        {verifyOtp.isPending && (
          <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} style={styles.verifyingRow}>
            <Text variant="bodySmall" color={colors.onSurfaceVariant}>Verifying…</Text>
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
              <Text variant="bodySmall" color={colors.primary}>{countdown}s</Text>
            </Text>
          ) : (
            <Pressable onPress={() => resendOtp.mutate()} disabled={resendOtp.isPending}>
              <Text variant="label" color={colors.primary}>
                {resendOtp.isPending ? 'Sending…' : 'Resend code'}
              </Text>
            </Pressable>
          )}
        </MotiView>
      </View>
    </SafeAreaView>
  );
}

// ── Individual OTP Cell ───────────────────────────────────────────────────────
interface OtpCellProps {
  index: number;
  value: string;
  isActive: boolean;
  isSuccess: boolean;
  inputRef: (ref: TextInput | null) => void;
  onChange: (val: string) => void;
  onKeyPress: (key: string) => void;
  onFocus: () => void;
  colors: DriverColors;
}

function OtpCell({ value, isActive, isSuccess, inputRef, onChange, onKeyPress, onFocus, colors }: OtpCellProps) {
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
        !!value && styles.cellFilled,
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

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.backgroundDeep },
    backButton: {
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing.base,
    },
    container: {
      flex: 1,
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing['3xl'],
    },
    headline: { letterSpacing: -1 },
    subtext: { marginTop: spacing.sm },
    devBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: spacing.base,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      backgroundColor: `${colors.primary}14`,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: `${colors.primary}33`,
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
      shadowOpacity: 0.35,
      shadowRadius: 10,
      elevation: 4,
    },
    cellFilled: {
      borderColor: colors.primary,
      backgroundColor: colors.surfaceContainerHigh,
    },
    cellSuccess: {
      borderColor: colors.primary,
      backgroundColor: `${colors.primary}20`,
    },
    cellInput: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.titleLarge,
      color: colors.onSurface,
      width: '100%',
      height: '100%',
      textAlign: 'center',
    },
    errorContainer: { marginBottom: spacing.md },
    verifyingRow: { alignItems: 'center', marginBottom: spacing.md },
    resendContainer: { alignItems: 'center', marginTop: spacing.sm },
  });
