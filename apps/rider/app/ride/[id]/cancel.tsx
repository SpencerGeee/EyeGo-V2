import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radii } from '@eyego/config';
import { Text, Button } from '@eyego/ui';
import { useColors, Colors } from '../../../utils/useColors';
import { bookingsApi } from '@eyego/api';
import { useMutation } from '@tanstack/react-query';

const REASONS = [
  'Changed my plans',
  'Driver taking too long',
  'Wrong pickup location',
  'Found another ride',
  'Emergency',
  'Other',
];

export default function CancelRideScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [selectedReason, setSelectedReason] = useState<string>('');
  const [note, setNote] = useState('');

  const cancelMutation = useMutation({
    mutationFn: () =>
      bookingsApi.cancelBooking(id, {
        reason: selectedReason,
        note: selectedReason === 'Other' ? note : undefined,
      }),
    onSuccess: () => {
      router.replace('/(tabs)/home');
    },
    onError: (err: any) => {
      Alert.alert('Cancellation Failed', err?.message || 'Could not cancel the ride. Please try again.');
    },
  });

  const handleSubmit = () => {
    if (!selectedReason) {
      Alert.alert('Select a reason', 'Please select a cancellation reason before continuing.');
      return;
    }
    Alert.alert(
      'Cancel Ride',
      'Are you sure you want to cancel this ride?',
      [
        { text: 'No, Keep Ride', style: 'cancel' },
        { text: 'Yes, Cancel', style: 'destructive', onPress: () => cancelMutation.mutate() },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <Text variant="titleSmall">Cancel Ride</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        >
          <View style={styles.warningBanner}>
            <Ionicons name="warning-outline" size={20} color={colors.warning ?? '#F59E0B'} />
            <Text
              variant="bodySmall"
              style={{ color: colors.onSurface, flex: 1, lineHeight: 18 }}
            >
              Cancelling may incur a cancellation fee if the driver has already been dispatched.
            </Text>
          </View>

          <Text
            variant="labelSmall"
            style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}
          >
            REASON FOR CANCELLATION
          </Text>

          <View style={styles.card}>
            {REASONS.map((reason, index) => (
              <React.Fragment key={reason}>
                {index > 0 && <View style={styles.divider} />}
                <Pressable
                  onPress={() => setSelectedReason(reason)}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && { backgroundColor: colors.surfaceContainerHigh ?? colors.surfaceContainer },
                  ]}
                >
                  <View style={styles.rowLeft}>
                    <Text variant="bodyMedium" style={{ color: colors.onSurface }}>
                      {reason}
                    </Text>
                  </View>
                  {selectedReason === reason && (
                    <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                  )}
                  {selectedReason !== reason && (
                    <Ionicons name="ellipse-outline" size={22} color={colors.outlineVariant} />
                  )}
                </Pressable>
              </React.Fragment>
            ))}
          </View>

          {selectedReason === 'Other' && (
            <MotiView
              from={{ opacity: 0, translateY: -8 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'spring', stiffness: 600, damping: 34 }}
              style={{ marginTop: spacing['2xl'] }}
            >
              <Text
                variant="labelSmall"
                style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}
              >
                ADDITIONAL NOTES
              </Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Describe your reason (optional)..."
                placeholderTextColor={colors.onSurfaceVariant}
                multiline
                numberOfLines={4}
                style={[
                  styles.textArea,
                  {
                    color: colors.onSurface,
                    borderColor: colors.outlineVariant,
                    backgroundColor: colors.surfaceContainer,
                  },
                ]}
              />
            </MotiView>
          )}

          <View style={{ marginTop: spacing['2xl'] }}>
            <Button
              label={cancelMutation.isPending ? 'Cancelling...' : 'Confirm Cancellation'}
              onPress={handleSubmit}
              variant="destructive"
              disabled={!selectedReason || cancelMutation.isPending}
            />
          </View>
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
      borderBottomWidth: 1,
      borderBottomColor: colors.outlineVariant,
    },
    backBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.surfaceContainer,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scroll: {
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing['2xl'],
      paddingBottom: spacing['3xl'],
    },
    warningBanner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      backgroundColor: colors.errorContainer ?? '#FEF2F2',
      borderRadius: radii.xl,
      padding: spacing.base,
      marginBottom: spacing['2xl'],
    },
    sectionLabel: { letterSpacing: 1, marginBottom: spacing.base },
    card: {
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: spacing.base,
    },
    rowLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 },
    divider: { height: 1, backgroundColor: colors.outlineVariant, marginHorizontal: spacing.base },
    textArea: {
      borderWidth: 1,
      borderRadius: radii.xl,
      padding: spacing.base,
      fontSize: 15,
      textAlignVertical: 'top',
      minHeight: 100,
    },
  });
