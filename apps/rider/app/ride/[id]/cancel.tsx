import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MotiView, AnimatePresence } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radii } from '@eyego/config';
import { Text, Button } from '@eyego/ui';
import { useColors, Colors } from '../../../utils/useColors';
import { bookingsApi, cancellationApi } from '@eyego/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@eyego/utils';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const REASONS = [
  { key: 'changed_plans', label: 'Changed my plans', icon: 'calendar-outline' },
  { key: 'driver_late', label: 'Driver taking too long', icon: 'time-outline' },
  { key: 'wrong_location', label: 'Wrong pickup location', icon: 'location-outline' },
  { key: 'found_other', label: 'Found another ride', icon: 'car-outline' },
  { key: 'emergency', label: 'Emergency', icon: 'medkit-outline' },
  { key: 'other', label: 'Other reason', icon: 'ellipsis-horizontal-circle-outline' },
];

export default function CancelRideScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();

  const [selectedReason, setSelectedReason] = useState<string>('');
  const [note, setNote] = useState('');

  // Fetch cancellation fee estimate
  const { data: cancelFeeData } = useQuery({
    queryKey: ['cancellation-fee', id],
    queryFn: () => cancellationApi.getFee(id),
    select: (r: any) => r.data?.data ?? r.data ?? r,
    enabled: !!id,
    staleTime: 30_000,
  });

  const cancellationFee = cancelFeeData?.fee ?? 0;
  const isFeeEligible = cancelFeeData?.eligible ?? false;
  // BUGFIX: Only show fee banner after the query has loaded to avoid flashing
  // fee: 0 (no fee) while the API call is in-flight. If fee query fails silently,
  // we show a neutral message instead of hiding a real fee.
  const isFeeLoading = !cancelFeeData && id !== undefined;

  const cancelMutation = useMutation({
    mutationFn: () =>
      cancellationApi.cancelWithFee(id, {
        reason: selectedReason,
        note: selectedReason === 'other' ? note : undefined,
      }),
    onSuccess: (res: any) => {
      const data = res.data?.data ?? res.data ?? res;
      const fee = data?.cancellationFee ?? 0;
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      if (fee > 0) {
        Alert.alert(
          'Ride Cancelled',
          `Your ride has been cancelled. A cancellation fee of ${formatCurrency(fee)} has been applied.`,
          [{ text: 'OK', onPress: () => router.replace('/(tabs)/home') }]
        );
      } else {
        router.replace('/(tabs)/home');
      }
    },
    onError: (err: any) => {
      Alert.alert('Cancellation Failed', err?.message || 'Could not cancel the ride. Please try again.');
    },
  });

  const handleSubmit = useCallback(() => {
    if (!selectedReason) {
      Alert.alert('Select a reason', 'Please select a cancellation reason before continuing.');
      return;
    }
    cancelMutation.mutate();
  }, [selectedReason, cancelMutation]);

  return (
    <View style={styles.container}>
      {/* Premium dark gradient background */}
      <View style={styles.bgGradient}>
        <View style={styles.bgGlow1} />
        <View style={styles.bgGlow2} />
      </View>

      <SafeAreaView style={styles.safe}>
        {/* Header with glass effect */}
        <MotiView
          from={{ opacity: 0, translateY: -12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34 }}
          style={styles.headerGlass}
        >
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.headerTitle}>Cancel Ride</Text>
          </View>
          <View style={{ width: 40 }} />
        </MotiView>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Icon header */}
          <MotiView
            from={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20, delay: 80 }}
            style={styles.iconCircle}
          >
            <Ionicons name="close-circle-outline" size={36} color="#EF4444" />
          </MotiView>

          <MotiView
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 120 }}
          >
            <Text style={styles.heading}>Why are you cancelling?</Text>
            <Text style={styles.subheading}>
              Your refund will be processed according to our cancellation policy.
            </Text>
          </MotiView>

          {/* Cancellation fee banner */}
          <MotiView
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 150 }}
            style={[styles.warningBanner, isFeeEligible && cancellationFee > 0 && { borderColor: 'rgba(239, 68, 68, 0.25)', backgroundColor: 'rgba(239, 68, 68, 0.08)' }]}
          >
            <View style={[styles.warningIcon, isFeeEligible && cancellationFee > 0 && { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
              <Ionicons name={isFeeEligible && cancellationFee > 0 ? 'alert-circle' : 'information'} size={16} color={isFeeEligible && cancellationFee > 0 ? '#EF4444' : '#F59E0B'} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.warningText, isFeeEligible && cancellationFee > 0 && { color: '#FCA5A5' }]}>
                {isFeeLoading
                  ? 'Checking cancellation policy...'
                  : isFeeEligible && cancellationFee > 0
                  ? `Cancelling this ride will incur a fee of ${formatCurrency(cancellationFee)}.`
                  : 'Cancelling after the driver has been dispatched may incur a cancellation fee.'}
              </Text>
              {cancelFeeData?.reason && (
                <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>
                  {cancelFeeData.reason}
                </Text>
              )}
            </View>
          </MotiView>

          {/* Reason cards */}
          <MotiView
            from={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 28, delay: 180 }}
            style={styles.reasonsContainer}
          >
            {REASONS.map((reason, index) => {
              const isSelected = selectedReason === reason.key;
              return (
                <MotiView
                  key={reason.key}
                  from={{ opacity: 0, translateX: -10 }}
                  animate={{ opacity: 1, translateX: 0 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 28, delay: 200 + index * 40 }}
                >
                  <Pressable
                    onPress={() => {
                      setSelectedReason(reason.key);
                      if (reason.key !== 'other') setNote('');
                    }}
                    style={({ pressed }) => [
                      styles.reasonCard,
                      isSelected && styles.reasonCardSelected,
                      pressed && { transform: [{ scale: 0.98 }] },
                    ]}
                  >
                    <View style={[styles.reasonIcon, isSelected && styles.reasonIconSelected]}>
                      <Ionicons
                        name={reason.icon as any}
                        size={20}
                        color={isSelected ? colors.onPrimary : colors.onSurfaceVariant}
                      />
                    </View>
                    <Text style={[styles.reasonLabel, isSelected && styles.reasonLabelSelected]}>
                      {reason.label}
                    </Text>
                    <View style={[styles.radio, isSelected && styles.radioSelected]}>
                      {isSelected && (
                        <View style={styles.radioInner} />
                      )}
                    </View>
                  </Pressable>
                </MotiView>
              );
            })}
          </MotiView>

          {/* Note input for 'other' */}
          <AnimatePresence>
            {selectedReason === 'other' && (
              <MotiView
                key="note-input"
                from={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: 140, marginTop: spacing.md }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                style={styles.noteContainer}
              >
                <Text style={styles.noteLabel}>Tell us more (optional)</Text>
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder="Describe your reason..."
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  multiline
                  numberOfLines={3}
                  style={styles.noteInput}
                  textAlignVertical="top"
                />
              </MotiView>
            )}
          </AnimatePresence>
        </ScrollView>

        {/* Bottom CTA */}
        <MotiView
          from={{ opacity: 0, translateY: 20 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 28, delay: 300 }}
          style={styles.footer}
        >
          <Pressable
            style={[
              styles.cancelButton,
              (!selectedReason || cancelMutation.isPending) && styles.cancelButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!selectedReason || cancelMutation.isPending}
          >
            <View style={styles.cancelButtonInner}>
              {cancelMutation.isPending ? (
                <MotiView
                  from={{ rotate: '0deg' }}
                  animate={{ rotate: '360deg' }}
                  transition={{ type: 'timing', duration: 1000, loop: true }}
                >
                  <Ionicons name="reload-outline" size={20} color="#fff" />
                </MotiView>
              ) : (
                <>
                  <Ionicons name="close-circle" size={20} color="#fff" />
                  <Text style={styles.cancelButtonText}>Confirm Cancellation</Text>
                </>
              )}
            </View>
          </Pressable>

          <Pressable
            style={styles.keepButton}
            onPress={() => router.back()}
          >
            <Text style={styles.keepButtonText}>Keep my ride</Text>
          </Pressable>
        </MotiView>
      </SafeAreaView>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0A0A0F' },
    safe: { flex: 1 },
    bgGradient: {
      ...StyleSheet.absoluteFillObject,
      overflow: 'hidden',
    },
    bgGlow1: {
      position: 'absolute',
      top: -100,
      right: -60,
      width: 200,
      height: 200,
      borderRadius: 100,
      backgroundColor: 'rgba(239, 68, 68, 0.12)',
    },
    bgGlow2: {
      position: 'absolute',
      bottom: -80,
      left: -40,
      width: 180,
      height: 180,
      borderRadius: 90,
      backgroundColor: 'rgba(239, 68, 68, 0.06)',
    },
    headerGlass: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing['2xl'],
      paddingVertical: spacing.base,
      backgroundColor: 'rgba(255,255,255,0.04)',
      borderBottomWidth: 1,
      borderBottomColor: 'rgba(255,255,255,0.06)',
    },
    backBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: 'rgba(255,255,255,0.08)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      fontSize: 17,
      fontWeight: '600',
      color: '#fff',
      letterSpacing: -0.3,
    },
    scroll: {
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing['2xl'],
      paddingBottom: spacing['3xl'],
    },
    iconCircle: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: 'rgba(239, 68, 68, 0.1)',
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
      marginBottom: spacing.lg,
      borderWidth: 1,
      borderColor: 'rgba(239, 68, 68, 0.2)',
    },
    heading: {
      fontSize: 24,
      fontWeight: '700',
      color: '#fff',
      textAlign: 'center',
      letterSpacing: -0.5,
      marginBottom: spacing.xs,
    },
    subheading: {
      fontSize: 14,
      color: 'rgba(255,255,255,0.5)',
      textAlign: 'center',
      lineHeight: 20,
      marginBottom: spacing['2xl'],
    },
    warningBanner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      backgroundColor: 'rgba(245, 158, 11, 0.08)',
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: 'rgba(245, 158, 11, 0.15)',
      padding: spacing.base,
      marginBottom: spacing['2xl'],
    },
    warningIcon: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: 'rgba(245, 158, 11, 0.15)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    warningText: {
      flex: 1,
      fontSize: 13,
      color: 'rgba(255,255,255,0.7)',
      lineHeight: 18,
    },
    reasonsContainer: {
      gap: spacing.sm,
    },
    reasonCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'rgba(255,255,255,0.04)',
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.06)',
      padding: spacing.base,
      gap: spacing.md,
    },
    reasonCardSelected: {
      backgroundColor: 'rgba(239, 68, 68, 0.08)',
      borderColor: 'rgba(239, 68, 68, 0.35)',
    },
    reasonIcon: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: 'rgba(255,255,255,0.06)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    reasonIconSelected: {
      backgroundColor: '#EF4444',
    },
    reasonLabel: {
      flex: 1,
      fontSize: 15,
      color: 'rgba(255,255,255,0.85)',
      fontWeight: '500',
    },
    reasonLabelSelected: {
      color: '#fff',
      fontWeight: '600',
    },
    radio: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2,
      borderColor: 'rgba(255,255,255,0.15)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioSelected: {
      borderColor: '#EF4444',
    },
    radioInner: {
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: '#EF4444',
    },
    noteContainer: {
      overflow: 'hidden',
    },
    noteLabel: {
      fontSize: 13,
      color: 'rgba(255,255,255,0.5)',
      fontWeight: '500',
      marginBottom: spacing.sm,
      marginLeft: spacing.xs,
    },
    noteInput: {
      backgroundColor: 'rgba(255,255,255,0.04)',
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.08)',
      padding: spacing.base,
      fontSize: 14,
      color: '#fff',
      minHeight: 100,
    },
    footer: {
      paddingHorizontal: spacing['2xl'],
      paddingBottom: spacing['3xl'],
      paddingTop: spacing.md,
      gap: spacing.md,
    },
    cancelButton: {
      borderRadius: radii['2xl'],
      overflow: 'hidden',
    },
    cancelButtonDisabled: {
      opacity: 0.4,
    },
    cancelButtonInner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.base + 2,
      backgroundColor: '#EF4444',
      borderRadius: radii['2xl'],
    },
    cancelButtonText: {
      fontSize: 16,
      fontWeight: '600',
      color: '#fff',
    },
    keepButton: {
      alignItems: 'center',
      paddingVertical: spacing.base,
    },
    keepButtonText: {
      fontSize: 15,
      color: 'rgba(255,255,255,0.5)',
      fontWeight: '500',
    },
  });
