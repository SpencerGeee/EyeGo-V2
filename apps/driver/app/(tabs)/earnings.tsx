import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { walletApi, driverApi } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import {
  Text,
  Button,
  Entrance,
  GlassCard,
  GlassSurface,
  AnimatedFareText,
  PanelSheet,
  GradientGlowBorder,
  AppBackground,
} from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useDriverStore } from '../../stores/driver.store';
import { EarningsChart, type ChartDataPoint } from '../../components/EarningsChart';

type Period = 'today' | 'week' | 'month';

// Driver earnings ledger uses several credit types — TRIP_EARNING (completeTrip),
// EARNINGS_CREDIT (arriveTrip), QUEST_BONUS, and legacy CREDIT (seed). Anything
// not in this set is treated as a debit (e.g. WITHDRAWAL).
const CREDIT_TYPES = ['CREDIT', 'TRIP_EARNING', 'EARNINGS_CREDIT', 'QUEST_BONUS'];

const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

export default function EarningsScreen() {
  const colors = useColors();
  const theme = useDriverStore(s => s.theme);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const [period, setPeriod] = useState<Period>('week');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const qc = useQueryClient();

  // Use driver profile as the source of balance — totalEarned reflects actual trip earnings.
  // walletApi.getBalance() returns 0 until the backend credits the wallet ledger separately.
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data: meData, isLoading, refetch: refetchWallet, isRefetching } = useQuery({
    queryKey: ['driver', 'me'],
    queryFn: () => driverApi.getMe(),
    // Match profile.tsx: unwrap nested driver object before the top-level data key
    select: (r) => (r.data as any).data?.driver ?? (r.data as any).data,
    retry: 1,
    staleTime: 30_000,
  });

  const { data: txData } = useQuery({
    queryKey: ['driver', 'wallet', 'transactions'],
    queryFn: () => driverApi.getWalletTransactions({ limit: 20 }),
    select: (r) => {
      const d = (r.data as any)?.data;
      if (Array.isArray(d)) return d;
      if (d?.items && Array.isArray(d.items)) return d.items;
      if (d?.transactions && Array.isArray(d.transactions)) return d.transactions;
      if (d?.data && Array.isArray(d.data)) return d.data;
      return [];
    },
  });

  const withdraw = useMutation({
    mutationFn: () => driverApi.withdraw({ amount: parseFloat(withdrawAmount) }),
    onSuccess: () => {
      setSheetOpen(false);
      setWithdrawAmount('');
      qc.invalidateQueries({ queryKey: ['driver', 'wallet'] });
      // Balance is derived from ['driver','me'] (walletBalance), so refresh that too.
      qc.invalidateQueries({ queryKey: ['driver', 'me'] });
      Alert.alert('Withdrawal Submitted', `GHS ${parseFloat(withdrawAmount).toFixed(2)} is being processed to your mobile money account.`);
    },
    onError: (err) => Alert.alert('Withdrawal Failed', (err as Error).message),
  });

  const handleWithdraw = () => {
    // D12: validate amount before submitting withdrawal
    const amount = parseFloat(withdrawAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Invalid Amount', 'Enter a valid amount.');
      return;
    }
    if (amount < 20) {
      Alert.alert('Minimum Withdrawal', 'The minimum withdrawal amount is GHS 20.00.');
      return;
    }
    if (amount > balance) {
      Alert.alert('Insufficient Balance', `You only have GHS ${balance.toFixed(2)} available.`);
      return;
    }
    Alert.alert(
      'Confirm Withdrawal',
      `Send GHS ${amount.toFixed(2)} to your mobile money account?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: () => withdraw.mutate() },
      ]
    );
  };

  // Derive chart data from real transactions
  const chartData = useMemo((): ChartDataPoint[] => {
    // D5: guard against non-array transactions before any derivation
    if (!Array.isArray(txData)) return [];
    const txs: any[] = txData;
    // Filtering only 'CREDIT' made the chart/Today/Trips render 0 — use the
    // full credit-type set (module-level CREDIT_TYPES).
    const credits = txs.filter((t) => CREDIT_TYPES.includes(t.type));
    const now = new Date();

    if (period === 'today') {
      const hours = [8, 10, 12, 14, 16, 18, 20];
      return hours.map((h) => ({
        label: h === 12 ? '12pm' : h > 12 ? `${h - 12}pm` : `${h}am`,
        value: credits
          .filter((t) => {
            const d = new Date(t.createdAt);
            return d.toDateString() === now.toDateString() && d.getHours() >= h && d.getHours() < h + 2;
          })
          .reduce((s, t) => s + (t.amount ?? 0), 0),
      }));
    }

    if (period === 'week') {
      const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      return Array.from({ length: 7 }, (_, i) => {
        const day = new Date(startOfWeek);
        day.setDate(startOfWeek.getDate() + i);
        return {
          label: DAY_LABELS[day.getDay()],
          value: credits
            .filter((t) => new Date(t.createdAt).toDateString() === day.toDateString())
            .reduce((s, t) => s + (t.amount ?? 0), 0),
        };
      });
    }

    // month — group into 4 weeks
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return Array.from({ length: 4 }, (_, i) => {
      const weekStart = new Date(startOfMonth);
      weekStart.setDate(1 + i * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      return {
        label: `W${i + 1}`,
        value: credits
          .filter((t) => {
            const d = new Date(t.createdAt);
            return d >= weekStart && d <= weekEnd;
          })
          .reduce((s, t) => s + (t.amount ?? 0), 0),
      };
    });
  }, [txData, period]);

  // Withdrawable balance is the actual wallet balance, not lifetime totalEarned.
  const balance = meData?.walletBalance != null ? meData.walletBalance : 0;
  const currency = meData?.currency ?? 'GHS';
  const withdrawAmt = parseFloat(withdrawAmount);
  const canWithdraw = !isNaN(withdrawAmt) && withdrawAmt >= 20 && withdrawAmt <= balance;

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground isDark={theme !== 'light'} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetchWallet} />
        }
      >
        {/* Header */}
        <Entrance animation="slideUp" delay={50} style={styles.header}>
          <Text variant="headlineMedium" style={styles.title}>Earnings</Text>
        </Entrance>

        {/* Balance card — the screen's hero number gets the premium ring */}
        <Entrance animation="slideDown" delay={100} style={styles.balanceCardWrapper}>
        <GradientGlowBorder
          palette="gold"
          fillColor={colors.surfaceContainerHigh}
          borderRadius={radii['2xl']}
          glow
          style={styles.balanceCard}
        >
          <GlassSurface borderRadius={radii['2xl'] - 3} intensity="high" dark style={StyleSheet.absoluteFill} />
          <View style={styles.balanceGlow} pointerEvents="none" />
          <Text variant="caption" color={colors.onSurfaceVariant}>Available Balance</Text>
          {isLoading ? (
            <Text style={styles.balanceAmount}>GHS —</Text>
          ) : (
            <AnimatedFareText value={balance} prefix="GHS " variant="fareLarge" color={colors.onSurface} shiny />
          )}
          <View style={styles.balanceMeta}>
            <View style={styles.currencyBadge}>
              <Text style={styles.currencyText}>{currency}</Text>
            </View>
          </View>
          <Button
            label="Withdraw"
            size="sm"
            onPress={() => setSheetOpen(true)}
            style={styles.withdrawBtn}
          />
          <Pressable
            onPress={() => router.push('/(profile)/payout-account' as any)}
            style={styles.payoutLink}
          >
            <Ionicons name="card-outline" size={13} color={colors.onSurfaceVariant} />
            <Text variant="caption" color={colors.onSurfaceVariant}>Manage payout account</Text>
          </Pressable>
        </GradientGlowBorder>
        </Entrance>

        {/* Period toggle */}
        <Entrance animation="slideDown" delay={150} style={styles.periodWrapper}>
          <View style={styles.periodContainer}>
            {PERIODS.map((p) => (
              <Pressable
                key={p.key}
                style={[styles.periodBtn, period === p.key && styles.periodActive]}
                onPress={() => setPeriod(p.key)}
              >
                <Text
                  style={[
                    styles.periodText,
                    { color: period === p.key ? colors.onPrimary : colors.onSurfaceVariant },
                  ]}
                >
                  {p.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Entrance>

        {/* Chart */}
        <Entrance animation="slideDown" delay={200} style={styles.chartCardWrapper}>
        <GlassCard style={styles.chartCard}>
          <EarningsChart period={period} data={chartData} />
        </GlassCard>
        </Entrance>

        {/* Transactions */}
        <Entrance animation="slideDown" delay={250}>
          <Text style={styles.sectionTitle}>Transactions</Text>
          {(() => {
            const txs: any[] = Array.isArray(txData) ? txData : [];
            return (
              <>
                {txs.length === 0 && (
                  <View style={styles.emptyTx}>
                    <Text variant="bodyMedium" color={colors.onSurfaceVariant}>No transactions yet.</Text>
                  </View>
                )}
                {txs.map((tx: any, i: number) => {
                  const isCredit = CREDIT_TYPES.includes(tx.type);
                  return (
            <Entrance
              key={tx.id}
              animation="slideLeft"
              delay={260 + i * 50}
              style={styles.txRow}
            >
              <View style={[
                styles.txIcon,
                { backgroundColor: isCredit ? `${colors.online}22` : `${colors.error}22` },
              ]}>
                <Ionicons
                  name={isCredit ? 'arrow-down' : 'arrow-up'}
                  size={16}
                  color={isCredit ? colors.online : colors.error}
                />
              </View>
              <View style={styles.txInfo}>
                <Text style={styles.txDesc}>{tx.description}</Text>
                <Text variant="caption" color={colors.onSurfaceVariant}>
                  {new Date(tx.createdAt).toLocaleDateString()}
                </Text>
              </View>
              <Text style={[
                styles.txAmount,
                { color: isCredit ? colors.online : colors.error },
              ]}>
                {isCredit ? '+' : '-'}GHS {tx.amount.toFixed(2)}
              </Text>
            </Entrance>
                  );
                })}
              </>
            );
          })()}
        </Entrance>
      </ScrollView>

      {/* Withdraw sheet */}
      <PanelSheet visible={sheetOpen} onDismiss={() => setSheetOpen(false)} maxHeightPct={0.5} sheetStyle={styles.sheetBg}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.sheetContent}>
            <Text variant="titleLarge" style={styles.sheetTitle}>Withdraw Funds</Text>
            <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.sheetSub}>
              Balance: GHS {balance.toFixed(2)} · Min. GHS 20
            </Text>
            <View style={styles.amountInputWrapper}>
              <Text style={styles.ghsPrefix}>GHS</Text>
              <TextInput
                style={styles.amountInput}
                value={withdrawAmount}
                onChangeText={setWithdrawAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={colors.onSurfaceVariant}
                selectionColor={colors.primary}
              />
            </View>
            <Button
              label="Confirm Withdrawal"
              onPress={handleWithdraw}
              disabled={!canWithdraw || withdraw.isPending}
              loading={withdraw.isPending}
              style={styles.confirmBtn}
            />
          </View>
        </KeyboardAvoidingView>
      </PanelSheet>
    </SafeAreaView>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    scroll: {
      paddingBottom: 120,
    },
    header: {
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing.xl,
      paddingBottom: spacing.md,
    },
    title: { fontFamily: fonts.displayBold, letterSpacing: -0.5 },
    balanceCardWrapper: {
      marginHorizontal: spacing['2xl'],
      marginBottom: spacing.xl,
    },
    balanceCard: {
      padding: spacing['2xl'],
      gap: spacing.xs,
    },
    balanceGlow: {
      position: 'absolute',
      width: 200,
      height: 200,
      borderRadius: 100,
      backgroundColor: colors.primary,
      opacity: 0.07,
      top: -60,
      right: -40,
    },
    balanceAmount: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.hero,
      lineHeight: Math.round(fontSizes.hero * 1.3),
      color: colors.onSurface,
      letterSpacing: -1,
      marginVertical: spacing.xs,
    },
    balanceMeta: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
    currencyBadge: {
      backgroundColor: `${colors.primary}22`,
      borderRadius: radii.full,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderWidth: 1,
      borderColor: `${colors.primary}44`,
    },
    currencyText: {
      fontFamily: fonts.semiBold,
      fontSize: 10,
      lineHeight: Math.round(10 * 1.3),
      color: colors.primary,
      letterSpacing: 1,
    },
    withdrawBtn: { alignSelf: 'flex-start' },
    payoutLink: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
    periodWrapper: { paddingHorizontal: spacing['2xl'], marginBottom: spacing.lg },
    periodContainer: {
      flexDirection: 'row',
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outline,
      padding: 4,
    },
    periodBtn: {
      flex: 1,
      paddingVertical: spacing.sm,
      borderRadius: radii.lg,
      alignItems: 'center',
    },
    periodActive: { backgroundColor: colors.primary },
    periodText: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, lineHeight: Math.round(fontSizes.bodyMedium * 1.3) },
    chartCardWrapper: {
      marginHorizontal: spacing['2xl'],
      marginBottom: spacing.xl,
    },
    chartCard: {
      padding: spacing.xl,
    },
    sectionTitle: {
      fontFamily: fonts.displaySemiBold,
      fontSize: fontSizes.titleSmall,
      lineHeight: Math.round(fontSizes.titleSmall * 1.3),
      color: colors.onSurface,
      paddingHorizontal: spacing['2xl'],
      marginBottom: spacing.md,
    },
    emptyTx: { alignItems: 'center', padding: spacing['2xl'] },
    txRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing['2xl'],
      paddingVertical: spacing.md,
      gap: spacing.md,
    },
    txIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    txInfo: { flex: 1 },
    txDesc: {
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
      color: colors.onSurface,
    },
    txAmount: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, lineHeight: Math.round(fontSizes.bodyMedium * 1.3) },
    sheetBg: { backgroundColor: colors.surfaceContainerHigh },
    sheetContent: { padding: spacing['2xl'], gap: spacing.lg },
    sheetTitle: { fontFamily: fonts.displayBold },
    sheetSub: { marginTop: -spacing.sm },
    amountInputWrapper: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.lg,
      borderWidth: 1.5,
      borderColor: colors.outline,
      height: 60,
      paddingHorizontal: spacing.base,
      gap: spacing.sm,
    },
    ghsPrefix: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.titleSmall,
      lineHeight: Math.round(fontSizes.titleSmall * 1.3),
      color: colors.onSurfaceVariant,
    },
    amountInput: {
      flex: 1,
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.titleLarge,
      lineHeight: Math.round(fontSizes.titleLarge * 1.3),
      color: colors.onSurface,
    },
    confirmBtn: { marginTop: spacing.sm },
  });
