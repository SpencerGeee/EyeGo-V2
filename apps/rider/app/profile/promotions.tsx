import React, { useState, useMemo } from 'react';
import { View, StyleSheet, Alert, TextInput, RefreshControl } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';
import { Ionicons } from '@expo/vector-icons';
import { bookingsApi, apiClient, userApi, type RiderPromotion, type RiderPromotions } from '@eyego/api';
import { formatGhs, describeError, dayMonth, dayMonthYear } from '@eyego/utils';
import { fonts, radii } from '@eyego/config';
import { Text, Button, Screen, ListSection, ListRow, SkeletonRows } from '@eyego/ui';
import { useColors, Colors } from '../../utils/useColors';
import { useRideStore } from '../../stores/ride.store';

/** "When does it end", in words — a bare date makes the reader do the sum. */
function expiryLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const end = new Date(iso).getTime();
  if (!Number.isFinite(end)) return '';
  const days = Math.floor((end - Date.now()) / 86_400_000);
  if (days < 0) return 'Expired';
  if (days === 0) return 'Ends today';
  if (days === 1) return 'Ends tomorrow';
  if (days <= 14) return `Ends in ${days} days`;
  return `Ends ${dayMonth(end)}`;
}

/**
 * PROMOTIONS (rival spec §12) — code field on top, what you're using, what
 * you can use, what you've used. One promo per ride, and swapping asks first.
 *
 * The "Refer & earn — get GHS 10" card is gone: no referral programme exists
 * on the server (nothing ever sets a referral code), so it was a promise of
 * money with a share button that could never be enabled.
 */
export default function PromotionsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const { activeBooking, setPendingPromoCode, pendingPromoCode } = useRideStore(
    useShallow((s) => ({ activeBooking: s.activeBooking, setPendingPromoCode: s.setPendingPromoCode, pendingPromoCode: s.pendingPromoCode })),
  );

  const promosQ = useQuery({
    queryKey: ['user', 'promotions'],
    queryFn: () => userApi.getPromotions(),
    select: (r: any) => (r?.data?.data ?? null) as RiderPromotions | null,
  });
  const applied = promosQ.data?.applied ?? null;
  const available = promosQ.data?.available ?? [];
  const used = promosQ.data?.used ?? [];

  const apply = async (raw: string, opts?: { forfeit?: boolean }) => {
    const c = raw.trim().toUpperCase();
    if (!c) return;
    // One promo, and you give it up on purpose.
    const held = pendingPromoCode?.toUpperCase() ?? null;
    if (held && held !== c && !opts?.forfeit) {
      Alert.alert(`Give up ${held}?`, `${held} is saved for your next ride. Using ${c} instead drops it.`, [
        { text: `Keep ${held}`, style: 'cancel' },
        { text: `Use ${c}`, style: 'destructive', onPress: () => void apply(c, { forfeit: true }) },
      ]);
      return;
    }
    setBusyCode(c);
    setStatus(null);
    try {
      if (activeBooking?.id) {
        await bookingsApi.applyPromo(activeBooking.id, c);
        setStatus({ ok: true, text: `${c} applied to your current ride.` });
        qc.invalidateQueries({ queryKey: ['user', 'promotions'] });
      } else {
        const res = await apiClient.get<{ success: boolean; data?: { valid: boolean } }>(`/bookings/promos/validate?code=${encodeURIComponent(c)}`);
        if (res.data?.success && res.data?.data?.valid) {
          setPendingPromoCode(c);
          setStatus({ ok: true, text: `${c} saved — it’s applied when you book your next ride.` });
        } else {
          setStatus({ ok: false, text: 'That code isn’t valid or has expired.' });
        }
      }
      setCode('');
    } catch (err) {
      setStatus({ ok: false, text: describeError(err, 'That code isn’t valid or has expired.').message });
    } finally {
      setBusyCode(null);
    }
  };

  return (
    <Screen
      title="Promotions"
      keyboard
      refreshControl={<RefreshControl refreshing={promosQ.isRefetching} onRefresh={() => promosQ.refetch()} tintColor={colors.primary} />}
    >
      <View style={styles.codeRow}>
        <View style={styles.codeBox}>
          <Ionicons name="ticket-outline" size={20} color={colors.onSurfaceVariant} />
          <TextInput
            maxFontSizeMultiplier={1.4}
            value={code}
            onChangeText={(t) => { setCode(t); setStatus(null); }}
            placeholder="Promo code"
            placeholderTextColor={colors.onSurfaceVariant}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => void apply(code)}
            style={styles.codeInput}
            accessibilityLabel="Promo code"
          />
        </View>
        <Button
          label="Apply"
          onPress={() => void apply(code)}
          loading={!!busyCode && busyCode === code.trim().toUpperCase()}
          disabled={!code.trim() || !!busyCode || (!!applied && !!activeBooking?.id)}
          fullWidth={false}
          size="sm"
        />
      </View>
      {status ? (
        <Text style={[styles.status, { color: status.ok ? colors.primary : colors.error }]}>{status.text}</Text>
      ) : null}

      <ListSection title="Your promo" footer="One promo per ride. Picking another offer replaces the one saved here.">
        {applied ? (
          <ListRow
            icon="pricetag"
            iconColor={colors.primary}
            title={applied.code}
            subtitle={`${applied.discountPercent}% off, up to ${formatGhs(applied.maxDiscountPesewas)} · on your current ride · ${expiryLabel(applied.expiry)}`}
            subtitleLines={2}
            value="Active"
            valueColor={colors.primary}
          />
        ) : null}
        {pendingPromoCode ? (
          <ListRow
            icon="time-outline"
            title={pendingPromoCode}
            subtitle={applied ? 'Saved for the ride after this one' : 'Saved for your next ride'}
            value="Remove"
            valueColor={colors.error}
            onPress={() => { setPendingPromoCode(null); setStatus(null); }}
            chevron={false}
            accessibilityLabel={`Remove saved promo ${pendingPromoCode}`}
          />
        ) : null}
        {!applied && !pendingPromoCode ? (
          <ListRow icon="pricetag-outline" title="No promo in use" subtitle="Enter a code above or pick an offer below." />
        ) : null}
      </ListSection>

      {promosQ.isPending ? (
        <SkeletonRows count={2} />
      ) : (
        <ListSection title="Available offers">
          {available.length === 0 ? (
            <ListRow icon="pricetags-outline" title="No offers right now" subtitle="Codes you get by SMS or email still work above." />
          ) : (
            available.map((p: RiderPromotion) => {
              const isActive = applied?.code?.toUpperCase() === p.code.toUpperCase();
              const isSaved = !isActive && pendingPromoCode?.toUpperCase() === p.code.toUpperCase();
              const busy = busyCode === p.code.toUpperCase();
              const locked = isActive || !!applied;
              return (
                <ListRow
                  key={p.id}
                  icon="pricetag-outline"
                  title={p.code}
                  subtitle={`${p.discountPercent}% off, up to ${formatGhs(p.maxDiscountPesewas)} · ${expiryLabel(p.expiry)}${p.redemptionsLeft != null && p.redemptionsLeft <= 20 ? ` · ${p.redemptionsLeft} left` : ''}`}
                  subtitleLines={2}
                  value={isActive ? 'Active' : isSaved ? 'Saved' : busy ? 'Applying…' : 'Use'}
                  valueColor={colors.primary}
                  onPress={locked || busy || isSaved ? undefined : () => void apply(p.code)}
                />
              );
            })
          )}
        </ListSection>
      )}

      {used.length > 0 ? (
        <ListSection title="Already used">
          {used.map((p: RiderPromotions['used'][number]) => (
            <ListRow
              key={`${p.id}-${p.bookingId}`}
              icon="checkmark-circle-outline"
              iconColor={colors.onSurfaceVariant}
              title={p.code}
              subtitle={p.usedAt ? `Used ${dayMonthYear(p.usedAt)}` : 'Used'}
            />
          ))}
        </ListSection>
      ) : null}
    </Screen>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    codeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, marginTop: 8 },
    codeBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, borderRadius: radii.lg, backgroundColor: c.surfaceContainer, paddingHorizontal: 14 },
    codeInput: { flex: 1, fontFamily: fonts.semiBold, fontSize: 16, letterSpacing: 1, color: c.onSurface, paddingVertical: 0 },
    status: { paddingHorizontal: 20, marginTop: 8, fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  });
