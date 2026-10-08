import React, { useState, useMemo, useEffect } from 'react';
import { View, StyleSheet, TextInput } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button, Entrance, AnimatedCheckmark, Screen, ListSection, ListRow, goBack, goOut, notify } from '@eyego/ui';
import { describeError } from '@eyego/utils';
import { apiClient, driverApi } from '@eyego/api';
import { useColors, type DriverColors } from '../../../utils/useColors';

const REPORT_TYPES = [
  'Verbal abuse or threats',
  'Physical aggression',
  'Property damage',
  'Passenger did not show up',
  'Inappropriate behaviour',
  'Other',
];

const DETAILS_MAX = 500;
/** "Not about one passenger" — distinct from `null`, which means "not chosen yet". */
const WHOLE_TRIP = '__trip__';

export default function ReportPassengerScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();

  const [selectedType, setSelectedType] = useState('');
  const [details, setDetails] = useState('');
  const [submitted, setSubmitted] = useState(false);
  /**
   * WHO the report is about: a booking id, WHOLE_TRIP, or null (not chosen).
   *
   * BUGFIX: `null` used to mean both "nothing chosen" and "not about one
   * passenger", and the multi-passenger guard refused null — so on a van with
   * two or more riders, a trip-level report (damage found after everyone left)
   * could never be filed, however many times the driver picked that option.
   */
  const [subject, setSubject] = useState<string | null>(null);

  useEffect(() => {
    if (!id || typeof id !== 'string') goBack();
  }, [id]);

  // Who was actually on this trip — read from the trip, so a seat added
  // mid-trip is present whichever screen the driver came from.
  const { data: trip, isLoading: tripLoading } = useQuery({
    queryKey: ['driver', 'trip', 'detail', id],
    queryFn: () => driverApi.getTripById(id!),
    select: (r: any) => r.data?.data?.trip ?? null,
    enabled: !!id && typeof id === 'string',
  });

  const passengers = useMemo(() => {
    const RELEASED = ['CANCELLED', 'EXPIRED', 'REFUNDED', 'NO_SHOW'];
    return ((trip?.bookings ?? []) as any[])
      .filter((b) => !RELEASED.includes(b.status))
      .map((b) => ({
        bookingId: b.id as string,
        seatNumber: (b.seatNumber ?? null) as number | null,
        // The guest first: they are who was in the seat.
        name: (b.guestName ?? b.user?.name ?? (b.seatNumber ? `Seat ${b.seatNumber}` : 'Passenger')) as string,
        isGuest: !b.user?.id,
      }));
  }, [trip]);

  // One passenger (or none): nothing to choose between.
  useEffect(() => {
    if (subject != null || tripLoading) return;
    if (passengers.length === 1) setSubject(passengers[0].bookingId);
    else if (passengers.length === 0) setSubject(WHOLE_TRIP);
  }, [passengers, subject, tripLoading]);

  const { mutate: submitReport, isPending } = useMutation({
    mutationFn: () =>
      apiClient.post(`/driver/trips/${id}/report`, {
        type: selectedType,
        details: details.trim(),
        // Absent bookingId = a trip-level report, which the server accepts.
        ...(subject && subject !== WHOLE_TRIP ? { bookingId: subject } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['driver', 'trips'] });
      setSubmitted(true);
    },
    onError: (err: unknown) => {
      notify('Could not send the report', describeError(err, 'Failed to submit report. Please try again.').message);
    },
  });

  if (submitted) {
    return (
      <View style={[styles.success, { backgroundColor: colors.backgroundDeep }]}>
        <Entrance animation="scaleIn" style={styles.successInner}>
          <View style={styles.successCheck}>
            <AnimatedCheckmark size={40} color="#fff" strokeWidth={3.5} />
          </View>
          <Text variant="headlineSmall" style={{ textAlign: 'center' }}>Report sent</Text>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.successBody}>
            Our safety team reviews every report. Thank you for telling us.
          </Text>
          <Button label="Done" size="lg" fullWidth onPress={() => goOut('/(tabs)/trips')} />
        </Entrance>
      </View>
    );
  }

  const canSubmit = !!selectedType && subject != null && !isPending;

  return (
    <Screen
      title="Report a problem"
      subtitle="Reports are confidential. The passenger is not told who filed it."
      keyboard
      footer={
        <Button
          label={isPending ? 'Sending…' : 'Send report'}
          size="lg"
          fullWidth
          loading={isPending}
          disabled={!canSubmit}
          onPress={() => submitReport()}
        />
      }
    >
      <ListSection title="Who is it about?">
        {tripLoading ? (
          <ListRow title="Loading passengers…" chevron={false} />
        ) : (
          <>
            {passengers.map((p) => {
              const on = subject === p.bookingId;
              return (
                <ListRow
                  key={p.bookingId}
                  title={p.name}
                  subtitle={`Seat ${p.seatNumber ?? '—'}${p.isGuest ? ' · guest' : ''}`}
                  onPress={() => setSubject(p.bookingId)}
                  chevron={false}
                  accessibilityLabel={`Report ${p.name}${on ? ', selected' : ''}`}
                  right={<Radio on={on} colors={colors} />}
                />
              );
            })}
            {/* Damage found after everyone left has no person behind it. */}
            <ListRow
              title="Not about one passenger"
              subtitle={passengers.length === 0 ? 'Nobody else was booked on this trip' : undefined}
              onPress={() => setSubject(WHOLE_TRIP)}
              chevron={false}
              divider={false}
              accessibilityLabel={`Not about one passenger${subject === WHOLE_TRIP ? ', selected' : ''}`}
              right={<Radio on={subject === WHOLE_TRIP} colors={colors} />}
            />
          </>
        )}
      </ListSection>

      <ListSection title="What happened?">
        {REPORT_TYPES.map((type, idx) => (
          <ListRow
            key={type}
            title={type}
            onPress={() => setSelectedType(type)}
            chevron={false}
            divider={idx < REPORT_TYPES.length - 1}
            accessibilityLabel={`${type}${selectedType === type ? ', selected' : ''}`}
            right={<Radio on={selectedType === type} colors={colors} />}
          />
        ))}
      </ListSection>

      <ListSection title="Details (optional)" footer={`${details.length}/${DETAILS_MAX}`}>
        <TextInput
          maxFontSizeMultiplier={1.4}
          style={styles.detailsInput}
          value={details}
          onChangeText={(t) => setDetails(t.slice(0, DETAILS_MAX))}
          placeholder="What should our team know?"
          placeholderTextColor={colors.onSurfaceVariant}
          multiline
          numberOfLines={5}
          textAlignVertical="top"
          maxLength={DETAILS_MAX}
          accessibilityLabel="Report details"
        />
      </ListSection>
    </Screen>
  );
}

function Radio({ on, colors }: { on: boolean; colors: DriverColors }) {
  return (
    <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? colors.primary : colors.onSurfaceVariant} />
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    detailsInput: {
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
      color: colors.onSurface,
      marginHorizontal: spacing.lg,
      marginTop: spacing.xs,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.md,
      minHeight: 120,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outline,
      backgroundColor: colors.surfaceContainer,
    },
    success: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing['2xl'] },
    successInner: { alignSelf: 'stretch', alignItems: 'center', gap: spacing.md },
    successCheck: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: '#22c55e',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.md,
    },
    successBody: { textAlign: 'center', lineHeight: 22, marginBottom: spacing.lg },
  });
