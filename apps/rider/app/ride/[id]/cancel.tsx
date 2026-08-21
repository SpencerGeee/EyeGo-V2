import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useRouter, useLocalSearchParams } from 'expo-router';
// `Pressable` from @eyego/ui, never react-native — NativeWind's interop runtime
// drops the `({ pressed }) => style` function form on RN's Pressable, which
// silently deletes the whole style. See components/trip/stages/SearchStage.tsx.
import { MotiView, AnimatePresence, Pressable } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radii, fonts, fontSizes, withOpacity, springs } from '@eyego/config';
import { Text, Radio, GlassSurface } from '@eyego/ui';
import { useColors, Colors } from '../../../utils/useColors';
import { cancellationApi } from '@eyego/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useKeyboardState } from 'react-native-keyboard-controller';
import { useRideStore } from '../../../stores/ride.store';
import { formatGhs } from '@eyego/utils';

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
  const { selectedTrip, clearRideState } = useRideStore();

  const [selectedReason, setSelectedReason] = useState<string>('');
  const [note, setNote] = useState('');

  /**
   * Room for the keyboard when "Other reason" opens the note field.
   *
   * This screen had no keyboard handling at all, so typing a reason put the
   * field under the keys with no way to see what was being written — the same
   * defect as the chat screen. Measured from the keyboard itself rather than
   * inferred from a frame, for the reasons in the note on chat.tsx.
   *
   * Applied as scroll padding rather than a container transform: the footer
   * ("Keep My Ride" / "Cancel Ride") should stay exactly where it is, and only
   * the scrollable content needs to get out of the way.
   */
  const keyboardShown = useKeyboardState((s) => s.isVisible);
  const keyboardMetrics = useKeyboardState((s) => s.height);
  const keyboardInset = keyboardShown ? keyboardMetrics : 0;

  // Fetch cancellation fee estimate
  const {
    data: cancelFeeData,
    isPending: isFeePending,
    isError: isFeeError,
  } = useQuery({
    queryKey: ['cancellation-fee', id],
    // `cancellationApi.getFee` now unwraps the envelope AND the
    // `cancellationFeePesewas` key it nests the terms under, so what arrives
    // here is the terms object itself — no `select` needed.
    queryFn: () => cancellationApi.getFee(id),
    enabled: !!id,
    staleTime: 30_000,
  });

  /**
   * BUGFIX ("the cancel screen never tells me what it will cost").
   *
   * These read `cancelFeeData?.fee` and `cancelFeeData?.eligible` — two fields
   * the server has never sent, off a response that was never unwrapped. Both
   * were therefore permanently undefined, `hasFee` was permanently false, and
   * the banner showed the vague "may incur a cancellation fee" line every time,
   * including when the rider was one tap away from being charged a real one.
   */
  const cancellationFeePesewas = cancelFeeData?.feeAmountPesewas ?? 0;
  const isFeeEligible = cancellationFeePesewas > 0;
  /**
   * BUGFIX ("it's showing 'checking cancellation policy' which is stuck and
   * doesn't work").
   *
   * This was `!cancelFeeData && id !== undefined` — derived from the ABSENCE of
   * data rather than from the query's state. When the fee request failed, data
   * stayed undefined forever, so the condition stayed true forever and the
   * banner sat on "Checking cancellation policy…" for the life of the screen.
   * There was no path out of it, because nothing was still loading.
   *
   * Read the query's own state instead. `isPending` is true only while a fetch
   * is genuinely in flight; a failure lands in `isFeeError`, which gets an
   * honest message telling the rider what they can and cannot know before they
   * commit — the one thing a cancellation screen must never be vague about.
   */
  const isFeeLoading = !!id && isFeePending;
  const hasFee = isFeeEligible && cancellationFeePesewas > 0;

  const cancelMutation = useMutation({
    mutationFn: () =>
      cancellationApi.cancelWithFee(id, {
        reason: selectedReason,
        note: selectedReason === 'other' ? note : undefined,
      }),
    onSuccess: (res) => {
      // Already unwrapped by cancellationApi — this used to peel an envelope
      // off an object that no longer has one, and read 0 every time.
      const fee = res?.cancellationFeePesewas ?? 0;
      // Invalidate every surface that could still show this ride as live:
      // booking lists/active queries, the tracking screen's ['trip', id] +
      // active-tracking query, and the scheduled-rides list.
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['trip', id] });
      queryClient.invalidateQueries({ queryKey: ['trips', 'scheduled'] });
      // BUGFIX ("I cancelled the trip but I'm still seeing the live trip card,
      // and tapping it opens the tracking page"): invalidating the QUERIES was
      // never enough, because the live-ride surfaces also read the PERSISTED
      // Zustand ride state. `activeBooking`/`selectedTrip` survive a cancel — and
      // survive an app restart, since the store is persisted — so the home card
      // and the tracking screen kept rendering a ride that no longer exists on
      // the server. Clearing the store is the actual fix; the invalidations
      // above only refresh what the server owns.
      clearRideState();
      if (fee > 0) {
        Alert.alert(
          'Ride Cancelled',
          `Your ride has been cancelled. A cancellation fee of ${formatGhs(fee)} has been applied.`,
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

  /**
   * TAKE THE RIDER TO THE THING THEY HAVE NOT DONE.
   *
   * The reason list sits above the fold, behind the footer, and the only signal
   * that it was mandatory was a greyed-out button — which on iOS does not even
   * fire a press, so a rider tapping it got no feedback of any kind and no way
   * to discover the cause. An Alert would say the words but leave them to find
   * the control themselves.
   *
   * So the destructive button stays ENABLED and, until a reason is chosen, its
   * press scrolls the list into view and pulses it. The rider ends up looking
   * at the control they need, which is the only outcome that actually resolves
   * the state.
   */
  const scrollRef = useRef<ScrollView>(null);
  const reasonsYRef = useRef(0);
  const [nudge, setNudge] = useState(false);

  const nudgeReasons = useCallback(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    scrollRef.current?.scrollTo({ y: Math.max(0, reasonsYRef.current - 24), animated: true });
    setNudge(true);
    setTimeout(() => setNudge(false), 900);
  }, []);

  const handleSubmit = useCallback(() => {
    if (!selectedReason) {
      nudgeReasons();
      return;
    }
    cancelMutation.mutate();
  }, [selectedReason, cancelMutation, nudgeReasons]);

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

        {/*
          `style={{ flex: 1 }}` is load-bearing, not decoration.

          BUGFIX ("the 'why are you cancelling' section seems to be cut off").
          A ScrollView with no flex inside a column parent sizes itself to its
          CONTENT, not to the space left over. So this grew past the screen,
          pushed the footer out of view and clipped its own tail — which is the
          reasons list, because that is what sits at the bottom. It never
          scrolled, because as far as layout was concerned it was not
          overflowing anything. Constraining it to the leftover space is what
          turns the overflow into a scroll.
        */}
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={[styles.scroll, { paddingBottom: spacing['3xl'] + keyboardInset }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <MotiView
            from={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', ...springs.standard }}
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
                {/**
                 * SAY WHAT IT COSTS, AND WHAT IT ACTUALLY COSTS.
                 *
                 * "Cancelling this ride is free" is true and unhelpful: it
                 * answers the money question and leaves the real one — is this
                 * going to be a problem? — for the rider to worry about alone.
                 * A rider who is not told is a rider who hesitates, and the ask
                 * was explicit: tell them they will not be charged, and that
                 * the only real cost is the wait for another car. That is the
                 * sentence that gives someone the liberty to book and change
                 * their mind, which is the behaviour we want.
                 */}
                <Text style={styles.policyText}>
                  {isFeeLoading
                    ? 'Checking cancellation policy…'
                    : isFeeError
                    ? "We couldn't check the fee for this ride just now. If one applies, it will be shown on your receipt."
                    : hasFee
                    ? `A cancellation fee of ${formatGhs(cancellationFeePesewas)} applies to this ride.`
                    : "You won't be charged a cancellation fee for this ride."}
                </Text>
                {!isFeeLoading && !isFeeError && !hasFee ? (
                  <Text style={styles.policyText}>
                    Finding another ride afterwards may take a little longer, especially at busy times.
                  </Text>
                ) : null}
                {/**
                 * The sub-line said `cancelFeeData.reason` — a field that has
                 * never existed on this response, so it never rendered. Say the
                 * thing the rider actually needs: WHY it is free, or what it is
                 * a fee for, in the units of whichever product this is.
                 */}
                {!isFeeLoading && !isFeeError && cancelFeeData ? (
                  <Text style={styles.policySub}>
                    {cancelFeeData.seatCount > 1
                      ? `This cancels all ${cancelFeeData.seatCount} of your seats. `
                      : ''}
                    {hasFee
                      ? 'Your driver was already on the way, so a share of their trip to you is charged.'
                      : cancelFeeData.freeCancelSeconds != null
                      ? `Free within ${Math.round(cancelFeeData.freeCancelSeconds / 60) || 1} minute${cancelFeeData.freeCancelSeconds >= 120 ? 's' : ''} of a driver accepting.`
                      : cancelFeeData.freeCancelMinutes != null
                      ? `Free up to ${cancelFeeData.freeCancelMinutes} minutes before departure.`
                      : ''}
                  </Text>
                ) : null}
              </View>
            </View>

            {/* Reason selection */}
            <View
              onLayout={(e) => { reasonsYRef.current = e.nativeEvent.layout.y; }}
              style={styles.reasonsHead}
            >
              <Text variant="titleSmall" style={styles.sectionTitle}>
                Why are you cancelling?
              </Text>
              {/**
               * REQUIRED, AND SAID SO BEFORE IT IS ENFORCED.
               *
               * BUGFIX — "on the 'why are you cancelling' section, it's easily
               * dismissable since it's under the Keep My Ride button section,
               * so the user might try and click on the grayed-out Cancel Ride
               * button but wouldn't notice that they need to scroll down and
               * pick one option first."
               *
               * The rule was expressed only as `disabled` on the destructive
               * button — a state with no voice. The rider taps, nothing
               * happens, and there is no way to learn why, because the cause is
               * off-screen behind the footer. A required field has to announce
               * itself where the requirement is, not only where it bites.
               */}
              <View style={[styles.requiredPill, selectedReason ? styles.requiredPillDone : null]}>
                <Ionicons
                  name={selectedReason ? 'checkmark' : 'alert-circle-outline'}
                  size={11}
                  color={selectedReason ? colors.statusSuccess : colors.statusWarning}
                />
                <Text
                  style={[
                    styles.requiredPillText,
                    { color: selectedReason ? colors.statusSuccess : colors.statusWarning },
                  ]}
                >
                  {selectedReason ? 'SELECTED' : 'REQUIRED'}
                </Text>
              </View>
            </View>
            <MotiView
              animate={{ scale: nudge ? 1.015 : 1 }}
              transition={{ type: 'spring', ...springs.accent }}
              style={[styles.reasonsContainer, nudge && styles.reasonsContainerNudged]}
            >
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
            </MotiView>

            {/* Note input for 'other' */}
            <AnimatePresence>
              {selectedReason === 'other' && (
                <MotiView
                  key="note-input"
                  from={{ opacity: 0, height: 0, marginTop: 0 }}
                  animate={{ opacity: 1, height: 132, marginTop: spacing.base }}
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  transition={{ type: 'spring', ...springs.standard }}
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

          {/* ENABLED even without a reason — see `nudgeReasons`. A disabled
              destructive button whose blocker is off-screen is a dead end; this
              one answers the tap by showing the rider what is missing. Only a
              request in flight genuinely disables it. */}
          <Pressable
            style={[styles.cancelButton, !selectedReason && styles.cancelButtonWaiting]}
            onPress={handleSubmit}
            disabled={cancelMutation.isPending}
            accessibilityRole="button"
            accessibilityState={{ disabled: cancelMutation.isPending }}
            accessibilityHint={
              selectedReason ? undefined : 'Choose a reason above before cancelling'
            }
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
              <Text style={[styles.cancelButtonText, !selectedReason && styles.cancelButtonTextWaiting]}>
                {selectedReason ? 'Cancel Ride' : 'Pick a reason first'}
              </Text>
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
    sectionTitle: { color: colors.onSurface },
    reasonsHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      marginBottom: spacing.base,
    },
    requiredPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderRadius: radii.full,
      backgroundColor: withOpacity(colors.statusWarning, 0.14),
    },
    requiredPillDone: { backgroundColor: withOpacity(colors.statusSuccess, 0.14) },
    requiredPillText: { fontFamily: fonts.bold, fontSize: 9, letterSpacing: 0.7 },
    reasonsContainer: { gap: spacing.sm, borderRadius: radii['2xl'] },
    /** A one-off pulse when the rider taps Cancel without having chosen. */
    reasonsContainerNudged: {
      backgroundColor: withOpacity(colors.statusWarning, 0.07),
    },
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
      // Never absorbed into the scroll area. Without this the footer is a
      // shrinkable flex child and an over-tall scroll region squeezed it — the
      // other half of the "cut off" report.
      flexShrink: 0,
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
    /**
     * Not greyed out — waiting. The distinction is the whole point: grey says
     * "you cannot", and the rider could, they just had not scrolled. This reads
     * as a neutral control with a prompt on it, and it still takes a press.
     */
    cancelButtonWaiting: {
      borderColor: colors.rimLightSubtle,
      backgroundColor: withOpacity(colors.onSurface, 0.04),
    },
    cancelButtonText: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.titleSmall,
      lineHeight: fontSizes.titleSmall * 1.3,
      color: colors.statusError,
    },
    cancelButtonTextWaiting: { color: colors.onSurfaceVariant },
  });
