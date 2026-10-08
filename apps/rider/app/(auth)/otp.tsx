import React, { useState, useRef, useEffect, useMemo } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Entrance, goBack, notify, OTPInput, type OTPInputRef } from '@eyego/ui';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '@eyego/api';
import { useAuthStore } from '../../stores/auth.store';
import { spacing, radii } from '@eyego/config';
import { Text } from '@eyego/ui';
import { describeError, formatPhone } from '@eyego/utils';
import { Ionicons } from '@expo/vector-icons';
import { useColors, Colors } from '../../utils/useColors';
import { consumeReturnTo } from '../../utils/returnTo';

const OTP_LENGTH = 6;
const RESEND_SECONDS = 60;

export default function OtpScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { phone: rawPhone, devOtp } = useLocalSearchParams<{ phone: string; devOtp?: string }>();
  // URL encoding can eat the '+'.
  const phone = rawPhone ? `+${rawPhone.replace(/^\+/, '')}` : '';
  const router = useRouter();
  const { login } = useAuthStore();

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
    mutationFn: (code: string) => authApi.verifyOtp({ phone, otp: code }),
    onSuccess: async ({ data }) => {
      const { user, accessToken, refreshToken, isNewUser } = data.data;
      await login(user, { accessToken, refreshToken });
      // A returning rider goes home — or back to the invite link that sent
      // them here. This went to the intro carousel, so they swiped through it
      // on every sign-in. A new rider keeps the target until setup finishes.
      const needsProfile = isNewUser || !user.name;
      router.replace((needsProfile ? '/(auth)/register' : consumeReturnTo() ?? '/(tabs)/home') as any);
    },
    onError: (err) => {
      setError(describeError(err, 'That code didn’t work. Try again.').message);
      otpRef.current?.shake();
      otpRef.current?.clear();
      setTimeout(() => otpRef.current?.focus(), 120);
    },
  });

  const resendOtp = useMutation({
    mutationFn: () => authApi.sendOtp({ phone }),
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
        <Entrance animation="slideUp" delay={50}>
          <Text variant="headlineLarge" style={styles.headline}>Enter the code</Text>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.subtext}>
            Sent by SMS to {formatPhone(phone)}
          </Text>
          <Pressable onPress={() => goBack()} accessibilityRole="button" accessibilityLabel="Change phone number" hitSlop={8}>
            <Text variant="label" color={colors.primary} style={{ marginTop: spacing.xs }}>Change number</Text>
          </Pressable>
          {!!currentDevOtp && (
            <View style={styles.devBanner}>
              <Text variant="caption" color={colors.onSurfaceVariant}>Dev OTP: </Text>
              <Text variant="label" color={colors.primary}>{currentDevOtp}</Text>
            </View>
          )}
        </Entrance>

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
            <Pressable onPress={() => resendOtp.mutate()} disabled={resendOtp.isPending} accessibilityRole="button" accessibilityLabel="Resend verification code" hitSlop={8}>
              <Text variant="label" color={colors.primary}>{resendOtp.isPending ? 'Sending…' : 'Resend code'}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    // Transparent like the rest of the auth flow — the root AppBackground shows through.
    safe: { flex: 1, backgroundColor: 'transparent' },
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
