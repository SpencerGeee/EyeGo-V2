import React, { useState, useMemo, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Pressable, TextInput, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button, Entrance, AnimatedCheckmark, AppBackground } from '@eyego/ui';
import { useColors, type DriverColors } from '../../../utils/useColors';
import { useDriverStore } from '../../../stores/driver.store';
import { apiClient, driverApi } from '@eyego/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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
  const theme = useDriverStore(s => s.theme);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const qc = useQueryClient();

  const [selectedType, setSelectedType] = useState('');
  const [details, setDetails] = useState('');
  const [submitted, setSubmitted] = useState(false);
  /**
   * WHICH passenger. `null` means the report is about the trip itself.
   *
   * BUGFIX ("when you click report passenger it should dynamically and
   * accurately distinguish and allow the user to select which passenger they
   * want to report — at the moment it just assumes it's one person").
   *
   * There was no selection at all: the request carried a trip id and a reason,
   * so on a fourteen-seat van the driver was reporting the vehicle. Nothing
   * downstream could attach it to a rider, which is also why a repeatedly
   * reported passenger's standing never moved.
   */
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);

  // D8: guard invalid id — navigate back after all hooks have run
  useEffect(() => {
    if (!id || typeof id !== 'string') {
      router.back();
    }
  }, [id, router]);

  /**
   * Who was actually on this trip. Read from the trip detail rather than passed
   * through the route, so the list is right whether the driver arrives from the
   * trips tab, the manage page or a notification — and so a seat added mid-trip
   * is present.
   */
  const { data: trip, isLoading: tripLoading } = useQuery({
    queryKey: ['driver', 'trip', 'detail', id],
    queryFn: () => driverApi.getTripById(id!),
    select: (r: any) => r.data?.data?.trip ?? null,
    enabled: !!id && typeof id === 'string',
  });

  const RELEASED = ['CANCELLED', 'EXPIRED', 'REFUNDED', 'NO_SHOW'];
  const passengers = ((trip?.bookings ?? []) as any[])
    .filter((b) => !RELEASED.includes(b.status))
    .map((b) => ({
      bookingId: b.id as string,
      seatNumber: (b.seatNumber ?? null) as number | null,
      // A guest booked by somebody else has no user account; name them by the
      // guest name so the driver can still tell two seats apart.
      name: (b.user?.name ?? b.guestName ?? (b.seatNumber ? `Seat ${b.seatNumber}` : 'Passenger')) as string,
      isGuest: !b.user?.id,
    }));

  // One passenger and nothing to choose between — preselect, so a solo ride
  // does not make the driver tap a list of one.
  useEffect(() => {
    if (passengers.length === 1 && selectedBookingId == null) {
      setSelectedBookingId(passengers[0].bookingId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passengers.length]);

  const { mutate: submitReport, isPending } = useMutation({
    mutationFn: () =>
      apiClient.post(`/driver/trips/${id}/report`, {
        type: selectedType,
        details,
        // Omitted rather than null when nothing is selected: the server treats
        // an absent bookingId as a trip-level report, which is a real case.
        ...(selectedBookingId ? { bookingId: selectedBookingId } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['driver', 'trips'] });
      setSubmitted(true);
    },
    onError: (err: any) => {
      Alert.alert(
        'Error',
        err?.response?.data?.message ?? err?.message ?? 'Failed to submit report. Please try again.',
      );
    },
  });

  const handleSubmit = () => {
    if (!selectedType) {
      Alert.alert('Select a type', 'Please select a report type.');
      return;
    }
    // Only insist on a passenger when there is genuinely a choice to make. A
    // report filed against the wrong person is worse than one filed against
    // nobody, so this is a hard stop rather than a default-to-first.
    if (!selectedBookingId && passengers.length > 1) {
      Alert.alert('Select a passenger', 'Choose which passenger this report is about.');
      return;
    }
    submitReport();
  };

  if (submitted) {
    return (
      <SafeAreaView style={styles.safe}>
        <AppBackground isDark={theme !== 'light'} />
        <Entrance animation="scaleIn" style={styles.successContainer}>
          <View style={[styles.successCheckCircle, { marginBottom: spacing.xl }]}>
            <AnimatedCheckmark size={40} color="#fff" strokeWidth={3.5} />
          </View>
          <Text variant="headlineLarge" style={[styles.headline, { textAlign: 'center' }]}>Report Submitted</Text>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.successBody}>
            We'll review your report within 24 hours. Your safety matters to us.
          </Text>
          <Button label="Done" onPress={() => router.replace('/(tabs)/trips' as any)} />
        </Entrance>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground isDark={theme !== 'light'} />
      <Entrance animation="slideLeft" style={styles.backRow}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant}>← Back</Text>
        </Pressable>
      </Entrance>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
      >
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Entrance animation="slideUp" delay={40}>
          <Text variant="headlineLarge" style={styles.headline}>Report Passenger</Text>
        </Entrance>

        {/* WHO. Rendered above "what happened" because it is the first thing a
            driver knows and the thing the report is actually about. */}
        <Entrance animation="slideDown" delay={60}>
          <Text variant="labelLarge" color={colors.onSurfaceVariant} style={styles.sectionLabel}>
            Which passenger?
          </Text>
          <View style={styles.card}>
            {tripLoading ? (
              <View style={styles.reasonRow}>
                <Text variant="bodyMedium" color={colors.onSurfaceVariant}>Loading passengers…</Text>
              </View>
            ) : passengers.length === 0 ? (
              <View style={[styles.reasonRow, { borderBottomWidth: 0 }]}>
                <Text variant="bodyMedium" color={colors.onSurfaceVariant}>
                  No passengers on this trip — this will be filed against the trip itself.
                </Text>
              </View>
            ) : (
              <>
                {passengers.map((p) => {
                  const isSelected = selectedBookingId === p.bookingId;
                  return (
                    <Pressable
                      key={p.bookingId}
                      style={styles.reasonRow}
                      onPress={() => setSelectedBookingId(p.bookingId)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isSelected }}
                      accessibilityLabel={`Report ${p.name}`}
                    >
                      <View style={[styles.dot, isSelected && styles.dotActive]} />
                      <View style={{ flex: 1 }}>
                        <Text
                          variant="bodyMedium"
                          style={{
                            fontFamily: isSelected ? fonts.bold : fonts.regular,
                            color: isSelected ? colors.onSurface : colors.onSurfaceVariant,
                          }}
                        >
                          {p.name}
                        </Text>
                        <Text variant="caption" color={colors.onSurfaceVariant}>
                          Seat {p.seatNumber ?? '—'}{p.isGuest ? ' · guest' : ''}
                        </Text>
                      </View>
                      {isSelected && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
                    </Pressable>
                  );
                })}
                {/* Not every report has a person behind it — damage found after
                    everyone has left, for instance. Better an explicit option
                    than a driver picking someone at random to get past a gate. */}
                <Pressable
                  style={[styles.reasonRow, { borderBottomWidth: 0 }]}
                  onPress={() => setSelectedBookingId(null)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: selectedBookingId === null }}
                >
                  <View style={[styles.dot, selectedBookingId === null && styles.dotActive]} />
                  <Text
                    variant="bodyMedium"
                    style={{
                      flex: 1,
                      fontFamily: selectedBookingId === null ? fonts.bold : fonts.regular,
                      color: selectedBookingId === null ? colors.onSurface : colors.onSurfaceVariant,
                    }}
                  >
                    Not about one passenger
                  </Text>
                  {selectedBookingId === null && (
                    <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                  )}
                </Pressable>
              </>
            )}
          </View>
        </Entrance>

        <Entrance animation="slideDown" delay={80}>
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
        </Entrance>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: DriverColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
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
    lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
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
  successCheckCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#22c55e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successBody: {
    textAlign: 'center',
    marginBottom: spacing['2xl'],
    lineHeight: 22,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.base, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.outlineVariant },
  iconBg: { width: 36, height: 36, borderRadius: 12, backgroundColor: `${colors.primary}18`, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, fontFamily: fonts.medium, fontSize: fontSizes.bodyMedium, lineHeight: Math.round(fontSizes.bodyMedium * 1.3), color: colors.onSurface },
});
