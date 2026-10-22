import React, { useRef, useState } from 'react';
import { View, TextInput, StyleSheet, Pressable, ScrollView, AccessibilityInfo } from 'react-native';
import Animated, { FadeInDown, FadeIn, useAnimatedStyle, useSharedValue, withTiming, interpolateColor } from 'react-native-reanimated';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '@eyego/api';
import { ghanaLocalDigits, describeError } from '@eyego/utils';
import { fonts, fontSizes, spacing, radii, withOpacity } from '@eyego/config';
import { Text, goDeeper } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '../../utils/useColors';
import { LoadingButton, type LoadingState } from '../../components/intro/LoadingButton';
import { AUTH_SHEET, formatGhLocal } from '../../components/intro/authScene';
import { BlurWordText } from '../../components/intro/BlurWordText';

/**
 * Sign in — and sign up: a Ghanaian number and a one-time code serve both, so
 * this one screen is the door for new and returning riders alike. Lives inside
 * the sign-in scene's sheet (see _layout).
 */
export default function PhoneScreen() {
  const colors = useColors();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<LoadingState>('idle');
  const inputRef = useRef<TextInput>(null);
  const isValid = phone.length === 9;

  const focus = useSharedValue(0);
  const fieldStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(focus.value, [0, 1], [AUTH_SHEET.fieldBorder, withOpacity(colors.primary, 0.6)]),
    shadowOpacity: focus.value * 0.35,
  }));

  const sendOtp = useMutation({
    mutationFn: () => authApi.sendOtp({ phone: `+233${phone}` }),
    onMutate: () => {
      setError(null);
      setState('loading');
    },
    onSuccess: (res) => {
      // The dev OTP whenever the backend returns it (development servers only).
      const devOtp = (res as any)?.data?.data?._dev_otp;
      setState('success');
      setTimeout(() => {
        goDeeper({
          pathname: '/(auth)/otp',
          // No '+' — URL encoding eats it.
          params: { phone: `233${phone}`, ...(devOtp ? { devOtp } : {}) },
        });
        setState('idle');
      }, 380);
    },
    onError: (err) => {
      const msg = describeError(err, 'We couldn’t send the code. Check your connection and try again.').message;
      setError(msg);
      AccessibilityInfo.announceForAccessibility?.(msg);
      setState('error');
      setTimeout(() => setState('idle'), 450);
    },
  });

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={styles.grabber} />
      <BlurWordText text="Welcome to EyeGo" textKey="phone-title" style={[styles.title, { color: AUTH_SHEET.text }]} containerStyle={styles.left} />
      <Animated.View entering={FadeIn.duration(300).delay(180)}>
        <Text style={[styles.subtitle, { color: AUTH_SHEET.textDim }]}>Sign in or create your account with your phone number.</Text>
      </Animated.View>

      <Animated.View entering={FadeInDown.duration(320).delay(240)}>
        <Text style={[styles.label, { color: AUTH_SHEET.textDim }]}>Phone number</Text>
        <Pressable onPress={() => inputRef.current?.focus()} accessibilityRole="none">
          <Animated.View style={[styles.field, { backgroundColor: AUTH_SHEET.field, shadowColor: colors.primary }, fieldStyle, error ? { borderColor: colors.error } : null]}>
            <View style={styles.chip}>
              <Text style={styles.flag}>🇬🇭</Text>
              <Text style={[styles.code, { color: AUTH_SHEET.text }]}>+233</Text>
            </View>
            <View style={[styles.divider, { backgroundColor: AUTH_SHEET.fieldBorder }]} />
            <TextInput
              maxFontSizeMultiplier={1.4}
              ref={inputRef}
              style={[styles.input, { color: AUTH_SHEET.text }]}
              value={formatGhLocal(phone)}
              onChangeText={(t) => {
                setPhone(ghanaLocalDigits(t));
                if (error) setError(null);
              }}
              onFocus={() => { focus.value = withTiming(1, { duration: 150 }); }}
              onBlur={() => { focus.value = withTiming(0, { duration: 150 }); }}
              keyboardType="number-pad"
              placeholder="24 123 4567"
              placeholderTextColor={withOpacity(AUTH_SHEET.text, 0.3)}
              returnKeyType="done"
              onSubmitEditing={() => isValid && state === 'idle' && sendOtp.mutate()}
              textContentType="telephoneNumber"
              autoComplete="tel"
              selectionColor={colors.primary}
              accessibilityLabel="Phone number"
              accessibilityHint="Nine digits after +233"
            />
            {isValid ? <Ionicons name="checkmark-circle" size={20} color={colors.primary} style={{ marginRight: spacing.base }} /> : null}
          </Animated.View>
        </Pressable>
        {error ? (
          <Animated.View entering={FadeInDown.duration(180)} style={styles.errorRow} accessibilityLiveRegion="polite">
            <Ionicons name="alert-circle" size={14} color={colors.error} />
            <Text style={[styles.error, { color: colors.error }]}>{error}</Text>
          </Animated.View>
        ) : null}
      </Animated.View>

      <Animated.View entering={FadeInDown.duration(320).delay(300)} style={{ marginTop: spacing.xl }}>
        <LoadingButton
          label="Continue"
          onPress={() => sendOtp.mutate()}
          state={state}
          disabled={!isValid}
          color={colors.primary}
          onColor={colors.onPrimary}
          accessibilityLabel="Send verification code"
        />
      </Animated.View>

      <Animated.View entering={FadeIn.duration(300).delay(360)}>
        <Text style={[styles.foot, { color: AUTH_SHEET.textDim }]}>
          New to EyeGo? The code creates your account — no password to remember.
        </Text>
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing['2xl'], paddingBottom: 140 },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)', marginTop: 10, marginBottom: spacing.lg },
  left: { justifyContent: 'flex-start' },
  title: { fontFamily: fonts.displayBold, fontSize: 26, lineHeight: 31, letterSpacing: -0.5 },
  subtitle: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, marginTop: spacing.xs, marginBottom: spacing.xl },
  label: { fontFamily: fonts.medium, fontSize: 12, letterSpacing: 0.4, marginBottom: spacing.sm },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    borderRadius: 14,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 10,
  },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.base },
  flag: { fontSize: 18, lineHeight: 24 },
  code: { fontFamily: fonts.medium, fontSize: fontSizes.bodyMedium },
  divider: { width: 1, height: 26 },
  input: { flex: 1, paddingHorizontal: spacing.base, fontFamily: fonts.medium, fontSize: fontSizes.titleSmall, letterSpacing: 0.5, padding: 0 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm },
  error: { fontFamily: fonts.regular, fontSize: 12.5, flex: 1 },
  foot: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, textAlign: 'center', marginTop: spacing.lg },
});
