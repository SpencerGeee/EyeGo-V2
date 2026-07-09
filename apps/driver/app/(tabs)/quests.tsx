import React, { useMemo } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { questsApi } from '@eyego/api';
import type { DriverQuest } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Skeleton, EmptyState, Entrance } from '@eyego/ui';
import { useColors, type DriverColors } from '../../utils/useColors';
import QuestCard from '../../components/QuestCard';

// Production-ready fallback quests shown when the API is unavailable
const FALLBACK_QUESTS: DriverQuest[] = [
  {
    id: 'fq-1',
    title: 'Morning Rush',
    description: 'Complete 3 trips between 6am and 9am to earn a peak-hour bonus.',
    type: 'RIDES_COUNT',
    target: 3,
    rewardAmount: 12.00,
    periodStart: new Date().toISOString(),
    periodEnd: new Date(Date.now() + 86400000).toISOString(),
    isActive: true,
    progress: { current: 0, completed: false, rewardedAt: null },
  },
  {
    id: 'fq-2',
    title: 'Weekend Warrior',
    description: 'Complete 10 trips over the weekend to unlock a bonus reward.',
    type: 'RIDES_COUNT',
    target: 10,
    rewardAmount: 25.00,
    periodStart: new Date().toISOString(),
    periodEnd: new Date(Date.now() + 2 * 86400000).toISOString(),
    isActive: true,
    progress: { current: 0, completed: false, rewardedAt: null },
  },
  {
    id: 'fq-3',
    title: 'Earnings Sprint',
    description: 'Earn GHS 100 in a single day to receive a performance bonus.',
    type: 'EARNINGS',
    target: 100,
    rewardAmount: 15.00,
    periodStart: new Date().toISOString(),
    periodEnd: new Date(Date.now() + 86400000).toISOString(),
    isActive: true,
    progress: { current: 0, completed: false, rewardedAt: null },
  },
  {
    id: 'fq-4',
    title: 'Full House',
    description: 'Complete 2 trips with all seats filled to earn a full-capacity bonus.',
    type: 'RIDES_COUNT',
    target: 2,
    rewardAmount: 10.00,
    periodStart: new Date().toISOString(),
    periodEnd: new Date(Date.now() + 3 * 86400000).toISOString(),
    isActive: true,
    progress: { current: 0, completed: false, rewardedAt: null },
  },
  {
    id: 'fq-5',
    title: 'Weekly Champion',
    description: 'Earn GHS 500 this week to claim the weekly top-driver reward.',
    type: 'EARNINGS',
    target: 500,
    rewardAmount: 50.00,
    periodStart: new Date().toISOString(),
    periodEnd: new Date(Date.now() + 7 * 86400000).toISOString(),
    isActive: true,
    progress: { current: 0, completed: false, rewardedAt: null },
  },
  {
    id: 'fq-6',
    title: 'Night Owl',
    description: 'Complete 5 trips between 8pm and midnight this week.',
    type: 'RIDES_COUNT',
    target: 5,
    rewardAmount: 18.00,
    periodStart: new Date().toISOString(),
    periodEnd: new Date(Date.now() + 7 * 86400000).toISOString(),
    isActive: true,
    progress: { current: 0, completed: false, rewardedAt: null },
  },
];

export default function QuestsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const { data: questsData, isLoading, isError, refetch } = useQuery({
    queryKey: ['driver', 'quests', 'active'],
    queryFn: () => questsApi.listActive(),
    select: (r) => (r.data as any)?.data?.quests ?? [],
    retry: 2,
  });

  const { data: historyData } = useQuery({
    queryKey: ['driver', 'quests', 'history'],
    queryFn: () => questsApi.listHistory(),
    select: (r) => (r.data as any)?.data?.history ?? [],
    retry: 1,
  });

  // Fall back to static quests ONLY when the API is unreachable (offline).
  // Previously an empty *successful* response also triggered the fallback, which
  // masked the real "no quests seeded" state and showed frozen 0-progress cards
  // that never updated after a completed ride. Now an empty response renders a
  // genuine empty state and real quests render live progress.
  const displayQuests: DriverQuest[] = useMemo(() => {
    if (isError) return FALLBACK_QUESTS;
    return questsData ?? [];
  }, [questsData, isError]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <Entrance animation="slideUp" style={styles.header}>
          <Text variant="headlineSmall">Quests & Bonuses</Text>
          <Text variant="bodySmall" color={colors.onSurfaceVariant}>
            Complete quests to earn bonus rewards
          </Text>
        </Entrance>

        {/* Active quests */}
        <Entrance animation="slideDown" delay={80}>
          <Text variant="titleSmall" style={styles.sectionLabel}>Active Quests</Text>

          {isLoading && (
            <View style={{ gap: spacing.base }}>
              {[1, 2].map((i) => (
                <Skeleton key={i} height={120} borderRadius={radii.xl} />
              ))}
            </View>
          )}

          {!isLoading && displayQuests.length === 0 && (
            <EmptyState
              icon="🏆"
              title="No active quests"
              subtitle="New quests appear here. Complete trips to earn bonus rewards."
            />
          )}

          {!isLoading && displayQuests.length > 0 && (
            <View style={{ gap: spacing.base }}>
              {displayQuests.map((quest) => (
                <QuestCard
                  key={quest.id}
                  title={quest.title}
                  description={quest.description}
                  type={quest.type}
                  target={quest.target}
                  rewardAmount={quest.rewardAmount}
                  current={quest.progress?.current ?? 0}
                  completed={quest.progress?.completed ?? false}
                  rewardedAt={quest.progress?.rewardedAt ?? null}
                />
              ))}
            </View>
          )}
        </Entrance>

        {/* Completed history */}
        {(historyData ?? []).length > 0 && (
          <Entrance animation="slideDown" delay={140}>
            <Text variant="titleSmall" style={styles.sectionLabel}>Completed</Text>
            <View style={{ gap: spacing.sm }}>
              {(historyData as any[]).map((item: any) => (
                <View key={item.questId} style={[styles.historyItem, { backgroundColor: colors.surfaceContainer, borderColor: colors.outline }]}>
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyMedium">{item.title}</Text>
                    <Text variant="caption" color={colors.onSurfaceVariant}>
                      +GHS {item.rewardAmount.toFixed(2)} bonus
                    </Text>
                  </View>
                  <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                </View>
              ))}
            </View>
          </Entrance>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.backgroundDeep },
    scroll: {
      paddingHorizontal: spacing['2xl'],
      paddingBottom: 120,
      gap: spacing.xl,
    },
    header: { paddingTop: spacing.lg, gap: spacing.xs },
    sectionLabel: { marginBottom: spacing.sm },
    historyItem: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: radii.lg,
      borderWidth: 1,
      padding: spacing.base,
      gap: spacing.sm,
    },
  });
