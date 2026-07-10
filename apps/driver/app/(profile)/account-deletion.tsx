import React, { useState, useMemo } from 'react';
import { View, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button, AppBackground } from '@eyego/ui';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useDriverStore } from '../../stores/driver.store';
import { apiClient } from '@eyego/api';
import { useMutation } from '@tanstack/react-query';

const DELETION_CONSEQUENCES = [
  'Active trips will be cancelled and fare settled automatically',
  'Earnings will be transferred to your linked payout account',
  'Documents and personal data deleted after 30 days',
  'Your account cannot be recovered once deleted',
];

export default function AccountDeletionScreen() {
  const colors = useColors();
  const theme = useDriverStore(s => s.theme);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const logout = useDriverStore((s: any) => s.logout);

  const [step, setStep] = useState<1 | 2>(1);
  const [confirmText, setConfirmText] = useState('');

  const { mutate: deleteAccount, isPending } = useMutation({
    mutationFn: () => apiClient.delete('/driver/me'),
    onSuccess: () => {
      logout();
      router.replace('/(auth)/phone' as any);
    },
    onError: (err: any) => {
      Alert.alert('Error', err?.message ?? 'Failed to delete account. Please try again.');
    },
  });

  const canConfirm = confirmText.trim() === 'DELETE';

  if (step === 2) {
    return (
      <SafeAreaView style={styles.safe}>
        <AppBackground isDark={theme !== 'light'} />
        <MotiView
          from={{ opacity: 0, translateX: -6 }}
          animate={{ opacity: 1, translateX: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34 }}
          style={styles.backRow}
        >
          <Pressable onPress={() => setStep(1)} hitSlop={12}>
            <Text variant="bodyMedium" color={colors.onSurfaceVariant}>← Back</Text>
          </Pressable>
        </MotiView>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <MotiView
            from={{ opacity: 0, translateY: -6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 40 }}
          >
            <Text variant="headlineLarge" style={styles.headline}>Confirm Deletion</Text>
          </MotiView>
          <MotiView
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 80 }}
          >
            <View style={styles.card}>
              <Text variant="bodyMedium" color={colors.onSurface} style={{ marginBottom: spacing.lg }}>
                To confirm account deletion, type <Text variant="bodyMedium" style={{ fontFamily: fonts.bold, color: colors.error }}>DELETE</Text> in the field below.
              </Text>
              <TextInput
                style={[styles.textInput, { borderColor: confirmText === 'DELETE' ? colors.error : colors.outline }]}
                value={confirmText}
                onChangeText={setConfirmText}
                placeholder="Type DELETE here"
                placeholderTextColor={colors.onSurfaceVariant}
                autoCapitalize="characters"
                autoCorrect={false}
              />
            </View>
            {isPending ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={colors.error} size="large" />
                <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ marginTop: spacing.md }}>
                  Deleting account…
                </Text>
              </View>
            ) : (
              <Button
                label="Permanently Delete Account"
                onPress={() => deleteAccount()}
                disabled={!canConfirm}
                style={[styles.dangerBtn, ...(!canConfirm ? [styles.dangerBtnDisabled] : [])]}
              />
            )}
          </MotiView>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground isDark={theme !== 'light'} />
      <MotiView
        from={{ opacity: 0, translateX: -6 }}
        animate={{ opacity: 1, translateX: 0 }}
        transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        style={styles.backRow}
      >
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant}>← Back</Text>
        </Pressable>
      </MotiView>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <MotiView
          from={{ opacity: 0, translateY: -6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 40 }}
        >
          <Text variant="headlineLarge" style={styles.headline}>Delete Account</Text>
        </MotiView>

        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 80 }}
        >
          <View style={styles.warningBanner}>
            <Ionicons name="warning" size={22} color="#fff" style={{ marginRight: spacing.sm }} />
            <Text variant="bodyMedium" style={styles.warningText}>
              This action is permanent and cannot be undone.
            </Text>
          </View>

          <View style={styles.card}>
            <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ marginBottom: spacing.md }}>
              Deleting your account will:
            </Text>
            {DELETION_CONSEQUENCES.map((item, idx) => (
              <View key={idx} style={styles.consequenceRow}>
                <Ionicons name="close-circle" size={18} color={colors.error} style={{ marginTop: 2 }} />
                <Text variant="bodyMedium" color={colors.onSurface} style={styles.consequenceText}>
                  {item}
                </Text>
              </View>
            ))}
          </View>

          <Button
            label="Continue to Delete"
            onPress={() => setStep(2)}
            style={styles.dangerBtn}
          />
        </MotiView>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: DriverColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  backRow: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.base },
  scroll: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.xl, paddingBottom: spacing['3xl'] },
  headline: { letterSpacing: -1, marginBottom: spacing['2xl'] },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.error,
    borderRadius: radii.xl,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  warningText: { flex: 1, color: '#fff', fontFamily: fonts.medium },
  card: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii['2xl'],
    borderWidth: 1,
    borderColor: colors.outline,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    marginBottom: spacing.xl,
  },
  consequenceRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
    alignItems: 'flex-start',
  },
  consequenceText: { flex: 1 },
  dangerBtn: {
    backgroundColor: colors.error,
    borderRadius: radii['2xl'],
    marginBottom: spacing.xl,
  },
  dangerBtnDisabled: { opacity: 0.5 },
  textInput: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodyMedium,
    lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
    color: colors.onSurface,
    borderWidth: 1.5,
    borderRadius: radii.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.xl,
    backgroundColor: colors.backgroundDeep,
  },
  loadingRow: { alignItems: 'center', paddingVertical: spacing['2xl'] },
});
