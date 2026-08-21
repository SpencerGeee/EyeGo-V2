import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  TextInput,
  Alert,
} from 'react-native';
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { MotiView } from '@eyego/ui';
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
import { fonts, fontSizes, spacing, radii, withOpacity, springs } from '@eyego/config';
import { useColors, Colors } from '../../../utils/useColors';
import { useThemeStore } from '../../../stores/theme.store';
import { Text, Button, Avatar, AppBackground } from '@eyego/ui';
import { formatGhs, pesewasFromCedis } from "@eyego/utils";

const COMPLIMENTS = [
  { label: 'Punctual', icon: 'time-outline' },
  { label: 'Safe Driver', icon: 'shield-checkmark-outline' },
  { label: 'Clean Vehicle', icon: 'sparkles-outline' },
  { label: 'Friendly', icon: 'happy-outline' },
  { label: 'Helpful', icon: 'heart-outline' },
  { label: 'Smooth Ride', icon: 'car-sport-outline' },
];

// Presets in PESEWAS. These were bare cedis literals (2, 5, 10) that were sent
// straight to the tip endpoint; once the server started reading pesewas, a
// "GHS 5" tap would have tipped the driver five pesewas.
const TIP_OPTIONS = [
  { amountPesewas: 0, label: 'No tip' },
  { amountPesewas: 200, label: 'GH₵2' },
  { amountPesewas: 500, label: 'GH₵5' },
  { amountPesewas: 1000, label: 'GH₵10' },
  { amountPesewas: 0, label: 'Custom', isCustom: true },
];

const STAR_MESSAGES = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent!'];

export default function RateTipScreen() {
  const colors = useColors();
  const isDark = useThemeStore((s) => s.isDark);
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

  // Fetch the specific booking by ID to get its actual fareAmountPesewas (the real price paid)
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
    enabled: !!resolvedBookingId && !activeBooking?.fareAmountPesewas,
    staleTime: 0,
  });

  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [selectedCompliments, setSelectedCompliments] = useState<string[]>([]);
  const [selectedTipIndex, setSelectedTipIndex] = useState<number | null>(null);
  const [customTip, setCustomTip] = useState('');
  const [comment, setComment] = useState('');
  /**
   * Height of the sticky footer, so the comment box can be scrolled clear of it
   * rather than underneath it. Seeded with a realistic default so the very first
   * focus (before layout has reported) is already close to right.
   */
  const [footerHeight, setFooterHeight] = useState(112);

  const displayRating = hoveredRating || rating;
  const isCustom = selectedTipIndex !== null && TIP_OPTIONS[selectedTipIndex]?.isCustom;
  // The custom field is typed by a human, so it is cedis and converts here.
  const finalTipPesewas = isCustom
    ? pesewasFromCedis(parseFloat(customTip) || 0)
    : selectedTipIndex !== null
    ? TIP_OPTIONS[selectedTipIndex].amountPesewas
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
      if (finalTipPesewas > 0) {
        await bookingsApi.tip(resolvedBookingId, { amountPesewas: finalTipPesewas, phone: user?.phone });
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
    if (rating > 0 || finalTipPesewas > 0) {
      submitFeedback.mutate();
    } else {
      clearRideState();
      router.replace('/(tabs)/home' as Href);
    }
  }, [rating, finalTipPesewas, submitFeedback, clearRideState, router]);

  const handleSkip = useCallback(() => {
    clearRideState();
    router.replace('/(tabs)/home' as Href);
  }, [clearRideState, router]);

  const driverName = selectedTrip?.driver?.name ?? activeBooking?.trip?.driver?.name ?? 'Your Driver';
  const driverAvatar = (selectedTrip?.driver as any)?.profilePhoto ?? selectedTrip?.driver?.avatarUrl ?? null;
  const tripFare = activeBooking?.fareAmountPesewas ?? resolvedBooking?.fareAmountPesewas ?? 0;
  const vehicle = selectedTrip?.vehicle as any;
  const vehicleLabel = vehicle
    ? [vehicle.model ?? vehicle.make, vehicle.plateNumber].filter(Boolean).join(' • ')
    : 'Shared Van';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <AppBackground variant="static" isDark={isDark} />
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={handleSkip} style={styles.headerBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
          <Ionicons name="close" size={22} color={colors.onSurface} />
        </Pressable>
        <Text variant="titleSmall" style={{ color: colors.onSurface }}>Rate Driver</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={{ flex: 1 }}>
        {/*
          THE COMMENT BOX HAS TO END UP ABOVE THE FOOTER, NOT JUST ABOVE THE
          KEYBOARD.

          BUGFIX ("on the rate driver page, when I try to put a comment it
          doesn't come up for the view — I can't see what I'm typing").

          `bottomOffset` is the gap `KeyboardAwareScrollView` leaves between the
          focused input and the top of the keyboard. It was a flat 24, but this
          screen also has a `KeyboardStickyView` footer (Submit + "Maybe later")
          that rises WITH the keyboard and paints on top of that gap — roughly
          110 pt of it. So the scroll view dutifully parked the comment box 24 pt
          above the keyboard and the footer then covered it completely: the
          caret was on screen, the text was not.

          Measured rather than guessed, because the footer's height moves with
          the label (a tip amount makes the button text longer and can wrap) and
          with the device's safe-area inset.
        */}
        <KeyboardAwareScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: footerHeight + spacing.xl }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          bottomOffset={footerHeight + spacing.base}
        >
          {/* Title block */}
          <MotiView
            from={{ opacity: 0, translateY: -10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', ...springs.standard }}
            style={styles.titleBlock}
          >
            <Text variant="headlineMedium" style={styles.screenTitle}>How was your ride?</Text>
            <Text variant="bodyLarge" style={styles.screenSubtitle}>Your feedback helps us improve.</Text>
          </MotiView>

          {/* Glass driver card */}
          <MotiView
            from={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', ...springs.standard, delay: 60 }}
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
                <Text style={styles.farePillText}>{formatGhs(tripFare)} paid</Text>
              </View>
            )}
          </MotiView>

          {/* Stars */}
          <MotiView
            from={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', ...springs.standard, delay: 100 }}
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
                transition={{ type: 'spring', ...springs.standard }}
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
              transition={{ type: 'spring', ...springs.standard, delay: 50 }}
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
                      transition={{ type: 'spring', ...springs.standard, delay: i * 35 }}
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
            transition={{ type: 'spring', ...springs.standard, delay: 150 }}
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
                transition={{ type: 'spring', ...springs.standard }}
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
            transition={{ type: 'spring', ...springs.standard, delay: 200 }}
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
        </KeyboardAwareScrollView>

        {/* Sticky footer — rides the keyboard while the comment box is focused */}
        <KeyboardStickyView>
        <MotiView
          from={{ opacity: 0, translateY: 16 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', ...springs.standard, delay: 250 }}
          style={styles.footer}
          onLayout={(e) => {
            const h = Math.round(e.nativeEvent.layout.height);
            // Guard the set: MotiView's entrance animation can fire layout more
            // than once, and re-rendering the scroll view on every pixel would
            // fight the keyboard animation it is meant to cooperate with.
            setFooterHeight((prev: number) => (Math.abs(prev - h) > 2 ? h : prev));
          }}
        >
          <Button
            variant="glow"
            label={
              submitFeedback.isPending
                ? 'Submitting…'
                : rating > 0 || finalTipPesewas > 0
                ? `Submit${finalTipPesewas > 0 ? ` + Tip ${formatGhs(finalTipPesewas)}` : ''}`
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
        </KeyboardStickyView>
      </View>
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
        // A star being awarded is one of the few things allowed to bounce —
        // but through `springs.accent` (ζ 0.75, 2.8 % overshoot), not the old
        // ζ 0.27 wobble, and from 1.2 rather than 1.35 so the star does not
        // collide with the one beside it.
        scale.value = withSequence(
          withSpring(1.2, springs.accent),
          withSpring(1, springs.micro)
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
      lineHeight: Math.round(fontSizes.bodySmall * 1.3),
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
      lineHeight: 14,
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
      lineHeight: Math.round(fontSizes.bodyMedium * 1.3),
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
      lineHeight: 13,
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
      lineHeight: Math.round(fontSizes.bodySmall * 1.3),
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
      lineHeight: Math.round(fontSizes.bodyMedium * 1.3),
      color: colors.primary,
      marginRight: spacing.xs,
    },
    customInput: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodyLarge,
      lineHeight: Math.round(fontSizes.bodyLarge * 1.4),
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
      lineHeight: 16,
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
      lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
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
      lineHeight: Math.round(fontSizes.bodySmall * 1.3),
      color: colors.onSurfaceVariant,
    },
  });
