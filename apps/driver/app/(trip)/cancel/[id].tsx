import React, { useState, useMemo, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Pressable, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button, Entrance } from '@eyego/ui';
import { useColors, type DriverColors } from '../../../utils/useColors';
import { useDriverStore } from '../../../stores/driver.store';
import { driverApi } from '@eyego/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';

const CANCEL_REASONS = [
  'Schedule conflict',
  'Vehicle breakdown',
  'Medical emergency',
  'Passenger no-show after 10 minutes',
  'Route no longer available',
  'Other',
];

export default function CancelTripScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [selectedReason, setSelectedReason] = useState('');
  const [note, setNote] = useState('');

  // D8: guard invalid id — navigate back after all hooks have run
  useEffect(() => {
    if (!id || typeof id !== 'string') {
      router.back();
    }
  }, [id, router]);

  const queryClient = useQueryClient();
  const { setActiveTripId } = useDriverStore();

  const { mutate: cancelTrip, isPending } = useMutation({
    mutationFn: () => driverApi.cancelTrip(id as string),
    onSuccess: () => {
      // D13: clear active trip in store before navigating away
      setActiveTripId(null);
      queryClient.invalidateQueries({ queryKey: ['driver', 'trips', 'all'] });
      queryClient.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
      router.replace('/(tabs)/home' as any);
    },
    onError: (err: any) => {
      Alert.alert('Error', err?.message ?? 'Failed to cancel trip. Please try again.');
    },
  });

  const handleSubmit = () => {
    if (!selectedReason) {
      Alert.alert('Select a reason', 'Please select a reason for cancellation.');
      return;
    }
    cancelTrip();
  };

  return (
    <SafeAreaView style={styles.safe}>
      <Entrance animation="slideLeft" style={styles.backRow}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant}>← Back</Text>
        </Pressable>
      </Entrance>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Entrance animation="slideUp" delay={40}>
          <Text variant="headlineLarge" style={styles.headline}>Cancel Trip</Text>
        </Entrance>

        <Entrance animation="slideDown" delay={80}>
          {/* Warning Banner */}
          <View style={styles.warningBanner}>
            <Ionicons name="warning-outline" size={20} color={colors.error} style={{ marginRight: spacing.sm }} />
            <Text variant="bodySmall" style={{ flex: 1, color: colors.error }}>
              Cancelling will affect your cancellation rate in performance stats, and passengers who already paid will be refunded. Frequent cancellations may result in account restrictions.
            </Text>
          </View>

          {/* Reason List */}
          <Text variant="labelLarge" color={colors.onSurfaceVariant} style={styles.sectionLabel}>
            Reason for cancellation
          </Text>
          <View style={styles.card}>
            {CANCEL_REASONS.map((reason, idx) => {
              const isSelected = selectedReason === reason;
              const isLast = idx === CANCEL_REASONS.length - 1;
              return (
                <Pressable
                  key={reason}
                  style={[styles.reasonRow, isLast && { borderBottomWidth: 0 }]}
                  onPress={() => setSelectedReason(reason)}
                >
                  <View style={[styles.dot, isSelected && styles.dotActive]} />
                  <Text
                    variant="bodyMedium"
                    style={{ flex: 1, fontFamily: isSelected ? fonts.bold : fonts.regular, color: isSelected ? colors.onSurface : colors.onSurfaceVariant }}
                  >
                    {reason}
                  </Text>
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                  )}
                </Pressable>
              );
            })}
          </View>

          {/* Note input for Other */}
          {selectedReason === 'Other' && (
            <Entrance animation="slideUp">
              <Text variant="labelLarge" color={colors.onSurfaceVariant} style={styles.sectionLabel}>
                Additional note
              </Text>
              <TextInput
                style={styles.noteInput}
                value={note}
                onChangeText={setNote}
                placeholder="Describe your reason..."
                placeholderTextColor={colors.onSurfaceVariant}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </Entrance>
          )}

          <Button
            label={isPending ? 'Cancelling…' : 'Cancel Trip'}
            onPress={handleSubmit}
            disabled={isPending || !selectedReason}
            style={styles.cancelBtn}
          />
        </Entrance>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: DriverColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.backgroundDeep },
  backRow: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.base },
  scroll: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.xl, paddingBottom: spacing['3xl'] },
  headline: { letterSpacing: -1, marginBottom: spacing['2xl'] },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: `${colors.error}14`,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: `${colors.error}40`,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  sectionLabel: { marginBottom: spacing.sm, marginLeft: spacing.xs },
  card: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii['2xl'],
    borderWidth: 1,
    borderColor: colors.outline,
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.xl,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.base,
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.outlineVariant,
    backgroundColor: 'transparent',
  },
  dotActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  noteInput: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodyMedium,
    color: colors.onSurface,
    borderWidth: 1,
    borderColor: colors.outline,
    borderRadius: radii.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.xl,
    backgroundColor: colors.surfaceContainer,
    minHeight: 100,
  },
  cancelBtn: {
    backgroundColor: colors.error,
    borderRadius: radii['2xl'],
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.base, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.outlineVariant },
  iconBg: { width: 36, height: 36, borderRadius: 12, backgroundColor: `${colors.primary}18`, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, fontFamily: fonts.medium, fontSize: fontSizes.bodyMedium, color: colors.onSurface },
});
