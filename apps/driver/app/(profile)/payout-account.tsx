import React, { useState, useMemo, useEffect } from 'react';
import { View, StyleSheet, Pressable, TextInput, Modal, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, MOMO_NETWORKS, type MomoNetwork } from '@eyego/api';
import { describeError } from '@eyego/utils';
import { fonts, radii } from '@eyego/config';
import { Text, Button, Screen, ListSection, ListRow, goBack, notify } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../utils/useColors';

/**
 * Names chosen to match Paystack's GHS bank list on their distinctive words
 * (paystack.client.js bankKey) — "Ghana Commercial Bank" is "GCB Bank" there,
 * and "Other" could never be paid, so it is gone.
 */
const BANKS = [
  'Absa Bank', 'Access Bank', 'Agricultural Development Bank', 'Bank of Africa', 'CAL Bank',
  'Consolidated Bank Ghana', 'Ecobank', 'FBNBank', 'Fidelity Bank', 'First Atlantic Bank',
  'First National Bank', 'GCB Bank', 'Guaranty Trust Bank', 'National Investment Bank',
  'OmniBSIC Bank', 'Prudential Bank', 'Republic Bank', 'Societe Generale', 'Stanbic Bank',
  'Standard Chartered', 'United Bank for Africa', 'Zenith Bank',
];

type PayoutTab = 'momo' | 'bank';

/** Older saves stored the label ("MTN MoMo"); read any spelling back. */
function toNetwork(v: unknown): MomoNetwork | '' {
  const s = String(v ?? '');
  if (/mtn/i.test(s)) return 'MOMO_MTN';
  if (/voda|telecel/i.test(s)) return 'MOMO_TELECEL';
  if (/airtel|tigo/i.test(s)) return 'MOMO_AIRTELTIGO';
  return '';
}

/**
 * PAYOUT ACCOUNT — where cash outs go. Mobile money first (how most Ghanaian
 * drivers are paid), bank second. Checked here AND on the server, because a
 * bad account used to save fine and only fail at cash-out.
 */
export default function PayoutAccountScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [tab, setTab] = useState<PayoutTab>('momo');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [network, setNetwork] = useState<MomoNetwork | ''>('');
  const [phone, setPhone] = useState('');
  const [bankPicker, setBankPicker] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['payout-account'],
    queryFn: () => apiClient.get('/driver/wallet/payout-account'),
    // ok(res, account) nests the account under data.data.
    select: (r) => (r.data as any)?.data ?? null,
  });

  useEffect(() => {
    const d = data as any;
    if (d?.type === 'bank') {
      setTab('bank');
      setBankName(d.bankName ?? '');
      setAccountNumber(d.accountNumber ?? '');
      setAccountName(d.accountName ?? '');
    } else if (d?.type === 'momo') {
      setTab('momo');
      setNetwork(toNetwork(d.network));
      setPhone(d.phone ?? '');
      setAccountName(d.accountName ?? '');
    }
  }, [data]);

  const digits = phone.replace(/\D/g, '');
  const momoOk = !!network && /^0[235]\d{8}$/.test(digits);
  const bankOk = !!bankName && /^\d{6,20}$/.test(accountNumber.replace(/\s/g, '')) && accountName.trim().length >= 3;
  const valid = tab === 'momo' ? momoOk : bankOk;

  const { mutate: save, isPending } = useMutation({
    mutationFn: (payload: object) => apiClient.patch('/driver/wallet/payout-account', payload),
    onSuccess: (res) => {
      // Write the saved account straight in — the cache's 5-minute staleTime
      // otherwise served the pre-save answer on the next visit.
      const saved = (res.data as any)?.data;
      qc.setQueryData(['payout-account'], (old: any) => ({ ...(old ?? {}), data: { data: saved } }));
      qc.invalidateQueries({ queryKey: ['payout-account'] });
      notify('Payout account saved', 'Cash outs go here from now on.', { tone: 'success' });
      goBack();
    },
    onError: (err) => {
      const { title, message } = describeError(err, 'We could not save your payout account.');
      notify(title, message);
    },
  });

  const handleSave = () => {
    if (tab === 'momo') save({ type: 'momo', network, phone: digits, accountName: accountName.trim() || undefined });
    else save({ type: 'bank', bankName, accountNumber: accountNumber.replace(/\s/g, ''), accountName: accountName.trim() });
  };

  return (
    <>
      <Screen
        title="Payout account"
        subtitle="Where your cash outs are sent."
        keyboard
        footer={<Button label="Save" onPress={handleSave} disabled={!valid || isPending || isLoading} loading={isPending} />}
      >
        <View style={styles.segment} accessibilityRole="tablist">
          {(['momo', 'bank'] as const).map((t) => {
            const on = tab === t;
            return (
              <Pressable
                key={t}
                style={[styles.segmentBtn, on && styles.segmentOn]}
                onPress={() => setTab(t)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.segmentText, { color: on ? colors.onSurface : colors.onSurfaceVariant }]}>
                  {t === 'momo' ? 'Mobile money' : 'Bank'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {tab === 'momo' ? (
          <>
            <ListSection title="Network">
              {MOMO_NETWORKS.map((n) => (
                <ListRow
                  key={n.value}
                  title={n.label}
                  onPress={() => setNetwork(n.value)}
                  right={network === n.value ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : <View style={{ width: 20 }} />}
                  accessibilityLabel={`${n.label}${network === n.value ? ', selected' : ''}`}
                />
              ))}
            </ListSection>
            <Field label="Mobile money number" styles={styles}>
              <TextInput
                maxFontSizeMultiplier={1.4}
                style={styles.input}
                value={phone}
                onChangeText={(t) => setPhone(t.replace(/[^\d ]/g, '').slice(0, 12))}
                placeholder="024 123 4567"
                placeholderTextColor={colors.onSurfaceVariant}
                keyboardType="phone-pad"
                textContentType="telephoneNumber"
                autoComplete="tel"
                accessibilityLabel="Mobile money number"
              />
            </Field>
            {phone.length > 0 && !/^0[235]\d{8}$/.test(digits) ? (
              <Text style={styles.hint}>Ten digits, starting 02, 03 or 05.</Text>
            ) : null}
            <Field label="Name on the wallet (optional)" styles={styles}>
              <TextInput
                maxFontSizeMultiplier={1.4}
                style={styles.input}
                value={accountName}
                onChangeText={setAccountName}
                placeholder="As registered with your network"
                placeholderTextColor={colors.onSurfaceVariant}
                autoCapitalize="words"
                accessibilityLabel="Name on the wallet"
              />
            </Field>
          </>
        ) : (
          <>
            <ListSection title="Bank">
              <ListRow
                icon="business-outline"
                title={bankName || 'Choose your bank'}
                onPress={() => setBankPicker(true)}
                accessibilityLabel={bankName ? `Bank, ${bankName}. Change` : 'Choose your bank'}
              />
            </ListSection>
            <Field label="Account number" styles={styles}>
              <TextInput
                maxFontSizeMultiplier={1.4}
                style={styles.input}
                value={accountNumber}
                onChangeText={(t) => setAccountNumber(t.replace(/[^\d ]/g, '').slice(0, 24))}
                placeholder="Digits only"
                placeholderTextColor={colors.onSurfaceVariant}
                keyboardType="number-pad"
                accessibilityLabel="Account number"
              />
            </Field>
            <Field label="Name on the account" styles={styles}>
              <TextInput
                maxFontSizeMultiplier={1.4}
                style={styles.input}
                value={accountName}
                onChangeText={setAccountName}
                placeholder="Exactly as the bank has it"
                placeholderTextColor={colors.onSurfaceVariant}
                autoCapitalize="words"
                accessibilityLabel="Name on the account"
              />
            </Field>
          </>
        )}

        <Text style={styles.note}>
          Payouts are sent through Paystack. The name must match the account, or the transfer is returned to your EyeGo balance.
        </Text>
      </Screen>

      <Modal visible={bankPicker} transparent animationType="slide" onRequestClose={() => setBankPicker(false)} statusBarTranslucent>
        <Pressable style={styles.overlay} onPress={() => setBankPicker(false)} accessibilityLabel="Close bank list" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Choose your bank</Text>
          <ScrollView>
            {BANKS.map((b) => (
              <ListRow
                key={b}
                title={b}
                onPress={() => {
                  setBankName(b);
                  setBankPicker(false);
                }}
                right={bankName === b ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : undefined}
                chevron={false}
              />
            ))}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

function Field({ label, children, styles }: { label: string; children: React.ReactNode; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.field}>
      <Text variant="labelCaps" style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const makeStyles = (c: DriverColors) =>
  StyleSheet.create({
    segment: {
      flexDirection: 'row',
      marginTop: 12,
      marginHorizontal: 20,
      padding: 3,
      borderRadius: radii.full,
      backgroundColor: c.surfaceContainer,
    },
    segmentBtn: { flex: 1, height: 36, borderRadius: radii.full, alignItems: 'center', justifyContent: 'center' },
    segmentOn: { backgroundColor: c.surfaceContainerHighest },
    segmentText: { fontFamily: fonts.semiBold, fontSize: 14, lineHeight: 18 },
    field: { marginTop: 24, paddingHorizontal: 20 },
    fieldLabel: { marginBottom: 8 },
    input: {
      fontFamily: fonts.medium,
      fontSize: 16,
      color: c.onSurface,
      backgroundColor: c.surfaceContainer,
      borderRadius: radii.lg,
      paddingHorizontal: 16,
      height: 52,
    },
    hint: { paddingHorizontal: 20, marginTop: 6, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: c.error },
    note: { paddingHorizontal: 20, marginTop: 24, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: c.onSurfaceVariant },
    overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      maxHeight: '75%',
      backgroundColor: c.surfaceContainerHigh,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
    },
    sheetHandle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: c.outline, marginTop: 8 },
    sheetTitle: { fontFamily: fonts.displayBold, fontSize: 18, lineHeight: 24, color: c.onSurface, paddingHorizontal: 20, paddingVertical: 14 },
  });
