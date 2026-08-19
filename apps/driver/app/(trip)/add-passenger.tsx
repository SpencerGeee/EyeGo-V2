import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { driverApi } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button, Entrance, AppBackground } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useDriverStore } from '../../stores/driver.store';

type Mode = 'select' | 'phone' | 'otp' | 'cash';

export default function AddPassengerScreen() {
  const colors = useColors();
  const theme = useDriverStore(s => s.theme);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const qc = useQueryClient();
  const { tripId } = useLocalSearchParams<{ tripId: string }>();

  const [mode, setMode] = useState<Mode>('select');
  const [phone, setPhone] = useState('');
  const [seatNumber, setSeatNumber] = useState<number>(1);
  const [otp, setOtp] = useState('');
  const [pendingBookingId, setPendingBookingId] = useState<string | null>(null);

  /**
   * WHICH SEATS ARE ACTUALLY FREE.
   *
   * The picker was a bare +/- stepper from 1 to a hardcoded 14 with no idea
   * what the vehicle held or who was already in it, so a driver could dial up
   * a seat someone was sitting in and only find out from a rejected request.
   *
   * Read from the same cache the trip screens fill, so opening this sheet
   * costs nothing when it is warm and still self-heals when it is not.
   */
  const { data: trip } = useQuery({
    queryKey: ['driver', 'trip', 'tracking', tripId],
    queryFn: () => driverApi.getTripById(tripId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (r: any) => r.data?.data?.trip ?? null,
    enabled: !!tripId,
    staleTime: 10_000,
  });

  const maxSeats: number = trip?.maxSeats ?? trip?.vehicle?.seatCapacity ?? 14;
  const takenSeats = useMemo(() => {
    const rows: any[] = trip?.bookings ?? [];
    return new Set(
      rows
        .filter((b) => !['CANCELLED', 'REFUNDED', 'EXPIRED', 'NO_SHOW'].includes(b.status))
        .map((b) => b.seatNumber)
        .filter((n): n is number => typeof n === 'number'),
    );
  }, [trip]);

  const firstFreeSeat = useMemo(() => {
    for (let n = 1; n <= maxSeats; n += 1) if (!takenSeats.has(n)) return n;
    return null;
  }, [maxSeats, takenSeats]);

  /** Next free seat in `dir`, or the current one if there is none that way. */
  const stepSeat = useCallback(
    (dir: 1 | -1) =>
      setSeatNumber((current) => {
        for (let n = current + dir; n >= 1 && n <= maxSeats; n += dir) {
          if (!takenSeats.has(n)) return n;
        }
        return current;
      }),
    [maxSeats, takenSeats],
  );

  const canStep = useCallback(
    (dir: 1 | -1) => {
      for (let n = seatNumber + dir; n >= 1 && n <= maxSeats; n += dir) {
        if (!takenSeats.has(n)) return true;
      }
      return false;
    },
    [seatNumber, maxSeats, takenSeats],
  );

  // Land on a free seat as soon as occupancy is known — seat 1 is the default
  // and is very often the one already sold.
  useEffect(() => {
    if (firstFreeSeat != null && takenSeats.has(seatNumber)) setSeatNumber(firstFreeSeat);
  }, [firstFreeSeat, takenSeats, seatNumber]);

  const addByPhone = useMutation({
    mutationFn: () =>
      driverApi.addOfflinePassenger(tripId, {
        seatNumber,
        phone: `+233${phone.replace(/\D/g, '')}`,
      }),
    onSuccess: (res) => {
      setPendingBookingId(res.data.data.bookingId);
      setMode('otp');
    },
    onError: (err) => Alert.alert('Error', (err as Error).message),
  });

  const verifyOtp = useMutation({
    mutationFn: () =>
      driverApi.verifyPassengerOtp(tripId, { bookingId: pendingBookingId!, otp }),
    onSuccess: () => {
      // Verified: the hold is now a real passenger and must not be released.
      pendingHoldRef.current = null;
      boardPassenger.mutate();
    },
    onError: (err) => Alert.alert('Invalid OTP', (err as Error).message),
  });

  /**
   * GIVE THE SEAT BACK WHEN THE DRIVER WALKS AWAY.
   *
   * BUGFIX ("I chose add rider → phone + OTP, which gave me the option to choose
   * the number and the seat, but I didn't go through with the OTP and it's still
   * showing that the seat is reserved").
   *
   * Creating the hold has to reserve the seat — otherwise two drivers sell the
   * same one — but nothing gave it back. Backing out of the OTP step, or leaving
   * the screen entirely, is the driver saying they are not going through with
   * it, and both now say so out loud.
   *
   * A ref rather than state: the release runs from an unmount cleanup, which
   * sees the values captured when its effect was created, and would otherwise
   * release a booking that had since been verified.
   */
  const pendingHoldRef = useRef<string | null>(null);
  useEffect(() => {
    pendingHoldRef.current = mode === 'otp' ? pendingBookingId : null;
  }, [mode, pendingBookingId]);

  /**
   * REFRESH, THEN LEAVE.
   *
   * `invalidateQueries` marks the trip stale and returns straight away, so the
   * old flow popped a modal, waited for a tap, dismissed — and dropped the
   * driver back onto an Earnings Estimate still showing the figure from before
   * the passenger existed. It corrected itself on the screen's 8-second poll,
   * which is long enough to read as "that didn't work" and tap again.
   *
   * Awaiting the refetch means the screen underneath is already correct at the
   * moment it is revealed. The confirmation modal goes with it: the seat
   * appearing in the seat map and the money going up IS the confirmation, and
   * it arrives a tap sooner.
   */
  const refreshTrip = useCallback(
    () =>
      qc.refetchQueries({
        predicate: (q) => {
          const k = q.queryKey as unknown[];
          return k[0] === 'driver' && k[1] === 'trip' && k[3] === tripId;
        },
      }),
    [qc, tripId],
  );

  const releaseHold = useCallback(() => {
    const bookingId = pendingHoldRef.current;
    if (!bookingId) return;
    pendingHoldRef.current = null;
    // Fire-and-forget: the driver is already leaving, and the server-side sweep
    // is the backstop if this never lands. See releaseOfflineHold.
    driverApi.releaseOfflineHold(tripId, bookingId).then(refreshTrip).catch(() => {});
  }, [tripId, refreshTrip]);

  // The screen being torn down for ANY reason — hardware back, swipe gesture, a
  // push that navigates elsewhere — is still an abandoned hold.
  useEffect(() => releaseHold, [releaseHold]);

  const boardPassenger = useMutation({
    mutationFn: () => driverApi.boardPassenger(tripId, pendingBookingId!),
    onSuccess: async () => {
      await refreshTrip();
      router.back();
    },
    onError: (err) => Alert.alert('Error', (err as Error).message ?? 'Failed to board passenger. Please try again.'),
  });

  const addCash = useMutation({
    mutationFn: () => driverApi.addCashPassenger(tripId, { seatNumber }),
    onSuccess: async () => {
      await refreshTrip();
      router.back();
    },
    onError: (err) => Alert.alert('Error', (err as Error).message),
  });

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground isDark={theme !== 'light'} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <Pressable
              onPress={() => {
                // Stepping back OUT of the OTP screen abandons the hold, and
                // says so now rather than leaving the seat sold to nobody.
                if (mode === 'otp') {
                  releaseHold();
                  setPendingBookingId(null);
                  setOtp('');
                }
                if (mode === 'select') router.back();
                else setMode('select');
              }}
              style={styles.backBtn}
            >
              <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
            </Pressable>
            <Text style={styles.headerTitle}>Add Passenger</Text>
            <View style={{ width: 36 }} />
          </View>

          {/* Mode: Select */}
          {mode === 'select' && (
            <Entrance animation="slideDown" style={styles.optionsContainer}>
              <Text style={styles.sectionTitle}>How is this passenger paying?</Text>
              <Pressable
                style={styles.optionCard}
                onPress={() => setMode('phone')}
        
              >
                <View style={[styles.optionIcon, { backgroundColor: `${colors.primary}22` }]}>
                  <Ionicons name="phone-portrait-outline" size={24} color={colors.primary} />
                </View>
                <View style={styles.optionInfo}>
                  <Text style={styles.optionTitle}>Phone + OTP</Text>
                  <Text variant="bodyMedium" color={colors.onSurfaceVariant}>
                    Enter their number → they receive OTP → verify before boarding.
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceVariant} />
              </Pressable>

              <Pressable
                style={styles.optionCard}
                onPress={() => setMode('cash')}
        
              >
                <View style={[styles.optionIcon, { backgroundColor: `${colors.online}22` }]}>
                  <Ionicons name="cash-outline" size={24} color={colors.online} />
                </View>
                <View style={styles.optionInfo}>
                  <Text style={styles.optionTitle}>Cash Passenger</Text>
                  <Text variant="bodyMedium" color={colors.onSurfaceVariant}>
                    No phone needed. Commission auto-deducted from fare.
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceVariant} />
              </Pressable>
            </Entrance>
          )}

          {/* Mode: Phone input */}
          {mode === 'phone' && (
            <Entrance animation="slideRight" style={styles.formContainer}>
              <Text style={styles.sectionTitle}>Passenger Details</Text>
              <View style={styles.fieldWrapper}>
                <Text variant="caption" color={colors.onSurfaceVariant} style={styles.fieldLabel}>
                  Phone number
                </Text>
                <View style={styles.phoneRow}>
                  <View style={styles.flagBox}>
                    <Text>🇬🇭</Text>
                    <Text style={styles.countryCode}>+233</Text>
                  </View>
                  <TextInput
                    style={styles.phoneInput}
                    value={phone}
                    onChangeText={(t) => setPhone(t.replace(/\D/g, '').slice(0, 9))}
                    keyboardType="number-pad"
                    placeholder="24X XXX XXXX"
                    placeholderTextColor={colors.onSurfaceVariant}
                    selectionColor={colors.primary}
                    maxLength={9}
                    autoFocus
                  />
                </View>
              </View>
              <SeatPicker seatNumber={seatNumber} onDecrement={() => stepSeat(-1)} onIncrement={() => stepSeat(1)} canDecrement={canStep(-1)} canIncrement={canStep(1)} takenCount={takenSeats.size} maxSeats={maxSeats} soldOut={firstFreeSeat == null} colors={colors} styles={styles} />
              <Button
                label="Send OTP to Passenger"
                onPress={() => addByPhone.mutate()}
                disabled={phone.length < 9}
                loading={addByPhone.isPending}
              />
            </Entrance>
          )}

          {/* Mode: OTP verify */}
          {mode === 'otp' && (
            <Entrance animation="slideRight" style={styles.formContainer}>
              <Text style={styles.sectionTitle}>Verify OTP</Text>
              <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.otpDesc}>
                Ask the passenger for the 4-digit code sent to their number.
              </Text>
              <TextInput
                style={styles.otpInput}
                value={otp}
                onChangeText={(t) => setOtp(t.replace(/\D/g, '').slice(0, 4))}
                keyboardType="number-pad"
                placeholder="_ _ _ _"
                placeholderTextColor={colors.onSurfaceVariant}
                selectionColor={colors.primary}
                maxLength={4}
                autoFocus
                textAlign="center"
              />
              <Button
                label="Verify & Board"
                onPress={() => verifyOtp.mutate()}
                disabled={otp.length < 4}
                loading={verifyOtp.isPending || boardPassenger.isPending}
              />
            </Entrance>
          )}

          {/* Mode: Cash */}
          {mode === 'cash' && (
            <Entrance animation="slideRight" style={styles.formContainer}>
              <Text style={styles.sectionTitle}>Cash Passenger</Text>
              <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.otpDesc}>
                Select the seat number for this passenger.
              </Text>
              <SeatPicker seatNumber={seatNumber} onDecrement={() => stepSeat(-1)} onIncrement={() => stepSeat(1)} canDecrement={canStep(-1)} canIncrement={canStep(1)} takenCount={takenSeats.size} maxSeats={maxSeats} soldOut={firstFreeSeat == null} colors={colors} styles={styles} />
              <Button
                label="Add Cash Passenger"
                onPress={() => addCash.mutate()}
                loading={addCash.isPending}
              />
            </Entrance>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * The stepper walks FREE seats only — `onDecrement`/`onIncrement` skip anything
 * occupied, and the arrow greys out when there is nothing free that way. The
 * driver cannot land on a taken seat, so there is no rejected request to
 * explain afterwards.
 */
function SeatPicker({
  seatNumber, onDecrement, onIncrement, canDecrement, canIncrement,
  takenCount, maxSeats, soldOut, colors, styles,
}: {
  seatNumber: number;
  onDecrement: () => void;
  onIncrement: () => void;
  canDecrement: boolean;
  canIncrement: boolean;
  takenCount: number;
  maxSeats: number;
  soldOut: boolean;
  colors: DriverColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.fieldWrapper}>
      <Text variant="caption" color={colors.onSurfaceVariant} style={styles.fieldLabel}>
        {soldOut
          ? 'Every seat is taken'
          : `Seat number · ${maxSeats - takenCount} of ${maxSeats} free`}
      </Text>
      <View style={styles.seatPickerRow}>
        <Pressable
          style={[styles.seatPickerBtn, !canDecrement && { opacity: 0.4 }]}
          onPress={onDecrement}
          disabled={!canDecrement}
          accessibilityRole="button"
          accessibilityLabel="Previous free seat"
        >
          <Ionicons name="remove" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.seatPickerValue}>{soldOut ? '—' : seatNumber}</Text>
        <Pressable
          style={[styles.seatPickerBtn, !canIncrement && { opacity: 0.4 }]}
          onPress={onIncrement}
          disabled={!canIncrement}
          accessibilityRole="button"
          accessibilityLabel="Next free seat"
        >
          <Ionicons name="add" size={22} color={colors.onSurface} />
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    scroll: { paddingBottom: 60 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.xl,
      paddingBottom: spacing.md,
    },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 12,
      backgroundColor: colors.surfaceContainer,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      fontFamily: fonts.displaySemiBold,
      fontSize: fontSizes.titleSmall,
      lineHeight: Math.round(fontSizes.titleSmall * 1.3),
      color: colors.onSurface,
    },
    optionsContainer: {
      paddingHorizontal: spacing['2xl'],
      gap: spacing.md,
    },
    sectionTitle: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.headlineMedium,
      lineHeight: Math.round(fontSizes.headlineMedium * 1.3),
      color: colors.onSurface,
      letterSpacing: -0.5,
      marginBottom: spacing.md,
    },
    optionCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      borderWidth: 1.5,
      borderColor: colors.outline,
      padding: spacing.base,
      gap: spacing.md,
    },
    optionIcon: {
      width: 48,
      height: 48,
      borderRadius: radii.lg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    optionInfo: { flex: 1 },
    optionTitle: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.3),
      color: colors.onSurface,
      marginBottom: 3,
    },
    formContainer: {
      paddingHorizontal: spacing['2xl'],
      gap: spacing.xl,
    },
    fieldWrapper: { gap: spacing.sm },
    fieldLabel: { marginLeft: spacing.xs },
    phoneRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.lg,
      borderWidth: 1.5,
      borderColor: colors.outline,
      height: 56,
      overflow: 'hidden',
    },
    flagBox: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.base,
      gap: spacing.xs,
    },
    countryCode: {
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.3),
      color: colors.onSurface,
    },
    phoneInput: {
      flex: 1,
      paddingHorizontal: spacing.sm,
      fontFamily: fonts.medium,
      fontSize: fontSizes.titleSmall,
      lineHeight: Math.round(fontSizes.titleSmall * 1.3),
      color: colors.onSurface,
      letterSpacing: 1,
    },
    otpDesc: { lineHeight: 22, marginTop: -spacing.sm },
    otpInput: {
      backgroundColor: colors.surfaceContainerHigh,
      borderRadius: radii.xl,
      borderWidth: 1.5,
      borderColor: colors.outline,
      height: 72,
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.display,
      lineHeight: Math.round(fontSizes.display * 1.3),
      color: colors.onSurface,
      letterSpacing: 12,
    },
    seatPickerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing['3xl'],
      backgroundColor: colors.surfaceContainerHigh,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outline,
      padding: spacing.lg,
    },
    seatPickerBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.surfaceContainerHighest,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.outline,
    },
    seatPickerValue: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.hero,
      lineHeight: Math.round(fontSizes.hero * 1.3),
      color: colors.primary,
      minWidth: 48,
      textAlign: 'center',
    },
  });
