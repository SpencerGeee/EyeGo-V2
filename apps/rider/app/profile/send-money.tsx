import React, { useState } from 'react';
import { View, StyleSheet, Pressable, Alert } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { walletApi, queryKeys } from '@eyego/api';
import { Button, Input, Screen, ListSection, ListRow, goBack, notify } from '@eyego/ui';
import { formatGhs, pesewasFromCedis } from '@eyego/utils';
import { useColors } from '../../utils/useColors';
import { pickPhoneContact, normaliseGhPhone } from '../../utils/contacts';
import { useWalletBalance } from '../../hooks/useWalletBalance';

/**
 * SEND RIDE CREDITS — wallet balance to another EyeGo rider. Credits, not
 * cash: a rider wallet has no withdraw route, so the page says so at the top
 * and again at the point of no return.
 */
export default function SendMoneyScreen() {
  const colors = useColors();
  const qc = useQueryClient();
  // `amount` arrives in CEDIS from a scanned pay code. Prefilled, never
  // locked — a QR code can never decide what leaves the wallet.
  const { phone: prefilledPhone, amount: prefilledAmount } = useLocalSearchParams<{ phone?: string; amount?: string }>();
  const [phone, setPhone] = useState(prefilledPhone ?? '');
  const [amount, setAmount] = useState(prefilledAmount ?? '');
  const { data: balance } = useWalletBalance();

  const send = useMutation({
    mutationFn: () => walletApi.sendMoney({ recipientPhone: phone.trim(), amountPesewas: pesewasFromCedis(parseFloat(amount)) }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: queryKeys.wallet.balance() });
      qc.invalidateQueries({ queryKey: queryKeys.wallet.transactions() });
      notify('Credits sent', res?.data?.message ?? 'Their next ride is on you.', { tone: 'success' });
      setAmount('');
      goBack();
    },
    onError: (err: any) => {
      const code = err?.response?.data?.errors?.[0]?.code ?? err?.response?.data?.code;
      const message =
        code === 'RECIPIENT_NOT_FOUND' ? 'That number isn’t on EyeGo yet — credits can only go to someone with an EyeGo account.'
        : code === 'INSUFFICIENT_WALLET' ? 'You don’t have enough credits for that. Top up first.'
        : code === 'SELF_TRANSFER' ? 'These are already your credits.'
        : err?.response?.data?.message ?? 'Couldn’t send those credits. Please try again.';
      notify('Couldn’t send credits', message);
    },
  });

  const pickContact = async () => {
    const result = await pickPhoneContact();
    if (result.status === 'picked') setPhone(normaliseGhPhone(result.contact.phone));
    else if (result.status === 'no-number') notify('No number saved', `${result.name ?? 'That contact'} has no phone number.`);
    else if (result.status === 'unavailable') notify(null, 'Couldn’t open contacts. You can type the number instead.');
  };

  const amt = pesewasFromCedis(parseFloat(amount));
  const handleSend = () => {
    const to = phone.trim();
    if (to.replace(/\D/g, '').length < 9) {
      notify('Check the number', 'Enter the EyeGo phone number of the person you’re sending credits to.');
      return;
    }
    if (!amt || amt <= 0) {
      notify('Check the amount', 'Enter how many credits to send.');
      return;
    }
    if (typeof balance === 'number' && amt > balance) {
      notify('Not enough credits', `You have ${formatGhs(balance)}. Top up to send more.`);
      return;
    }
    Alert.alert(
      'Send these credits?',
      `${formatGhs(amt)} in ride credits will move to ${to}.\n\nThey can spend it on EyeGo fares. Credits can’t be cashed out, and this can’t be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send credits', onPress: () => send.mutate() },
      ],
    );
  };

  return (
    <Screen
      title="Send credits"
      subtitle="Pay for a friend’s ride from your EyeGo balance."
      keyboard
      footer={<Button label={amt > 0 ? `Send ${formatGhs(amt)}` : 'Send'} onPress={handleSend} loading={send.isPending} disabled={send.isPending} />}
    >
      <ListSection footer="Credits are bought with money and spent on fares. They can’t be withdrawn to a bank or mobile money — by you or by them.">
        <ListRow icon="wallet-outline" title="Your credits" value={typeof balance === 'number' ? formatGhs(balance) : '—'} valueColor={colors.onSurface} />
      </ListSection>

      <View style={styles.form}>
        <Input
          label="Their EyeGo phone number"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          placeholder="024 123 4567"
          leftIcon={<Ionicons name="person-outline" size={20} color={colors.onSurfaceVariant} />}
          rightIcon={
            <Pressable onPress={pickContact} hitSlop={10} accessibilityRole="button" accessibilityLabel="Choose from contacts">
              <Ionicons name="people-outline" size={20} color={colors.primary} />
            </Pressable>
          }
        />
        <Input
          label="Amount (GH₵)"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0.00"
          leftIcon={<Ionicons name="cash-outline" size={20} color={colors.onSurfaceVariant} />}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { paddingHorizontal: 20, marginTop: 24, gap: 16 },
});
