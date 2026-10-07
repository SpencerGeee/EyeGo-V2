import React, { useState, useRef, useEffect, useMemo } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MotiView, goBack, notify, OTPInput, type OTPInputRef } from '@eyego/ui';
import { useMutation } from '@tanstack/react-query';
import { driverAuthApi, driverApi } from '@eyego/api';
import { describeError, formatPhone } from '@eyego/utils';
import { spacing, radii, springs } from '@eyego/config';
import { Text } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useDriverStore } from '../../stores/driver.store';

const OTP_LENGTH = 6;
const RESEND_SECONDS = 60;

export default function DriverOtpScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { phone: rawPhone, devOtp } = useLocalSearchParams<{ phone: string; devOtp?: string }>();
  // URL encoding can eat the '+'.
  const phone = rawPhone ? `+${rawPhone.replace(/^\+/, '')}` : '';
  const router = useRouter();
  const { login, setDriver } = useDriverStore();

  const otpRef = useRef<OTPInputRef>(null);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(RESEND_SECONDS);
  const [currentDevOtp, setCurrentDevOtp] = useState(devOtp ?? '');

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const verifyOtp = useMutation({
    mutationFn: (code: string) => driverAuthApi.verifyOtp({ phone, otp: code }),
    onSuccess: async ({ data }) => {
      const { accessToken, refreshToken, isNewDriver } = data.data;
      await login({ accessToken, refreshToken });
      if (isNewDriver) {
        router.replace('/(auth)/register');
        return;
      }
      try {
        const res = await driverApi.getMe();
        const body = (res.data as any).data;
        setDriver(body?.driver ?? body);
      } catch {
        // Profile loads again on the next app start.
      }
      router.replace('/(tabs)/home');
    },
    onError: (err) => {
      // The server's reason — wrong code, expired code, too many tries — not
      // a blanket "Invalid code" for a dropped connection too.
      setError(describeError(err, 'That code didn’t work. Try again.').message);
      otpRef.current?.shake();
      otpRef.current?.clear();
      setTimeout(() => otpRef.current?.focus(), 120);
    },
  });

  const resendOtp = useMutation({
    mutationFn: () => driverAuthApi.requestOtp({ phone }),
    onSuccess: (res) => {
      const newDevOtp = (res as any)?.data?.data?._dev_otp;
      if (newDevOtp) setCurrentDevOtp(newDevOtp);
      setError('');
      otpRef.current?.clear();
      setCountdown(RESEND_SECONDS);
      otpRef.current?.focus();
    },
    onError: (err: any) => {
      const status = err?.response?.status ?? err?.status;
      if (status === 429) {
        setCountdown(RESEND_SECONDS);
        notify('Too many attempts', 'Wait a minute before asking for a new code.');
      } else {
        notify('Couldn’t resend', describeError(err, 'Please try again.').message);
      }
    },
  });

  return (
    <SafeAreaView style={styles.safe}>
      <Pressable onPress={() => goBack()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back" style={styles.back}>
        <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
      </Pressable>

      <View style={styles.container}>
        <MotiView from={{ opacity: 0, translateY: 10 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'spring', ...springs.standard, delay: 50 }}>
          <Text variant="headlineLarge" style={styles.headline}>Enter the code</Text>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.subtext}>
            Sent by SMS to {formatPhone(phone)}
          </Text>
          <Pressable onPress={() => goBack()} accessibilityRole="button" hitSlop={8}>
            <Text variant="label" color={colors.primary} style={{ marginTop: spacing.xs }}>Change number</Text>
          </Pressable>

          {/* Shown whenever the backend returns a dev OTP (NODE_ENV=development),
              including sideloaded builds. Production never returns _dev_otp. */}
          {!!currentDevOtp && (
            <View style={styles.devBanner}>
              <Text variant="caption" color={colors.onSurfaceVariant}>Dev OTP: </Text>
              <Text variant="label" color={colors.primary}>{currentDevOtp}</Text>
            </View>
          )}
        </MotiView>

        <View style={styles.otp}>
          <OTPInput
            ref={otpRef}
            length={OTP_LENGTH}
            hasError={!!error}
            onErrorReset={() => setError('')}
            onComplete={(code) => !verifyOtp.isPending && verifyOtp.mutate(code)}
          />
        </View>

        {error ? (
          <Text variant="caption" color={colors.error} style={styles.center}>{error}</Text>
        ) : verifyOtp.isPending ? (
          <Text variant="bodySmall" color={colors.onSurfaceVariant} style={styles.center}>Checking…</Text>
        ) : null}

        <View style={styles.resend}>
          {countdown > 0 ? (
            <Text variant="bodySmall" color={colors.onSurfaceVariant}>
              Resend code in <Text variant="bodySmall" color={colors.onSurface}>{countdown}s</Text>
            </Text>
          ) : (
            <Pressable onPress={() => resendOtp.mutate()} disabled={resendOtp.isPending} accessibilityRole="button" hitSlop={8}>
              <Text variant="label" color={colors.primary}>{resendOtp.isPending ? 'Sending…' : 'Resend code'}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.backgroundDeep },
    back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: spacing.sm, marginTop: spacing.xs },
    container: { flex: 1, paddingHorizontal: spacing['2xl'], paddingTop: spacing.xl },
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
      alignSelf: 'flex-start',
    },
    otp: { marginTop: spacing['3xl'], marginBottom: spacing.lg },
    center: { textAlign: 'center', marginBottom: spacing.md },
    resend: { alignItems: 'center', marginTop: spacing.sm },
  });
