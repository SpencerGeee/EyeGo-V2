import React, { useState, useMemo } from 'react';
import { formatGhs, pesewasFromCedis } from '@eyego/utils';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Keyboard,
  Alert,
  RefreshControl,
} from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { walletApi, driverApi, MOMO_NETWORKS, type MomoNetwork } from '@eyego/api';
import { describeError } from '@eyego/utils';
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
/**
 * Every ledger type that represents money the driver earned.
 *
 * `CASH_EARNING` is the important addition: cash fares are handed over in person,
 * so the backend deliberately never credits the wallet for them (only the
 * commission is debited). With no earning row of any kind, a driver working cash
 * saw a permanently flat chart and GHS 0 — the reported "blank chart even though
 * sales have been made or a commission has been deducted". `CASH_EARNING` rows
 * carry balanceBeforePesewas === balanceAfterPesewas, i.e. they are income for reporting and
 * not part of the wallet balance.
 *
 * `TIP` counts too — a tip is earnings the driver actually keeps.
 */
const CREDIT_TYPES = ['CREDIT', 'TRIP_EARNING', 'EARNINGS_CREDIT', 'CASH_EARNING', 'QUEST_BONUS', 'TIP'];

/**
 * Mirrors `DRIVER_MIN_WITHDRAWAL` on the server (GH₵20.00), in pesewas.
 *
 * The server is the authority — it rejects anything below this — but the screen
 * needs the number to grey out the button, and a bare `20` sitting next to a
 * pesewas balance was a comparison of two different units.
 */
const MIN_WITHDRAWAL_PESEWAS = 2000;

/** Mirrors the server's own top-up bounds (wallet.routes.js / wallet.service.js). */
const MIN_TOPUP_PESEWAS = 100; // ₵1
const MAX_TOPUP_PESEWAS = 500_000; // ₵5,000

/** One tap instead of typing, for the amounts drivers actually add. */
const TOPUP_PRESETS_PESEWAS = [2000, 5000, 10000, 20000];

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

  // The chart derives its bars entirely from this list — a fixed limit of 20
  // silently truncated the "week"/"month" views for any driver with more than
  // 20 transactions in that window (trivial for a working driver), making
  // older days/weeks in the period under-report or show as flat zero even
  // though real earnings existed. Scale the fetch to the selected period.
  const TX_LIMIT_FOR_PERIOD: Record<Period, number> = { today: 50, week: 150, month: 500 };
  const { data: txData } = useQuery({
    queryKey: ['driver', 'wallet', 'transactions', period],
    queryFn: () => driverApi.getWalletTransactions({ limit: TX_LIMIT_FOR_PERIOD[period] }),
    select: (r) => {
      const d = (r.data as any)?.data;
      if (Array.isArray(d)) return d;
      if (d?.items && Array.isArray(d.items)) return d.items;
      if (d?.transactions && Array.isArray(d.transactions)) return d.transactions;
      if (d?.data && Array.isArray(d.data)) return d.data;
      return [];
    },
  });

  /**
   * PUTTING MONEY IN.
   *
   * There was no way to do this anywhere in the driver app. A driver working
   * cash fares has their commission DEBITED from the wallet without any
   * matching credit (see CREDIT_TYPES above — `CASH_EARNING` is income for
   * reporting and deliberately does not move the balance), so a busy cash day
   * drives the balance negative. `goOnline` then refuses them until the balance
   * clears `DRIVER_REQUIRED_WALLET_TO_GO_ONLINE`, and the only screen it could
   * point them at had a Withdraw button and nothing else. The app had a one-way
   * valve on the driver's own money.
   */
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [momoNetwork, setMomoNetwork] = useState<MomoNetwork>('MOMO_MTN');

  const topUp = useMutation({
    mutationFn: () =>
      driverApi.topUp({
        amountPesewas: pesewasFromCedis(parseFloat(topUpAmount)),
        method: momoNetwork,
      }),
    onSuccess: (res) => {
      const data = (res.data as any)?.data ?? {};
      const added = pesewasFromCedis(parseFloat(topUpAmount));
      setTopUpOpen(false);
      setTopUpAmount('');
      qc.invalidateQueries({ queryKey: ['driver', 'wallet'] });
      qc.invalidateQueries({ queryKey: ['driver', 'me'] });
      if (data.simulated) {
        // Say what actually happened. Claiming "check your phone for the MoMo
        // prompt" when no gateway exists is how a driver ends up waiting for a
        // prompt that is never coming.
        Alert.alert(
          'Wallet topped up',
          `${formatGhs(added)} has been added to your wallet.\n\nNo payment was taken — the payment gateway is not live yet, so top-ups are credited directly for now.`,
        );
      } else {
        Alert.alert(
          'Approve on your phone',
          `Approve the ${formatGhs(added)} mobile money prompt to finish topping up. Your balance updates once it clears.`,
        );
      }
    },
    onError: (err) => {
      const { title, message } = describeError(err, 'We could not add money to your wallet.');
      Alert.alert(title, message);
    },
  });

  const handleTopUp = () => {
    const amountPesewas = pesewasFromCedis(parseFloat(topUpAmount));
    if (isNaN(amountPesewas) || amountPesewas < MIN_TOPUP_PESEWAS) {
      Alert.alert('Enter an amount', `The smallest top-up is ${formatGhs(MIN_TOPUP_PESEWAS)}.`);
      return;
    }
    if (amountPesewas > MAX_TOPUP_PESEWAS) {
      Alert.alert('Too much at once', `The most you can add at once is ${formatGhs(MAX_TOPUP_PESEWAS)}.`);
      return;
    }
    topUp.mutate();
  };

  const withdraw = useMutation({
    // The driver TYPES cedis ("50"), and every balance and limit on this screen
    // is pesewas. This is the one direction the conversion has to run, and it
    // runs exactly here — the parsed text never travels any further as cedis.
    mutationFn: () => driverApi.withdraw({ amountPesewas: pesewasFromCedis(parseFloat(withdrawAmount)) }),
    onSuccess: () => {
      setSheetOpen(false);
      setWithdrawAmount('');
      qc.invalidateQueries({ queryKey: ['driver', 'wallet'] });
      // Balance is derived from ['driver','me'] (walletBalancePesewas), so refresh that too.
      qc.invalidateQueries({ queryKey: ['driver', 'me'] });
      Alert.alert('Withdrawal Submitted', `${formatGhs(pesewasFromCedis(parseFloat(withdrawAmount)))} is being processed to your mobile money account.`);
    },
    onError: (err) => Alert.alert('Withdrawal Failed', (err as Error).message),
  });

  const handleWithdraw = () => {
    // D12: validate amount before submitting withdrawal.
    // Converted to pesewas FIRST, so the comparisons below are pesewas-vs-
    // pesewas. Comparing typed cedis against a pesewas balance would have let a
    // driver "withdraw" GH₵50 against a GH₵0.50 balance.
    const amountPesewas = pesewasFromCedis(parseFloat(withdrawAmount));
    if (isNaN(amountPesewas) || amountPesewas <= 0) {
      Alert.alert('Invalid Amount', 'Enter a valid amount.');
      return;
    }
    if (amountPesewas < MIN_WITHDRAWAL_PESEWAS) {
      Alert.alert('Minimum Withdrawal', `The minimum withdrawal amount is ${formatGhs(MIN_WITHDRAWAL_PESEWAS)}.`);
      return;
    }
    if (amountPesewas > balance) {
      Alert.alert('Insufficient Balance', `You only have ${formatGhs(balance)} available.`);
      return;
    }
    Alert.alert(
      'Confirm Withdrawal',
      `Send ${formatGhs(amountPesewas)} to your mobile money account?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: () => withdraw.mutate() },
      ]
    );
  };

  // Derive chart data from real transactions.
  //
  // BUGFIX: every bucket below summed `t.amount`, a field the wallet ledger has
  // never had — the column is `amountPesewas`. `?? 0` then swallowed it, so the
  // earnings chart rendered a flat zero for every period on every device while
  // looking entirely healthy in code review.
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
          .reduce((s, t) => s + (t.amountPesewas ?? 0), 0),
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
            .reduce((s, t) => s + (t.amountPesewas ?? 0), 0),
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
          .reduce((s, t) => s + (t.amountPesewas ?? 0), 0),
      };
    });
  }, [txData, period]);

  // Withdrawable balance is the actual wallet balance, not lifetime totalEarned.
  const balance = meData?.walletBalancePesewas != null ? meData.walletBalancePesewas : 0;
  const currency = meData?.currency ?? 'GHS';
  const withdrawAmtPesewas = pesewasFromCedis(parseFloat(withdrawAmount));
  const canWithdraw =
    !isNaN(withdrawAmtPesewas) &&
    withdrawAmtPesewas >= MIN_WITHDRAWAL_PESEWAS &&
    withdrawAmtPesewas <= balance;

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
            <AnimatedFareText pesewas={balance} variant="fareLarge" color={colors.onSurface} shiny />
          )}
          <View style={styles.balanceMeta}>
            <View style={styles.currencyBadge}>
              <Text style={styles.currencyText}>{currency}</Text>
            </View>
          </View>
          {/*
            THE WAY BACK. A negative balance is not an edge case for a driver
            working cash — commission is debited per trip and cash fares credit
            nothing — and until this existed there was no screen in the app that
            could clear it. Stated in the driver's own terms ("you owe"), with
            the exact amount needed, because "top up your wallet" without a
            number is a puzzle.
          */}
          {balance < 0 && (
            <View style={styles.oweNotice}>
              <Ionicons name="alert-circle" size={15} color={colors.error} />
              <Text variant="caption" color={colors.error} style={{ flex: 1 }}>
                You owe {formatGhs(Math.abs(balance))} in commission. Top up to go back online.
              </Text>
            </View>
          )}
          <View style={styles.balanceActions}>
            <Button
              label="Top up"
              size="sm"
              onPress={() => {
                // Pre-fill enough to clear the debt AND meet the online floor,
                // so the common case is one tap.
                if (balance < 0) {
                  setTopUpAmount(String(Math.ceil((Math.abs(balance) + 2000) / 100)));
                }
                setTopUpOpen(true);
              }}
            />
            <Button
              label="Withdraw"
              size="sm"
              variant="secondary"
              onPress={() => setSheetOpen(true)}
              disabled={balance < MIN_WITHDRAWAL_PESEWAS}
            />
          </View>
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
                  // BUGFIX ("the top-up row just shows a dash"): the ledger
                  // column is `amountPesewas` — `tx.amount` has never existed,
                  // so every row formatted `undefined`. The ledger also stores
                  // SIGNED amounts (a debit is negative, and `balanceAfter =
                  // balanceBefore + amount` is asserted on write), so the sign
                  // is a fact about the row, not something to infer from the
                  // type list: a type missing from CREDIT_TYPES used to render
                  // a credit with a minus in front of it.
                  const amountPesewas = tx.amountPesewas ?? 0;
                  const isCredit = amountPesewas >= 0;
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
                {/* A row with no description used to render as nothing at all,
                    which is the other half of the reported blank/dash row. */}
                <Text style={styles.txDesc}>
                  {tx.description || (isCredit ? 'Wallet credit' : 'Wallet debit')}
                </Text>
                <Text variant="caption" color={colors.onSurfaceVariant}>
                  {new Date(tx.createdAt).toLocaleDateString()}
                </Text>
              </View>
              <Text style={[
                styles.txAmount,
                { color: isCredit ? colors.online : colors.error },
              ]}>
                {isCredit ? '+' : '-'}{formatGhs(Math.abs(amountPesewas))}
              </Text>
            </Entrance>
                  );
                })}
              </>
            );
          })()}
        </Entrance>
      </ScrollView>

      {/* Top-up sheet — same KeyboardStickyView treatment as Withdraw below,
          for the same reason (PanelSheet renders inside a Modal, which
          KeyboardAvoidingView never resizes correctly). */}
      <PanelSheet
        visible={topUpOpen}
        onDismiss={() => setTopUpOpen(false)}
        maxHeightPct={0.62}
        sheetStyle={styles.sheetBg}
        scrollable={false}
      >
        <View style={styles.sheetContent}>
          <View style={styles.sheetTitleRow}>
            <Text variant="titleLarge" style={styles.sheetTitle}>Top up wallet</Text>
            <Pressable
              onPress={() => { Keyboard.dismiss(); setTopUpOpen(false); }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Done, close top-up sheet"
            >
              <Text variant="label" color={colors.primary}>Done</Text>
            </Pressable>
          </View>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.sheetSub}>
            {balance < 0
              ? `You owe ${formatGhs(Math.abs(balance))}. Add at least that much to go back online.`
              : `Balance: ${formatGhs(balance)}`}
          </Text>

          <View style={styles.presetRow}>
            {TOPUP_PRESETS_PESEWAS.map((p) => (
              <Pressable
                key={p}
                style={styles.presetChip}
                onPress={() => setTopUpAmount(String(p / 100))}
                accessibilityRole="button"
                accessibilityLabel={`Top up ${formatGhs(p)}`}
              >
                <Text variant="label" color={colors.onSurface}>{formatGhs(p)}</Text>
              </Pressable>
            ))}
          </View>

          <Text variant="caption" color={colors.onSurfaceVariant} style={styles.networkLabel}>
            MOBILE MONEY NETWORK
          </Text>
          <View style={styles.presetRow}>
            {MOMO_NETWORKS.map((n) => (
              <Pressable
                key={n.value}
                style={[styles.presetChip, momoNetwork === n.value && styles.presetChipActive]}
                onPress={() => setMomoNetwork(n.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected: momoNetwork === n.value }}
                accessibilityLabel={n.label}
              >
                <Text
                  variant="label"
                  color={momoNetwork === n.value ? colors.onPrimary : colors.onSurfaceVariant}
                >
                  {n.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <KeyboardStickyView style={styles.stickyGroup}>
            <View style={styles.amountInputWrapper}>
              <Text style={styles.ghsPrefix}>GHS</Text>
              <TextInput
                style={styles.amountInput}
                value={topUpAmount}
                onChangeText={setTopUpAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={colors.onSurfaceVariant}
                selectionColor={colors.primary}
                accessibilityLabel="Top-up amount in cedis"
              />
            </View>
            <Button
              label="Add money"
              onPress={handleTopUp}
              disabled={topUp.isPending}
              loading={topUp.isPending}
              style={styles.confirmBtn}
            />
          </KeyboardStickyView>
        </View>
      </PanelSheet>

      {/* Withdraw sheet */}
      {/* scrollable=false: content is short and doesn't need PanelSheet's own
          gesture-arbitrated ScrollView. Amount input + confirm button are
          wrapped in KeyboardStickyView (same pattern as dispute.tsx / rate-tip.tsx)
          instead of KeyboardAvoidingView — KeyboardAvoidingView never reliably
          resized content living inside PanelSheet's Modal, so the keyboard just
          slid up over the fixed-position sheet and covered the amount input and
          Confirm button. KeyboardStickyView tracks the real keyboard frame via
          react-native-keyboard-controller's native listeners and translates the
          group above it regardless of the Modal's layout quirks. */}
      <PanelSheet visible={sheetOpen} onDismiss={() => setSheetOpen(false)} maxHeightPct={0.5} sheetStyle={styles.sheetBg} scrollable={false}>
        <View style={styles.sheetContent}>
          <View style={styles.sheetTitleRow}>
            <Text variant="titleLarge" style={styles.sheetTitle}>Withdraw Funds</Text>
            {/* A header button labeled "Done" reads as "close this sheet" (the
                standard iOS/Android sheet convention) — it previously only
                called Keyboard.dismiss(), so tapping it left the sheet open
                with no visible change, which looked like the button (and the
                backdrop-tap fallback) simply didn't work. Close the sheet for
                real; dismissing the keyboard first avoids the Android
                stuck-keyboard issue the PanelSheet backdrop tap already guards
                against (see PanelSheet.tsx's `dismiss`). */}
            <Pressable
              onPress={() => { Keyboard.dismiss(); setSheetOpen(false); }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Done, close withdraw sheet"
            >
              <Text variant="label" color={colors.primary}>Done</Text>
            </Pressable>
          </View>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.sheetSub}>
            Balance: {formatGhs(balance)} · Min. GHS 20
          </Text>
          <KeyboardStickyView style={styles.stickyGroup}>
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
          </KeyboardStickyView>
        </View>
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
    balanceActions: { flexDirection: 'row', gap: spacing.sm, alignSelf: 'flex-start' },
    oweNotice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radii.lg,
      backgroundColor: `${colors.error}18`,
      borderWidth: 1,
      borderColor: `${colors.error}44`,
      marginBottom: spacing.md,
    },
    presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
    presetChip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radii.full,
      borderWidth: 1,
      borderColor: colors.outlineVariant ?? `${colors.onSurface}22`,
      backgroundColor: colors.surfaceContainer,
    },
    presetChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    networkLabel: { letterSpacing: 1, marginBottom: spacing.sm },
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
    sheetTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    sheetTitle: { fontFamily: fonts.displayBold },
    sheetSub: { marginTop: -spacing.sm },
    stickyGroup: { gap: spacing.lg },
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
