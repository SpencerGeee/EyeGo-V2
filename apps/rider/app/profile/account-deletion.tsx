import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { fonts, spacing, radii } from '@eyego/config';
import { Text, Button } from '@eyego/ui';
import { useColors, Colors } from '../../utils/useColors';
import { useAuthStore } from '../../stores/auth.store';
import { apiClient } from '@eyego/api';

const CONSEQUENCES = [
  'All active and upcoming bookings will be immediately cancelled.',
  'Wallet balance under GHS 5 will be forfeited and cannot be recovered.',
  'Your account data will be permanently deleted after 30 days.',
  'This action cannot be undone — you will lose access immediately.',
  'You will need to create a new account to use EyeGo again.',
];

export default function AccountDeletionScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { logout } = useAuthStore();

  const [step, setStep] = useState<1 | 2>(1);
  const [confirmText, setConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const canConfirm = confirmText === 'DELETE';

  const handleDelete = async () => {
    if (!canConfirm) return;
    setIsDeleting(true);
    try {
      await apiClient.delete('/user/me');
      logout();
      router.replace('/(auth)/phone');
    } catch (err: any) {
      Alert.alert(
        'Deletion Failed',
        err?.message || 'Something went wrong. Please try again later.',
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
        </Pressable>
        <Text variant="titleSmall" style={{ color: colors.onSurface }}>Delete Account</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        >
          {step === 1 ? (
            <>
              <View style={styles.warningBanner}>
                <Ionicons name="warning" size={28} color={colors.statusError} />
                <Text variant="titleSmall" style={{color: colors.statusError, marginTop: spacing.md }}>
                Before you continue
                </Text>
              </View>

              <Text variant="bodyMedium" style={[styles.bodyText, { color: colors.onSurfaceVariant }]}>
                Deleting your account is permanent and irreversible. Please read the following
                carefully:
              </Text>

              <View style={styles.card}>
                {CONSEQUENCES.map((item, i) => (
                  <View key={i} style={styles.bulletRow}>
                    <Ionicons
                      name="close-circle"
                      size={18}
                      color={colors.statusError}
                      style={{ marginTop: 2 }}
                    />
                    <Text
                      variant="bodySmall"
                      style={{ color: colors.onSurface, flex: 1, lineHeight: 20 }}
                    >
                      {item}
                    </Text>
                  </View>
                ))}
              </View>

              <View style={{ marginTop: spacing['2xl'] }}>
                <Button label="I Understand, Continue" onPress={() => setStep(2)} variant="destructive" />
              </View>
            </>
          ) : (
            <>
              <View style={styles.warningBanner}>
                <Ionicons name="trash" size={28} color={colors.statusError} />
                <Text variant="titleSmall" style={{ color: colors.statusError, marginTop: spacing.md }}>
                  Confirm Deletion
                </Text>
              </View>

              <Text
                variant="bodyMedium"
                style={[styles.bodyText, { color: colors.onSurfaceVariant }]}
              >
                To permanently delete your account, type{' '}
                <Text variant="bodyMedium" style={{ color: colors.statusError, fontWeight: '700' }}>
                  DELETE
                </Text>{' '}
                in the field below.
              </Text>

              <View style={styles.inputWrap}>
                <TextInput
                  value={confirmText}
                  onChangeText={setConfirmText}
                  placeholder="Type DELETE to confirm"
                  placeholderTextColor={colors.onSurfaceVariant}
                  style={[styles.input, { color: colors.onSurface, borderColor: colors.outlineVariant }]}
                  autoCapitalize="characters"
                  autoCorrect={false}
                />
              </View>

              {isDeleting ? (
                <View style={styles.loadingWrap}>
                  <ActivityIndicator size="large" color={colors.statusError} />
                  <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant, marginTop: spacing.base }}>
                    Deleting your account...
                  </Text>
                </View>
              ) : (
                <View style={{ marginTop: spacing['2xl'], gap: spacing.base }}>
                  <Button label="Delete My Account" onPress={handleDelete} variant="destructive" disabled={!canConfirm} />
                  <Button label="Go Back" onPress={() => setStep(1)} variant="secondary" />
                </View>
              )}
            </>
          )}
        </MotiView>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.backgroundDeep },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing['2xl'],
      paddingVertical: spacing.base,
    },
    backBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.surfaceCard,
      borderWidth: 1,
      borderColor: colors.rimLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scroll: {
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing.lg,
      paddingBottom: spacing['3xl'],
    },
    warningBanner: {
      alignItems: 'center',
      paddingVertical: spacing['2xl'],
    },
    bodyText: {
      marginBottom: spacing['2xl'],
      lineHeight: 22,
    },
    card: {
      backgroundColor: colors.surfaceCard,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.rimLightSubtle,
      padding: spacing.base,
      gap: spacing.md,
    },
    bulletRow: {
      flexDirection: 'row',
      gap: spacing.md,
      alignItems: 'flex-start',
    },
    inputWrap: {
      marginBottom: spacing.base,
    },
    input: {
      height: 52,
      borderWidth: 1,
      borderRadius: radii.lg,
      paddingHorizontal: spacing.base,
      fontSize: 16,
      backgroundColor: colors.surfaceInput,
      borderColor: colors.rimLightSubtle,
      color: colors.onSurface,
      fontFamily: fonts.regular,
    },
    loadingWrap: {
      alignItems: 'center',
      paddingVertical: spacing['2xl'],
    },
  });
