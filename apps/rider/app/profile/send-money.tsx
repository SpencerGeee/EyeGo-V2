import React, { useState, useMemo } from 'react';
import { View, StyleSheet, Pressable, Alert } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { walletApi, queryKeys } from '@eyego/api';
import { fonts, fontSizes, spacing, radii, withOpacity } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, Button, Input } from '@eyego/ui';
import { formatCurrency } from '@eyego/utils';

export default function SendMoneyScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { phone: prefilledPhone } = useLocalSearchParams<{ phone?: string }>();

  const [phone, setPhone] = useState(prefilledPhone ?? '');
  const [amount, setAmount] = useState('');

  const { data: balance } = useQuery({
    queryKey: queryKeys.wallet.balance(),
    queryFn: () => walletApi.getBalance(),
    select: (r: any) => r.data?.data?.balance ?? 0,
  });

  const sendMutation = useMutation({
    mutationFn: () => walletApi.sendMoney({ recipientPhone: phone.trim(), amount: parseFloat(amount) }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.wallet.balance() });
      Alert.alert('Sent!', res?.data?.message ?? 'Money sent successfully.', [
        { text: 'Done', onPress: () => router.back() },
      ]);
    },
    onError: (err: any) => {
      const code = err?.response?.data?.errors?.[0]?.code ?? err?.response?.data?.code;
      const message =
        code === 'RECIPIENT_NOT_FOUND' ? 'No EyeGo user found with that phone number.'
        : code === 'INSUFFICIENT_WALLET' ? "You don't have enough wallet balance for this transfer."
        : code === 'SELF_TRANSFER' ? 'You cannot send money to yourself.'
        : err?.response?.data?.message ?? 'Could not send money. Please try again.';
      Alert.alert('Send Failed', message);
    },
  });

  const handleSend = () => {
    const trimmedPhone = phone.trim();
    const amt = parseFloat(amount);
    if (trimmedPhone.length < 9) {
      Alert.alert('Invalid Phone', 'Please enter a valid recipient phone number.');
      return;
    }
    if (!amt || amt <= 0) {
      Alert.alert('Invalid Amount', 'Please enter an amount greater than 0.');
      return;
    }
    if (typeof balance === 'number' && amt > balance) {
      Alert.alert('Insufficient Balance', `You only have ${formatCurrency(balance)} in your wallet.`);
      return;
    }
    Alert.alert(
      'Confirm Transfer',
      `Send ${formatCurrency(amt)} to ${trimmedPhone}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send', onPress: () => sendMutation.mutate() },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
        </Pressable>
        <Text variant="titleMedium" style={styles.headerTitle}>Send Money</Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAwareScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" bottomOffset={24}>
        <View style={styles.balanceCard}>
          <Text variant="caption" color={colors.onSurfaceVariant}>Available Balance</Text>
          <Text style={styles.balanceText}>{formatCurrency(typeof balance === 'number' ? balance : 0)}</Text>
        </View>

        <View style={styles.form}>
          <Input
            label="Recipient Phone Number"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="0XX XXX XXXX"
            leftIcon={<Ionicons name="person-outline" size={20} color={colors.onSurfaceVariant} />}
          />
          <Input
            label="Amount (GHS)"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="0.00"
            leftIcon={<Ionicons name="cash-outline" size={20} color={colors.onSurfaceVariant} />}
          />
          <Pressable
            style={styles.scanLink}
            onPress={() => router.push('/profile/scan-pay' as any)}
            accessibilityRole="button"
          >
            <Ionicons name="qr-code-outline" size={16} color={colors.primary} />
            <Text variant="label" color={colors.primary}>Scan a QR code instead</Text>
          </Pressable>
        </View>

        <Button
          label="Send Money"
          onPress={handleSend}
          loading={sendMutation.isPending}
          style={{ marginTop: spacing.xl }}
        />
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.md,
  },
  headerTitle: { color: colors.onSurface, fontFamily: fonts.bold },
  backBtn: {
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
    paddingTop: spacing.md,
    paddingBottom: spacing['3xl'],
  },
  balanceCard: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.rimLight,
    padding: spacing.lg,
    marginBottom: spacing.xl,
    gap: spacing.xs,
  },
  balanceText: {
    fontFamily: fonts.bold,
    fontSize: 28,
    lineHeight: 34,
    color: colors.primary,
  },
  form: { gap: spacing.md },
  scanLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'center',
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
});
