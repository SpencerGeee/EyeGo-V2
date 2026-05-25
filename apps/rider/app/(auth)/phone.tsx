import React, { useState, useRef, useMemo } from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView, MotiText } from 'moti';
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
      const devOtp = (res as any)?.data?.data?._dev_otp;
      router.push({
        pathname: '/(auth)/otp',
        params: { phone: `+233${phone.replace(/\s/g, '')}`, devOtp: devOtp ?? '' },
      });
    },
  });

  const handlePhoneChange = (text: string) => {
    // Only digits, max 9
    const digits = text.replace(/\D/g, '').slice(0, 9);
    setPhone(digits);
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Animated background orbs */}
      <MotiView
        style={styles.orb1}
        from={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 0.15, scale: 1 }}
        transition={{ type: 'timing', duration: 800 }}
      />
      <MotiView
        style={styles.orb2}
        from={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 0.1, scale: 1 }}
        transition={{ type: 'timing', duration: 900, delay: 80 }}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Logo */}
          <MotiView
            from={{ opacity: 0, translateY: -6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 50 }}
          >
            <Text style={styles.logo}>EyeGo</Text>
          </MotiView>

          {/* Headline */}
          <MotiView
            from={{ opacity: 0, translateY: 10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 100 }}
            style={styles.headlineContainer}
          >
            <Text variant="headlineLarge" style={styles.headline}>
              What's your{'\n'}number?
            </Text>
            <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.subtext}>
              We'll send you a one-time verification code.
            </Text>
          </MotiView>

          {/* Phone input */}
          <MotiView
            from={{ opacity: 0, translateY: 10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 150 }}
            style={styles.inputWrapper}
          >
            <TouchableOpacity
              style={styles.phoneContainer}
              activeOpacity={1}
              onPress={() => inputRef.current?.focus()}
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
              />
            </TouchableOpacity>
          </MotiView>

          {/* Error */}
          {sendOtp.isError && (
            <MotiView
              from={{ opacity: 0, translateY: -8 }}
              animate={{ opacity: 1, translateY: 0 }}
            >
              <Text variant="caption" color={colors.error} style={styles.errorText}>
                {(sendOtp.error as Error)?.message ?? 'Failed to send code. Try again.'}
              </Text>
            </MotiView>
          )}

          {/* CTA */}
          <MotiView
            from={{ opacity: 0, translateY: 10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 180 }}
            style={styles.ctaContainer}
          >
            <Button
              label="Send Code"
              onPress={() => sendOtp.mutate()}
              disabled={!isValid}
              loading={sendOtp.isPending}
            />
          </MotiView>

          {/* Divider */}
          <MotiView
            from={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ type: 'timing', duration: 400, delay: 200 }}
            style={styles.orDivider}
          >
            <View style={styles.dividerLine} />
            <Text variant="caption" color={colors.onSurfaceVariant} style={{ marginHorizontal: spacing.md }}>
              OR
            </Text>
            <View style={styles.dividerLine} />
          </MotiView>

          {/* Social buttons */}
          <MotiView
            from={{ opacity: 0, translateY: 10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 200 }}
            style={styles.socialContainer}
          >
            <Button
              label="Continue with Google"
              variant="secondary"
              onPress={() => router.push('/(auth)/social' as any)}
            />
            {Platform.OS === 'ios' && (
              <Button
                label="Continue with Apple"
                variant="secondary"
                onPress={() => router.push('/(auth)/social' as any)}
                style={styles.appleBtn}
              />
            )}
          </MotiView>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.backgroundDeep,
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
