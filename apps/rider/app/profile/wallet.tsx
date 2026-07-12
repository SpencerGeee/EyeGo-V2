import React, { useState, useMemo } from 'react';
import { View, StyleSheet, Platform, Pressable, ScrollView, Alert, Modal, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { walletApi, bookingsApi, paymentsApi, queryKeys } from '@eyego/api';
import { fonts, fontSizes, spacing, radii, withOpacity } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, Button, Skeleton, GlassSurface, GradientGlowBorder, PREMIUM_RING_LOCATIONS } from '@eyego/ui';
import { formatCurrency } from '@eyego/utils';

// Green-accent variant of the premium ring sweep — two narrow emerald arcs
// (brand green core) orbiting a near-black ring, matching the house
// PREMIUM_RING technique but tuned to the wallet's green identity.
const GREEN_RING_COLORS = [
  '#0A0A0C', '#0A0A0C', '#4be277', '#b1f2c5', '#4be277', '#0A0A0C',
  '#0A0A0C', '#4be277', '#b1f2c5', '#4be277', '#0A0A0C', '#0A0A0C',
] as const;

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
  const tier = getAccountTier(tripCount, colors.primary);

  const balance = (balanceData as any)?.data?.data?.balance ?? (balanceData as any)?.data?.balance ?? 0;
  const transactions = (txData as any)?.data?.data?.transactions ?? (txData as any)?.data?.transactions ?? [];

  const [isVerifyingTopUp, setIsVerifyingTopUp] = useState(false);

  const topUp = useMutation({
    mutationFn: (amount: number) => walletApi.topUp({ amount, method: 'MOMO' }),
    onSuccess: async (res, amount) => {
      const reference = (res as any)?.data?.data?.reference;
      setModalVisible(false);
      setTopUpAmount('');

      if (!reference) {
        // No reference to verify against — fall back to an honest "in progress" message
        // rather than falsely declaring success.
        Alert.alert('Top Up Initiated', 'Approve the prompt on your phone to complete the top-up.');
        return;
      }

      // The charge is only *initiated* here — approve on the phone happens next, and the
      // balance is only actually credited once the webhook confirms it. Poll before telling
      // the rider their money has been added.
      setIsVerifyingTopUp(true);
      try {
        await paymentsApi.pollWalletTopup(reference);
        queryClient.invalidateQueries({ queryKey: queryKeys.wallet.balance() });
        queryClient.invalidateQueries({ queryKey: queryKeys.wallet.transactions() });
        Alert.alert('Top Up Successful', `GHS ${amount.toFixed(2)} has been added to your EyeGo Wallet.`);
      } catch {
        Alert.alert(
          'Top Up Not Confirmed',
          'We could not confirm your payment yet. If you approved the prompt, your balance will update shortly — otherwise please try again.',
        );
      } finally {
        setIsVerifyingTopUp(false);
      }
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

  const comingSoon = (feature: string) =>
    Alert.alert(feature, `${feature} is coming soon to EyeGo Wallet.`);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
        </Pressable>
        <Text variant="titleSmall" style={{ color: colors.onSurface }}>Wallet</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Balance Card */}
        <View
          >
          {/* Balance HERO — green glow ring with a frosted-glass fill inset by
              the ring thickness (3) so the blur doesn't paint over the ring. */}
          <GradientGlowBorder
            colors={GREEN_RING_COLORS}
            locations={PREMIUM_RING_LOCATIONS}
            fillColor={colors.surfaceCard}
            borderRadius={radii['2xl']}
            glow
            glowColor={colors.primary}
            style={styles.balanceCard}
          >
            <GlassSurface
              borderRadius={radii['2xl'] - 3}
              intensity="high"
              dark
              style={styles.balanceGlassInset}
            />
            <View style={styles.balanceGlow} pointerEvents="none" />
            <View style={styles.balanceContent}>
              <Text style={styles.balanceLabel}>AVAILABLE BALANCE</Text>
              {balanceLoading ? (
                <Skeleton width={180} height={44} borderRadius={8} style={{ marginTop: spacing.sm }} />
              ) : (
                <View style={styles.balanceRow}>
                  <Text style={styles.balanceCurrency}>GH₵</Text>
                  <Text style={styles.balanceValue}>{Number(balance).toFixed(2)}</Text>
                </View>
              )}

              <View style={styles.tierRow}>
                <Ionicons name={tier.icon} size={14} color={tier.color} />
                <Text style={[styles.tierText, { color: tier.color }]}>{tier.label} Rider</Text>
              </View>

              <Pressable
                style={({ pressed }) => [styles.topUpBtn, pressed && { transform: [{ scale: 0.97 }] }]}
                onPress={() => setModalVisible(true)}
                accessibilityRole="button"
                accessibilityLabel="Top up wallet"
              >
                <Ionicons name="add-circle" size={20} color={colors.onPrimary} />
                <Text style={styles.topUpText}>Top Up Wallet</Text>
              </Pressable>
            </View>
          </GradientGlowBorder>
        </View>

        {/* Quick Actions grid */}
        <View
          style={styles.quickGrid}
        >
          <Pressable style={styles.quickCard} onPress={() => comingSoon('Send Money')}>
            <Ionicons name="send-outline" size={28} color={colors.primary} />
            <Text style={styles.quickLabel}>Send Money</Text>
          </Pressable>
          <Pressable style={styles.quickCard} onPress={() => comingSoon('Scan & Pay')}>
            <Ionicons name="qr-code-outline" size={28} color={colors.primary} />
            <Text style={styles.quickLabel}>Scan & Pay</Text>
          </Pressable>
        </View>

        {/* Recent Activity */}
        <View
          style={styles.section}
        >
          <Text variant="titleSmall" style={{ color: colors.onSurface }}>Recent Activity</Text>

          <GlassSurface borderRadius={radii.xl} intensity="low" dark style={styles.transactionList}>
            {txLoading ? (
              <>
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} height={52} borderRadius={radii.lg} style={{ marginBottom: spacing.sm }} />
                ))}
              </>
            ) : transactions.length === 0 ? (
              <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ textAlign: 'center', padding: spacing.base }}>
                No transactions yet.
              </Text>
            ) : (
              transactions.map((tx: any, i: number) => {
                const isCredit = tx.type === 'CREDIT';
                return (
                  <View
                    key={tx.id}
                    style={[styles.txRow, i === transactions.length - 1 && { borderBottomWidth: 0 }]}
                  >
                    <View style={[styles.txIcon, { backgroundColor: isCredit ? withOpacity(colors.statusSuccess, 0.15) : colors.surfaceContainerHigh }]}>
                      <Ionicons
                        name={isCredit ? 'arrow-down' : 'car-outline'}
                        size={16}
                        color={isCredit ? colors.statusSuccess : colors.onSurface}
                      />
                    </View>
                    <View style={styles.txInfo}>
                      <Text variant="bodyMedium" style={{ color: colors.onSurface }} numberOfLines={1}>
                        {tx.description}
                      </Text>
                      <Text variant="caption" color={colors.onSurfaceVariant}>
                        {new Date(tx.createdAt).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </View>
                    <Text style={[styles.txAmount, { color: isCredit ? colors.statusSuccess : colors.onSurface }]}>
                      {isCredit ? '+' : '-'}{formatCurrency(tx.amount)}
                    </Text>
                  </View>
                );
              })
            )}
          </GlassSurface>
        </View>
      </ScrollView>

      {/* Top Up Modal */}
      <Modal
        animationType="slide"
        transparent
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          {Platform.OS === 'ios' ? (
            <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFillObject} />
          ) : (
            // expo-blur on Android is just a tint (plus native-view overhead) — render the tint directly.
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.55)' }]} />
          )}
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text variant="titleMedium" style={{ color: colors.onSurface }}>Top Up Wallet</Text>
              <Pressable onPress={() => setModalVisible(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close top up">
                <Ionicons name="close" size={24} color={colors.onSurface} />
              </Pressable>
            </View>

            <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ marginBottom: spacing.md }}>
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
              <Text variant="caption" color={colors.onSurfaceVariant} style={{ marginBottom: 6 }}>CUSTOM AMOUNT (GHS)</Text>
              <TextInput
                style={styles.input}
                value={topUpAmount}
                onChangeText={setTopUpAmount}
                keyboardType="numeric"
                placeholder="0.00"
                placeholderTextColor={colors.outlineVariant}
              />
            </View>

            <Button
              label={isVerifyingTopUp ? 'Confirming payment…' : 'Confirm Top Up'}
              onPress={() => {
                const amt = parseFloat(topUpAmount);
                handleTopUp(amt);
              }}
              loading={topUp.isPending || isVerifyingTopUp}
              disabled={topUp.isPending || isVerifyingTopUp}
              style={{ marginTop: spacing.lg }}
            />
          </View>
        </View>
      </Modal>
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
    paddingVertical: spacing.base,
  },
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
    gap: spacing.xl,
  },
  balanceCard: {
    borderRadius: radii['2xl'],
    overflow: 'hidden',
  },
  balanceGlassInset: {
    position: 'absolute',
    top: 3,
    left: 3,
    right: 3,
    bottom: 3,
  },
  balanceContent: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  balanceGlow: {
    position: 'absolute',
    top: -60,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: withOpacity(colors.primary, 0.12),
  },
  balanceLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1.5,
    color: colors.onSurfaceVariant,
    marginBottom: spacing.sm,
  },
  balanceRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  balanceCurrency: {
    fontFamily: fonts.displayBold,
    fontSize: 22,
    lineHeight: 28,
    color: colors.primary,
  },
  balanceValue: {
    fontFamily: fonts.displayBold,
    fontSize: 44,
    lineHeight: 54,
    color: colors.primary,
    letterSpacing: -1,
    textShadowColor: withOpacity(colors.primary, 0.4),
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 18,
  },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.sm,
  },
  tierText: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodySmall, lineHeight: Math.round(fontSizes.bodySmall * 1.3) },
  topUpBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    alignSelf: 'stretch',
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingVertical: spacing.base,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
  },
  topUpText: { fontFamily: fonts.bold, fontSize: fontSizes.titleSmall, lineHeight: fontSizes.titleSmall * 1.3, color: colors.onPrimary },
  quickGrid: { flexDirection: 'row', gap: spacing.base },
  quickCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceCard,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.rimLightSubtle,
    paddingVertical: spacing.lg,
  },
  quickLabel: { fontFamily: fonts.medium, fontSize: fontSizes.bodySmall, lineHeight: Math.round(fontSizes.bodySmall * 1.3), color: colors.onSurface },
  section: { gap: spacing.md },
  transactionList: {
    borderRadius: radii.xl,
    paddingHorizontal: spacing.base,
  },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.rimLightSubtle,
  },
  txIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  txInfo: { flex: 1 },
  txAmount: { fontFamily: fonts.bold, fontSize: fontSizes.bodyLarge, lineHeight: fontSizes.bodyLarge * 1.3 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: colors.surfaceCard,
    borderTopLeftRadius: radii['4xl'],
    borderTopRightRadius: radii['4xl'],
    padding: spacing.xl,
    paddingBottom: spacing['3xl'],
    borderTopWidth: 1,
    borderTopColor: colors.rimLight,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  quickAmountsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  quickAmtBtn: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.rimLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickAmtText: { color: colors.onSurface, fontFamily: fonts.bold, fontSize: 13, lineHeight: 17 },
  inputContainer: {
    backgroundColor: colors.surfaceInput,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.rimLight,
    padding: spacing.md,
  },
  input: {
    fontSize: 22,
    lineHeight: 31,
    fontFamily: fonts.bold,
    color: colors.primary,
    padding: 0,
  },
});
