import React, { useState, useRef, useMemo } from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  Platform,
  Pressable,
  Alert,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Entrance } from '@eyego/ui';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text } from '@eyego/ui';
import { Button } from '@eyego/ui';
import { useColors, Colors } from '../../utils/useColors';

export default function PhoneScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [phone, setPhone] = useState('');
  const inputRef = useRef<TextInput>(null);
  const router = useRouter();
  const isValid = phone.replace(/\s/g, '').length === 9;

  const sendOtp = useMutation({
    mutationFn: () => authApi.sendOtp({ phone: `+233${phone.replace(/\s/g, '')}` }),
    onSuccess: (res) => {
      // Surface the dev OTP whenever the backend returns it (NODE_ENV=development).
      // Keyed off the response — NOT __DEV__ — so it still works in sideloaded
      // preview/release builds. A production backend never returns _dev_otp.
      const devOtp = (res as any)?.data?.data?._dev_otp;
      router.push({
        pathname: '/(auth)/otp',
        // Strip '+' prefix to avoid URL encoding issues in dev builds
        params: { phone: `233${phone.replace(/\s/g, '')}`, ...(devOtp ? { devOtp } : {}) },
      });
    },
    onError: (err: any) => {
      // Previously a failed request did nothing at all — the rider tapped
      // Continue and the screen just sat there.
      Alert.alert(
        'Could not send code',
        err?.response?.data?.message ?? err?.message ?? 'Please check your connection and try again.'
      );
    },
  });

  const handlePhoneChange = (text: string) => {
    // Only digits, max 9
    const digits = text.replace(/\D/g, '').slice(0, 9);
    setPhone(digits);
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Animated background orbs — subtle ambient glow that fades in to low opacity,
          not a full-scale entrance. Uses standalone Animated.View with useSharedValue
          for the continuous pulse effect. */}
      <View style={styles.orb1} pointerEvents="none" />
      <View style={styles.orb2} pointerEvents="none" />

      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
          {/* Logo */}
          <Entrance animation="slideDown" delay={50}>
            <Text style={styles.logo}>EyeGo</Text>
          </Entrance>

          {/* Headline */}
          <Entrance animation="slideUp" delay={100} style={styles.headlineContainer}>
            <Text variant="headlineLarge" style={styles.headline}>
              What's your{'\n'}number?
            </Text>
            <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.subtext}>
              We'll send you a one-time verification code.
            </Text>
          </Entrance>

          {/* Phone input */}
          <Entrance animation="slideUp" delay={150} style={styles.inputWrapper}>
            <Pressable
              style={styles.phoneContainer}
              onPress={() => inputRef.current?.focus()}
              accessibilityRole="none"
            >
              <View style={styles.countryCode}>
                <Text style={styles.flag}>🇬🇭</Text>
                <Text style={styles.code}>+233</Text>
              </View>
              <View style={styles.divider} />
              <TextInput
                ref={inputRef}
                style={styles.phoneInput}
                value={phone}
                onChangeText={handlePhoneChange}
                keyboardType="number-pad"
                placeholder="24X XXX XXXX"
                placeholderTextColor={colors.onSurfaceVariant}
                returnKeyType="done"
                autoFocus
                selectionColor={colors.primary}
                maxLength={9}
                accessibilityLabel="Phone number input"
              />
            </Pressable>
          </Entrance>

          {/* Error */}
          {sendOtp.isError && (
            <Entrance animation="slideUp" duration={200}>
              <Text variant="caption" color={colors.error} style={styles.errorText}>
                {(sendOtp.error as Error)?.message ?? 'Failed to send code. Try again.'}
              </Text>
            </Entrance>
          )}

          {/* CTA */}
          <Entrance animation="slideUp" delay={180} style={styles.ctaContainer}>
            <Button
              label="Send Code"
              onPress={() => sendOtp.mutate()}
              disabled={!isValid}
              loading={sendOtp.isPending}
              accessibilityLabel="Send verification code"
            />
          </Entrance>

          {/* Divider */}
          <Entrance animation="fadeIn" delay={200} duration={400} style={styles.orDivider}>
            <View style={styles.dividerLine} />
            <Text variant="caption" color={colors.onSurfaceVariant} style={{ marginHorizontal: spacing.md }}>
              OR
            </Text>
            <View style={styles.dividerLine} />
          </Entrance>

          {/* Social buttons */}
          <Entrance animation="slideUp" delay={200} style={styles.socialContainer}>
            <Button
              label="Continue with Google"
              variant="secondary"
              onPress={() => router.push('/(auth)/social' as any)}
              accessibilityLabel="Continue with Google"
            />
            {Platform.OS === 'ios' && (
              <Button
                label="Continue with Apple"
                variant="secondary"
                onPress={() => router.push('/(auth)/social' as any)}
                style={styles.appleBtn}
                accessibilityLabel="Continue with Apple"
              />
            )}
          </Entrance>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing['2xl'],
    paddingBottom: spacing['3xl'],
  },
  orb1: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: colors.primary,
    top: -100,
    right: -80,
  },
  orb2: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: colors.secondary,
    bottom: 100,
    left: -80,
  },
  logo: {
    fontFamily: fonts.displayBold,
    fontSize: 22,
    lineHeight: 28,
    color: colors.primary,
    marginTop: spacing.lg,
    letterSpacing: -0.5,
  },
  headlineContainer: {
    marginTop: 52,
    marginBottom: spacing['2xl'],
  },
  headline: {
    letterSpacing: -1,
    lineHeight: 34,
  },
  subtext: {
    marginTop: spacing.sm,
    lineHeight: 22,
  },
  inputWrapper: {
    marginBottom: spacing.lg,
  },
  phoneContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.outline,
    height: 60,
    overflow: 'hidden',
  },
  countryCode: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    gap: spacing.xs,
    minWidth: 80,
  },
  flag: {
    fontSize: 20,
    lineHeight: 26,
  },
  code: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodyMedium,
    color: colors.onSurface,
  },
  divider: {
    width: 1,
    height: 28,
    backgroundColor: colors.outline,
  },
  phoneInput: {
    flex: 1,
    paddingHorizontal: spacing.base,
    fontFamily: fonts.medium,
    fontSize: fontSizes.titleSmall,
    color: colors.onSurface,
    letterSpacing: 1,
  },
  errorText: {
    marginBottom: spacing.md,
    marginLeft: spacing.xs,
  },
  ctaContainer: {
    marginBottom: spacing.xl,
  },
  orDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.outlineVariant,
  },
  socialContainer: {
    gap: spacing.md,
  },
  appleBtn: {
    marginTop: 0,
  },
});
