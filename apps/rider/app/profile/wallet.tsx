import React, { useState, useMemo } from 'react';
import { View, StyleSheet, TextInput, Pressable, Keyboard, RefreshControl } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { walletApi, paymentsApi, queryKeys, MOMO_NETWORKS, type MomoNetwork } from '@eyego/api';
import { fonts, radii, spacing } from '@eyego/config';
import {
  Text,
  Button,
  Skeleton,
  GradientGlowBorder,
  PREMIUM_RING_LOCATIONS,
  PanelSheet,
  Screen,
  ListSection,
  ListRow,
  SkeletonRows,
  goDeeper,
  notify,
  useBiometricGate,
  BiometricLock,
} from '@eyego/ui';
import { formatGhs, pesewasFromCedis, pesewasToDecimalString, ghanaLocalDigits, describeError } from '@eyego/utils';
import { useColors, Colors } from '../../utils/useColors';
import { useWalletBalance } from '../../hooks/useWalletBalance';
import { useAuthStore } from '../../stores/auth.store';

// Two emerald arcs orbiting a near-black ring — the page's one glow.
const GREEN_RING_COLORS = [
  '#0A0A0C', '#0A0A0C', '#4be277', '#b1f2c5', '#4be277', '#0A0A0C',
  '#0A0A0C', '#4be277', '#b1f2c5', '#4be277', '#0A0A0C', '#0A0A0C',
] as const;

const PRESETS_PESEWAS = [2000, 5000, 10000, 20000];
const MIN_TOPUP_PESEWAS = 100;
const MAX_TOPUP_PESEWAS = 500_000;

/** The network a Ghanaian number is on, from its prefix — the default chip. */
function networkFor(local9: string): MomoNetwork {
  const p = local9.slice(0, 2);
  if (['20', '50'].includes(p)) return 'MOMO_TELECEL';
  if (['26', '56', '27', '57'].includes(p)) return 'MOMO_AIRTELTIGO';
  return 'MOMO_MTN';
}

/**
 * WALLET (rival spec §8) — balance hero + Top up, then money actions, then
 * activity with signed amounts and pending/failed in grey.
 *
 * Top-up used to send `method: "MOMO"`, which the live gateway rejects
 * ("Unsupported MoMo method") — every real rider top-up failed. The rider now
 * picks the network and number; the server also reads the network off the
 * number as a fallback. The "Standard / Silver / Gold Rider" chip was invented
 * here from trip counts the server knows nothing about, so it is gone.
 */
export default function WalletScreen() {
  const gate = useBiometricGate({ reason: 'Unlock your wallet' });
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const myLocal = ghanaLocalDigits(user?.phone ?? '');
  const [sheet, setSheet] = useState(false);
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState(myLocal);
  const [network, setNetwork] = useState<MomoNetwork>(networkFor(myLocal));
  const [verifying, setVerifying] = useState(false);

  const balanceQ = useWalletBalance({ refetchInterval: 15_000 });
  const txQ = useQuery({
    queryKey: queryKeys.wallet.transactions(),
    queryFn: () => walletApi.getTransactions(),
  });
  const transactions: any[] = (txQ.data as any)?.data?.data?.transactions ?? (txQ.data as any)?.data?.transactions ?? [];

  const amountPesewas = pesewasFromCedis(parseFloat(amount));
  const amountOk = Number.isFinite(amountPesewas) && amountPesewas >= MIN_TOPUP_PESEWAS && amountPesewas <= MAX_TOPUP_PESEWAS;
  const phoneOk = /^[235]\d{8}$/.test(phone);

  const topUp = useMutation({
    mutationFn: (p: number) => walletApi.topUp({ amountPesewas: p, method: network, momoPhone: `0${phone}` }),
    onSuccess: async (res, p) => {
      const reference = (res as any)?.data?.data?.reference;
      setSheet(false);
      setAmount('');
      if (!reference) {
        notify('Approve on your phone', 'Approve the mobile money prompt to finish your top-up.');
        return;
      }
      // Initiated, not paid: the balance moves when the network confirms.
      setVerifying(true);
      try {
        await paymentsApi.pollWalletTopup(reference);
        qc.invalidateQueries({ queryKey: queryKeys.wallet.balance() });
        qc.invalidateQueries({ queryKey: queryKeys.wallet.transactions() });
        notify('Money added', `${formatGhs(p)} is in your wallet.`, { tone: 'success' });
      } catch {
        notify('Not confirmed yet', 'If you approved the prompt, your balance updates shortly. Otherwise, try again.');
      } finally {
        setVerifying(false);
      }
    },
    onError: (err) => {
      const { title, message } = describeError(err, 'Your top-up couldn’t be started. Please try again.');
      notify(title, message);
    },
  });

  const submit = () => {
    if (!amountOk) {
      notify('Check the amount', `Top up between ${formatGhs(MIN_TOPUP_PESEWAS)} and ${formatGhs(MAX_TOPUP_PESEWAS, { showDecimals: false })}.`);
      return;
    }
    if (!phoneOk) {
      notify('Check the number', 'Enter the 10-digit mobile money number, e.g. 024 123 4567.');
      return;
    }
    Keyboard.dismiss();
    topUp.mutate(amountPesewas);
  };

  if (gate.state !== 'unlocked') {
    // The money is behind the face — see BiometricGate in @eyego/ui.
    return (
      <SafeAreaView style={styles.locked}>
        <BiometricLock state={gate.state} failed={gate.failed} onRetry={gate.retry} />
      </SafeAreaView>
    );
  }

  const balance = balanceQ.data;

  return (
    <>
      <Screen
        title="Wallet"
        refreshControl={
          <RefreshControl
            refreshing={balanceQ.isRefetching || txQ.isRefetching}
            onRefresh={() => { balanceQ.refetch(); txQ.refetch(); }}
            tintColor={colors.primary}
          />
        }
      >
        <View style={styles.heroWrap}>
          <GradientGlowBorder
            colors={GREEN_RING_COLORS}
            locations={PREMIUM_RING_LOCATIONS}
            fillColor={colors.surfaceContainerHigh}
            borderRadius={radii['2xl']}
            glow
            glowColor={colors.primary}
            style={styles.hero}
          >
            <Text variant="labelCaps" color={colors.onSurfaceVariant}>EyeGo balance</Text>
            {balanceQ.isPending ? (
              <Skeleton width={180} height={44} borderRadius={8} style={{ marginTop: 8 }} />
            ) : balance == null && balanceQ.isError ? (
              // "We could not ask" must never read as "you have nothing".
              <Pressable onPress={() => void balanceQ.refetch()} style={styles.retry} accessibilityRole="button" accessibilityLabel="Retry loading your balance">
                <Ionicons name="refresh" size={16} color={colors.onSurfaceVariant} />
                <Text variant="bodyMedium" color={colors.onSurfaceVariant}>Couldn’t load · Retry</Text>
              </Pressable>
            ) : (
              <View style={styles.balanceRow}>
                <Text style={styles.currency}>GH₵</Text>
                <Text style={styles.balance}>{pesewasToDecimalString(balance ?? 0)}</Text>
              </View>
            )}
            {balanceQ.isError && balance != null && balanceQ.dataUpdatedAt > 0 ? (
              <Text variant="caption" color={colors.onSurfaceVariant}>
                As of {Math.max(1, Math.round((Date.now() - balanceQ.dataUpdatedAt) / 60_000))} min ago
              </Text>
            ) : null}
            <Button
              label={verifying ? 'Confirming…' : 'Top up'}
              onPress={() => setSheet(true)}
              loading={verifying}
              disabled={verifying}
              style={{ marginTop: 16, alignSelf: 'flex-start' }}
              size="sm"
            />
          </GradientGlowBorder>
        </View>

        <ListSection>
          <ListRow icon="paper-plane-outline" title="Send credits" subtitle="To another EyeGo rider" onPress={() => goDeeper('/profile/send-money')} />
          <ListRow icon="qr-code-outline" title="Scan & pay" onPress={() => goDeeper('/profile/scan-pay')} />
          <ListRow icon="card-outline" title="Payment methods" onPress={() => goDeeper('/profile/payment-methods')} />
        </ListSection>

        {txQ.isPending ? (
          <SkeletonRows count={4} />
        ) : txQ.isError && transactions.length === 0 ? (
          <ListSection title="Activity">
            <ListRow icon="refresh" title="Couldn’t load your activity" subtitle="Tap to try again" onPress={() => void txQ.refetch()} />
          </ListSection>
        ) : (
          <ListSection title="Activity">
            {transactions.length === 0 ? (
              <ListRow icon="receipt-outline" title="No activity yet" subtitle="Top-ups, transfers and wallet fares show here." />
            ) : (
              transactions.map((tx) => {
                const kind: string = tx.type;
                const credit = kind === 'CREDIT';
                const debit = kind === 'DEBIT';
                const muted = kind === 'PENDING' || kind === 'FAILED' || kind === 'EXTERNAL';
                const when = new Date(tx.createdAt);
                return (
                  <ListRow
                    key={tx.id}
                    leading={
                      <View style={[styles.txIcon, { backgroundColor: credit ? `${colors.statusSuccess}22` : colors.surfaceContainerHigh }]}>
                        <Ionicons
                          name={credit ? 'arrow-down' : debit ? 'arrow-up' : kind === 'FAILED' ? 'close' : kind === 'PENDING' ? 'time-outline' : 'car-outline'}
                          size={15}
                          color={credit ? colors.statusSuccess : colors.onSurfaceVariant}
                        />
                      </View>
                    }
                    title={tx.description}
                    subtitle={`${when.toLocaleDateString('en-GH', { day: 'numeric', month: 'short' })} · ${when.toLocaleTimeString('en-GH', { hour: 'numeric', minute: '2-digit' })}${kind === 'PENDING' ? ' · Pending' : kind === 'FAILED' ? ' · Failed' : ''}`}
                    subtitleLines={1}
                    value={`${credit ? '+' : debit ? '−' : ''}${formatGhs(Math.abs(tx.amountPesewas ?? 0))}`}
                    valueColor={credit ? colors.statusSuccess : muted ? colors.onSurfaceVariant : colors.onSurface}
                  />
                );
              })
            )}
          </ListSection>
        )}
      </Screen>

      <PanelSheet
        visible={sheet}
        onDismiss={() => { Keyboard.dismiss(); setSheet(false); }}
        maxHeightPct={0.9}
        sheetStyle={{ backgroundColor: colors.surfaceContainerHigh }}
        scrollable={false}
      >
        <View style={styles.sheet}>
          <View style={styles.sheetBar}>
            <Text style={styles.sheetTitle}>Top up</Text>
            <Pressable onPress={() => { Keyboard.dismiss(); setSheet(false); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close top up">
              <Text variant="label" color={colors.primary}>Done</Text>
            </Pressable>
          </View>

          <View style={styles.chips}>
            {PRESETS_PESEWAS.map((p) => {
              const on = amountPesewas === p;
              return (
                <Pressable
                  key={p}
                  style={[styles.chip, on && styles.chipOn]}
                  onPress={() => setAmount(String(p / 100))}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.chipText, { color: on ? colors.onPrimary : colors.onSurface }]}>{formatGhs(p, { showDecimals: false })}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text variant="labelCaps" color={colors.onSurfaceVariant}>Mobile money network</Text>
          <View style={styles.chips}>
            {MOMO_NETWORKS.map((n) => {
              const on = network === n.value;
              return (
                <Pressable
                  key={n.value}
                  style={[styles.chip, on && styles.chipOn]}
                  onPress={() => setNetwork(n.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.chipText, { color: on ? colors.onPrimary : colors.onSurface }]}>{n.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.phoneBox}>
            <Text style={styles.prefix}>+233</Text>
            <TextInput
              maxFontSizeMultiplier={1.4}
              value={phone}
              onChangeText={(t) => {
                const d = ghanaLocalDigits(t);
                setPhone(d);
                if (d.length >= 2) setNetwork(networkFor(d));
              }}
              keyboardType="number-pad"
              placeholder="24X XXX XXXX"
              placeholderTextColor={colors.onSurfaceVariant}
              style={styles.phoneInput}
              accessibilityLabel="Mobile money number"
            />
          </View>

          <KeyboardStickyView style={{ gap: 12 }}>
            <View style={styles.amountBox}>
              <Text style={styles.prefix}>GH₵</Text>
              <TextInput
                maxFontSizeMultiplier={1.4}
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={colors.onSurfaceVariant}
                style={styles.amountInput}
                accessibilityLabel="Top-up amount in cedis"
              />
            </View>
            <Button label={amountOk ? `Top up ${formatGhs(amountPesewas)}` : 'Top up'} onPress={submit} loading={topUp.isPending} disabled={topUp.isPending || !amountOk || !phoneOk} />
          </KeyboardStickyView>
        </View>
      </PanelSheet>
    </>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    locked: { flex: 1, backgroundColor: c.background },
    heroWrap: { paddingHorizontal: 20, marginTop: 8 },
    hero: { padding: spacing.xl, gap: 4 },
    retry: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, minHeight: 44 },
    balanceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 4 },
    currency: { fontFamily: fonts.semiBold, fontSize: 20, lineHeight: 26, color: c.onSurfaceVariant },
    balance: { fontFamily: fonts.displayBold, fontSize: 42, lineHeight: 50, letterSpacing: -1, color: c.onSurface, fontVariant: ['tabular-nums'] },
    txIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    sheet: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16, gap: 14 },
    sheetBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sheetTitle: { fontFamily: fonts.displayBold, fontSize: 22, lineHeight: 28, color: c.onSurface },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radii.full, backgroundColor: c.surfaceContainer },
    chipOn: { backgroundColor: c.primary },
    chipText: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18 },
    phoneBox: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.surfaceContainer, borderRadius: radii.lg, paddingHorizontal: 16, height: 52 },
    amountBox: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.surfaceContainer, borderRadius: radii.lg, paddingHorizontal: 16, height: 60 },
    prefix: { fontFamily: fonts.semiBold, fontSize: 16, color: c.onSurfaceVariant },
    phoneInput: { flex: 1, fontFamily: fonts.medium, fontSize: 17, color: c.onSurface, paddingVertical: 0 },
    amountInput: { flex: 1, fontFamily: fonts.displayBold, fontSize: 24, color: c.onSurface, paddingVertical: 0 },
  });
