import React, { useMemo, useCallback, useState, useEffect } from 'react';
import { View, StyleSheet, FlatList, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { notificationsApi } from '@eyego/api';
import type { AppNotification } from '@eyego/api';
import { fonts, spacing, radii, withOpacity } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, GlassSurface } from '@eyego/ui';
import { relativeTime } from '@eyego/utils';

type Category = 'All' | 'Trips' | 'Payments' | 'Promos';

const CATEGORIES: Category[] = ['All', 'Trips', 'Payments', 'Promos'];

const CATEGORY_TYPES: Record<Category, AppNotification['type'][] | null> = {
  All: null,
  Trips: ['booking', 'driver'],
  Payments: ['payment'],
  Promos: ['promo', 'system'],
};

function getTypeIcons(colors: Colors): Record<AppNotification['type'], { icon: keyof typeof Ionicons.glyphMap; color: string }> {
  return {
    booking: { icon: 'ticket-outline', color: colors.statusInfo },
    payment: { icon: 'card-outline', color: colors.statusSuccess },
    driver: { icon: 'bus-outline', color: colors.tierRoyal },
    promo: { icon: 'gift-outline', color: colors.tierPremium },
    system: { icon: 'notifications-outline', color: colors.onSurfaceVariant },
  };
}

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

function NotificationCard({
  item,
  index,
  onPress,
  styles,
  colors,
}: {
  item: AppNotification;
  index: number;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  const typeInfo = getTypeIcons(colors)[item.type] ?? { icon: 'notifications-outline' as const, color: colors.onSurfaceVariant };

  return (
    <MotiView
      from={{ opacity: 0, translateY: 10 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'spring', stiffness: 600, damping: 34, delay: index * 35 }}
    >
      <Pressable onPress={onPress} style={styles.cardWrapper}>
        {/* Glass card — canonical GlassSurface behind each primary card
            (replaces the ad-hoc per-row BlurView; gates on perf tier internally). */}
        <View style={[styles.notifCard, !item.read && styles.notifCardUnread]}>
          <GlassSurface
            borderRadius={radii.xl}
            intensity={item.read ? 'low' : 'high'}
            dark
            style={StyleSheet.absoluteFill}
          />
          {!item.read && <View style={styles.unreadStripe} />}

          <View style={[styles.iconCircle, { backgroundColor: withOpacity(typeInfo.color, 0.1) }]}>
            <Ionicons name={typeInfo.icon} size={20} color={typeInfo.color} />
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

          {!item.read && <View style={styles.unreadDot} />}
        </View>
      </Pressable>
    </MotiView>
  );
}

export default function NotificationsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [activeCategory, setActiveCategory] = useState<Category>('All');

  // Notifications are DERIVED live from booking history on the backend (no stored
  // read-state model), so the server mark-read routes are intentional no-ops.
  // We persist read-state locally keyed by the stable derived id (e.g.
  // "<bookingId>:paid") so the buttons actually work and the unread dot stays
  // cleared across refetches/sessions.
  const READ_KEY = 'eyego_read_notifications';
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    AsyncStorage.getItem(READ_KEY)
      .then((raw) => { if (raw) setReadIds(new Set(JSON.parse(raw) as string[])); })
      .catch(() => {});
  }, []);

  const persistReadIds = useCallback((next: Set<string>) => {
    setReadIds(next);
    AsyncStorage.setItem(READ_KEY, JSON.stringify([...next])).catch(() => {});
  }, []);

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.getAll({ limit: 50 }),
    refetchInterval: 30_000,
    refetchOnMount: true,
  });

  const rawNotifications: AppNotification[] = (data as any)?.data?.data?.notifications ?? [];
  // Overlay locally-persisted read-state on top of the server-derived flag.
  const allNotifications: AppNotification[] = useMemo(
    () => rawNotifications.map((n) => (readIds.has(n.id) ? { ...n, read: true } : n)),
    [rawNotifications, readIds],
  );
  const hasUnread = allNotifications.some((n) => !n.read);

  const markRead = useCallback((notifId: string) => {
    if (readIds.has(notifId)) return;
    const next = new Set(readIds);
    next.add(notifId);
    persistReadIds(next);
    // Best-effort server call (currently a no-op) — harmless if it stays one.
    notificationsApi.markRead(notifId).catch(() => {});
  }, [readIds, persistReadIds]);

  const markAllRead = useCallback(() => {
    const next = new Set(readIds);
    allNotifications.forEach((n) => next.add(n.id));
    persistReadIds(next);
    notificationsApi.markAllRead().catch(() => {});
  }, [readIds, allNotifications, persistReadIds]);

  const filteredNotifications = useMemo(() => {
    const typeFilter = CATEGORY_TYPES[activeCategory];
    if (!typeFilter) return allNotifications;
    return allNotifications.filter((n) => typeFilter.includes(n.type));
  }, [allNotifications, activeCategory]);

  const renderItem = useCallback(({ item, index }: { item: AppNotification; index: number }) => (
    <NotificationCard
      item={item}
      index={index}
      onPress={() => { if (!item.read) markRead(item.id); }}
      styles={styles}
      colors={colors}
    />
  ), [styles, colors, markRead]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <MotiView
        from={{ opacity: 0, translateY: -6 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        style={styles.header}
      >
        <Text variant="headlineMedium">Notifications</Text>
        {hasUnread && (
          <Pressable
            onPress={markAllRead}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Mark all notifications as read"
          >
            <Text variant="label" color={colors.primary}>Mark all read</Text>
          </Pressable>
        )}
      </MotiView>

      {/* Category pills */}
      <MotiView
        from={{ opacity: 0, translateY: 4 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 60 }}
        style={styles.categoryRow}
      >
        {CATEGORIES.map((cat) => (
          <Pressable
            key={cat}
            onPress={() => setActiveCategory(cat)}
            style={[styles.categoryPill, activeCategory === cat && styles.categoryPillActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: activeCategory === cat }}
          >
            <Text
              style={[
                styles.categoryLabel,
                { color: activeCategory === cat ? colors.primary : colors.onSurfaceVariant },
              ]}
            >
              {cat}
            </Text>
            {activeCategory === cat && <View style={styles.categoryUnderline} />}
          </Pressable>
        ))}
      </MotiView>

      {isLoading ? (
        <View style={styles.list}>
          {[...Array(5)].map((_, i) => <SkeletonCard key={i} />)}
        </View>
      ) : (
        <FlatList
          data={filteredNotifications}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          renderItem={renderItem}
          ListEmptyComponent={
            <MotiView
              from={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 600, damping: 34 }}
              style={styles.empty}
            >
              <View style={styles.emptyIconWrapper}>
                <Ionicons name="notifications-outline" size={52} color={colors.onSurfaceVariant} style={{ opacity: 0.3 }} />
              </View>
              <Text variant="titleMedium" style={{ marginTop: spacing.base }}>All caught up!</Text>
              <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ marginTop: spacing.sm, textAlign: 'center' }}>
                No {activeCategory === 'All' ? '' : activeCategory.toLowerCase() + ' '}notifications yet.
              </Text>
            </MotiView>
          }
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
  },
  categoryRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing['2xl'],
    gap: spacing.lg,
    paddingBottom: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.rimLight,
    marginBottom: spacing.sm,
  },
  categoryPill: {
    paddingVertical: spacing.xs,
    alignItems: 'center',
    position: 'relative',
  },
  categoryPillActive: {},
  categoryLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    lineHeight: Math.round(13 * 1.4),
  },
  categoryUnderline: {
    position: 'absolute',
    bottom: -spacing.xs - 1,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.primary,
    borderRadius: radii.full,
  },
  list: {
    paddingHorizontal: spacing['2xl'],
    gap: spacing.sm,
    paddingBottom: 100,
  },
  cardWrapper: {},
  notifCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: radii.xl,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.rimLight,
    gap: spacing.md,
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: colors.surfaceCard,
  },
  notifCardUnread: {
    borderColor: withOpacity(colors.primary, 0.2),
    backgroundColor: colors.surfaceContainer,
  },
  unreadStripe: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: colors.primary,
    borderTopLeftRadius: radii.xl,
    borderBottomLeftRadius: radii.xl,
  },
  unreadDot: {
    position: 'absolute',
    top: spacing.base,
    right: spacing.base,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
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
  emptyIconWrapper: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skeletonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.xl,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.rimLight,
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
