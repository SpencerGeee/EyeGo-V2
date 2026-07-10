import React, { useMemo } from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { useQuery } from '@tanstack/react-query';
import { driverApi } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
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

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground isDark={theme !== 'light'} />
      <MotiView
        from={{ opacity: 0, translateX: -6 }}
        animate={{ opacity: 1, translateX: 0 }}
        transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        style={styles.backRow}
      >
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant}>← Back</Text>
        </Pressable>
      </MotiView>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <MotiView
          from={{ opacity: 0, translateY: -6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 40 }}
        >
          <Text variant="headlineLarge" style={styles.headline}>My Ratings</Text>
        </MotiView>

        {/* Overall rating hero */}
        <MotiView
          from={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25, delay: 80 }}
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
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 120 }}
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
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 160 }}
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

        {/* Recent ratings */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 200 }}
          style={styles.card}
        >
          <Text style={styles.cardTitle}>Recent Ratings</Text>
          {ratingsData?.total === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.md }}>
              <Ionicons name="star-outline" size={40} color={colors.onSurfaceVariant} />
              <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ textAlign: 'center' }}>
                No ratings yet. Complete trips to receive ratings!
              </Text>
            </View>
          ) : !ratingsData?.recent?.length ? (
            <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ paddingVertical: spacing.lg, textAlign: 'center' }}>
              No ratings yet
            </Text>
          ) : (
            ratingsData.recent.map((r, i) => (
              <MotiView
                key={r.tripId}
                from={{ opacity: 0, translateX: -10 }}
                animate={{ opacity: 1, translateX: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 220 + i * 50 }}
                style={[styles.recentRow, i < ratingsData.recent.length - 1 && styles.recentBorder]}
              >
                <View style={styles.recentStars}>
                  {Array.from({ length: 5 }).map((_, j) => (
                    <Ionicons key={j} name={j < r.stars ? 'star' : 'star-outline'} size={13} color="#F59E0B" />
                  ))}
                </View>
                {r.comment ? (
                  <Text variant="bodyMedium" color={colors.onSurface} style={styles.recentComment}>
                    "{r.comment}"
                  </Text>
                ) : null}
                <Text variant="caption" color={colors.onSurfaceVariant}>
                  {new Date(r.createdAt).toLocaleDateString()}
                </Text>
              </MotiView>
            ))
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
    recentRow: { paddingVertical: spacing.md, gap: spacing.xs },
    recentBorder: { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant },
    recentStars: { flexDirection: 'row', gap: 2 },
    recentComment: { fontStyle: 'italic', lineHeight: 20 },
  });
