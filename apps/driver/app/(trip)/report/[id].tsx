import React, { useState, useMemo, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Pressable, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button } from '@eyego/ui';
import { useColors, type DriverColors } from '../../../utils/useColors';
import { apiClient } from '@eyego/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';

const REPORT_TYPES = [
  'Verbal abuse or threats',
  'Physical aggression',
  'Property damage',
  'Passenger did not show up',
  'Inappropriate behaviour',
  'Other',
];

const DETAILS_MAX = 500;

export default function ReportPassengerScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const qc = useQueryClient();

  const [selectedType, setSelectedType] = useState('');
  const [details, setDetails] = useState('');
  const [submitted, setSubmitted] = useState(false);

  // D8: guard invalid id — navigate back after all hooks have run
  useEffect(() => {
    if (!id || typeof id !== 'string') {
      router.back();
    }
  }, [id, router]);

  const { mutate: submitReport, isPending } = useMutation({
    mutationFn: () =>
      apiClient.post(`/driver/trips/${id}/report`, { type: selectedType, details }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['driver', 'trips'] });
      setSubmitted(true);
    },
    onError: (err: any) => {
      Alert.alert('Error', err?.message ?? 'Failed to submit report. Please try again.');
    },
  });

  const handleSubmit = () => {
    if (!selectedType) {
      Alert.alert('Select a type', 'Please select a report type.');
      return;
    }
    submitReport();
  };

  if (submitted) {
    return (
      <SafeAreaView style={styles.safe}>
        <MotiView
          from={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          style={styles.successContainer}
        >
          <Ionicons name="checkmark-circle" size={80} color="#22c55e" style={{ marginBottom: spacing.xl }} />
          <Text variant="headlineLarge" style={[styles.headline, { textAlign: 'center' }]}>Report Submitted</Text>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.successBody}>
            We'll review your report within 24 hours. Your safety matters to us.
          </Text>
          <Button label="Done" onPress={() => router.replace('/(tabs)/trips' as any)} />
        </MotiView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
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
          <Text variant="headlineLarge" style={styles.headline}>Report Passenger</Text>
        </MotiView>

        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 80 }}
        >
          <Text variant="labelLarge" color={colors.onSurfaceVariant} style={styles.sectionLabel}>
            What happened?
          </Text>
          <View style={styles.card}>
            {REPORT_TYPES.map((type, idx) => {
              const isSelected = selectedType === type;
              const isLast = idx === REPORT_TYPES.length - 1;
              return (
                <Pressable
                  key={type}
                  style={[styles.reasonRow, isLast && { borderBottomWidth: 0 }]}
                  onPress={() => setSelectedType(type)}
                >
                  <View style={[styles.dot, isSelected && styles.dotActive]} />
                  <Text
                    variant="bodyMedium"
                    style={{ flex: 1, fontFamily: isSelected ? fonts.bold : fonts.regular, color: isSelected ? colors.onSurface : colors.onSurfaceVariant }}
                  >
                    {type}
                  </Text>
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                  )}
                </Pressable>
              );
            })}
          </View>

          <View style={styles.detailsHeader}>
            <Text variant="labelLarge" color={colors.onSurfaceVariant} style={styles.sectionLabel}>
              Additional details <Text variant="labelSmall" color={colors.onSurfaceVariant}>(optional)</Text>
            </Text>
            <Text variant="labelSmall" color={colors.onSurfaceVariant}>
              {details.length}/{DETAILS_MAX}
            </Text>
          </View>
          <TextInput
            style={styles.detailsInput}
            value={details}
            onChangeText={(t) => setDetails(t.slice(0, DETAILS_MAX))}
            placeholder="Provide any additional context..."
            placeholderTextColor={colors.onSurfaceVariant}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
            maxLength={DETAILS_MAX}
          />

          <Button
            label={isPending ? 'Submitting…' : 'Submit Report'}
            onPress={handleSubmit}
            disabled={isPending || !selectedType}
          />
        </MotiView>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: DriverColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.backgroundDeep },
  backRow: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.base },
  scroll: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.xl, paddingBottom: spacing['3xl'] },
  headline: { letterSpacing: -1, marginBottom: spacing['2xl'] },
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
  detailsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  detailsInput: {
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
    minHeight: 120,
  },
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing['2xl'],
  },
  successBody: {
    textAlign: 'center',
    marginBottom: spacing['2xl'],
    lineHeight: 22,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.base, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.outlineVariant },
  iconBg: { width: 36, height: 36, borderRadius: 12, backgroundColor: `${colors.primary}18`, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, fontFamily: fonts.medium, fontSize: fontSizes.bodyMedium, color: colors.onSurface },
});
