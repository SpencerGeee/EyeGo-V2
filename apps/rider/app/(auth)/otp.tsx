import React, { useState, useRef, useEffect } from 'react';
import { View, StyleSheet, Pressable, ScrollView, ActivityIndicator, AccessibilityInfo } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { goBack, notify, OTPInput, Text, type OTPInputRef } from '@eyego/ui';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '@eyego/api';
import { useAuthStore } from '../../stores/auth.store';
import { fonts, spacing, radii } from '@eyego/config';
import { describeError } from '@eyego/utils';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '../../utils/useColors';
import { consumeReturnTo } from '../../utils/returnTo';
import { AUTH_SHEET, leaveAuthScene, maskPhone } from '../../components/intro/authScene';
import { BlurWordText } from '../../components/intro/BlurWordText';

const OTP_LENGTH = 6;
/** Matches the server's resend window — asking sooner is a 429. */
const RESEND_SECONDS = 60;

export default function OtpScreen() {
  const colors = useColors();
  const { phone: rawPhone, devOtp } = useLocalSearchParams<{ phone: string; devOtp?: string }>();
  // URL encoding can eat the '+'.
  const phone = rawPhone ? `+${rawPhone.replace(/^\+/, '')}` : '';
  const router = useRouter();
  const { login } = useAuthStore();

  const otpRef = useRef<OTPInputRef>(null);
  const [error, setError] = useState('');
  const [verified, setVerified] = useState(false);
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
      // Tokens go to secure storage inside `login` — nothing sensitive is logged.
      await login(user, { accessToken, refreshToken });
      setVerified(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // A returning rider goes home (or back to the invite that sent them); a
      // new one finishes their profile first.
      const needsProfile = isNewUser || !user.name;
      if (needsProfile) {
        setTimeout(() => router.replace('/(auth)/register' as any), 300);
        return;
      }
      leaveAuthScene(() => router.replace((consumeReturnTo() ?? '/(tabs)/home') as any));
    },
    onError: (err) => {
      const msg = describeError(err, 'That code didn’t work. Try again.').message;
      setError(msg);
      AccessibilityInfo.announceForAccessibility?.(msg);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
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
        setError(describeError(err, 'We couldn’t resend the code. Try again.').message);
      }
    },
  });

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={styles.top}>
        <Pressable onPress={() => goBack()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Change phone number" style={styles.back}>
          <Ionicons name="arrow-back" size={20} color={AUTH_SHEET.text} />
        </Pressable>
        <View style={styles.grabber} />
        <View style={{ width: 36 }} />
      </View>

      <BlurWordText text="Enter the code" textKey="otp-title" style={[styles.title, { color: AUTH_SHEET.text }]} containerStyle={styles.left} />
      <Animated.View entering={FadeIn.duration(300).delay(160)}>
        <Text style={[styles.subtitle, { color: AUTH_SHEET.textDim }]}>
          We sent a 6-digit code to {maskPhone(phone)}
        </Text>
        {!!currentDevOtp && (
          <View style={[styles.devBanner, { backgroundColor: `${colors.primary}14` }]}>
            <Text variant="caption" color={AUTH_SHEET.textDim}>Dev OTP: </Text>
            <Text variant="label" color={colors.primary}>{currentDevOtp}</Text>
          </View>
        )}
      </Animated.View>

      <Animated.View entering={FadeInDown.duration(320).delay(220)} style={styles.otp} accessible accessibilityLabel="Verification code, six digits">
        <OTPInput
          ref={otpRef}
          length={OTP_LENGTH}
          hasError={!!error}
          onErrorReset={() => setError('')}
          onComplete={(code) => !verifyOtp.isPending && !verified && verifyOtp.mutate(code)}
        />
      </Animated.View>

      <View style={styles.status} accessibilityLiveRegion="polite">
        {verified ? (
          <Animated.View entering={FadeIn.duration(200)} style={styles.row}>
            <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
            <Text style={[styles.statusText, { color: colors.primary }]}>Verified</Text>
          </Animated.View>
        ) : error ? (
          <Animated.View entering={FadeInDown.duration(180)} style={styles.row}>
            <Ionicons name="alert-circle" size={15} color={colors.error} />
            <Text style={[styles.statusText, { color: colors.error }]}>{error}</Text>
          </Animated.View>
        ) : verifyOtp.isPending ? (
          <View style={styles.row}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.statusText, { color: AUTH_SHEET.textDim }]}>Checking…</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.resend}>
        {countdown > 0 ? (
          <Text style={[styles.statusText, { color: AUTH_SHEET.textDim }]}>
            Resend code in <Text style={[styles.statusText, { color: AUTH_SHEET.text }]}>{countdown}s</Text>
          </Text>
        ) : (
          <Pressable onPress={() => resendOtp.mutate()} disabled={resendOtp.isPending} accessibilityRole="button" accessibilityLabel="Resend verification code" hitSlop={10}>
            <Text style={[styles.statusText, { color: colors.primary, fontFamily: fonts.semiBold }]}>
              {resendOtp.isPending ? 'Sending…' : 'Resend code'}
            </Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing['2xl'], paddingBottom: 140 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, marginBottom: spacing.base },
  back: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)' },
  left: { justifyContent: 'flex-start' },
  title: { fontFamily: fonts.displayBold, fontSize: 26, lineHeight: 31, letterSpacing: -0.5 },
  subtitle: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, marginTop: spacing.xs },
  devBanner: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.md, alignSelf: 'flex-start' },
  otp: { marginTop: spacing['2xl'] },
  status: { minHeight: 28, marginTop: spacing.base, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { fontFamily: fonts.regular, fontSize: 13.5 },
  resend: { alignItems: 'center', marginTop: spacing.sm },
});
