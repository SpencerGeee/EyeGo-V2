import React, { useState, useRef, useMemo } from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { useMutation } from '@tanstack/react-query';
import { driverAuthApi } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button } from '@eyego/ui';
import { useColors, type DriverColors } from '../../utils/useColors';

export default function DriverPhoneScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [phone, setPhone] = useState('');
  const inputRef = useRef<TextInput>(null);
  const router = useRouter();
  const isValid = phone.replace(/\s/g, '').length === 9;

  const sendOtp = useMutation({
    mutationFn: () =>
      driverAuthApi.requestOtp({ phone: `+233${phone.replace(/\s/g, '')}` }),
    onSuccess: (res) => {
      const devOtp = (res as any)?.data?.data?._dev_otp;
      router.push({
        pathname: '/(auth)/otp',
        // Strip '+' prefix to avoid URL encoding issues in dev builds
        params: { phone: `233${phone.replace(/\s/g, '')}`, devOtp: devOtp ?? '' },
      });
    },
  });

  return (
    <SafeAreaView style={styles.safe}>
      {/* Blue background orbs */}
      <MotiView
        style={styles.orb1}
        from={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 0.18, scale: 1 }}
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
          {/* Logo + Driver badge */}
          <MotiView
            from={{ opacity: 0, translateY: -6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 50 }}
            style={styles.logoRow}
          >
            <Text style={styles.logo}>EyeGo</Text>
            <View style={styles.driverBadge}>
              <Text style={styles.driverBadgeText}>DRIVER</Text>
            </View>
          </MotiView>

          {/* Headline */}
          <MotiView
            from={{ opacity: 0, translateY: 10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 100 }}
            style={styles.headlineContainer}
          >
            <Text variant="headlineLarge" style={styles.headline}>
              Driver{'\n'}Sign In
            </Text>
            <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.subtext}>
              Enter your registered phone number to continue.
            </Text>
          </MotiView>

          {/* Phone input */}
          <MotiView
            from={{ opacity: 0, translateY: 10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 150 }}
            style={styles.inputWrapper}
          >
            <Pressable
              style={styles.phoneContainer}
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
                onChangeText={(t) => setPhone(t.replace(/\D/g, '').slice(0, 9))}
                keyboardType="number-pad"
                placeholder="24X XXX XXXX"
                placeholderTextColor={colors.onSurfaceVariant}
                returnKeyType="done"
                autoFocus
                selectionColor={colors.primary}
                maxLength={9}
              />
            </Pressable>
          </MotiView>

          {sendOtp.isError && (
            <MotiView from={{ opacity: 0, translateY: -8 }} animate={{ opacity: 1, translateY: 0 }}>
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
          >
            <Button
              label="Send Code"
              onPress={() => sendOtp.mutate()}
              disabled={!isValid}
              loading={sendOtp.isPending}
            />
          </MotiView>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.backgroundDeep },
    scroll: {
      flexGrow: 1,
      paddingHorizontal: spacing['2xl'],
      paddingBottom: spacing['3xl'],
    },
    orb1: {
      position: 'absolute',
      width: 320,
      height: 320,
      borderRadius: 160,
      backgroundColor: colors.primary,
      top: -120,
      right: -100,
    },
    orb2: {
      position: 'absolute',
      width: 220,
      height: 220,
      borderRadius: 110,
      backgroundColor: colors.accent,
      bottom: 80,
      left: -90,
    },
    logoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.lg,
    },
    logo: {
      fontFamily: fonts.displayBold,
      fontSize: 22,
      lineHeight: 29,
      color: colors.primary,
      letterSpacing: -0.5,
    },
    driverBadge: {
      backgroundColor: `${colors.primary}22`,
      borderWidth: 1,
      borderColor: `${colors.primary}55`,
      borderRadius: radii.full,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
    },
    driverBadgeText: {
      fontFamily: fonts.semiBold,
      fontSize: 10,
      lineHeight: 13,
      color: colors.primary,
      letterSpacing: 1.5,
    },
    headlineContainer: { marginTop: 52, marginBottom: spacing['2xl'] },
    headline: { letterSpacing: -1, lineHeight: 34 },
    subtext: { marginTop: spacing.sm, lineHeight: 22 },
    inputWrapper: { marginBottom: spacing.lg },
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
    flag: { fontSize: 20, lineHeight: 26 },
    code: {
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.3),
      color: colors.onSurface,
    },
    divider: { width: 1, height: 28, backgroundColor: colors.outline },
    phoneInput: {
      flex: 1,
      paddingHorizontal: spacing.base,
      fontFamily: fonts.medium,
      fontSize: fontSizes.titleSmall,
      lineHeight: Math.round(fontSizes.titleSmall * 1.3),
      color: colors.onSurface,
      letterSpacing: 1,
    },
    errorText: { marginBottom: spacing.md, marginLeft: spacing.xs },
  });
