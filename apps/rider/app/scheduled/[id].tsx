import React, { useMemo } from 'react';
import { View, StyleSheet, ScrollView, Pressable, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { tripsApi } from '@eyego/api';
import { Text, Button, AppBackground, GradientGlowBorder, GlassSurface } from '@eyego/ui';
import { fonts, fontSizes, spacing, radii, withOpacity } from '@eyego/config';
import { formatCurrency } from '@eyego/utils';
import { useColors, Colors } from '../../utils/useColors';
import { useThemeStore } from '../../stores/theme.store';

/**
 * Dedicated detail screen for ONE scheduled ride.
 *
 * Before this, tapping a scheduled-ride card did nothing until a driver had been
 * matched — which is the tail end of its life, so for most of the time the card
 * existed it was inert. A rider had no way to see what they had actually booked:
 * when, from where to where, how many seats, what it costs, or what happens next.
 *
 * Layout follows what Uber and Bolt show for a reserved ride: status first (the
 * only thing that changes), then the route, then the commercial details, then
 * the one destructive action, kept well away from everything else.
 *
 * Reads from the same `/trips/scheduled` list the Activity tab uses rather than
 * a new single-intent endpoint — the list is already cached, so opening this
 * screen from the card is instant and needs no extra round trip.
 */

const STATUS_COPY: Record<string, { label: string; detail: string; tone: 'live' | 'good' | 'dead' }> = {
  PENDING: {
    label: 'Scheduled',
    detail: "We'll start looking for a driver shortly before your pickup time.",
    tone: 'live',
  },
  DISPATCHED: {
    label: 'Finding your driver',
    detail: "We're contacting drivers near your pickup point right now.",
    tone: 'live',
  },
  MATCHED: {
    label: 'Driver confirmed',
    detail: 'Your driver is booked. Live tracking opens closer to pickup time.',
    tone: 'good',
  },
  CANCELLED: { label: 'Cancelled', detail: 'This ride was cancelled.', tone: 'dead' },
  EXPIRED: {
    label: 'Expired',
    detail: 'No driver was available in time, so this ride lapsed. Nothing was charged.',
    tone: 'dead',
  },
};

function formatWhen(iso: string): { day: string; time: string; relative: string } {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-GH', { weekday: 'long', month: 'long', day: 'numeric' });
  const time = d.toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' });

  const diffMs = d.getTime() - Date.now();
  const mins = Math.round(diffMs / 60000);
  let relative: string;
  if (mins < -60) relative = 'in the past';
  else if (mins < 0) relative = 'now';
  else if (mins < 60) relative = `in ${mins} min`;
  else if (mins < 60 * 24) relative = `in ${Math.round(mins / 60)} hr`;
  else relative = `in ${Math.round(mins / (60 * 24))} days`;

  return { day, time, relative };
}

export default function ScheduledRideDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { isDark } = useThemeStore();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['trips', 'scheduled'],
    queryFn: () => tripsApi.getScheduledRides(),
    refetchInterval: 20000,
  });

  const intent = useMemo(() => {
    const list: any[] = (data as any)?.data?.data?.intents ?? [];
    return list.find((i) => i.id === id) ?? null;
  }, [data, id]);

  const cancel = useMutation({
    mutationFn: (intentId: string) => tripsApi.cancelScheduledRide(intentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trips', 'scheduled'] });
      router.back();
    },
    onError: () => Alert.alert('Error', 'Could not cancel this scheduled ride. Please try again.'),
  });

  const status = STATUS_COPY[intent?.status] ?? {
    label: intent?.status ?? 'Scheduled',
    detail: '',
    tone: 'live' as const,
  };
  const toneColor =
    status.tone === 'good' ? colors.statusSuccess
      : status.tone === 'dead' ? colors.onSurfaceVariant
      : colors.primary;

  const cancellable = intent?.status === 'PENDING' || intent?.status === 'DISPATCHED';
  const when = intent ? formatWhen(intent.scheduledAt) : null;

  return (
    <View style={styles.root}>
      {/* Same animated Skia backdrop the rest of the app uses — this screen is a
          destination in its own right, not a plain modal. */}
      <AppBackground variant="animated" isDark={isDark} />

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle}>Scheduled ride</Text>
          <View style={styles.backBtn} />
        </View>

        {isLoading && !intent ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : !intent ? (
          <View style={styles.center}>
            <Ionicons name="calendar-outline" size={32} color={colors.onSurfaceVariant} />
            <Text style={styles.emptyText}>This scheduled ride is no longer available.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            {/* Status — the only thing that changes over time, so it leads. */}
            <GradientGlowBorder
              palette={status.tone === 'dead' ? undefined : 'green'}
              fillColor={colors.surfaceCard}
              borderRadius={radii.xl}
              glow={status.tone !== 'dead'}
              style={styles.statusCard}
            >
              <View style={styles.statusRow}>
                <View style={[styles.statusDot, { backgroundColor: toneColor }]} />
                <Text style={[styles.statusLabel, { color: toneColor }]}>
                  {status.label.toUpperCase()}
                </Text>
              </View>
              <Text style={styles.statusDetail}>{status.detail}</Text>
            </GradientGlowBorder>

            {/* When */}
            <View style={styles.card}>
              <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.xl} intensity="low" />
              <Text style={styles.cardLabel}>PICKUP TIME</Text>
              <Text style={styles.bigTime}>{when!.time}</Text>
              <Text style={styles.cardValue}>{when!.day}</Text>
              <View style={styles.relativeChip}>
                <Ionicons name="time-outline" size={12} color={colors.primary} />
                <Text style={styles.relativeText}>{when!.relative}</Text>
              </View>
            </View>

            {/* Route */}
            <View style={styles.card}>
              <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.xl} intensity="low" />
              <Text style={styles.cardLabel}>ROUTE</Text>
              <View style={styles.routeRow}>
                <View style={styles.routeRail}>
                  <View style={[styles.railDot, { borderColor: colors.primary }]} />
                  <View style={styles.railLine} />
                  <View style={[styles.railDot, styles.railDotFilled, { backgroundColor: colors.secondary }]} />
                </View>
                <View style={styles.routeText}>
                  <Text style={styles.routeStopLabel}>FROM</Text>
                  <Text style={styles.routeStop} numberOfLines={2}>
                    {intent.route?.originName ?? 'Your pickup point'}
                  </Text>
                  <View style={{ height: spacing.base }} />
                  <Text style={styles.routeStopLabel}>TO</Text>
                  <Text style={styles.routeStop} numberOfLines={2}>
                    {intent.route?.destinationName ?? 'Your destination'}
                  </Text>
                </View>
              </View>
            </View>

            {/* Booking details */}
            <View style={styles.card}>
              <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.xl} intensity="low" />
              <Text style={styles.cardLabel}>BOOKING</Text>
              <DetailRow
                styles={styles}
                icon="people-outline"
                colors={colors}
                label="Seats"
                value={`${intent.seatCount ?? 1} seat${(intent.seatCount ?? 1) > 1 ? 's' : ''}`}
              />
              {intent.route?.distanceKm != null && (
                <DetailRow
                  styles={styles}
                  icon="navigate-outline"
                  colors={colors}
                  label="Distance"
                  value={`${Number(intent.route.distanceKm).toFixed(1)} km`}
                />
              )}
              {intent.estimatedFare != null && (
                <DetailRow
                  styles={styles}
                  icon="cash-outline"
                  colors={colors}
                  label="Estimated fare"
                  value={formatCurrency(intent.estimatedFare)}
                />
              )}
              <DetailRow
                styles={styles}
                icon="receipt-outline"
                colors={colors}
                label="Reference"
                value={String(intent.id).slice(-8).toUpperCase()}
              />
            </View>

            {intent.matchedTripId && (
              <Button
                label="Open live tracking"
                onPress={() => {
                  Haptics.selectionAsync();
                  router.push(`/ride/${intent.matchedTripId}/tracking` as any);
                }}
                style={{ marginTop: spacing.sm }}
              />
            )}

            {cancellable && (
              <Pressable
                style={styles.cancelBtn}
                disabled={cancel.isPending}
                onPress={() =>
                  Alert.alert('Cancel scheduled ride?', 'This cannot be undone.', [
                    { text: 'Keep it', style: 'cancel' },
                    {
                      text: 'Cancel ride',
                      style: 'destructive',
                      onPress: () => cancel.mutate(intent.id),
                    },
                  ])
                }
              >
                <Text style={styles.cancelText}>
                  {cancel.isPending ? 'Cancelling…' : 'Cancel this ride'}
                </Text>
              </Pressable>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

function DetailRow({
  icon,
  label,
  value,
  colors,
  styles,
}: {
  icon: any;
  label: string;
  value: string;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.detailRow}>
      <Ionicons name={icon} size={16} color={colors.onSurfaceVariant} />
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.backgroundDeep },
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.base, paddingHorizontal: spacing['2xl'] },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodyMedium,
    lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
    color: colors.onSurfaceVariant,
    textAlign: 'center',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.base,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surfaceCard,
    borderWidth: 1, borderColor: colors.rimLight,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 17,
    // A display face with negative letterSpacing and NO explicit lineHeight has
    // its ascenders clipped by the default line box — the same top-clipping fixed
    // app-wide in acdda37 ("clipped titles"). This screen was written afterwards
    // and reintroduced it, which is the "top most part of the page is clipped"
    // report. Every other fontSize style in this file gets the same treatment.
    lineHeight: 23,
    color: colors.onSurface,
    letterSpacing: -0.3,
  },

  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing['3xl'], gap: spacing.base },

  statusCard: { padding: spacing.xl, gap: spacing.xs },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 15, letterSpacing: 1 },
  statusDetail: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodySmall,
    color: colors.onSurfaceVariant,
    lineHeight: 19,
  },

  card: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.rimLight,
    padding: spacing.xl,
    overflow: 'hidden',
    gap: spacing.xs,
  },
  cardLabel: {
    fontFamily: fonts.medium,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1,
    color: withOpacity(colors.onSurfaceVariant, 0.8),
    marginBottom: spacing.xs,
  },
  cardValue: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodyMedium,
    lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
    color: colors.onSurfaceVariant,
  },
  bigTime: {
    fontFamily: fonts.displayBold,
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -1,
    color: colors.onSurface,
  },
  relativeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.full ?? 999,
    backgroundColor: withOpacity(colors.primary, 0.12),
  },
  relativeText: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 15, color: colors.primary },

  routeRow: { flexDirection: 'row', gap: spacing.base, marginTop: spacing.xs },
  routeRail: { alignItems: 'center', paddingTop: 16, paddingBottom: 6 },
  railDot: { width: 11, height: 11, borderRadius: 6, borderWidth: 2 },
  railDotFilled: { borderWidth: 0, borderRadius: 3 },
  railLine: { width: 1.5, flex: 1, backgroundColor: colors.outlineVariant, marginVertical: 4 },
  routeText: { flex: 1 },
  routeStopLabel: {
    fontFamily: fonts.medium,
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.8,
    color: withOpacity(colors.onSurfaceVariant, 0.75),
  },
  routeStop: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodyMedium,
    lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
    color: colors.onSurface,
    marginTop: 2,
  },

  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.outlineVariant,
  },
  detailLabel: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodySmall,
    lineHeight: Math.round(fontSizes.bodySmall * 1.4),
    color: colors.onSurfaceVariant,
  },
  detailValue: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodySmall,
    lineHeight: Math.round(fontSizes.bodySmall * 1.4),
    color: colors.onSurface,
  },

  cancelBtn: { alignItems: 'center', paddingVertical: spacing.base, marginTop: spacing.sm },
  cancelText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodyMedium,
    lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
    color: colors.statusError,
  },
});
