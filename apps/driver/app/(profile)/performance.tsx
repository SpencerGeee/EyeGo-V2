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

const LEVEL_CONFIG = {
  BRONZE:   { color: '#CD7F32', label: 'Bronze',   icon: 'medal-outline',  minTrips: 0,   description: 'Getting started' },
  SILVER:   { color: '#94A3B8', label: 'Silver',   icon: 'medal-outline',  minTrips: 50,  description: 'Building experience' },
  GOLD:     { color: '#F59E0B', label: 'Gold',     icon: 'ribbon-outline', minTrips: 200, description: 'Trusted driver' },
  PLATINUM: { color: '#3B82F6', label: 'Platinum', icon: 'star-outline',   minTrips: 500, description: 'Elite driver' },
} as const;

function StatCircle({ value, label, color, colors }: { value: number; label: string; color: string; colors: DriverColors }) {
  return (
    <View style={{ alignItems: 'center', gap: spacing.xs }}>
      <View style={{ width: 80, height: 80, borderRadius: 40, borderWidth: 4, borderColor: `${color}44`, backgroundColor: `${color}14`, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: fonts.displayBold, fontSize: 22, color, letterSpacing: -1 }}>{value}%</Text>
      </View>
      <Text variant="caption" color={colors.onSurfaceVariant} style={{ textAlign: 'center' }}>{label}</Text>
    </View>
  );
}

function ProgressBar({ value, max, color, colors }: { value: number; max: number; color: string; colors: DriverColors }) {
  const pct = Math.min(100, Math.round((value / Math.max(max, 1)) * 100));
  return (
    <View style={{ height: 10, backgroundColor: colors.surfaceContainerHighest, borderRadius: 5, overflow: 'hidden' }}>
      <MotiView
        from={{ width: '0%' }}
        animate={{ width: `${pct}%` }}
        transition={{ type: 'timing', duration: 900, delay: 200 }}
        style={{ height: '100%', backgroundColor: color, borderRadius: 5 }}
      />
    </View>
  );
}

export default function PerformanceScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const driver = useDriverStore((s) => s.driver);

  const { data: perf, isLoading } = useQuery({
    queryKey: ['driver', 'performance'],
    queryFn: () => driverApi.getPerformance(),
    select: (r) => r.data.data,
  });

  const level = perf?.level ?? 'BRONZE';
  const lvl = LEVEL_CONFIG[level];

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground variant="static" />
      <MotiView from={{ opacity: 0, translateX: -6 }} animate={{ opacity: 1, translateX: 0 }}
        transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        style={styles.backRow}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant}>← Back</Text>
        </Pressable>
      </MotiView>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <MotiView from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 40 }}>
          <Text variant="headlineLarge" style={styles.headline}>Performance</Text>
        </MotiView>

        {/* Level card */}
        <MotiView from={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25, delay: 80 }}
          style={[styles.levelCard, { borderColor: `${lvl.color}55` }]}>
          <View style={[styles.levelGlow, { backgroundColor: lvl.color }]} />
          <View style={[styles.levelBadge, { backgroundColor: `${lvl.color}22`, borderColor: `${lvl.color}55` }]}>
            <Ionicons name={lvl.icon as any} size={28} color={lvl.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.levelName, { color: lvl.color }]}>{lvl.label} Driver</Text>
            <Text variant="caption" color={colors.onSurfaceVariant}>{lvl.description}</Text>
            <Text variant="caption" color={colors.onSurfaceVariant}>
              {driver?.totalTrips ?? 0} total trips
            </Text>
          </View>
        </MotiView>

        {/* Rate circles */}
        <MotiView from={{ opacity: 0, translateY: 12 }} animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 120 }}
          style={styles.card}>
          <Text style={styles.cardTitle}>Rates</Text>
          {isLoading ? (
            <View style={{ height: 100, borderRadius: radii.lg, backgroundColor: colors.surfaceContainerHigh }} />
          ) : (
            <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: spacing.md }}>
              <StatCircle
                value={perf?.acceptanceRate ?? 0}
                label="Acceptance"
                color={colors.primary}
                colors={colors}
              />
              <StatCircle
                value={perf?.completionRate ?? 0}
                label="Completion"
                color="#22C55E"
                colors={colors}
              />
              <StatCircle
                value={Math.max(0, 100 - (perf?.cancellationRate ?? 0))}
                label="No Cancel"
                color="#F59E0B"
                colors={colors}
              />
            </View>
          )}
          <Text variant="caption" color={colors.onSurfaceVariant} style={{ textAlign: 'center', marginTop: spacing.xs }}>
            Maintain {'>'} 80% acceptance to keep your account in good standing
          </Text>
        </MotiView>

        {/* This week */}
        <MotiView from={{ opacity: 0, translateY: 12 }} animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 160 }}
          style={styles.card}>
          <Text style={styles.cardTitle}>This Week</Text>
          <View style={styles.weekGrid}>
            {[
              { label: 'Trips',         value: String(perf?.tripsThisWeek ?? 0),              icon: 'car-outline' as const },
              { label: 'Online Hours',  value: `${(perf?.onlineHoursThisWeek ?? 0).toFixed(1)}h`,  icon: 'time-outline' as const },
              { label: 'Earnings',      value: `GHS ${(perf?.earningsThisWeek ?? 0).toFixed(0)}`, icon: 'cash-outline' as const },
            ].map((stat) => (
              <View key={stat.label} style={styles.weekStat}>
                <View style={styles.weekIconBg}>
                  <Ionicons name={stat.icon} size={18} color={colors.primary} />
                </View>
                <Text style={styles.weekValue}>{isLoading ? '—' : stat.value}</Text>
                <Text variant="caption" color={colors.onSurfaceVariant}>{stat.label}</Text>
              </View>
            ))}
          </View>
        </MotiView>

        {/* Weekly goal */}
        {perf?.weeklyGoal != null && (
          <MotiView from={{ opacity: 0, translateY: 12 }} animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 200 }}
            style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md }}>
              <Text style={styles.cardTitle}>Weekly Earnings Goal</Text>
              <Text style={{ fontFamily: fonts.semiBold, fontSize: fontSizes.bodySmall ?? 12, color: colors.primary }}>
                {Math.round((perf.weeklyGoalProgress / perf.weeklyGoal) * 100)}%
              </Text>
            </View>
            <ProgressBar value={perf.weeklyGoalProgress} max={perf.weeklyGoal} color={colors.primary} colors={colors} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm }}>
              <Text variant="caption" color={colors.onSurfaceVariant}>
                GHS {perf.weeklyGoalProgress.toFixed(0)} earned
              </Text>
              <Text variant="caption" color={colors.onSurfaceVariant}>
                Goal: GHS {perf.weeklyGoal.toFixed(0)}
              </Text>
            </View>
          </MotiView>
        )}
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
    levelCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.lg,
      backgroundColor: colors.surfaceContainerHigh,
      borderRadius: radii['2xl'],
      borderWidth: 1.5,
      padding: spacing.xl,
      overflow: 'hidden',
    },
    levelGlow: { position: 'absolute', width: 120, height: 120, borderRadius: 60, opacity: 0.08, right: -20, top: -20 },
    levelBadge: {
      width: 56,
      height: 56,
      borderRadius: 16,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    levelName: { fontFamily: fonts.displayBold, fontSize: fontSizes.titleMedium, lineHeight: Math.round(fontSizes.titleMedium * 1.3), letterSpacing: -0.5 },
    card: {
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii['2xl'],
      borderWidth: 1,
      borderColor: colors.outline,
      padding: spacing.xl,
    },
    cardTitle: { fontFamily: fonts.displaySemiBold, fontSize: fontSizes.titleSmall, lineHeight: Math.round(fontSizes.titleSmall * 1.3), color: colors.onSurface, marginBottom: spacing.md },
    weekGrid: { flexDirection: 'row', justifyContent: 'space-around' },
    weekStat: { alignItems: 'center', gap: spacing.sm },
    weekIconBg: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: `${colors.primary}14`,
      alignItems: 'center',
      justifyContent: 'center',
    },
    weekValue: { fontFamily: fonts.displayBold, fontSize: fontSizes.titleSmall, lineHeight: Math.round(fontSizes.titleSmall * 1.3), color: colors.onSurface },
  });
