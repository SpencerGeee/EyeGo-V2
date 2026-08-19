import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { formatGhs } from '@eyego/utils';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, GlassSurface } from '@eyego/ui';
import { useColors, type DriverColors } from '../utils/useColors';
import { useDriverTripStore } from '../stores/trip.store';
import { beatPresenceNow } from '../hooks/useDriverLocation';
import type { PendingDispatch } from '@eyego/api';

/**
 * WHAT IS ACTUALLY LOOKING FOR A DRIVER RIGHT NOW.
 *
 * THE BUG THIS EXISTS FOR: "it's saying asking driver 1 of 1 but nothing on the
 * driver app is showing". A dispatch offer is one socket frame with no trip
 * `seq`, which means it cannot be replayed. Miss it — phone asleep, tunnel, or
 * simply being in the rider app on the same handset — and the only evidence the
 * ride ever existed was a card that never rendered. There was no surface
 * anywhere in the driver app that could answer "is anything waiting on me?".
 *
 * This is that surface, and it is deliberately a LIST rather than a card: the
 * offer sheet is for the one ride that is exclusively mine this second, while
 * this shows every live search I am eligible for, including the ones another
 * driver is currently being asked about. Seeing a request I can't accept yet is
 * information, not noise — it is the difference between "the app is broken" and
 * "someone else is being asked first".
 *
 * Refresh does two things in order, and the order is the point: beat presence so
 * the pool knows this phone is back, THEN ask the server to re-run any search
 * that had already exhausted its candidates. See `_layout` for the same pairing
 * on foreground.
 */
export function PendingDispatchList({ compact = false }: { compact?: boolean }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const requests = useDriverTripStore((s) => s.pendingRequests);
  const resync = useDriverTripStore((s) => s.resync);
  const clockSkewMs = useDriverTripStore((s) => s.clockSkewMs);
  const [refreshing, setRefreshing] = useState(false);
  const [, forceTick] = useState(0);

  // One timer for the whole list, not one per row: countdowns are cosmetic and
  // a second's granularity is plenty, but N intervals on a list is not.
  useEffect(() => {
    if (!requests.some((r) => r.expiresAtServerMs)) return;
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [requests]);

  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await beatPresenceNow().catch(() => {});
      await resync();
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, resync]);

  const open = useCallback(
    (r: PendingDispatch) => {
      if (!r.offeredToMe) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      router.push(`/(trip)/dispatch/${r.tripId}` as any);
    },
    [router],
  );

  return (
    <View style={[styles.wrap, compact && { paddingHorizontal: 0 }]}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <View style={styles.liveDot} />
          <Text style={styles.headerTitle}>
            {requests.length > 0 ? `${requests.length} live request${requests.length > 1 ? 's' : ''}` : 'No live requests'}
          </Text>
        </View>
        <Pressable
          onPress={refresh}
          hitSlop={10}
          style={styles.refreshBtn}
          accessibilityRole="button"
          accessibilityLabel="Check for new requests"
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <>
              <Ionicons name="refresh" size={14} color={colors.primary} />
              <Text style={[styles.refreshLabel, { color: colors.primary }]}>Check now</Text>
            </>
          )}
        </Pressable>
      </View>

      {requests.length === 0 ? (
        <Text variant="bodySmall" color={colors.onSurfaceVariant} style={styles.emptyLine}>
          Nothing is being dispatched to you right now. Stay online and this fills in the moment a
          rider requests nearby.
        </Text>
      ) : (
        requests.map((r) => {
          const secondsLeft = r.expiresAtServerMs
            ? Math.max(0, Math.round((r.expiresAtServerMs - (Date.now() + clockSkewMs)) / 1000))
            : null;
          const mine = r.offeredToMe && (secondsLeft == null || secondsLeft > 0);
          return (
            <Pressable
              key={r.tripId}
              onPress={() => open(r)}
              disabled={!mine}
              style={[styles.row, mine && styles.rowMine]}
              accessibilityRole={mine ? 'button' : 'text'}
              accessibilityLabel={
                mine
                  ? `Offer to ${r.dropoffAddress ?? 'destination'}, tap to review`
                  : `Request to ${r.dropoffAddress ?? 'destination'}, being offered to another driver`
              }
            >
              <GlassSurface
                borderRadius={radii.xl}
                intensity={mine ? 'high' : 'low'}
                style={StyleSheet.absoluteFill}
              />
              {mine && <View style={styles.glow} pointerEvents="none" />}

              <View style={[styles.icon, { backgroundColor: (mine ? colors.primary : colors.onSurfaceVariant) + '18' }]}>
                <Ionicons
                  name={mine ? 'flash' : 'time-outline'}
                  size={18}
                  color={mine ? colors.primary : colors.onSurfaceVariant}
                />
              </View>

              <View style={styles.body}>
                <View style={styles.topRow}>
                  <Text style={styles.dest} numberOfLines={1}>
                    {r.dropoffAddress ?? 'Destination pending'}
                  </Text>
                  {r.driverEarningsPesewas != null && (
                    <Text style={[styles.money, { color: mine ? colors.primary : colors.onSurface }]}>
                      {formatGhs(r.driverEarningsPesewas)}
                    </Text>
                  )}
                </View>
                <Text variant="caption" color={colors.onSurfaceVariant} numberOfLines={1}>
                  From {r.pickupAddress ?? 'pickup'}
                </Text>
                <View style={styles.tagRow}>
                  {mine ? (
                    <View style={[styles.tag, { backgroundColor: colors.primary + '1F' }]}>
                      <Text style={[styles.tagText, { color: colors.primary }]}>
                        {secondsLeft != null ? `YOURS · ${secondsLeft}s` : 'YOURS'}
                      </Text>
                    </View>
                  ) : (
                    <View style={[styles.tag, { backgroundColor: colors.onSurfaceVariant + '14' }]}>
                      <Text style={[styles.tagText, { color: colors.onSurfaceVariant }]}>
                        {r.heldByAnother ? 'WITH ANOTHER DRIVER' : 'IN QUEUE'}
                      </Text>
                    </View>
                  )}
                  {r.tier && (
                    <View style={[styles.tag, { backgroundColor: colors.onSurfaceVariant + '14' }]}>
                      <Text style={[styles.tagText, { color: colors.onSurfaceVariant }]}>{r.tier}</Text>
                    </View>
                  )}
                </View>
              </View>

              {mine && <Ionicons name="chevron-forward" size={16} color={colors.primary} />}
            </Pressable>
          );
        })
      )}
    </View>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    wrap: { paddingHorizontal: spacing['2xl'], gap: spacing.sm, marginBottom: spacing.base },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.xs,
    },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
    headerTitle: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyMedium,
      color: colors.onSurface,
      letterSpacing: 0.2,
    },
    refreshBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 76, justifyContent: 'flex-end' },
    refreshLabel: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodySmall },
    emptyLine: { lineHeight: 18 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.base,
      padding: spacing.base,
      borderRadius: radii.xl,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.outline,
    },
    rowMine: { borderColor: colors.primary + '66', borderWidth: 1 },
    // A soft inner wash rather than a shadow: shadows do not render inside an
    // `overflow: hidden` card, and a second absolute layer costs nothing.
    glow: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.primary + '0F' },
    icon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
    body: { flex: 1, gap: 2 },
    topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    dest: { flex: 1, fontFamily: fonts.semiBold, fontSize: fontSizes.bodyLarge, color: colors.onSurface },
    money: { fontFamily: fonts.bold, fontSize: fontSizes.bodyLarge },
    tagRow: { flexDirection: 'row', gap: spacing.xs, marginTop: 4 },
    tag: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.sm },
    tagText: { fontFamily: fonts.bold, fontSize: 9, letterSpacing: 0.6 },
  });

export default PendingDispatchList;
