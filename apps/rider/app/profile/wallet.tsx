import React, { useState, useMemo } from 'react';
import { View, StyleSheet, Pressable, ScrollView, Alert, Modal, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { walletApi, bookingsApi, queryKeys } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, Button, Skeleton } from '@eyego/ui';
import { formatCurrency } from '@eyego/utils';

export default function WalletScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [modalVisible, setModalVisible] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState('');

  const { data: balanceData, isLoading: balanceLoading } = useQuery({
    queryKey: queryKeys.wallet.balance(),
    queryFn: walletApi.getBalance,
    refetchInterval: 15_000, // 15s — avoids excessive network chatter on a profile screen
  });

  const { data: txData, isLoading: txLoading } = useQuery({
    queryKey: queryKeys.wallet.transactions(),
    queryFn: () => walletApi.getTransactions(),
  });

  const { data: historyData } = useQuery({
    queryKey: ['bookings', 'history', 'completed'],
    queryFn: () => bookingsApi.getHistory({ status: 'COMPLETED', limit: 1 }),
    // Backend getUserBookings returns { data: { bookings, total, page, totalPages } }
    // — there is no top-level `pagination` and `data` is an object (no .length),
    // so the old select always yielded 0 → tier stuck on "Standard". Read data.total.
    select: (r) => (r.data as any)?.data?.total ?? (r.data as any)?.data?.bookings?.length ?? 0,
  });
  const tripCount = historyData ?? 0;

  // Tier icons use Ionicons (vector) names instead of emoji.
  function getAccountTier(count: number, primaryColor: string) {
    if (count >= 50) return { label: 'Premium', color: '#F59E0B', icon: 'star' as const };
    if (count >= 26) return { label: 'Gold', color: '#EAB308', icon: 'medal' as const };
    if (count >= 11) return { label: 'Silver', color: '#94A3B8', icon: 'medal-outline' as const };
    return { label: 'Standard', color: primaryColor, icon: 'leaf' as const };
  }
  const tier = getAccountTier(tripCount, '#4BE277');

  const balance = (balanceData as any)?.data?.data?.balance ?? (balanceData as any)?.data?.balance ?? 0;
  const transactions = (txData as any)?.data?.data?.transactions ?? (txData as any)?.data?.transactions ?? [];

  const topUp = useMutation({
    mutationFn: (amount: number) =>
      walletApi.topUp({ amount, method: 'MOMO' }),
    onSuccess: (_, amount) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.wallet.balance() });
      queryClient.invalidateQueries({ queryKey: queryKeys.wallet.transactions() });
      setModalVisible(false);
      setTopUpAmount('');
      Alert.alert('Top Up Successful', `GHS ${amount.toFixed(2)} has been added to your EyeGo Wallet.`);
    },
    onError: () => {
      Alert.alert('Failed', 'Top up could not be processed. Please try again.');
    },
  });

  const handleTopUp = (amount: number) => {
    if (!amount || amount <= 0) {
      Alert.alert('Error', 'Please enter a valid amount');
      return;
    }
    topUp.mutate(amount);
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </Pressable>
        <Text variant="titleMedium" style={styles.headerTitle}>EyeGo Wallet</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Wallet Balance Card */}
        <MotiView
          from={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 580, damping: 34, mass: 0.8 }}
          style={styles.cardContainer}
        >
          <BlurView intensity={30} tint="dark" style={styles.cardGlass}>
            <View style={styles.cardTop}>
              <View>
                <Text variant="caption" color="rgba(255, 255, 255, 0.6)">TOTAL BALANCE</Text>
                {balanceLoading ? (
                  <Skeleton width={140} height={40} borderRadius={8} style={{ marginTop: spacing.xs }} />
                ) : (
                  <Text style={styles.balanceText}>{formatCurrency(balance)}</Text>
                )}
              </View>
              <Ionicons name="wallet-outline" size={32} color="#4BE277" />
            </View>

            <View style={styles.cardBottom}>
              <View style={styles.cardMetaItem}>
                <Text style={styles.metaLabel}>ACCOUNT TYPE</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Ionicons name={tier.icon} size={14} color={tier.color} />
                  <Text style={[styles.metaValue, { color: tier.color }]}>{tier.label} Rider</Text>
                </View>
              </View>
              <View style={styles.cardMetaDivider} />
              <View style={styles.cardMetaItem}>
                <Text style={styles.metaLabel}>DEFAULT PAY</Text>
                <Text style={styles.metaValue}>Cash / Wallet</Text>
              </View>
            </View>
          </BlurView>
        </MotiView>

        {/* Quick Actions */}
        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 580, damping: 34, mass: 0.8, delay: 50 }}
          style={styles.actionRow}
        >
          <Pressable style={styles.actionButton} onPress={() => setModalVisible(true)} accessibilityRole="button" accessibilityLabel="Top up wallet">
            <Ionicons name="add-circle" size={20} color="#050508" />
            <Text style={styles.actionButtonText}>Top Up Wallet</Text>
          </Pressable>
        </MotiView>

        {/* Transaction History */}
        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 580, damping: 34, mass: 0.8, delay: 80 }}
          style={styles.section}
        >
          <Text variant="titleSmall" style={styles.sectionTitle}>Recent Transactions</Text>

          <View style={styles.transactionList}>
            {txLoading ? (
              <>
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} height={52} borderRadius={radii.lg} style={{ marginBottom: spacing.sm }} />
                ))}
              </>
            ) : transactions.length === 0 ? (
              <Text variant="bodySmall" color="rgba(255,255,255,0.4)" style={{ textAlign: 'center', padding: spacing.base }}>
                No transactions yet.
              </Text>
            ) : (
              transactions.map((tx: any) => (
                <View key={tx.id} style={styles.txRow}>
                  <View style={[styles.txIconContainer, { backgroundColor: tx.type === 'CREDIT' ? 'rgba(75, 226, 119, 0.15)' : 'rgba(255, 255, 255, 0.05)' }]}>
                    <Ionicons
                      name={tx.type === 'CREDIT' ? 'arrow-down-outline' : 'arrow-up-outline'}
                      size={16}
                      color={tx.type === 'CREDIT' ? '#4BE277' : '#FFFFFF'}
                    />
                  </View>
                  <View style={styles.txInfo}>
                    <Text variant="bodyMedium" style={styles.txTitle}>{tx.description}</Text>
                    <Text variant="caption" color="rgba(255, 255, 255, 0.5)">
                      {new Date(tx.createdAt).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                  <Text style={[styles.txAmount, { color: tx.type === 'CREDIT' ? '#4BE277' : '#FFFFFF' }]}>
                    {tx.type === 'CREDIT' ? '+' : '-'}{formatCurrency(tx.amount)}
                  </Text>
                </View>
              ))
            )}
          </View>
        </MotiView>
      </ScrollView>

      {/* Top Up Modal */}
      <Modal
        animationType="slide"
        transparent
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFillObject} />
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text variant="titleMedium">Top Up Wallet</Text>
              <Pressable onPress={() => setModalVisible(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close top up">
                <Ionicons name="close" size={24} color="#FFFFFF" />
              </Pressable>
            </View>

            <Text variant="bodySmall" color="rgba(255, 255, 255, 0.6)" style={{ marginBottom: spacing.md }}>
              Select a quick amount or enter a custom amount:
            </Text>

            <View style={styles.quickAmountsRow}>
              {[20, 50, 100].map((amt) => (
                <Pressable
                  key={amt}
                  style={styles.quickAmtBtn}
                  onPress={() => handleTopUp(amt)}
                  disabled={topUp.isPending}
                  accessibilityRole="button"
                  accessibilityLabel={`Top up GHS ${amt}`}
                >
                  <Text style={styles.quickAmtText}>+GHS {amt}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.inputContainer}>
              <Text variant="caption" color="rgba(255, 255, 255, 0.5)" style={{ marginBottom: 6 }}>CUSTOM AMOUNT (GHS)</Text>
              <TextInput
                style={styles.input}
                value={topUpAmount}
                onChangeText={setTopUpAmount}
                keyboardType="numeric"
                placeholder="0.00"
                placeholderTextColor="rgba(255,255,255,0.3)"
              />
            </View>

            <Button
              label="Confirm Top Up"
              onPress={() => {
                const amt = parseFloat(topUpAmount);
                handleTopUp(amt);
              }}
              loading={topUp.isPending}
              style={{ marginTop: spacing.lg }}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (_colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#050508' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.md,
  },
  headerTitle: { color: '#FFFFFF', fontFamily: fonts.bold },
  scroll: {
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing.md,
    paddingBottom: spacing['3xl'],
    gap: spacing.xl,
  },
  cardContainer: {
    borderRadius: radii['2xl'],
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  cardGlass: { padding: spacing.xl },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing['2xl'],
  },
  balanceText: {
    fontSize: 36,
    fontFamily: fonts.bold,
    color: '#FFFFFF',
    marginTop: spacing.xs,
    letterSpacing: -1,
  },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    paddingTop: spacing.md,
  },
  cardMetaItem: { flex: 1 },
  cardMetaDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginHorizontal: spacing.md,
  },
  metaLabel: {
    fontSize: 9,
    fontFamily: fonts.bold,
    color: 'rgba(255, 255, 255, 0.4)',
    letterSpacing: 1.5,
  },
  metaValue: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
    color: '#FFFFFF',
    marginTop: 2,
  },
  actionRow: { width: '100%' },
  actionButton: {
    backgroundColor: '#4BE277',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    borderRadius: 24,
    gap: spacing.sm,
  },
  actionButtonText: { color: '#050508', fontFamily: fonts.bold, fontSize: 14 },
  section: { gap: spacing.md },
  sectionTitle: { color: '#FFFFFF', fontFamily: fonts.bold },
  transactionList: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    padding: spacing.md,
  },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
  },
  txIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  txInfo: { flex: 1 },
  txTitle: { color: '#FFFFFF', fontFamily: fonts.medium },
  txAmount: { fontSize: 15, fontFamily: fonts.bold },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#0A0A0F',
    borderTopLeftRadius: radii['3xl'],
    borderTopRightRadius: radii['3xl'],
    padding: spacing.xl,
    paddingBottom: spacing['3xl'],
    borderTopWidth: 1.5,
    borderTopColor: 'rgba(255, 255, 255, 0.12)',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  quickAmountsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  quickAmtBtn: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickAmtText: { color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 13 },
  inputContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: spacing.md,
  },
  input: {
    fontSize: 22,
    fontFamily: fonts.bold,
    color: '#4BE277',
    padding: 0,
  },
});
