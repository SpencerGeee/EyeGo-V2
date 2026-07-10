import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Modal,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button, AppBackground } from '@eyego/ui';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useDriverStore } from '../../stores/driver.store';
import { apiClient } from '@eyego/api';
import { useQuery, useMutation } from '@tanstack/react-query';

const BANKS = [
  'Ghana Commercial Bank',
  'Ecobank',
  'Fidelity Bank',
  'Standard Chartered',
  'Absa Bank',
  'Agricultural Development Bank',
  'Other',
];

const NETWORKS = ['MTN MoMo', 'Telecel Cash', 'AirtelTigo Money'];

type PayoutTab = 'bank' | 'momo';

export default function PayoutAccountScreen() {
  const colors = useColors();
  const theme = useDriverStore(s => s.theme);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();

  const [tab, setTab] = useState<PayoutTab>('bank');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [network, setNetwork] = useState('');
  const [phone, setPhone] = useState('');

  const [bankModalVisible, setBankModalVisible] = useState(false);
  const [networkModalVisible, setNetworkModalVisible] = useState(false);

  const { data } = useQuery({
    queryKey: ['payout-account'],
    queryFn: () => apiClient.get('/driver/wallet/payout-account'),
    // Backend getPayoutAccount → ok(res, account) nests the account under
    // response.data.data. Without this select, `data` is the raw axios response
    // and the account fields (one level deeper) never pre-filled the form, so a
    // returning driver saw blanks and could silently overwrite a saved account.
    select: (r) => (r.data as any)?.data ?? null,
  });

  useEffect(() => {
    if (data) {
      const d = data as any;
      if (d?.type === 'bank') {
        setTab('bank');
        setBankName(d.bankName ?? '');
        setAccountNumber(d.accountNumber ?? '');
        setAccountName(d.accountName ?? '');
      } else if (d?.type === 'momo') {
        setTab('momo');
        setNetwork(d.network ?? '');
        setPhone(d.phone ?? '');
      }
    }
  }, [data]);

  const { mutate: save, isPending } = useMutation({
    mutationFn: (payload: object) => apiClient.patch('/driver/wallet/payout-account', payload),
    onSuccess: () => {
      Alert.alert('Saved successfully');
      router.back();
    },
    onError: (err: any) => {
      Alert.alert('Error', err?.message ?? 'Failed to save payout account.');
    },
  });

  const renderBankItem = useCallback(({ item }: { item: string }) => (
    <Pressable
      style={styles.modalItem}
      onPress={() => { setBankName(item); setBankModalVisible(false); }}
    >
      <Text variant="bodyMedium" color={colors.onSurface}>{item}</Text>
      {bankName === item && <Ionicons name="checkmark" size={18} color={colors.primary} />}
    </Pressable>
  ), [styles, colors, bankName]);

  const renderNetworkItem = useCallback(({ item }: { item: string }) => (
    <Pressable
      style={styles.modalItem}
      onPress={() => { setNetwork(item); setNetworkModalVisible(false); }}
    >
      <Text variant="bodyMedium" color={colors.onSurface}>{item}</Text>
      {network === item && <Ionicons name="checkmark" size={18} color={colors.primary} />}
    </Pressable>
  ), [styles, colors, network]);

  const handleSave = () => {
    if (tab === 'bank') {
      save({ type: 'bank', bankName, accountNumber, accountName });
    } else {
      save({ type: 'momo', network, phone });
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground isDark={theme !== 'light'} />
      <MotiView
        from={{ opacity: 0, translateX: -6 }}
        animate={{ opacity: 1, translateX: 0 }}
        transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        style={styles.backRow}
      >
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant}>← Back</Text>
        </Pressable>
      </MotiView>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <MotiView
            from={{ opacity: 0, translateY: -6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 40 }}
          >
            <Text variant="headlineLarge" style={styles.headline}>Payout Account</Text>
          </MotiView>

          <MotiView
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 80 }}
          >
            {/* Tab Toggle */}
            <View style={styles.tabRow}>
              <Pressable
                style={[styles.tab, tab === 'bank' && styles.tabActive]}
                onPress={() => setTab('bank')}
              >
                <Text
                  variant="bodyMedium"
                  style={{ fontFamily: tab === 'bank' ? fonts.bold : fonts.regular, color: tab === 'bank' ? colors.primary : colors.onSurfaceVariant }}
                >
                  Bank Account
                </Text>
              </Pressable>
              <Pressable
                style={[styles.tab, tab === 'momo' && styles.tabActive]}
                onPress={() => setTab('momo')}
              >
                <Text
                  variant="bodyMedium"
                  style={{ fontFamily: tab === 'momo' ? fonts.bold : fonts.regular, color: tab === 'momo' ? colors.primary : colors.onSurfaceVariant }}
                >
                  Mobile Money
                </Text>
              </Pressable>
            </View>

            {tab === 'bank' ? (
              <View style={styles.card}>
                <Text variant="labelMedium" color={colors.onSurfaceVariant} style={styles.fieldLabel}>Bank</Text>
                <Pressable style={styles.picker} onPress={() => setBankModalVisible(true)}>
                  <Text variant="bodyMedium" color={bankName ? colors.onSurface : colors.onSurfaceVariant}>
                    {bankName || 'Select bank'}
                  </Text>
                  <Ionicons name="chevron-down" size={18} color={colors.onSurfaceVariant} />
                </Pressable>

                <Text variant="labelMedium" color={colors.onSurfaceVariant} style={styles.fieldLabel}>Account Number</Text>
                <TextInput
                  style={styles.input}
                  value={accountNumber}
                  onChangeText={setAccountNumber}
                  placeholder="Enter account number"
                  placeholderTextColor={colors.onSurfaceVariant}
                  keyboardType="numeric"
                />

                <Text variant="labelMedium" color={colors.onSurfaceVariant} style={styles.fieldLabel}>Account Name</Text>
                <TextInput
                  style={styles.input}
                  value={accountName}
                  onChangeText={setAccountName}
                  placeholder="Enter account name"
                  placeholderTextColor={colors.onSurfaceVariant}
                />
              </View>
            ) : (
              <View style={styles.card}>
                <Text variant="labelMedium" color={colors.onSurfaceVariant} style={styles.fieldLabel}>Network</Text>
                <Pressable style={styles.picker} onPress={() => setNetworkModalVisible(true)}>
                  <Text variant="bodyMedium" color={network ? colors.onSurface : colors.onSurfaceVariant}>
                    {network || 'Select network'}
                  </Text>
                  <Ionicons name="chevron-down" size={18} color={colors.onSurfaceVariant} />
                </Pressable>

                <Text variant="labelMedium" color={colors.onSurfaceVariant} style={styles.fieldLabel}>Phone Number</Text>
                <TextInput
                  style={styles.input}
                  value={phone}
                  onChangeText={(t) => setPhone(t.slice(0, 10))}
                  placeholder="0XX XXX XXXX"
                  placeholderTextColor={colors.onSurfaceVariant}
                  keyboardType="numeric"
                  maxLength={10}
                />
              </View>
            )}

            <Button label={isPending ? 'Saving…' : 'Save Payout Account'} onPress={handleSave} disabled={isPending} />
          </MotiView>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Bank Picker Modal */}
      <Modal visible={bankModalVisible} transparent animationType="slide" onRequestClose={() => setBankModalVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setBankModalVisible(false)}>
          <View style={styles.modalSheet}>
            <Text variant="titleMedium" color={colors.onSurface} style={styles.modalTitle}>Select Bank</Text>
            <FlatList
              data={BANKS}
              keyExtractor={(item) => item}
              renderItem={renderBankItem}
            />
          </View>
        </Pressable>
      </Modal>

      {/* Network Picker Modal */}
      <Modal visible={networkModalVisible} transparent animationType="slide" onRequestClose={() => setNetworkModalVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setNetworkModalVisible(false)}>
          <View style={styles.modalSheet}>
            <Text variant="titleMedium" color={colors.onSurface} style={styles.modalTitle}>Select Network</Text>
            <FlatList
              data={NETWORKS}
              keyExtractor={(item) => item}
              renderItem={renderNetworkItem}
            />
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (colors: DriverColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  backRow: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.base },
  scroll: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.xl, paddingBottom: spacing['3xl'] },
  headline: { letterSpacing: -1, marginBottom: spacing['2xl'] },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii['2xl'],
    borderWidth: 1,
    borderColor: colors.outline,
    marginBottom: spacing.xl,
    overflow: 'hidden',
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderRadius: radii['2xl'],
  },
  tabActive: {
    backgroundColor: `${colors.primary}18`,
  },
  card: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii['2xl'],
    borderWidth: 1,
    borderColor: colors.outline,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    marginBottom: spacing.xl,
  },
  fieldLabel: { marginBottom: spacing.xs, marginTop: spacing.sm },
  input: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodyMedium,
    lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
    color: colors.onSurface,
    borderWidth: 1,
    borderColor: colors.outline,
    borderRadius: radii.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.backgroundDeep,
  },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.outline,
    borderRadius: radii.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.backgroundDeep,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surfaceContainer,
    borderTopLeftRadius: radii['2xl'],
    borderTopRightRadius: radii['2xl'],
    paddingBottom: spacing['3xl'],
    maxHeight: '70%',
  },
  modalTitle: {
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
  },
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
  },
  sectionLabel: { marginBottom: spacing.sm, marginLeft: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.base, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.outlineVariant },
  iconBg: { width: 36, height: 36, borderRadius: 12, backgroundColor: `${colors.primary}18`, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, fontFamily: fonts.medium, fontSize: fontSizes.bodyMedium, lineHeight: Math.round(fontSizes.bodyMedium * 1.3), color: colors.onSurface },
});
