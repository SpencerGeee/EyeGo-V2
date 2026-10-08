import React, { useMemo, useState, useEffect } from 'react';
import { View, StyleSheet, TextInput } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button, Screen, ListSection, ListRow, goBack, goOut, notify } from '@eyego/ui';
import { describeError } from '@eyego/utils';
import { driverApi } from '@eyego/api';
import { useColors, type DriverColors } from '../../../utils/useColors';
import { useDriverStore } from '../../../stores/driver.store';

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
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const setActiveTripId = useDriverStore((s) => s.setActiveTripId);

  const [selectedReason, setSelectedReason] = useState('');
  const [note, setNote] = useState('');

  // No trip id, nothing to cancel — leave after the hooks have run.
  useEffect(() => {
    if (!id || typeof id !== 'string') goBack();
  }, [id]);

  const { mutate: cancelTrip, isPending } = useMutation({
    mutationFn: () => driverApi.cancelTrip(id as string, selectedReason, note.trim() || undefined),
    onSuccess: () => {
      setActiveTripId(null);
      queryClient.invalidateQueries({ queryKey: ['driver', 'trips', 'all'] });
      queryClient.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
      goOut('/(tabs)/home');
    },
    // describeError, never err.message: that is axios's "Request failed with
    // status code 409", not something a driver can act on.
    onError: (err: unknown) => {
      const e = describeError(err, 'Failed to cancel the trip. Please try again.');
      notify('Could not cancel that trip', e.message);
    },
  });

  const needsNote = selectedReason === 'Other';
  const canSubmit = !!selectedReason && (!needsNote || note.trim().length >= 3) && !isPending;

  return (
    <Screen
      title="Cancel trip"
      subtitle="Tell us why. It helps us keep riders informed."
      keyboard
      footer={
        <Button
          label={isPending ? 'Cancelling…' : 'Cancel trip'}
          variant="destructive"
          size="lg"
          fullWidth
          loading={isPending}
          disabled={!canSubmit}
          onPress={() => cancelTrip()}
        />
      }
    >
      <View style={styles.warning}>
        <Ionicons name="warning-outline" size={18} color={colors.error} />
        <Text variant="bodySmall" style={styles.warningText}>
          If riders have already booked, we hand the trip to another driver so they keep their seats. Otherwise it is
          cancelled and anyone who paid is refunded. Cancellations count against your cancellation rate.
        </Text>
      </View>

      <ListSection title="Reason">
        {CANCEL_REASONS.map((reason, idx) => {
          const on = selectedReason === reason;
          return (
            <ListRow
              key={reason}
              title={reason}
              onPress={() => setSelectedReason(reason)}
              chevron={false}
              divider={idx < CANCEL_REASONS.length - 1}
              accessibilityLabel={`${reason}${on ? ', selected' : ''}`}
              right={
                <Ionicons
                  name={on ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={on ? colors.primary : colors.onSurfaceVariant}
                />
              }
            />
          );
        })}
      </ListSection>

      {needsNote && (
        <ListSection title="What happened?">
          <TextInput
            maxFontSizeMultiplier={1.4}
            style={styles.noteInput}
            value={note}
            onChangeText={setNote}
            placeholder="A few words for the riders and our team"
            placeholderTextColor={colors.onSurfaceVariant}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            accessibilityLabel="Reason for cancelling"
          />
        </ListSection>
      )}
    </Screen>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    warning: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      marginHorizontal: spacing.lg,
      marginBottom: spacing.lg,
      padding: spacing.base,
      borderRadius: radii.xl,
      backgroundColor: `${colors.error}14`,
      borderWidth: 1,
      borderColor: `${colors.error}40`,
    },
    warningText: { flex: 1, color: colors.error, lineHeight: 19 },
    noteInput: {
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
      color: colors.onSurface,
      marginHorizontal: spacing.lg,
      marginTop: spacing.xs,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.md,
      minHeight: 110,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outline,
      backgroundColor: colors.surfaceContainer,
    },
  });
