import React, { useMemo } from 'react';
import { View, StyleSheet, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationsApi } from '@eyego/api';
import type { AppNotification } from '@eyego/api';
import { fonts, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text } from '@eyego/ui';
import { relativeTime } from '@eyego/utils';

const TYPE_ICONS: Record<AppNotification['type'], string> = {
  booking: '🎫',
  payment: '💳',
  driver: '🚌',
  promo: '🎉',
  system: '🔔',
};

function SkeletonCard() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <MotiView
      from={{ opacity: 0.4 }}
      animate={{ opacity: 1 }}
      transition={{ type: 'timing', duration: 500, loop: true }}
      style={styles.skeletonCard}
    >
      <View style={styles.skeletonIcon} />
      <View style={styles.skeletonContent}>
        <View style={[styles.skeletonLine, { width: '60%' }]} />
        <View style={[styles.skeletonLine, { width: '90%', marginTop: spacing.xs }]} />
      </View>
    </MotiView>
  );
}

export default function NotificationsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.getAll({ limit: 30 }),
    refetchInterval: 30_000,
    refetchOnMount: true,
  });

  const markReadMutation = useMutation({
    mutationFn: (notifId: string) => notificationsApi.markRead(notifId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const notifications: AppNotification[] = (data as any)?.data?.data?.notifications ?? [];
  const hasUnread = Array.isArray(notifications) ? notifications.some((n) => !n.read) : false;

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <MotiView
        from={{ opacity: 0, translateY: -6 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        style={styles.header}
      >
        <Text variant="headlineMedium">Notifications</Text>
        {hasUnread && (
          <Pressable onPress={() => markAllReadMutation.mutate()}>
            <Text variant="label" color={colors.primary}>Mark all read</Text>
          </Pressable>
        )}
      </MotiView>

      {isLoading ? (
        <View style={styles.list}>
          {[...Array(5)].map((_, i) => <SkeletonCard key={i} />)}
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => (
            <MotiView
              from={{ opacity: 0, translateY: 10 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'spring', stiffness: 600, damping: 34, delay: index * 35 }}
            >
              <Pressable
                style={[styles.notifCard, !item.read && styles.notifCardUnread]}
                onPress={() => {
                  if (!item.read) markReadMutation.mutate(item.id);
                }}
              >
                {!item.read && <View style={styles.unreadDot} />}

                <View style={styles.iconCircle}>
                  <Text style={{ fontSize: 20 }}>{TYPE_ICONS[item.type] ?? '🔔'}</Text>
                </View>

                <View style={styles.notifContent}>
                  <View style={styles.notifTop}>
                    <Text variant="titleSmall" numberOfLines={1} style={{ flex: 1 }}>
                      {item.title}
                    </Text>
                    <Text variant="caption" color={colors.onSurfaceVariant}>
                      {relativeTime(item.createdAt)}
                    </Text>
                  </View>
                  <Text variant="bodySmall" color={colors.onSurfaceVariant} numberOfLines={2}>
                    {item.body}
                  </Text>
                </View>
              </Pressable>
            </MotiView>
          )}
          ListEmptyComponent={
            <MotiView
              from={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 600, damping: 34 }}
              style={styles.empty}
            >
              <Text style={{ fontSize: 48 }}>🔔</Text>
              <Text variant="titleMedium" style={{ marginTop: spacing.base }}>
                All caught up!
              </Text>
              <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ marginTop: spacing.sm }}>
                No new notifications.
              </Text>
            </MotiView>
          }
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.backgroundDeep },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing.xl,
    paddingBottom: spacing.base,
  },
  list: { paddingHorizontal: spacing['2xl'], gap: spacing.sm, paddingBottom: spacing['3xl'] },
  notifCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.xl,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    gap: spacing.md,
    position: 'relative',
  },
  notifCardUnread: {
    borderColor: colors.primary + '40',
    backgroundColor: colors.surfaceContainerHigh,
  },
  unreadDot: {
    position: 'absolute',
    top: spacing.base,
    right: spacing.base,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  notifContent: { flex: 1 },
  notifTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.xs,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 80,
  },
  skeletonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.xl,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  skeletonIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceContainerHigh,
  },
  skeletonContent: { flex: 1 },
  skeletonLine: {
    height: 12,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceContainerHigh,
  },
});
