import React, { useState, useMemo } from 'react';
import { View, StyleSheet, Alert, Platform, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { authApi } from '@eyego/api';
import { useAuthStore } from '../../stores/auth.store';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text } from '@eyego/ui';

export default function SocialAuthScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { login } = useAuthStore();
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [loadingApple, setLoadingApple] = useState(false);

  const handleGoogleSignIn = async () => {
    try {
      setLoadingGoogle(true);
      // GoogleSignin must be configured with webClientId from .env
      // Configure in app entry or this screen: GoogleSignin.configure({ webClientId: EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID })
      const { GoogleSignin } = require('@react-native-google-signin/google-signin');

      GoogleSignin.configure({
        webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
      });

      await GoogleSignin.hasPlayServices();
      const userInfo = await GoogleSignin.signIn();
      const idToken = userInfo.idToken ?? userInfo.data?.idToken;

      if (!idToken) throw new Error('No ID token returned from Google');

      const res = await authApi.socialLogin({ provider: 'google', idToken });
      const { user, tokens, isNewUser } = res.data.data;
      await login(user, tokens);

      if (isNewUser) {
        router.replace('/(auth)/register');
      } else {
        router.replace('/(tabs)/home');
      }
    } catch (err: any) {
      if (err?.code !== 'SIGN_IN_CANCELLED') {
        Alert.alert('Google Sign-In Failed', err?.message ?? 'Something went wrong. Try again.');
      }
    } finally {
      setLoadingGoogle(false);
    }
  };

  const handleAppleSignIn = async () => {
    try {
      setLoadingApple(true);
      const AppleAuthentication = require('expo-apple-authentication');

      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) throw new Error('No identity token from Apple');

      const res = await authApi.socialLogin({
        provider: 'apple',
        idToken: credential.identityToken,
        appleToken: credential.authorizationCode ?? undefined,
      });
      const { user, tokens, isNewUser } = res.data.data;
      await login(user, tokens);

      if (isNewUser) {
        router.replace('/(auth)/register');
      } else {
        router.replace('/(tabs)/home');
      }
    } catch (err: any) {
      if (err?.code !== 'ERR_REQUEST_CANCELED') {
        Alert.alert('Apple Sign-In Failed', err?.message ?? 'Something went wrong. Try again.');
      }
    } finally {
      setLoadingApple(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
      </View>

      <MotiView
        from={{ opacity: 0, translateY: 10 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        style={styles.content}
      >
        {/* Wordmark */}
        <Text style={styles.wordmark}>EyeGo</Text>

        <Text variant="titleLarge" style={styles.headline}>Continue with</Text>
        <Text variant="bodySmall" color={colors.onSurfaceVariant} style={styles.sub}>
          Choose a sign-in method to get started
        </Text>

        {/* Google */}
        <TouchableOpacity
          onPress={handleGoogleSignIn}
          disabled={loadingGoogle || loadingApple}
          activeOpacity={0.85}
          style={[styles.socialBtn, loadingGoogle && styles.socialBtnDisabled]}
        >
          {loadingGoogle ? (
            <MotiView
              from={{ opacity: 0.4 }} animate={{ opacity: 1 }}
              transition={{ loop: true, type: 'timing', duration: 500 }}
              style={styles.loadingDots}
            >
              <Text style={styles.socialBtnText}>Signing in…</Text>
            </MotiView>
          ) : (
            <>
              <Text style={styles.googleIcon}>G</Text>
              <Text style={styles.socialBtnText}>Continue with Google</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Apple — iOS only */}
        {Platform.OS === 'ios' && (
          <TouchableOpacity
            onPress={handleAppleSignIn}
            disabled={loadingGoogle || loadingApple}
            activeOpacity={0.85}
            style={[styles.socialBtn, styles.appleSocialBtn, loadingApple && styles.socialBtnDisabled]}
          >
            {loadingApple ? (
              <MotiView
                from={{ opacity: 0.4 }} animate={{ opacity: 1 }}
                transition={{ loop: true, type: 'timing', duration: 500 }}
              >
                <Text style={[styles.socialBtnText, { color: colors.backgroundDeep }]}>Signing in…</Text>
              </MotiView>
            ) : (
              <>
                <Ionicons name="logo-apple" size={20} color={colors.backgroundDeep} />
                <Text style={[styles.socialBtnText, { color: colors.backgroundDeep }]}>
                  Continue with Apple
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}

        <Text variant="caption" color={colors.onSurfaceVariant} style={styles.legal}>
          By continuing, you agree to EyeGo's Terms of Service and Privacy Policy.
        </Text>
      </MotiView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.backgroundDeep },
  header: {
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.base,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing['2xl'],
  },
  wordmark: {
    fontFamily: fonts.displayBold,
    fontSize: 20,
    color: colors.primary,
    marginBottom: spacing.xl,
  },
  headline: {
    marginBottom: spacing.xs,
  },
  sub: {
    marginBottom: spacing['2xl'],
  },
  socialBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 56,
    borderRadius: radii['2xl'],
    backgroundColor: colors.surfaceContainer,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    marginBottom: spacing.base,
  },
  appleSocialBtn: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  socialBtnDisabled: {
    opacity: 0.6,
  },
  socialBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyLarge,
    color: colors.onSurface,
  },
  googleIcon: {
    fontFamily: fonts.displayBold,
    fontSize: 20,
    color: '#4285F4',
  },
  loadingDots: {
    alignItems: 'center',
  },
  legal: {
    textAlign: 'center',
    marginTop: spacing.xl,
    lineHeight: 16,
  },
});
