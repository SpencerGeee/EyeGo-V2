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
import { Text, Button, Input, goDeeper, goBack, notify } from '@eyego/ui';
import { formatGhs, pesewasFromCedis } from "@eyego/utils";
import { pickPhoneContact, normaliseGhPhone } from '../../utils/contacts';

export default function SendMoneyScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const queryClient = useQueryClient();
  // `amount` arrives in CEDIS from a scanned pay code that named a figure — see
  // My Code in scan-pay. Prefilled, never locked: the payer still has to read it
  // and press send, so a QR code can never decide what leaves their wallet.
  const { phone: prefilledPhone, amount: prefilledAmount } =
    useLocalSearchParams<{ phone?: string; amount?: string }>();

  const [phone, setPhone] = useState(prefilledPhone ?? '');
  const [amount, setAmount] = useState(prefilledAmount ?? '');

  const { data: balance } = useQuery({
    queryKey: queryKeys.wallet.balance(),
    queryFn: () => walletApi.getBalance(),
    select: (r: any) => r.data?.data?.balancePesewas ?? 0,
  });

  const sendMutation = useMutation({
    mutationFn: () => walletApi.sendMoney({ recipientPhone: phone.trim(), amountPesewas: pesewasFromCedis(parseFloat(amount)) }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.wallet.balance() });
      notify('Credits sent', res?.data?.message ?? 'Their next ride is on you.', { tone: 'success' });
    },
    onError: (err: any) => {
      const code = err?.response?.data?.errors?.[0]?.code ?? err?.response?.data?.code;
      const message =
        code === 'RECIPIENT_NOT_FOUND' ? "That number isn't on EyeGo yet — credits can only go to someone with an EyeGo account."
        : code === 'INSUFFICIENT_WALLET' ? "You don't have enough credits for that. Top up first."
        : code === 'SELF_TRANSFER' ? 'These are already your credits.'
        : err?.response?.data?.message ?? 'Could not send those credits. Please try again.';
      notify("Couldn't send credits", message);
    },
  });

  /**
   * The address book stores the same subscriber four different ways, so the
   * picked number is normalised before it lands in the field: the server
   * resolves every spelling, but this screen’s own length check does not,
   * and a number shown back with the contact’s spacing is harder to check.
   */
  const handlePickContact = async () => {
    const result = await pickPhoneContact();
    if (result.status === 'picked') {
      setPhone(normaliseGhPhone(result.contact.phone));
      return;
    }
    if (result.status === 'no-number') {
      notify('No number saved', `${result.name ?? 'That contact'} has no phone number in your contacts.`);
      return;
    }
    if (result.status === 'unavailable') {
      notify(null, 'Could not open contacts. You can still type the number below.');
    }
  };

  const handleSend = () => {
    const trimmedPhone = phone.trim();
    const amt = pesewasFromCedis(parseFloat(amount));
    if (trimmedPhone.length < 9) {
      notify('Check the number', "Enter the EyeGo phone number of the person you're sending credits to.");
      return;
    }
    if (!amt || amt <= 0) {
      notify('Check the amount', 'Enter how many credits to send.');
      return;
    }
    if (typeof balance === 'number' && amt > balance) {
      notify('Not enough credits', `You have ${formatGhs(balance)} in credits. Top up to send more.`);
      return;
    }
    /**
     * SAY WHAT CREDITS ARE, AT THE POINT OF NO RETURN.
     *
     * They are spendable on EyeGo fares and nothing else — a rider wallet has
     * no withdraw endpoint (only drivers do), which is precisely why calling
     * this "Send Money" was misleading. The confirm step is the one moment the
     * sender is guaranteed to read, so the rule is stated here rather than
     * buried in terms nobody opens.
     */
    Alert.alert(
      'Send these credits?',
      `${formatGhs(amt)} in ride credits will move to ${trimmedPhone}.

` +
        'They can spend it on EyeGo fares. Credits cannot be cashed out, and this cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send credits', onPress: () => sendMutation.mutate() },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack()} style={styles.backBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
        </Pressable>
        <Text variant="titleMedium" style={styles.headerTitle}>Send Ride Credits</Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAwareScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" bottomOffset={24}>
        <View style={styles.balanceCard}>
          <Text variant="caption" color={colors.onSurfaceVariant}>Your ride credits</Text>
          <Text style={styles.balanceText}>{formatGhs(typeof balance === 'number' ? balance : 0)}</Text>
        </View>

        {/**
         * ── THIS IS NOT A MONEY TRANSFER, AND IT NEVER WAS ────────────────
         *
         * BUGFIX ("the send money option in the wallet page is very misleading —
         * customers wouldn't be able to send money to anyone; they might be able
         * to send credits to a fellow EyeGo rider so they can pay for their
         * ride, and that's it").
         *
         * Exactly right, and the code already worked that way: the endpoint only
         * ever resolves a recipient who has an EyeGo account, and a rider wallet
         * has no withdraw route at all — `POST /wallet/withdraw` is
         * driver-only, behind driver auth, and pays out to a driver's payout
         * account. So the balance can be topped up and spent on fares, and that
         * is the whole of it.
         *
         * The name promised a P2P cash rail we do not operate and must not look
         * like we operate: a rider who believes they can move money through
         * EyeGo has been misled about a financial product, and the first person
         * to find out otherwise is whoever tries to take it out again.
         *
         * Nothing about the mechanics changed. The screen now says what the
         * mechanics have always been.
         */}
        <View style={styles.explainer}>
          <Ionicons name="information-circle-outline" size={18} color={colors.primary} style={{ marginTop: 1 }} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="label" color={colors.onSurface}>Credits, not cash</Text>
            <Text variant="caption" color={colors.onSurfaceVariant} style={{ lineHeight: 17 }}>
              Ride credits are bought with money and spent on EyeGo fares. You can pass them to
              anyone with an EyeGo account so their next ride is on you — but they can’t be
              withdrawn to a bank or mobile money wallet, by you or by them.
            </Text>
          </View>
        </View>

        <View style={styles.form}>
          <Input
            label="Their EyeGo phone number"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="0XX XXX XXXX"
            leftIcon={<Ionicons name="person-outline" size={20} color={colors.onSurfaceVariant} />}
            /* Typing ten digits from memory is the slowest thing this screen
               asks for, and the one most likely to send credits to a stranger. */
            rightIcon={(
              <Pressable
                onPress={handlePickContact}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Choose from contacts"
              >
                <Ionicons name="people-outline" size={20} color={colors.primary} />
              </Pressable>
            )}
          />
          <Input
            label="How many credits (GHS)"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="0.00"
            leftIcon={<Ionicons name="cash-outline" size={20} color={colors.onSurfaceVariant} />}
          />
          <Pressable
            style={styles.scanLink}
            onPress={() => goDeeper('/profile/scan-pay' as any)}
            accessibilityRole="button"
          >
            <Ionicons name="qr-code-outline" size={16} color={colors.primary} />
            <Text variant="label" color={colors.primary}>Scan a QR code instead</Text>
          </Pressable>
        </View>

        <Button
          label="Send Credits"
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
  /** "Credits, not cash" — the sentence that stops this reading as a cash rail. */
  explainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.base,
    padding: spacing.base,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: withOpacity(colors.primary, 0.22),
    backgroundColor: withOpacity(colors.primary, 0.07),
  },
});
