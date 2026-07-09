import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MotiView, AnimatePresence } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radii, fonts, fontSizes, withOpacity } from '@eyego/config';
import { Text, Radio, GlassSurface } from '@eyego/ui';
import { useColors, Colors } from '../../../utils/useColors';
import { cancellationApi } from '@eyego/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRideStore } from '../../../stores/ride.store';
import { formatCurrency } from '@eyego/utils';

const REASONS = [
  { key: 'changed_plans', label: 'Changed my plans', icon: 'calendar-outline' },
  { key: 'driver_late', label: 'Driver taking too long', icon: 'time-outline' },
  { key: 'wrong_location', label: 'Wrong pickup location', icon: 'location-outline' },
  { key: 'found_other', label: 'Found another ride', icon: 'car-outline' },
  { key: 'emergency', label: 'Emergency', icon: 'medkit-outline' },
  { key: 'other', label: 'Other reason', icon: 'ellipsis-horizontal-circle-outline' },
] as const;

export default function CancelRideScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { selectedTrip } = useRideStore();

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
  const hasFee = isFeeEligible && cancellationFee > 0;

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

  const trip = selectedTrip as any;
  const pickup = trip?.pickupLocation?.name ?? trip?.route?.name ?? 'Your pickup point';
  const dropoff = trip?.dropoffLocation?.name ?? trip?.route?.destinationName ?? 'Your destination';

  return (
    <View style={styles.container}>
      {/* Ambient error glow backdrop */}
      <View style={styles.bgGradient} pointerEvents="none">
        <View style={styles.bgGlow} />
      </View>

      <SafeAreaView style={styles.safe}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
          </Pressable>
          <Text variant="titleSmall" style={{ color: colors.onSurface }}>
            Cancel Ride
          </Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <MotiView
            from={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34 }}
          >
            {/* Warning hero */}
            <View style={styles.hero}>
              <View style={styles.warnCircle}>
                <Ionicons name="warning-outline" size={34} color={colors.statusError} />
              </View>
              <Text variant="headlineMedium" style={styles.heroTitle}>
                Cancel Ride?
              </Text>
              <Text variant="bodyLarge" style={styles.heroSubtitle}>
                Are you sure you want to cancel this ride? This action cannot be undone.
              </Text>
            </View>

            {/* Glass route card */}
            <GlassSurface borderRadius={radii['2xl']} intensity="low" dark style={styles.glassCard}>
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderLeft}>
                  <Ionicons name="car-outline" size={18} color={colors.onSurfaceVariant} />
                  <Text style={styles.cardHeaderLabel}>
                    {selectedTrip?.vehicle?.model ?? 'Shared Van'}
                  </Text>
                </View>
                <View style={styles.etaPill}>
                  <Ionicons name="time-outline" size={13} color={colors.primary} />
                  <Text style={styles.etaText}>
                    {trip?.etaMinutes ? `${trip.etaMinutes} min` : 'En route'}
                  </Text>
                </View>
              </View>

              {/* Route timeline */}
              <View style={styles.timeline}>
                <View style={styles.timelineLine} />
                <View style={styles.routeRow}>
                  <View style={styles.dotPickup}>
                    <View style={styles.dotPickupInner} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.routeLabel}>PICKUP</Text>
                    <Text variant="bodyLarge" numberOfLines={1} style={styles.routeValue}>
                      {pickup}
                    </Text>
                  </View>
                </View>
                <View style={[styles.routeRow, { marginTop: spacing.base }]}>
                  <View style={styles.dotDrop}>
                    <View style={styles.dotDropInner} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.routeLabel}>DROP-OFF</Text>
                    <Text variant="bodyLarge" numberOfLines={1} style={styles.routeValue}>
                      {dropoff}
                    </Text>
                  </View>
                </View>
              </View>
            </GlassSurface>

            {/* Cancellation policy banner */}
            <View style={[styles.policyBanner, hasFee && styles.policyBannerActive]}>
              <Ionicons
                name={hasFee ? 'alert-circle-outline' : 'information-circle-outline'}
                size={20}
                color={hasFee ? colors.statusError : colors.primary}
                style={{ marginTop: 1 }}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.policyTitle, hasFee && { color: colors.statusError }]}>
                  Cancellation Policy
                </Text>
                <Text style={styles.policyText}>
                  {isFeeLoading
                    ? 'Checking cancellation policy…'
                    : hasFee
                    ? `A cancellation fee of ${formatCurrency(cancellationFee)} applies to this ride.`
                    : 'Cancelling after the driver has been dispatched may incur a cancellation fee.'}
                </Text>
                {cancelFeeData?.reason ? (
                  <Text style={styles.policySub}>{cancelFeeData.reason}</Text>
                ) : null}
              </View>
            </View>

            {/* Reason selection */}
            <Text variant="titleSmall" style={styles.sectionTitle}>
              Why are you cancelling?
            </Text>
            <View style={styles.reasonsContainer}>
              {REASONS.map((reason) => {
                const isSelected = selectedReason === reason.key;
                return (
                  <Pressable
                    key={reason.key}
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
                        size={18}
                        color={isSelected ? colors.statusError : colors.onSurfaceVariant}
                      />
                    </View>
                    <Text style={[styles.reasonLabel, isSelected && styles.reasonLabelSelected]}>
                      {reason.label}
                    </Text>
                    <Radio
                      selected={isSelected}
                      accentColor={colors.statusError}
                      onPress={() => {
                        setSelectedReason(reason.key);
                        if (reason.key !== 'other') setNote('');
                      }}
                    />
                  </Pressable>
                );
              })}
            </View>

            {/* Note input for 'other' */}
            <AnimatePresence>
              {selectedReason === 'other' && (
                <MotiView
                  key="note-input"
                  from={{ opacity: 0, height: 0, marginTop: 0 }}
                  animate={{ opacity: 1, height: 132, marginTop: spacing.base }}
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                  style={styles.noteContainer}
                >
                  <TextInput
                    value={note}
                    onChangeText={setNote}
                    placeholder="Tell us more (optional)…"
                    placeholderTextColor={colors.outlineVariant}
                    multiline
                    numberOfLines={3}
                    style={styles.noteInput}
                    textAlignVertical="top"
                  />
                </MotiView>
              )}
            </AnimatePresence>
          </MotiView>
        </ScrollView>

        {/* Bottom CTAs — keep ride primary, cancel destructive */}
        <View style={styles.footer}>
          <Pressable
            style={({ pressed }) => [styles.keepButton, pressed && { transform: [{ scale: 0.98 }] }]}
            onPress={() => router.back()}
          >
            <Ionicons name="checkmark-circle" size={20} color={colors.onPrimary} />
            <Text style={styles.keepButtonText}>Keep My Ride</Text>
          </Pressable>

          <Pressable
            style={[
              styles.cancelButton,
              (!selectedReason || cancelMutation.isPending) && styles.cancelButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!selectedReason || cancelMutation.isPending}
          >
            {cancelMutation.isPending ? (
              <MotiView
                from={{ rotate: '0deg' }}
                animate={{ rotate: '360deg' }}
                transition={{ type: 'timing', duration: 1000, loop: true }}
              >
                <Ionicons name="reload-outline" size={18} color={colors.statusError} />
              </MotiView>
            ) : (
              <Text style={styles.cancelButtonText}>Cancel Ride</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: 'transparent' },
    safe: { flex: 1 },
    bgGradient: { ...StyleSheet.absoluteFillObject, overflow: 'hidden', opacity: 0.3 },
    bgGlow: {
      position: 'absolute',
      top: '14%',
      alignSelf: 'center',
      width: 360,
      height: 360,
      borderRadius: 180,
      backgroundColor: withOpacity(colors.statusError, 0.12),
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
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
    scroll: {
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing.lg,
      paddingBottom: spacing['3xl'],
    },
    hero: { alignItems: 'center', marginBottom: spacing['2xl'] },
    warnCircle: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: withOpacity(colors.statusError, 0.1),
      borderWidth: 1,
      borderColor: withOpacity(colors.statusError, 0.2),
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.base,
    },
    heroTitle: { color: colors.onSurface, textAlign: 'center', marginBottom: spacing.sm },
    heroSubtitle: {
      color: colors.onSurfaceVariant,
      textAlign: 'center',
      maxWidth: 290,
      lineHeight: 22,
    },
    glassCard: {
      padding: spacing.lg,
      marginBottom: spacing.base,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottomWidth: 1,
      borderBottomColor: colors.rimLight,
      paddingBottom: spacing.base,
    },
    cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    cardHeaderLabel: {
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodySmall,
      lineHeight: Math.round(fontSizes.bodySmall * 1.3),
      letterSpacing: 0.6,
      color: colors.onSurfaceVariant,
      textTransform: 'uppercase',
    },
    etaPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.surfaceDim,
      borderWidth: 1,
      borderColor: colors.rimLightSubtle,
      borderRadius: radii.md,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
    },
    etaText: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14, color: colors.primary },
    timeline: { position: 'relative', paddingLeft: spacing['2xl'], paddingTop: spacing.base },
    timelineLine: {
      position: 'absolute',
      left: 9,
      top: spacing.base + 14,
      bottom: 14,
      width: 2,
      backgroundColor: colors.rimLight,
      borderRadius: 1,
    },
    routeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
    dotPickup: {
      position: 'absolute',
      left: -spacing['2xl'],
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: colors.surfaceDim,
      borderWidth: 2,
      borderColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dotPickupInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
    dotDrop: {
      position: 'absolute',
      left: -spacing['2xl'],
      width: 20,
      height: 20,
      borderRadius: 6,
      backgroundColor: colors.surfaceDim,
      borderWidth: 2,
      borderColor: colors.onSurfaceVariant,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dotDropInner: { width: 6, height: 6, borderRadius: 2, backgroundColor: colors.onSurfaceVariant },
    routeLabel: {
      fontFamily: fonts.semiBold,
      fontSize: 10,
      lineHeight: 13,
      letterSpacing: 0.8,
      color: colors.onSurfaceVariant,
      marginBottom: 2,
    },
    routeValue: { color: colors.onSurface },
    policyBanner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.rimLightSubtle,
      padding: spacing.base,
      marginBottom: spacing['2xl'],
    },
    policyBannerActive: {
      backgroundColor: withOpacity(colors.statusError, 0.08),
      borderColor: withOpacity(colors.statusError, 0.2),
    },
    policyTitle: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodySmall,
      lineHeight: Math.round(fontSizes.bodySmall * 1.3),
      color: colors.onSurface,
      marginBottom: 2,
    },
    policyText: {
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodySmall,
      color: colors.onSurfaceVariant,
      lineHeight: 18,
    },
    policySub: {
      fontFamily: fonts.regular,
      fontSize: 12,
      lineHeight: 16,
      color: colors.outline,
      marginTop: 4,
    },
    sectionTitle: { color: colors.onSurface, marginBottom: spacing.base },
    reasonsContainer: { gap: spacing.sm },
    reasonCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.rimLightSubtle,
      padding: spacing.base,
      gap: spacing.md,
    },
    reasonCardSelected: {
      backgroundColor: withOpacity(colors.statusError, 0.08),
      borderColor: withOpacity(colors.statusError, 0.35),
    },
    reasonIcon: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: colors.surfaceContainerHigh,
      alignItems: 'center',
      justifyContent: 'center',
    },
    reasonIconSelected: { backgroundColor: withOpacity(colors.statusError, 0.15) },
    reasonLabel: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.3),
      color: colors.onSurfaceVariant,
    },
    reasonLabelSelected: { color: colors.onSurface, fontFamily: fonts.semiBold },
    noteContainer: { overflow: 'hidden' },
    noteInput: {
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.rimLight,
      padding: spacing.base,
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
      color: colors.onSurface,
      minHeight: 110,
    },
    footer: {
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing.base,
      paddingBottom: spacing['2xl'],
      gap: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.rimLightSubtle,
      backgroundColor: colors.backgroundDeep,
    },
    keepButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.base + 2,
      borderRadius: radii['2xl'],
      backgroundColor: colors.primary,
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.25,
      shadowRadius: 16,
    },
    keepButtonText: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.titleSmall,
      lineHeight: fontSizes.titleSmall * 1.3,
      color: colors.onPrimary,
    },
    cancelButton: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.base + 2,
      borderRadius: radii['2xl'],
      borderWidth: 1,
      borderColor: withOpacity(colors.statusError, 0.3),
      backgroundColor: 'transparent',
    },
    cancelButtonDisabled: { opacity: 0.4 },
    cancelButtonText: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.titleSmall,
      lineHeight: fontSizes.titleSmall * 1.3,
      color: colors.statusError,
    },
  });
