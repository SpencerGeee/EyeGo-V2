import React, { useState, useMemo, useCallback } from 'react';
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
import { useLocalSearchParams, useRouter } from 'expo-router';
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
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
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
    select: (r) => (r.data as any)?.data?.booking ?? null,
    enabled: !paramBookingId && !activeBooking?.id,
    staleTime: 0,
  });

  // bookingId priority: URL param → store → API fallback
  const resolvedBookingId = paramBookingId || activeBooking?.id || fetchedBooking?.id || '';

  // Fetch the specific booking by ID to get its actual fareAmount (the real price paid)
  // This prevents showing the estimate fare instead of the confirmed paid amount
  const { data: resolvedBooking } = useQuery({
    queryKey: ['booking', 'by-id', resolvedBookingId],
    queryFn: () => bookingsApi.getById(resolvedBookingId),
    select: (r) => (r.data as any)?.data?.booking ?? (r.data as any)?.data ?? null,
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
      router.replace('/(tabs)/home' as any);
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
      router.replace('/(tabs)/home' as any);
    }
  }, [rating, finalTip, submitFeedback, clearRideState, router]);

  const handleSkip = useCallback(() => {
    clearRideState();
    router.replace('/(tabs)/home' as any);
  }, [clearRideState, router]);

  const driverName = selectedTrip?.driver?.name ?? activeBooking?.trip?.driver?.name ?? 'Your Driver';
  const driverAvatar = (selectedTrip?.driver as any)?.profilePhoto ?? (selectedTrip?.driver as any)?.avatarUrl;
  const tripFare = activeBooking?.fareAmount ?? resolvedBooking?.fareAmount ?? 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Driver hero section */}
          <MotiView
            from={{ opacity: 0, translateY: -10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            style={styles.heroSection}
          >
            {/* Glow ring behind avatar */}
            <View style={styles.avatarGlow} />
            <View style={styles.avatarRing}>
              <Avatar size={80} name={driverName} uri={driverAvatar} />
            </View>
            <MotiView
              from={{ opacity: 0, translateY: 4 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30, delay: 80 }}
              style={styles.heroText}
            >
              <Text style={styles.heroName}>{driverName}</Text>
              <Text variant="bodySmall" color={colors.onSurfaceVariant}>
                How was your trip?
              </Text>
              {tripFare > 0 && (
                <View style={styles.farePill}>
                  <Ionicons name="receipt-outline" size={12} color={colors.primary} />
                  <Text style={styles.farePillText}>{formatCurrency(tripFare)} paid</Text>
                </View>
              )}
            </MotiView>
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
                      >
                        <Ionicons
                          name={c.icon as any}
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
          <Pressable onPress={handleSkip} style={styles.skipLink} hitSlop={10}>
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
    safe: { flex: 1, backgroundColor: colors.backgroundDeep },
    scroll: {
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing['2xl'],
      paddingBottom: spacing.xl,
      gap: spacing.xl,
    },
    heroSection: {
      alignItems: 'center',
      paddingTop: spacing.lg,
      gap: spacing.md,
    },
    avatarGlow: {
      position: 'absolute',
      top: spacing.lg + 4,
      width: 120,
      height: 120,
      borderRadius: 60,
      backgroundColor: colors.primary,
      opacity: 0.12,
    },
    avatarRing: {
      padding: 4,
      borderRadius: 999,
      borderWidth: 2,
      borderColor: colors.primary + '80',
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.35,
      shadowRadius: 12,
      elevation: 8,
    },
    heroText: { alignItems: 'center', gap: spacing.xs },
    heroName: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.titleLarge,
      color: colors.onSurface,
      letterSpacing: -0.3,
    },
    farePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      marginTop: spacing.xs,
      backgroundColor: colors.primary + '18',
      borderWidth: 1,
      borderColor: colors.primary + '40',
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
      borderColor: colors.outlineVariant,
      gap: spacing.md,
    },
    tipCard: {
      borderColor: colors.primary + '30',
    },
    cardTitle: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.titleSmall,
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
      backgroundColor: colors.primary + '14',
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
      borderColor: colors.outline,
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
      backgroundColor: 'rgba(0,0,0,0.25)',
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
      borderColor: colors.primary + '60',
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
      borderColor: colors.outlineVariant,
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
      backgroundColor: colors.surfaceContainerHigh,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      padding: spacing.base,
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodyMedium,
      color: colors.onSurface,
      minHeight: 80,
    },
    footer: {
      paddingHorizontal: spacing['2xl'],
      paddingBottom: spacing.xl,
      paddingTop: spacing.base,
      gap: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.outlineVariant,
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
