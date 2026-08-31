import React, { useMemo } from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView, goBack } from '@eyego/ui';
import { useQuery } from '@tanstack/react-query';
import { driverApi } from '@eyego/api';
import { fonts, fontSizes, spacing, radii, springs } from '@eyego/config';
import { Text, AppBackground } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useDriverStore } from '../../stores/driver.store';

const COMPLIMENT_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  'Professional':       'briefcase-outline',
  'Safe Driver':        'shield-checkmark-outline',
  'Friendly':           'happy-outline',
  'On Time':            'time-outline',
  'Clean Vehicle':      'car-outline',
  'Great Navigation':   'navigate-outline',
  'Helpful':            'hand-left-outline',
  'Smooth Ride':        'speedometer-outline',
};

function StarBar({ stars, count, percentage, colors }: {
  stars: number; count: number; percentage: number; colors: DriverColors;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginVertical: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, width: 70 }}>
        {Array.from({ length: stars }).map((_, i) => (
          <Ionicons key={i} name="star" size={11} color="#F59E0B" />
        ))}
      </View>
      <View style={{ flex: 1, height: 8, backgroundColor: colors.surfaceContainerHighest, borderRadius: 4, overflow: 'hidden' }}>
        <MotiView
          from={{ width: '0%' }}
          animate={{ width: `${percentage}%` }}
          transition={{ type: 'timing', duration: 800, delay: (5 - stars) * 100 }}
          style={{ height: '100%', backgroundColor: percentage > 50 ? colors.primary : colors.accent, borderRadius: 4 }}
        />
      </View>
      <Text variant="caption" color={colors.onSurfaceVariant} style={{ width: 30, textAlign: 'right' }}>
        {count}
      </Text>
    </View>
  );
}

export default function RatingsScreen() {
  const colors = useColors();
  const theme = useDriverStore(s => s.theme);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const driver = useDriverStore((s) => s.driver);

  const { data: ratingsData, isLoading } = useQuery({
    queryKey: ['driver', 'ratings'],
    queryFn: () => driverApi.getRatings(),
    select: (r) => r.data.data,
  });

  const rating = driver?.rating ?? 0;

  /**
   * The 30-day trend, derived once. `average` is null until the window has any
   * ratings in it, which is a real state on a driver who took a fortnight off —
   * and it must not read as "0.00 stars".
   */
  const recentAverage = ratingsData?.last30Days?.average ?? null;
  const allTime = ratingsData?.average ?? rating;
  const delta = recentAverage != null ? recentAverage - allTime : 0;
  const trendLabel =
    recentAverage == null
      ? ''
      : Math.abs(delta) < 0.05
        ? 'In line with your average'
        : delta > 0
          ? `Up ${delta.toFixed(2)} on your average`
          : `Down ${Math.abs(delta).toFixed(2)} on your average`;
  const trendColor =
    recentAverage == null || Math.abs(delta) < 0.05
      ? colors.onSurfaceVariant
      : delta > 0
        ? colors.primary
        : colors.error;

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground isDark={theme !== 'light'} />
      <MotiView
        from={{ opacity: 0, translateX: -6 }}
        animate={{ opacity: 1, translateX: 0 }}
        transition={{ type: 'spring', ...springs.standard }}
        style={styles.backRow}
      >
        <Pressable onPress={() => goBack()} hitSlop={12} accessibilityRole="button">
          <Text variant="bodyMedium" color={colors.onSurfaceVariant}>← Back</Text>
        </Pressable>
      </MotiView>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <MotiView
          from={{ opacity: 0, translateY: -6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', ...springs.standard, delay: 40 }}
        >
          <Text variant="headlineLarge" style={styles.headline}>My Ratings</Text>
        </MotiView>

        {/* Overall rating hero */}
        <MotiView
          from={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', ...springs.standard, delay: 80 }}
          style={styles.heroCard}
        >
          <View style={styles.heroGlow} />
          <Text style={styles.heroNumber}>{rating.toFixed(1)}</Text>
          <View style={styles.heroStars}>
            {[1, 2, 3, 4, 5].map((s) => (
              <Ionicons
                key={s}
                name={s <= Math.round(rating) ? 'star' : s - 0.5 <= rating ? 'star-half' : 'star-outline'}
                size={22}
                color="#F59E0B"
              />
            ))}
          </View>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant}>
            Based on {ratingsData?.total ?? driver?.totalTrips ?? 0} trips
          </Text>
        </MotiView>

        {/* Star breakdown */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', ...springs.standard, delay: 120 }}
          style={styles.card}
        >
          <Text style={styles.cardTitle}>Rating Breakdown</Text>
          {isLoading ? (
            [5, 4, 3, 2, 1].map((s) => (
              <MotiView
                key={s}
                from={{ opacity: 0.3 }} animate={{ opacity: 0.6 }}
                transition={{ type: 'timing', duration: 800, loop: true, delay: s * 80 }}
                style={{ height: 20, borderRadius: 4, backgroundColor: colors.surfaceContainerHigh, marginVertical: 4 }}
              />
            ))
          ) : (
            ratingsData?.breakdown?.length
              ? [...(ratingsData.breakdown)].sort((a, b) => b.stars - a.stars).map((b) => (
                  <StarBar key={b.stars} stars={b.stars} count={b.count} percentage={b.percentage} colors={colors} />
                ))
              : [5, 4, 3, 2, 1].map((s) => (
                  <StarBar key={s} stars={s} count={0} percentage={0} colors={colors} />
                ))
          )}
        </MotiView>

        {/* Compliments */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', ...springs.standard, delay: 160 }}
          style={styles.card}
        >
          <Text style={styles.cardTitle}>Compliments</Text>
          {(ratingsData?.compliments?.length ?? 0) === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.md }}>
              <Ionicons name="star-outline" size={48} color={colors.onSurfaceVariant} />
              <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ textAlign: 'center' }}>
                No compliments yet. Complete trips to earn them!
              </Text>
            </View>
          ) : (
            <View style={styles.complimentsGrid}>
              {ratingsData!.compliments.map((c) => (
                <View key={c.label} style={styles.complimentChip}>
                  <Ionicons
                    name={COMPLIMENT_ICONS[c.label] ?? 'thumbs-up-outline'}
                    size={16}
                    color={colors.primary}
                  />
                  <View>
                    <Text style={styles.complimentLabel}>{c.label}</Text>
                    <Text variant="caption" color={colors.onSurfaceVariant}>{c.count}×</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </MotiView>

        {/**
          * ── THE LAST THIRTY DAYS, AS ONE NUMBER ────────────────────────────
          *
          * FEATURE ("make sure on the ratings of the driver app the driver isn't
          * able to view the ratings made by riders — it needs to be anonymous so
          * the riders can freely share how they felt").
          *
          * This card replaces the "Recent Ratings" list, which printed each
          * rating with its trip id, its date and its comment. A driver reading
          * "2 stars, Tuesday, trip #4821" knows exactly which rider wrote it,
          * because they drove them — the name was never the thing that
          * identified them. A rider who can be worked out is a rider who does
          * not say anything true, which costs the driver the honest signal too.
          *
          * What is left is the part that is actually useful for improving: is my
          * recent driving rated better or worse than my all-time average. That
          * moves when their driving changes and points at nobody.
          *
          * The server no longer returns the individual rows at all (see
          * `getRatings`), so this is not a screen hiding data it still holds.
          */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', ...springs.standard, delay: 200 }}
          style={styles.card}
        >
          <Text style={styles.cardTitle}>Last 30 days</Text>
          {ratingsData?.total === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.md }}>
              <Ionicons name="star-outline" size={40} color={colors.onSurfaceVariant} />
              <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ textAlign: 'center' }}>
                No ratings yet. Complete trips to receive ratings.
              </Text>
            </View>
          ) : recentAverage == null ? (
            <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ paddingVertical: spacing.lg }}>
              No ratings in the last 30 days. Your all-time average is unchanged.
            </Text>
          ) : (
            <>
              <View style={styles.trendRow}>
                <Text style={styles.trendNumber}>{recentAverage.toFixed(2)}</Text>
                <View style={{ flex: 1, gap: 2 }}>
                  {/* Only claim a direction when the gap is big enough to be a
                      direction. Within 0.05 stars, two averages are the same
                      average with different rounding. */}
                  <Text style={[styles.trendDelta, { color: trendColor }]}>{trendLabel}</Text>
                  <Text variant="caption" color={colors.onSurfaceVariant}>
                    from {ratingsData?.last30Days?.count ?? 0} rating
                    {(ratingsData?.last30Days?.count ?? 0) === 1 ? '' : 's'} · all-time {rating.toFixed(2)}
                  </Text>
                </View>
              </View>
              <View style={styles.anonNote}>
                <Ionicons name="lock-closed-outline" size={13} color={colors.onSurfaceVariant} />
                <Text variant="caption" color={colors.onSurfaceVariant} style={{ flex: 1, lineHeight: 17 }}>
                  Ratings are anonymous. Riders rate the trip, not you personally, and
                  nobody can see who said what.
                </Text>
              </View>
            </>
          )}
        </MotiView>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    backRow: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.base },
    scroll: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.xl, paddingBottom: spacing['3xl'], gap: spacing.xl },
    headline: { letterSpacing: -1 },
    heroCard: {
      backgroundColor: colors.surfaceContainerHigh,
      borderRadius: radii['2xl'],
      borderWidth: 1,
      borderColor: colors.outline,
      padding: spacing['2xl'],
      alignItems: 'center',
      gap: spacing.sm,
      overflow: 'hidden',
    },
    heroGlow: {
      position: 'absolute',
      width: 200,
      height: 200,
      borderRadius: 100,
      backgroundColor: '#F59E0B',
      opacity: 0.06,
      top: -60,
    },
    heroNumber: {
      fontFamily: fonts.displayBold,
      fontSize: 64,
      lineHeight: 83,
      color: colors.onSurface,
      letterSpacing: -3,
    },
    heroStars: { flexDirection: 'row', gap: 4 },
    card: {
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii['2xl'],
      borderWidth: 1,
      borderColor: colors.outline,
      padding: spacing.xl,
    },
    cardTitle: {
      fontFamily: fonts.displaySemiBold,
      fontSize: fontSizes.titleSmall,
      lineHeight: Math.round(fontSizes.titleSmall * 1.3),
      color: colors.onSurface,
      marginBottom: spacing.md,
    },
    complimentsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
    complimentChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: `${colors.primary}14`,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: `${colors.primary}33`,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    complimentLabel: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodySmall ?? 12,
      lineHeight: Math.round((fontSizes.bodySmall ?? 12) * 1.3),
      color: colors.onSurface,
    },
    /** The 30-day trend. One large figure, its reading beside it. */
    trendRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.base,
      paddingVertical: spacing.xs,
    },
    trendNumber: {
      fontFamily: fonts.displayBold,
      fontSize: 40,
      lineHeight: 46,
      color: colors.onSurface,
      letterSpacing: -1.6,
      // The figure must not shift width as the average moves.
      fontVariant: ['tabular-nums'],
    },
    trendDelta: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.3),
    },
    anonNote: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      marginTop: spacing.md,
      paddingTop: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.outlineVariant,
    },
  });
