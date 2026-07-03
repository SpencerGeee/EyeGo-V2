import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { MotiView } from 'moti';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withSpring,
} from 'react-native-reanimated';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { bookingsApi, queryKeys } from '@eyego/api';
import { useRideStore } from '../../../stores/ride.store';
import { useAuthStore } from '../../../stores/auth.store';
import { fonts, fontSizes, spacing, radii, withOpacity } from '@eyego/config';
import { useColors, Colors } from '../../../utils/useColors';
import { Text, Button, Avatar } from '@eyego/ui';
import { formatCurrency } from '@eyego/utils';

const COMPLIMENTS = [
  { label: 'Punctual', icon: 'time-outline' },
  { label: 'Safe Driver', icon: 'shield-checkmark-outline' },
  { label: 'Clean Vehicle', icon: 'sparkles-outline' },
  { label: 'Friendly', icon: 'happy-outline' },
  { label: 'Helpful', icon: 'heart-outline' },
  { label: 'Smooth Ride', icon: 'car-sport-outline' },
];

const TIP_OPTIONS = [
  { amount: 0, label: 'No tip' },
  { amount: 2, label: 'GHS 2' },
  { amount: 5, label: 'GHS 5' },
  { amount: 10, label: 'GHS 10' },
  { amount: 0, label: 'Custom', isCustom: true },
];

const STAR_MESSAGES = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent!'];

export default function RateTipScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id, bookingId: paramBookingId } = useLocalSearchParams<{ id: string; bookingId?: string }>();
  const router = useRouter();
  const { activeBooking, selectedTrip, clearRideState } = useRideStore();
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

  // Fallback: fetch active booking from API if store was cleared before we arrived here
  const { data: fetchedBooking } = useQuery({
    queryKey: ['booking', 'active-for-rating'],
    queryFn: () => bookingsApi.getActive(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (r: any) => r.data?.data?.booking ?? null,
    enabled: !paramBookingId && !activeBooking?.id,
    staleTime: 0,
  });

  // R13: Stabilize resolvedBookingId — derive once on mount using a ref so it
  // doesn't change mid-render. Prefer URL param, fall back to store, then API.
  const resolvedBookingIdRef = useRef<string | null>(null);
  if (resolvedBookingIdRef.current === null) {
    resolvedBookingIdRef.current = paramBookingId || activeBooking?.id || fetchedBooking?.id || '';
  }
  // Update ref if we get a new value from API fetch and ref is still empty
  if (!resolvedBookingIdRef.current && fetchedBooking?.id) {
    resolvedBookingIdRef.current = fetchedBooking.id;
  }
  const resolvedBookingId = resolvedBookingIdRef.current;

  // Fetch the specific booking by ID to get its actual fareAmount (the real price paid)
  // This prevents showing the estimate fare instead of the confirmed paid amount.
  // R20: The double .data unwrap is needed because axios wraps the response body in
  // { data: ... } and our API returns { data: { booking: ... } } — so it's axios.data.apiData.booking.
  const { data: resolvedBooking } = useQuery({
    queryKey: ['booking', 'by-id', resolvedBookingId],
    queryFn: () => resolvedBookingId ? bookingsApi.getById(resolvedBookingId) : Promise.reject(new Error('No booking id')),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (r: any) => {
      const booking = r.data?.data?.booking ?? r.data?.data ?? null;
      if (!booking) {
        console.warn('[RateTipScreen] resolvedBooking unexpectedly null for id:', resolvedBookingId);
      }
      return booking;
    },
    enabled: !!resolvedBookingId && !activeBooking?.fareAmount,
    staleTime: 0,
  });

  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [selectedCompliments, setSelectedCompliments] = useState<string[]>([]);
  const [selectedTipIndex, setSelectedTipIndex] = useState<number | null>(null);
  const [customTip, setCustomTip] = useState('');
  const [comment, setComment] = useState('');

  const displayRating = hoveredRating || rating;
  const isCustom = selectedTipIndex !== null && TIP_OPTIONS[selectedTipIndex]?.isCustom;
  const finalTip = isCustom
    ? parseFloat(customTip) || 0
    : selectedTipIndex !== null
    ? TIP_OPTIONS[selectedTipIndex].amount
    : 0;

  const toggleCompliment = useCallback((label: string) => {
    setSelectedCompliments((prev) =>
      prev.includes(label) ? prev.filter((c) => c !== label) : [...prev, label]
    );
  }, []);

  const submitFeedback = useMutation({
    mutationFn: async () => {
      if (!resolvedBookingId) {
        throw new Error('Could not identify your booking. Please try again.');
      }
      const commentText = [selectedCompliments.join(', '), comment]
        .filter(Boolean)
        .join(' — ');

      if (rating > 0) {
        await bookingsApi.rate(resolvedBookingId, { rating, comment: commentText });
      }
      if (finalTip > 0) {
        await bookingsApi.tip(resolvedBookingId, { amount: finalTip, phone: user?.phone });
      }
    },
    onSuccess: () => {
      clearRideState();
      // Refresh trips (Past tab) and profile trip count
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.myHistory() });
      queryClient.invalidateQueries({ queryKey: ['bookings', 'completed', 'count'] });
      router.replace('/(tabs)/home' as Href);
    },
    onError: (err: any) => {
      Alert.alert(
        'Submission failed',
        err?.response?.data?.message ?? (err as Error).message ?? 'Something went wrong. Please try again.',
        [{ text: 'OK' }],
      );
    },
  });

  const handleFinish = useCallback(() => {
    if (rating > 0 || finalTip > 0) {
      submitFeedback.mutate();
    } else {
      clearRideState();
      router.replace('/(tabs)/home' as Href);
    }
  }, [rating, finalTip, submitFeedback, clearRideState, router]);

  const handleSkip = useCallback(() => {
    clearRideState();
    router.replace('/(tabs)/home' as Href);
  }, [clearRideState, router]);

  const driverName = selectedTrip?.driver?.name ?? activeBooking?.trip?.driver?.name ?? 'Your Driver';
  const driverAvatar = (selectedTrip?.driver as any)?.profilePhoto ?? selectedTrip?.driver?.avatarUrl ?? null;
  const tripFare = activeBooking?.fareAmount ?? resolvedBooking?.fareAmount ?? 0;
  const vehicle = selectedTrip?.vehicle as any;
  const vehicleLabel = vehicle
    ? [vehicle.model ?? vehicle.make, vehicle.plateNumber].filter(Boolean).join(' • ')
    : 'Shared Van';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={handleSkip} style={styles.headerBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
          <Ionicons name="close" size={22} color={colors.onSurface} />
        </Pressable>
        <Text variant="titleSmall" style={{ color: colors.onSurface }}>Rate Driver</Text>
        <View style={{ width: 44 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Title block */}
          <MotiView
            from={{ opacity: 0, translateY: -10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            style={styles.titleBlock}
          >
            <Text variant="headlineMedium" style={styles.screenTitle}>How was your ride?</Text>
            <Text variant="bodyLarge" style={styles.screenSubtitle}>Your feedback helps us improve.</Text>
          </MotiView>

          {/* Glass driver card */}
          <MotiView
            from={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30, delay: 60 }}
            style={styles.driverCard}
          >
            <View style={styles.avatarWrap}>
              <View style={styles.avatarGlow} />
              <View style={styles.avatarRing}>
                <Avatar size={80} name={driverName} uri={driverAvatar} />
              </View>
              <View style={styles.verifiedBadge}>
                <Ionicons name="checkmark" size={14} color={colors.onPrimary} />
              </View>
            </View>
            <Text style={styles.heroName}>{driverName}</Text>
            <View style={styles.vehiclePill}>
              <Ionicons name="car-outline" size={13} color={colors.onSurfaceVariant} />
              <Text style={styles.vehiclePillText}>{vehicleLabel}</Text>
            </View>
            {tripFare > 0 && (
              <View style={styles.farePill}>
                <Ionicons name="receipt-outline" size={12} color={colors.primary} />
                <Text style={styles.farePillText}>{formatCurrency(tripFare)} paid</Text>
              </View>
            )}
          </MotiView>

          {/* Stars */}
          <MotiView
            from={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 28, delay: 100 }}
            style={styles.starsSection}
          >
            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((star) => (
                <StarButton
                  key={star}
                  star={star}
                  isActive={displayRating >= star}
                  onPress={() => setRating(star)}
                  onHover={() => setHoveredRating(star)}
                  onHoverOut={() => setHoveredRating(0)}
                  colors={colors}
                />
              ))}
            </View>
            {displayRating > 0 && (
              <MotiView
                from={{ opacity: 0, translateY: 4 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: 'spring', stiffness: 600, damping: 28 }}
              >
                <Text style={[styles.starMessage, { color: displayRating === 5 ? colors.primary : colors.onSurface }]}>
                  {STAR_MESSAGES[displayRating]}
                </Text>
              </MotiView>
            )}
          </MotiView>

          {/* Compliments — only show after rating */}
          {rating > 0 && (
            <MotiView
              from={{ opacity: 0, translateY: 8 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30, delay: 50 }}
              style={styles.card}
            >
              <Text style={styles.cardTitle}>What went well?</Text>
              <View style={styles.chipsWrap}>
                {COMPLIMENTS.map((c, i) => {
                  const active = selectedCompliments.includes(c.label);
                  return (
                    <MotiView
                      key={c.label}
                      from={{ opacity: 0, scale: 0.88 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 28, delay: i * 35 }}
                    >
                      <Pressable
                        onPress={() => toggleCompliment(c.label)}
                        style={[styles.chip, active && styles.chipActive]}
                        accessibilityRole="button" accessibilityLabel={`${c.label}${active ? ' (selected)' : ''}`}
                      >
                        <Ionicons
                          name={c.icon as keyof typeof Ionicons.glyphMap}
                          size={13}
                          color={active ? colors.onPrimary : colors.onSurfaceVariant}
                        />
                        <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                          {c.label}
                        </Text>
                      </Pressable>
                    </MotiView>
                  );
                })}
              </View>
            </MotiView>
          )}

          {/* Tip section */}
          <MotiView
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30, delay: 150 }}
            style={[styles.card, styles.tipCard]}
          >
            <View style={styles.tipHeader}>
              <Text style={styles.cardTitle}>Add a tip</Text>
              <View style={styles.tipBadge}>
                <Ionicons name="heart" size={10} color={colors.primary} />
                <Text style={styles.tipBadgeText}>100% to driver</Text>
              </View>
            </View>

            <View style={styles.tipGrid}>
              {TIP_OPTIONS.map((opt, i) => {
                const isSelected = selectedTipIndex === i;
                return (
                  <Pressable
                    key={i}
                    onPress={() => setSelectedTipIndex(isSelected ? null : i)}
                    style={[styles.tipOption, isSelected && styles.tipOptionActive]}
                  >
                    {isSelected && (
                      <View style={styles.tipCheck}>
                        <Ionicons name="checkmark" size={10} color={colors.onPrimary} />
                      </View>
                    )}
                    <Text style={[styles.tipOptionLabel, isSelected && styles.tipOptionLabelActive]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {isCustom && (
              <MotiView
                from={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 52 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                style={{ overflow: 'hidden', marginTop: spacing.md }}
              >
                <View style={styles.customInputWrap}>
                  <Text style={styles.customInputPrefix}>GHS</Text>
                  <TextInput
                    style={styles.customInput}
                    value={customTip}
                    onChangeText={setCustomTip}
                    placeholder="0.00"
                    placeholderTextColor={colors.onSurfaceVariant}
                    keyboardType="decimal-pad"
                    autoFocus
                  />
                </View>
              </MotiView>
            )}
          </MotiView>

          {/* Comment */}
          <MotiView
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30, delay: 200 }}
            style={styles.card}
          >
            <Text style={styles.cardTitle}>Leave a comment</Text>
            <TextInput
              style={styles.commentInput}
              value={comment}
              onChangeText={setComment}
              placeholder="Anything you'd like to share? (optional)"
              placeholderTextColor={colors.onSurfaceVariant}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </MotiView>
        </ScrollView>

        {/* Sticky footer */}
        <MotiView
          from={{ opacity: 0, translateY: 16 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30, delay: 250 }}
          style={styles.footer}
        >
          <Button
            variant="glow"
            label={
              submitFeedback.isPending
                ? 'Submitting…'
                : rating > 0 || finalTip > 0
                ? `Submit${finalTip > 0 ? ` + Tip ${formatCurrency(finalTip)}` : ''}`
                : 'Finish'
            }
            onPress={handleFinish}
            loading={submitFeedback.isPending}
            fullWidth
          />
          <Pressable onPress={handleSkip} style={styles.skipLink} hitSlop={10} accessibilityRole="button" accessibilityLabel="Skip rating">
            <Text style={styles.skipText}>Maybe later</Text>
          </Pressable>
        </MotiView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function StarButton({
  star,
  isActive,
  onPress,
  onHover,
  onHoverOut,
  colors,
}: {
  star: number;
  isActive: boolean;
  onPress: () => void;
  onHover: () => void;
  onHoverOut: () => void;
  colors: Colors;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      onPress={() => {
        scale.value = withSequence(
          withSpring(1.35, { stiffness: 500, damping: 12 }),
          withSpring(1, { stiffness: 400, damping: 18 })
        );
        onPress();
      }}
      onPressIn={onHover}
      onPressOut={onHoverOut}
      hitSlop={6}
    >
      <Animated.Text
        style={[
          {
            fontSize: 46,
            lineHeight: 54,
            color: isActive ? colors.primary : colors.outlineVariant,
          },
          animStyle,
        ]}
      >
        ★
      </Animated.Text>
    </Pressable>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing['2xl'],
      paddingVertical: spacing.base,
    },
    headerBtn: {
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
      paddingTop: spacing.sm,
      paddingBottom: spacing.xl,
      gap: spacing.xl,
    },
    titleBlock: { alignItems: 'center', gap: spacing.xs },
    screenTitle: { color: colors.onSurface, textAlign: 'center' },
    screenSubtitle: { color: colors.onSurfaceVariant, textAlign: 'center' },
    driverCard: {
      alignItems: 'center',
      backgroundColor: colors.surfaceCard,
      borderRadius: radii['2xl'],
      borderWidth: 1,
      borderColor: colors.rimLightSubtle,
      paddingVertical: spacing.xl,
      paddingHorizontal: spacing.lg,
      gap: spacing.sm,
    },
    avatarWrap: { position: 'relative', marginBottom: spacing.xs },
    avatarGlow: {
      position: 'absolute',
      top: -4,
      left: -4,
      right: -4,
      bottom: -4,
      borderRadius: 60,
      backgroundColor: colors.primary,
      opacity: 0.18,
    },
    avatarRing: {
      padding: 4,
      borderRadius: 999,
      borderWidth: 2,
      borderColor: withOpacity(colors.primary, 0.5),
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.4,
      shadowRadius: 14,
      elevation: 8,
    },
    verifiedBadge: {
      position: 'absolute',
      bottom: -2,
      right: -2,
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.primary,
      borderWidth: 2,
      borderColor: colors.surfaceCard,
      alignItems: 'center',
      justifyContent: 'center',
    },
    vehiclePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.surfaceDim,
      borderWidth: 1,
      borderColor: colors.rimLightSubtle,
      borderRadius: radii.full,
      paddingHorizontal: spacing.md,
      paddingVertical: 5,
    },
    vehiclePillText: {
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodySmall,
      color: colors.onSurfaceVariant,
    },
    heroName: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.titleLarge,
      lineHeight: fontSizes.titleLarge * 1.3,
      color: colors.onSurface,
      letterSpacing: -0.3,
    },
    farePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      marginTop: spacing.xs,
      backgroundColor: withOpacity(colors.primary, 0.1),
      borderWidth: 1,
      borderColor: withOpacity(colors.primary, 0.25),
      borderRadius: radii.full,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
    },
    farePillText: {
      fontFamily: fonts.semiBold,
      fontSize: 11,
      color: colors.primary,
    },
    starsSection: {
      alignItems: 'center',
      gap: spacing.sm,
    },
    starsRow: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    starMessage: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyMedium,
      letterSpacing: 0.2,
    },
    card: {
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii['2xl'],
      padding: spacing.xl,
      borderWidth: 1,
      borderColor: colors.rimLight,
      gap: spacing.md,
    },
    tipCard: {
      borderColor: withOpacity(colors.primary, 0.2),
    },
    cardTitle: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.titleSmall,
      lineHeight: fontSizes.titleSmall * 1.3,
      color: colors.onSurface,
    },
    tipHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    tipBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: withOpacity(colors.primary, 0.08),
      borderRadius: radii.full,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
    },
    tipBadgeText: {
      fontFamily: fonts.medium,
      fontSize: 10,
      color: colors.primary,
    },
    tipGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    tipOption: {
      flex: 1,
      minWidth: '28%',
      paddingVertical: spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.lg,
      backgroundColor: colors.surfaceContainerHigh,
      borderWidth: 1,
      borderColor: colors.rimLight,
      position: 'relative',
    },
    tipOptionActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 6,
    },
    tipCheck: {
      position: 'absolute',
      top: 4,
      right: 4,
      width: 14,
      height: 14,
      borderRadius: 7,
      backgroundColor: withOpacity(colors.scrim, 0.25),
      alignItems: 'center',
      justifyContent: 'center',
    },
    tipOptionLabel: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodySmall,
      color: colors.onSurface,
    },
    tipOptionLabelActive: {
      color: colors.onPrimary,
    },
    customInputWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceContainerHigh,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: withOpacity(colors.primary, 0.4),
      paddingHorizontal: spacing.base,
      height: 52,
    },
    customInputPrefix: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyMedium,
      color: colors.primary,
      marginRight: spacing.xs,
    },
    customInput: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodyLarge,
      color: colors.onSurface,
    },
    chipsWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radii.full,
      backgroundColor: colors.surfaceContainerHigh,
      borderWidth: 1,
      borderColor: colors.rimLight,
    },
    chipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    chipLabel: {
      fontFamily: fonts.medium,
      fontSize: 12,
      color: colors.onSurface,
    },
    chipLabelActive: {
      color: colors.onPrimary,
    },
    commentInput: {
      backgroundColor: colors.surfaceInput,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.rimLight,
      padding: spacing.base,
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodyMedium,
      color: colors.onSurface,
      minHeight: 96,
    },
    footer: {
      paddingHorizontal: spacing['2xl'],
      paddingBottom: spacing.xl,
      paddingTop: spacing.base,
      gap: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.rimLightSubtle,
      backgroundColor: colors.backgroundDeep,
    },
    skipLink: {
      alignItems: 'center',
      paddingVertical: spacing.xs,
    },
    skipText: {
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodySmall,
      color: colors.onSurfaceVariant,
    },
  });
