import React, { useMemo } from 'react';
import { View, StyleSheet, RefreshControl } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { driverApi, type DriverLevel } from '@eyego/api';
import { fonts } from '@eyego/config';
import { Text, Screen, ListSection, ListRow, Skeleton } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../utils/useColors';

const LEVEL_LABEL: Record<DriverLevel, string> = {
  BRONZE: 'Bronze', SILVER: 'Silver', GOLD: 'Gold', PLATINUM: 'Platinum',
};

const COMPLIMENT_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Punctual: 'time-outline',
  'On Time': 'time-outline',
  'Safe Driver': 'shield-checkmark-outline',
  Professional: 'briefcase-outline',
  Friendly: 'happy-outline',
  'Clean Vehicle': 'car-outline',
  'Great Navigation': 'navigate-outline',
  Helpful: 'hand-left-outline',
  'Smooth Ride': 'speedometer-outline',
};

const pct = (n: number | null | undefined) => (n == null ? '—' : `${n}%`);

/**
 * RATINGS & PERFORMANCE — one page, the way Uber Pro shows it (rival spec §17).
 *
 * Was two screens with two bugs between them:
 *  - Ratings read the rating from the local store with a 0 default, so a new
 *    driver saw "0.0" and five empty stars instead of "New".
 *  - Performance kept its own tier table (50/200/500 trips) against the
 *    server's (20/50/100), showed an inverted "No Cancel %", read a null
 *    acceptance rate as 0%, and rendered the 20-TRIP weekly goal as GH₵0.20.
 *    The weekly goal now lives on Earnings; tier thresholds come from the server.
 *
 * Ratings stay aggregate-only: no list of individual scores (they're anonymous).
 */
export default function PerformanceScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const perfQ = useQuery({
    queryKey: ['driver', 'performance'],
    queryFn: () => driverApi.getPerformance(),
    select: (r) => r.data.data,
  });
  const ratingsQ = useQuery({
    queryKey: ['driver', 'ratings'],
    queryFn: () => driverApi.getRatings(),
    select: (r) => r.data.data,
  });
  const perf = perfQ.data;
  const ratings = ratingsQ.data;

  const rated = (ratings?.total ?? 0) > 0;
  const rating = rated ? ratings!.average : null;
  const recent = ratings?.last30Days?.average ?? null;
  const delta = recent != null && rating != null ? recent - rating : 0;
  const trend =
    recent == null
      ? null
      : Math.abs(delta) < 0.05
        ? { text: `Last 30 days ${recent.toFixed(2)} · in line with your average`, color: colors.onSurfaceVariant }
        : { text: `Last 30 days ${recent.toFixed(2)} · ${delta > 0 ? 'up' : 'down'} ${Math.abs(delta).toFixed(2)}`, color: delta > 0 ? colors.primary : colors.error };

  const breakdown = [5, 4, 3, 2, 1].map(
    (s) => ratings?.breakdown?.find((b) => b.stars === s) ?? { stars: s, count: 0, percentage: 0 },
  );

  const tierProgress = perf && perf.nextLevel
    ? perf.completedTrips / Math.max(1, perf.completedTrips + perf.tripsToNextLevel)
    : 1;

  const refreshing = perfQ.isRefetching || ratingsQ.isRefetching;

  return (
    <Screen
      title="Ratings & performance"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { perfQ.refetch(); ratingsQ.refetch(); }} tintColor={colors.primary} />
      }
    >
      {/* The rating — the page's one big number */}
      <View style={styles.hero}>
        {ratingsQ.isLoading ? (
          <Skeleton width={140} height={56} />
        ) : (
          <View style={styles.heroRow}>
            <Text style={styles.heroNumber}>{rating == null ? 'New' : rating.toFixed(2)}</Text>
            {rating != null ? <Ionicons name="star" size={28} color={colors.onSurface} style={{ marginBottom: 10 }} /> : null}
          </View>
        )}
        <Text style={styles.heroSub}>
          {rated
            ? `From ${ratings!.total} rating${ratings!.total === 1 ? '' : 's'}`
            : 'Your rating appears after your first rated trip.'}
        </Text>
        {trend ? <Text style={[styles.heroTrend, { color: trend.color }]}>{trend.text}</Text> : null}
      </View>

      <ListSection title="Last 7 days" footer="Acceptance counts ride offers you answered. Cancellation counts only trips you cancelled — a rider cancelling never counts against you.">
        <ListRow icon="checkmark-circle-outline" title="Acceptance rate" value={perfQ.isLoading ? '…' : pct(perf?.acceptanceRate)} />
        <ListRow icon="close-circle-outline" title="Cancellation rate" value={perfQ.isLoading ? '…' : pct(perf?.cancellationRate)} />
        <ListRow icon="flag-outline" title="Completion rate" value={perfQ.isLoading ? '…' : pct(perf?.completionRate)} />
        <ListRow icon="time-outline" title="Time online" value={perfQ.isLoading ? '…' : `${(perf?.onlineHoursThisWeek ?? 0).toFixed(1)} h`} />
      </ListSection>

      {/* Tier */}
      {perf ? (
        <View style={styles.block}>
          <Text variant="labelCaps" style={styles.blockTitle}>Tier</Text>
          <View style={styles.tierRow}>
            <Text style={styles.tierName}>{LEVEL_LABEL[perf.level]}</Text>
            <Text style={styles.tierNext}>
              {perf.nextLevel
                ? `${perf.tripsToNextLevel} trip${perf.tripsToNextLevel === 1 ? '' : 's'} to ${LEVEL_LABEL[perf.nextLevel]}`
                : 'Top tier'}
            </Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(tierProgress * 100)}%` }]} />
          </View>
          <Text style={styles.blockFoot}>{perf.completedTrips} completed trips</Text>
        </View>
      ) : null}

      {/* Breakdown */}
      <View style={styles.block}>
        <Text variant="labelCaps" style={styles.blockTitle}>Rating breakdown</Text>
        {breakdown.map((b) => (
          <View key={b.stars} style={styles.barRow} accessible accessibilityLabel={`${b.stars} stars, ${b.count}`}>
            <Text style={styles.barLabel}>{b.stars}★</Text>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${b.percentage}%`, opacity: b.stars >= 4 ? 1 : 0.55 }]} />
            </View>
            <Text style={styles.barCount}>{b.count}</Text>
          </View>
        ))}
      </View>

      <ListSection
        title="Compliments"
        footer="Ratings are anonymous. Riders rate the trip, and nobody can see who said what."
      >
        {(ratings?.compliments?.length ?? 0) === 0 ? (
          <ListRow icon="ribbon-outline" title="No compliments yet" subtitle="Riders can add one when they rate a trip." />
        ) : (
          ratings!.compliments.map((c) => (
            <ListRow key={c.label} icon={COMPLIMENT_ICONS[c.label] ?? 'thumbs-up-outline'} title={c.label} value={`${c.count}×`} />
          ))
        )}
      </ListSection>
    </Screen>
  );
}

const makeStyles = (c: DriverColors) =>
  StyleSheet.create({
    hero: { paddingHorizontal: 20, paddingTop: 8 },
    heroRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
    heroNumber: { fontFamily: fonts.displayBold, fontSize: 56, lineHeight: 64, letterSpacing: -2, color: c.onSurface, fontVariant: ['tabular-nums'] },
    heroSub: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, color: c.onSurfaceVariant, marginTop: 4 },
    heroTrend: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 19, marginTop: 6 },
    block: { marginTop: 24, paddingHorizontal: 20 },
    blockTitle: { marginBottom: 10 },
    blockFoot: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: c.onSurfaceVariant, marginTop: 8 },
    tierRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 },
    tierName: { fontFamily: fonts.displayBold, fontSize: 22, lineHeight: 28, color: c.onSurface },
    tierNext: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 19, color: c.onSurfaceVariant },
    track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: c.surfaceContainerHighest, overflow: 'hidden' },
    fill: { height: '100%', borderRadius: 3, backgroundColor: c.primary },
    barRow: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 26 },
    barLabel: { width: 26, fontFamily: fonts.medium, fontSize: 13, color: c.onSurfaceVariant },
    barCount: { width: 32, textAlign: 'right', fontFamily: fonts.regular, fontSize: 13, color: c.onSurfaceVariant, fontVariant: ['tabular-nums'] },
  });
