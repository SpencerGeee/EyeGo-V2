import React, { useState, useMemo } from 'react';
import { formatGhs, pesewasFromCedis, describeError } from '@eyego/utils';
import { View, StyleSheet, Pressable, TextInput, Keyboard, Alert, RefreshControl } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { driverApi, MOMO_NETWORKS, type MomoNetwork } from '@eyego/api';
import { usePlatformConfig } from '../../hooks/usePlatformConfig';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import {
  Text,
  Button,
  AnimatedFareText,
  PanelSheet,
  GradientGlowBorder,
  Screen,
  ListSection,
  ListRow,
  goDeeper,
  notify,
  useBiometricGate,
  BiometricLock,
} from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../utils/useColors';
import { EarningsChart, type ChartDataPoint } from '../../components/EarningsChart';

type Period = 'today' | 'week' | 'month';

/**
 * Every ledger type that counts as money the driver made — fares (online and
 * cash), promo subsidy, tips and quest bonuses. Mirrors the server's daily
 * breakdown so the hourly "Today" bars and the week/month bars mean the same.
 * `CASH_EARNING` is ledger-only (cash is handed over in person) but is income.
 */
const CREDIT_TYPES = ['TRIP_EARNING', 'EARNINGS_CREDIT', 'CASH_EARNING', 'PROMO_SUBSIDY', 'QUEST_BONUS', 'TIP'];

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

/** Rows shown per period; the rest is one tap away in the statement. */
const TX_SHOWN = 30;
const TX_LIMIT_FOR_PERIOD: Record<Period, number> = { today: 50, week: 150, month: 500 };

/** Start of the selected period, local time — the chart and the list share it. */
function periodStart(period: Period, now = new Date()): Date {
  if (period === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'week') return new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

const localKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Week-of-month buckets: 4 or 5 — the old fixed four dropped the 29th–31st. */
function monthBuckets(now: Date) {
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Array.from({ length: Math.ceil(dim / 7) }, (_, i) => {
    const from = 1 + i * 7;
    const to = Math.min(dim, from + 6);
    return { from, to, label: `${from}–${to}` };
  });
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Whole day in 3-hour bars — the old 8am–10pm window hid early and late trips. */
const HOUR_BUCKETS = [0, 3, 6, 9, 12, 15, 18, 21];
const hourLabel = (h: number) => (h === 0 ? '12a' : h === 12 ? '12p' : h > 12 ? `${h - 12}p` : `${h}a`);

export default function EarningsScreen() {
  const gate = useBiometricGate({ reason: 'Unlock your earnings' });
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { driverMinWithdrawalPesewas: MIN_WITHDRAWAL_PESEWAS, driverRequiredWalletPesewas } = usePlatformConfig();
  const [period, setPeriod] = useState<Period>('week');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const qc = useQueryClient();

  const { data: meData, isLoading, refetch: refetchMe, isRefetching } = useQuery({
    queryKey: ['driver', 'me'],
    queryFn: () => driverApi.getMe(),
    select: (r) => (r.data as any).data?.driver ?? (r.data as any).data,
    retry: 1,
    staleTime: 30_000,
  });

  /**
   * THE STATEMENT — the server's arithmetic over the whole period. Failure is
   * not fatal: the balance, the rows and a phone-derived chart still render.
   */
  const { data: statement, isError: statementFailed, refetch: refetchStatement } = useQuery({
    queryKey: ['driver', 'earnings', 'breakdown', period],
    queryFn: () => driverApi.getEarningsBreakdown(period),
    select: (r) => (r.data as any)?.data ?? null,
    staleTime: 30_000,
    retry: 1,
  });

  const { data: txData, refetch: refetchTx } = useQuery({
    queryKey: ['driver', 'wallet', 'transactions', period],
    queryFn: () => driverApi.getWalletTransactions({ limit: TX_LIMIT_FOR_PERIOD[period] }),
    select: (r) => {
      const d = (r.data as any)?.data;
      if (Array.isArray(d)) return d;
      if (Array.isArray(d?.transactions)) return d.transactions;
      if (Array.isArray(d?.items)) return d.items;
      return [];
    },
  });

  // The weekly goal (TRIPS) moved here from the old performance page.
  const { data: perf, refetch: refetchPerf } = useQuery({
    queryKey: ['driver', 'performance'],
    queryFn: () => driverApi.getPerformance(),
    select: (r) => r.data.data,
    staleTime: 60_000,
  });

  /**
   * PUTTING MONEY IN. A driver working cash has commission debited with no
   * matching credit, so the balance goes negative and goOnline refuses them
   * until it clears. This is the way back.
   */
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [momoNetwork, setMomoNetwork] = useState<MomoNetwork>('MOMO_MTN');

  const topUp = useMutation({
    mutationFn: (amountPesewas: number) => driverApi.topUp({ amountPesewas, method: momoNetwork }),
    onSuccess: (res, added) => {
      const data = (res.data as any)?.data ?? {};
      setTopUpOpen(false);
      setTopUpAmount('');
      qc.invalidateQueries({ queryKey: ['driver', 'wallet'] });
      qc.invalidateQueries({ queryKey: ['driver', 'me'] });
      if (data.simulated) {
        // Say what actually happened — there is no MoMo prompt coming.
        notify(
          'Wallet topped up',
          `${formatGhs(added)} has been added to your wallet.\n\nNo payment was taken — the payment gateway is not live yet, so top-ups are credited directly for now.`,
          { tone: 'success' },
        );
      } else {
        notify(
          'Approve on your phone',
          `Approve the ${formatGhs(added)} mobile money prompt to finish topping up. Your balance updates once it clears.`,
        );
      }
    },
    onError: (err) => {
      const { title, message } = describeError(err, 'We could not add money to your wallet.');
      notify(title, message);
    },
  });

  const handleTopUp = () => {
    const amountPesewas = pesewasFromCedis(parseFloat(topUpAmount));
    if (isNaN(amountPesewas) || amountPesewas < MIN_TOPUP_PESEWAS) {
      notify('Enter an amount', `The smallest top-up is ${formatGhs(MIN_TOPUP_PESEWAS)}.`);
      return;
    }
    if (amountPesewas > MAX_TOPUP_PESEWAS) {
      notify('Too much at once', `The most you can add at once is ${formatGhs(MAX_TOPUP_PESEWAS)}.`);
      return;
    }
    Keyboard.dismiss();
    topUp.mutate(amountPesewas);
  };

  const withdraw = useMutation({
    // The driver types cedis; everything past this line is pesewas.
    mutationFn: (amountPesewas: number) => driverApi.withdraw({ amountPesewas }),
    onSuccess: (res, amountPesewas) => {
      setSheetOpen(false);
      setWithdrawAmount('');
      qc.invalidateQueries({ queryKey: ['driver', 'wallet'] });
      qc.invalidateQueries({ queryKey: ['driver', 'me'] });
      const serverMessage = (res.data as any)?.data?.message;
      notify(
        'Cash out on its way',
        serverMessage ?? `${formatGhs(amountPesewas)} is being sent to your payout account.`,
        { tone: 'success' },
      );
    },
    onError: (err) => {
      const { title, message } = describeError(err, 'We could not send your cash out.');
      notify(title, message);
    },
  });

  const balance: number = meData?.walletBalancePesewas ?? 0;

  const handleWithdraw = () => {
    const amountPesewas = pesewasFromCedis(parseFloat(withdrawAmount));
    if (isNaN(amountPesewas) || amountPesewas <= 0) {
      notify('Enter an amount', 'Type how much you want to cash out.');
      return;
    }
    if (amountPesewas < MIN_WITHDRAWAL_PESEWAS) {
      notify('Below the minimum', `The smallest cash out is ${formatGhs(MIN_WITHDRAWAL_PESEWAS)}.`);
      return;
    }
    if (amountPesewas > balance) {
      notify('Not enough balance', `You have ${formatGhs(balance)} available.`);
      return;
    }
    Keyboard.dismiss();
    Alert.alert('Cash out', `Send ${formatGhs(amountPesewas)} to your payout account?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send', onPress: () => withdraw.mutate(amountPesewas) },
    ]);
  };

  // Phone-side bars: the fallback for week/month, the only source for "today".
  const derivedChartData = useMemo((): ChartDataPoint[] => {
    const credits: any[] = (Array.isArray(txData) ? txData : []).filter((t: any) => CREDIT_TYPES.includes(t.type));
    const now = new Date();
    const amt = (t: any) => Math.abs(t.amountPesewas ?? 0);

    if (period === 'today') {
      const today = now.toDateString();
      return HOUR_BUCKETS.map((h) => ({
        label: hourLabel(h),
        value: credits
          .filter((t) => {
            const d = new Date(t.createdAt);
            return d.toDateString() === today && d.getHours() >= h && d.getHours() < h + 3;
          })
          .reduce((s, t) => s + amt(t), 0),
      }));
    }
    if (period === 'week') {
      const start = periodStart('week', now);
      return Array.from({ length: 7 }, (_, i) => {
        const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        return {
          label: DAY_LABELS[day.getDay()],
          value: credits.filter((t) => new Date(t.createdAt).toDateString() === day.toDateString()).reduce((s, t) => s + amt(t), 0),
        };
      });
    }
    return monthBuckets(now).map((b) => ({
      label: b.label,
      value: credits
        .filter((t) => {
          const d = new Date(t.createdAt);
          return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() >= b.from && d.getDate() <= b.to;
        })
        .reduce((s, t) => s + amt(t), 0),
    }));
  }, [txData, period]);

  /** Server-backed for week and month; never mixed with the derivation within a period. */
  const chartData = useMemo((): ChartDataPoint[] => {
    const days: { date: string; earnings: number }[] = Array.isArray(statement?.dailyBreakdown) ? statement.dailyBreakdown : [];
    if (period === 'today' || statementFailed || !statement) return derivedChartData;
    // Server keys are UTC dates — the same calendar day in Ghana (UTC+0).
    const byDate = new Map(days.map((d) => [d.date, d.earnings ?? 0]));
    const now = new Date();
    if (period === 'week') {
      const start = periodStart('week', now);
      return Array.from({ length: 7 }, (_, i) => {
        const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        return { label: DAY_LABELS[day.getDay()], value: byDate.get(localKey(day)) ?? 0 };
      });
    }
    return monthBuckets(now).map((b) => {
      let value = 0;
      for (let d = b.from; d <= b.to; d++) value += byDate.get(localKey(new Date(now.getFullYear(), now.getMonth(), d))) ?? 0;
      return { label: b.label, value };
    });
  }, [statement, statementFailed, derivedChartData, period]);

  // The rows the list shows are the selected period's — it used to show the
  // latest N whatever the toggle said.
  const periodTx = useMemo(() => {
    const since = periodStart(period).getTime();
    return (Array.isArray(txData) ? txData : []).filter((t: any) => new Date(t.createdAt).getTime() >= since);
  }, [txData, period]);

  const withdrawAmtPesewas = pesewasFromCedis(parseFloat(withdrawAmount));
  const canWithdraw = !isNaN(withdrawAmtPesewas) && withdrawAmtPesewas >= MIN_WITHDRAWAL_PESEWAS && withdrawAmtPesewas <= balance;

  const goal = perf?.weeklyGoal ?? 0;
  const goalDone = perf?.weeklyGoalProgress ?? 0;

  const onRefresh = () => {
    refetchMe();
    refetchStatement();
    refetchTx();
    refetchPerf();
  };

  if (gate.state !== 'unlocked') {
    // The money is behind the face — see BiometricGate in @eyego/ui.
    return (
      <SafeAreaView style={styles.locked}>
        <BiometricLock state={gate.state} failed={gate.failed} onRetry={gate.retry} label="Unlock to view your earnings" />
      </SafeAreaView>
    );
  }

  return (
    <>
      <Screen
        title="Earnings"
        back={false}
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Balance — the screen's one glow */}
        <View style={styles.balanceWrap}>
          <GradientGlowBorder palette="gold" fillColor={colors.surfaceContainerHigh} borderRadius={radii['2xl']} glow style={styles.balanceCard}>
            <Text variant="labelCaps" color={colors.onSurfaceVariant}>Balance</Text>
            {isLoading ? (
              <Text style={styles.balanceAmount}>GH₵—</Text>
            ) : (
              <AnimatedFareText pesewas={balance} variant="fareLarge" color={balance < 0 ? colors.error : colors.onSurface} />
            )}
            {balance < 0 ? (
              <View style={styles.oweNotice}>
                <Ionicons name="alert-circle" size={15} color={colors.error} />
                <Text variant="caption" color={colors.error} style={{ flex: 1 }}>
                  You owe {formatGhs(Math.abs(balance))} in commission. Top up to go back online.
                </Text>
              </View>
            ) : null}
            <View style={styles.balanceActions}>
              <Button
                label="Top up"
                size="sm"
                onPress={() => {
                  // Enough to clear the debt AND meet the online floor, so the
                  // common case is one tap.
                  if (balance < 0) setTopUpAmount(String(Math.ceil((Math.abs(balance) + driverRequiredWalletPesewas) / 100)));
                  setTopUpOpen(true);
                }}
              />
              <Button
                label="Cash out"
                size="sm"
                variant="secondary"
                onPress={() => setSheetOpen(true)}
                disabled={balance < MIN_WITHDRAWAL_PESEWAS}
              />
            </View>
          </GradientGlowBorder>
        </View>

        <ListSection>
          <ListRow icon="card-outline" title="Payout account" onPress={() => goDeeper('/(profile)/payout-account')} />
        </ListSection>

        {/* Weekly goal (trips, Sun–Sat) */}
        {perf && goal > 0 ? (
          <View style={styles.block}>
            <Text variant="labelCaps" color={colors.onSurfaceVariant}>Weekly goal</Text>
            <View style={styles.goalRow}>
              <Text style={styles.goalNumber}>
                {Math.min(goalDone, goal)}
                <Text style={styles.goalOf}> of {goal} trips</Text>
              </Text>
              <Text variant="caption" color={goalDone >= goal ? colors.primary : colors.onSurfaceVariant}>
                {goalDone >= goal ? 'Goal reached' : `${goal - goalDone} to go`}
              </Text>
            </View>
            <View style={styles.track} accessible accessibilityLabel={`${goalDone} of ${goal} trips this week`}>
              <View style={[styles.fill, { width: `${Math.min(100, Math.round((goalDone / goal) * 100))}%` }]} />
            </View>
          </View>
        ) : null}

        {/* Period */}
        <View style={styles.segment} accessibilityRole="tablist">
          {PERIODS.map((p) => {
            const on = period === p.key;
            return (
              <Pressable
                key={p.key}
                style={[styles.segmentBtn, on && styles.segmentOn]}
                onPress={() => setPeriod(p.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.segmentText, { color: on ? colors.onSurface : colors.onSurfaceVariant }]}>{p.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.block}>
          <EarningsChart period={period} data={chartData} />
        </View>

        {/* Statement — the server's arithmetic. Hidden on failure rather than
            rendered as zeros: "you earned GH₵0.00" is a claim. */}
        {!statementFailed && statement ? (
          <ListSection
            title="Statement"
            footer={`${statement.totalTrips ?? 0} ${(statement.totalTrips ?? 0) === 1 ? 'trip' : 'trips'}${
              (statement.totalTrips ?? 0) > 0 ? ` · ${formatGhs(statement.averagePerTripPesewas ?? 0)} average fare` : ''
            }. Cash outs are not deductions — they're your money moving.`}
          >
            <ListRow title="Fares" value={formatGhs(statement.totalEarningsPesewas ?? 0)} valueColor={colors.onSurface} />
            {(statement.totalTips ?? 0) > 0 ? <ListRow title="Tips" value={formatGhs(statement.totalTips)} valueColor={colors.onSurface} /> : null}
            {(statement.totalBonuses ?? 0) > 0 ? <ListRow title="Quest bonuses" value={formatGhs(statement.totalBonuses ?? 0)} valueColor={colors.onSurface} /> : null}
            <ListRow title="Commission" value={`−${formatGhs(Math.abs(statement.totalDeductions ?? 0))}`} valueColor={colors.error} />
            <ListRow
              title="Net"
              value={formatGhs(statement.netEarnings ?? 0)}
              valueColor={(statement.netEarnings ?? 0) < 0 ? colors.error : colors.onSurface}
            />
          </ListSection>
        ) : null}

        <ListSection
          title="Activity"
          footer={periodTx.length > TX_SHOWN ? `Showing the latest ${TX_SHOWN} of ${periodTx.length}.` : undefined}
        >
          {periodTx.length === 0 ? (
            <ListRow icon="receipt-outline" title="Nothing yet" subtitle={`No wallet activity ${period === 'today' ? 'today' : `this ${period}`}.`} />
          ) : (
            periodTx.slice(0, TX_SHOWN).map((tx: any) => {
              // Server-signed (see signedLedgerAmount): a debit is negative.
              const amount = tx.amountPesewas ?? 0;
              const credit = amount >= 0;
              const when = new Date(tx.createdAt);
              return (
                <ListRow
                  key={tx.id}
                  leading={
                    <View style={[styles.txIcon, { backgroundColor: credit ? `${colors.online}22` : `${colors.error}1F` }]}>
                      <Ionicons name={credit ? 'arrow-down' : 'arrow-up'} size={15} color={credit ? colors.online : colors.error} />
                    </View>
                  }
                  title={tx.description || (credit ? 'Wallet credit' : 'Wallet debit')}
                  subtitle={`${when.toLocaleDateString('en-GH', { day: 'numeric', month: 'short' })} · ${when.toLocaleTimeString('en-GH', { hour: 'numeric', minute: '2-digit' })}`}
                  subtitleLines={1}
                  value={`${credit ? '+' : '−'}${formatGhs(Math.abs(amount))}`}
                  valueColor={credit ? colors.online : colors.error}
                />
              );
            })
          )}
        </ListSection>
      </Screen>

      {/* Top-up sheet. KeyboardStickyView, not KeyboardAvoidingView — PanelSheet
          renders in a Modal, which KeyboardAvoidingView never resizes. */}
      <PanelSheet
        visible={topUpOpen}
        // Dismissing takes the keyboard with it, or iOS leaves it up over nothing.
        onDismiss={() => { Keyboard.dismiss(); setTopUpOpen(false); }}
        maxHeightPct={0.85}
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
              accessibilityLabel="Close top-up"
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
            {TOPUP_PRESETS_PESEWAS.map((p) => {
              const on = pesewasFromCedis(parseFloat(topUpAmount)) === p;
              return (
                <Pressable
                  key={p}
                  style={[styles.presetChip, on && styles.presetChipActive]}
                  onPress={() => setTopUpAmount(String(p / 100))}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`Top up ${formatGhs(p)}`}
                >
                  <Text variant="label" color={on ? colors.onPrimary : colors.onSurface}>{formatGhs(p, { showDecimals: false })}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text variant="labelCaps" color={colors.onSurfaceVariant}>Mobile money network</Text>
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
                <Text variant="label" color={momoNetwork === n.value ? colors.onPrimary : colors.onSurfaceVariant}>
                  {n.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <KeyboardStickyView style={styles.stickyGroup}>
            <View style={styles.amountInputWrapper}>
              <Text style={styles.ghsPrefix}>GH₵</Text>
              <TextInput
                maxFontSizeMultiplier={1.4}
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
            <Button label="Add money" onPress={handleTopUp} disabled={topUp.isPending} loading={topUp.isPending} />
          </KeyboardStickyView>
        </View>
      </PanelSheet>

      {/* Cash-out sheet */}
      <PanelSheet
        visible={sheetOpen}
        onDismiss={() => { Keyboard.dismiss(); setSheetOpen(false); }}
        maxHeightPct={0.6}
        sheetStyle={styles.sheetBg}
        scrollable={false}
      >
        <View style={styles.sheetContent}>
          <View style={styles.sheetTitleRow}>
            <Text variant="titleLarge" style={styles.sheetTitle}>Cash out</Text>
            <Pressable
              onPress={() => { Keyboard.dismiss(); setSheetOpen(false); }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close cash out"
            >
              <Text variant="label" color={colors.primary}>Done</Text>
            </Pressable>
          </View>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.sheetSub}>
            Available {formatGhs(balance)} · minimum {formatGhs(MIN_WITHDRAWAL_PESEWAS, { showDecimals: false })}
          </Text>
          <KeyboardStickyView style={styles.stickyGroup}>
            <View style={styles.amountInputWrapper}>
              <Text style={styles.ghsPrefix}>GH₵</Text>
              <TextInput
                maxFontSizeMultiplier={1.4}
                style={styles.amountInput}
                value={withdrawAmount}
                onChangeText={setWithdrawAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={colors.onSurfaceVariant}
                selectionColor={colors.primary}
                accessibilityLabel="Cash out amount in cedis"
              />
              {balance >= MIN_WITHDRAWAL_PESEWAS ? (
                <Pressable onPress={() => setWithdrawAmount(String(balance / 100))} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cash out everything">
                  <Text variant="label" color={colors.primary}>All</Text>
                </Pressable>
              ) : null}
            </View>
            <Button
              label="Cash out"
              onPress={handleWithdraw}
              disabled={!canWithdraw || withdraw.isPending}
              loading={withdraw.isPending}
            />
          </KeyboardStickyView>
        </View>
      </PanelSheet>
    </>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    locked: { flex: 1, backgroundColor: colors.background },
    balanceWrap: { marginHorizontal: 20, marginTop: 8 },
    balanceCard: { padding: spacing.xl, gap: spacing.xs },
    balanceAmount: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.hero,
      lineHeight: Math.round(fontSizes.hero * 1.3),
      color: colors.onSurface,
      letterSpacing: -1,
    },
    balanceActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    oweNotice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radii.lg,
      backgroundColor: `${colors.error}18`,
      marginTop: spacing.xs,
    },
    block: { marginTop: 24, paddingHorizontal: 20 },
    goalRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 6, marginBottom: 10 },
    goalNumber: { fontFamily: fonts.displayBold, fontSize: 22, lineHeight: 28, color: colors.onSurface },
    goalOf: { fontFamily: fonts.regular, fontSize: 15, color: colors.onSurfaceVariant },
    track: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceContainerHighest, overflow: 'hidden' },
    fill: { height: '100%', borderRadius: 3, backgroundColor: colors.primary },
    segment: {
      flexDirection: 'row',
      marginTop: 28,
      marginHorizontal: 20,
      padding: 3,
      borderRadius: radii.full,
      backgroundColor: colors.surfaceContainer,
    },
    segmentBtn: { flex: 1, height: 36, borderRadius: radii.full, alignItems: 'center', justifyContent: 'center' },
    segmentOn: { backgroundColor: colors.surfaceContainerHighest },
    segmentText: { fontFamily: fonts.semiBold, fontSize: 14, lineHeight: 18 },
    txIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    presetChip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radii.full,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      backgroundColor: colors.surfaceContainer,
    },
    presetChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    sheetBg: { backgroundColor: colors.surfaceContainerHigh },
    // Tight rhythm on purpose: the top-up sheet once ran past its own height
    // cap and the sticky input landed on the chip rows above it.
    sheetContent: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.xl, paddingBottom: spacing.lg, gap: spacing.md },
    sheetTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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
      // No lineHeight on a TextInput: Android clips the glyphs with one set.
      color: colors.onSurface,
      paddingVertical: 0,
    },
  });
