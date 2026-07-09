import React, { useState, useMemo } from 'react';
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
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { driverApi } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button, Entrance, AppBackground } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../utils/useColors';

type Mode = 'select' | 'phone' | 'otp' | 'cash';

export default function AddPassengerScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const qc = useQueryClient();
  const { tripId } = useLocalSearchParams<{ tripId: string }>();

  const [mode, setMode] = useState<Mode>('select');
  const [phone, setPhone] = useState('');
  const [seatNumber, setSeatNumber] = useState<number>(1);
  const [otp, setOtp] = useState('');
  const [pendingBookingId, setPendingBookingId] = useState<string | null>(null);

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
      boardPassenger.mutate();
    },
    onError: (err) => Alert.alert('Invalid OTP', (err as Error).message),
  });

  const boardPassenger = useMutation({
    mutationFn: () => driverApi.boardPassenger(tripId, pendingBookingId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['driver', 'trip', tripId] });
      Alert.alert('Boarded!', 'Passenger has been boarded successfully.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    },
  });

  const addCash = useMutation({
    mutationFn: () => driverApi.addCashPassenger(tripId, { seatNumber }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['driver', 'trip', tripId] });
      Alert.alert('Added!', 'Cash passenger has been added.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    },
    onError: (err) => Alert.alert('Error', (err as Error).message),
  });

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground variant="static" />
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
              onPress={() => (mode === 'select' ? router.back() : setMode('select'))}
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
              <SeatPicker seatNumber={seatNumber} onDecrement={() => setSeatNumber((s) => Math.max(1, s - 1))} onIncrement={() => setSeatNumber((s) => Math.min(14, s + 1))} colors={colors} styles={styles} />
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
              <SeatPicker seatNumber={seatNumber} onDecrement={() => setSeatNumber((s) => Math.max(1, s - 1))} onIncrement={() => setSeatNumber((s) => Math.min(14, s + 1))} colors={colors} styles={styles} />
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

function SeatPicker({ seatNumber, onDecrement, onIncrement, colors, styles }: {
  seatNumber: number;
  onDecrement: () => void;
  onIncrement: () => void;
  colors: DriverColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.fieldWrapper}>
      <Text variant="caption" color={colors.onSurfaceVariant} style={styles.fieldLabel}>
        Seat number
      </Text>
      <View style={styles.seatPickerRow}>
        <Pressable
          style={[styles.seatPickerBtn, seatNumber <= 1 && { opacity: 0.4 }]}
          onPress={onDecrement}
          disabled={seatNumber <= 1}
        >
          <Ionicons name="remove" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.seatPickerValue}>{seatNumber}</Text>
        <Pressable
          style={[styles.seatPickerBtn, seatNumber >= 14 && { opacity: 0.4 }]}
          onPress={onIncrement}
          disabled={seatNumber >= 14}
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
      color: colors.onSurface,
    },
    optionsContainer: {
      paddingHorizontal: spacing['2xl'],
      gap: spacing.md,
    },
    sectionTitle: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.headlineMedium,
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
      color: colors.onSurface,
    },
    phoneInput: {
      flex: 1,
      paddingHorizontal: spacing.sm,
      fontFamily: fonts.medium,
      fontSize: fontSizes.titleSmall,
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
