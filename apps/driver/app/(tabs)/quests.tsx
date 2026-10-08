import React, { useMemo, useState } from 'react';
import { formatGhs } from '@eyego/utils';
import { View, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { questsApi } from '@eyego/api';
import type { DriverQuest } from '@eyego/api';
import { spacing, radii } from '@eyego/config';
import { Text, Skeleton, EmptyState, Entrance, notify } from '@eyego/ui';
import { useColors, type DriverColors } from '../../utils/useColors';
import QuestCard from '../../components/QuestCard';

export default function QuestsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const queryClient = useQueryClient();
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const { data: questsData, isLoading, isError, refetch } = useQuery({
    queryKey: ['driver', 'quests', 'active'],
    queryFn: () => questsApi.listActive(),
    select: (r) => (r.data as any)?.data?.quests ?? [],
    retry: 2,
  });

  const claimMutation = useMutation({
    mutationFn: (questId: string) => questsApi.claim(questId),
    onMutate: (questId: string) => setClaimingId(questId),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['driver', 'quests', 'active'] });
      queryClient.invalidateQueries({ queryKey: ['driver', 'quests', 'history'] });
      queryClient.invalidateQueries({ queryKey: ['driver', 'me'] });
      queryClient.invalidateQueries({ queryKey: ['driver', 'wallet'] });
      const amount = res?.data?.data?.rewardAmountPesewas;
      notify(
        'Bonus claimed',
        typeof amount === 'number' ? `${formatGhs(amount)} added to your wallet.` : 'Your bonus has been added to your wallet.',
        { tone: 'success' },
      );
    },
    onError: (err: any) => {
      const code = err?.response?.data?.errors?.[0]?.code ?? err?.response?.data?.code;
      const message =
        code === 'ALREADY_CLAIMED' ? 'This bonus has already been claimed.'
        : code === 'QUEST_NOT_COMPLETED' ? 'This quest isn\'t completed yet.'
        : err?.response?.data?.message ?? 'Could not claim your bonus. Please try again.';
      notify('Claim Failed', message);
    },
    onSettled: () => setClaimingId(null),
  });

  const { data: historyData } = useQuery({
    queryKey: ['driver', 'quests', 'history'],
    queryFn: () => questsApi.listHistory(),
    select: (r) => (r.data as any)?.data?.history ?? [],
    retry: 1,
  });

  // No invented quests when the request fails. The old offline fallback showed
  // six made-up bonuses ("Weekly Champion, GH₵50") a driver could never earn —
  // a failure is a failure, with a retry.
  const displayQuests: DriverQuest[] = questsData ?? [];

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

          {!isLoading && isError && !questsData && (
            <EmptyState
              icon="cloud-offline-outline"
              title="Couldn’t load quests"
              subtitle="Check your connection and try again."
              action={{ label: 'Try again', onPress: () => void refetch() }}
            />
          )}

          {!isLoading && !isError && displayQuests.length === 0 && (
            <EmptyState
              icon="trophy-outline"
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
                  rewardAmountPesewas={quest.rewardAmountPesewas}
                  current={quest.progress?.current ?? 0}
                  completed={quest.progress?.completed ?? false}
                  rewardedAt={quest.progress?.rewardedAt ?? null}
                  onClaim={() => claimMutation.mutate(quest.id)}
                  claiming={claimingId === quest.id}
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
              {(historyData as any[]).map((item: any, i: number) => (
                // Quests repeat per period, so the quest id alone collides.
                <View key={`${item.questId}-${item.periodStart ?? item.rewardedAt ?? i}`} style={[styles.historyItem, { backgroundColor: colors.surfaceContainer, borderColor: colors.outline }]}>
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyMedium">{item.title}</Text>
                    <Text variant="caption" color={colors.onSurfaceVariant}>
                      +{formatGhs(item.rewardAmountPesewas)} bonus
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
    safe: { flex: 1, backgroundColor: 'transparent' },
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
