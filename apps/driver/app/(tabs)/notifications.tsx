import React, { useMemo, useCallback, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { driverApi, type AwayOutcome } from '@eyego/api';
import { present } from '../../components/AwayOutcomesSheet';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Entrance, GlassSurface, AnimatedList, LargeTitle, goDeeper } from '@eyego/ui';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useDriverStore } from '../../stores/driver.store';
import { useNotificationsStore, type DriverNotification, type NotificationType } from '../../stores/notifications.store';
import { useDriverTripStore } from '../../stores/trip.store';
import { PendingDispatchList } from '../../components/PendingDispatchList';

type Category = 'All' | 'Dispatch' | 'Earnings' | 'System';
const CATEGORIES: Category[] = ['All', 'Dispatch', 'Earnings', 'System'];

const CATEGORY_TYPES: Record<Category, NotificationType[] | null> = {
  All: null,
  Dispatch: ['TRIP_ASSIGNED', 'DRIVER_EN_ROUTE', 'IN_PROGRESS', 'ARRIVED_AT_PICKUP', 'COMPLETED'],
  Earnings: ['PAYMENT_CONFIRMED'],
  System: ['SEAT_UPDATE', 'INFO'],
};

const TYPE_CONFIG: Record<NotificationType, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  TRIP_ASSIGNED:      { icon: 'car-sport', color: '#3B82F6' },
  PAYMENT_CONFIRMED:  { icon: 'wallet', color: '#22C55E' },
  DRIVER_EN_ROUTE:    { icon: 'navigate', color: '#F59E0B' },
  IN_PROGRESS:        { icon: 'play', color: '#4BE277' },
  ARRIVED_AT_PICKUP:  { icon: 'location', color: '#F59E0B' },
  COMPLETED:          { icon: 'checkmark-circle', color: '#60A5FA' },
  SEAT_UPDATE:        { icon: 'people', color: '#A78BFA' },
  INFO:               { icon: 'information-circle', color: '#94A3B8' },
};

/** Which inbox filter each away fact belongs under. */
const OUTCOME_TYPE: Record<string, NotificationType> = {
  TRIP_COMPLETED: 'COMPLETED',
  SEATS_CHANGED: 'SEAT_UPDATE',
  TIP_RECEIVED: 'PAYMENT_CONFIRMED',
  BONUS_RECEIVED: 'PAYMENT_CONFIRMED',
  PAYOUT_COMPLETED: 'PAYMENT_CONFIRMED',
  PAYOUT_FAILED: 'PAYMENT_CONFIRMED',
};

function formatTimestamp(iso: string) {
  const now = Date.now();
  const diff = now - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function NotificationsScreen() {
  const colors = useColors();
  const theme = useDriverStore(s => s.theme);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { notifications: liveNotifications, markRead, markAllRead } = useNotificationsStore();
  const [activeCategory, setActiveCategory] = useState<Category>('All');
  const pendingRequests = useDriverTripStore((s) => s.pendingRequests);
  const resync = useDriverTripStore((s) => s.resync);

  /**
   * "if i go to the dispatch page on the alerts page, i should be able to see if
   * there's an unaccepted offer."
   *
   * Notifications are a HISTORY — they only exist once something already
   * happened to this driver. A search that is still hunting has produced no
   * notification at all, so the Dispatch tab was structurally incapable of
   * showing the thing the user went there to check. Asking the server on entry
   * is what makes the tab answer the live question rather than the past one.
   */
  React.useEffect(() => {
    if (activeCategory === 'Dispatch') void resync();
  }, [activeCategory, resync]);

  // Backfills history the live socket-driven store missed while the app was
  // fully killed: the same 30 days of facts as the away sheet
  // (away-outcomes.service), in the sheet's own words (`present`).
  const { data: derivedNotifications = [] } = useQuery({
    queryKey: ['driver', 'notifications', 'outcomes'],
    queryFn: () => driverApi.outcomes(undefined, 30),
    select: (r) => ((r.data as any)?.data?.outcomes ?? []) as AwayOutcome[],
    staleTime: 60_000,
  });

  const notifications = useMemo<(DriverNotification & { go?: string })[]>(() => {
    // Live entries carry the real read state; backfilled history was already
    // told (banner, push or away sheet) and lands read.
    const backfilled = derivedNotifications.flatMap((o) => {
      const p = present(o);
      if (!p) return [];
      return [{ id: o.key, type: OUTCOME_TYPE[o.kind] ?? 'INFO', title: p.title, body: p.body, tripId: o.tripId ?? undefined, timestamp: o.at, read: true, go: p.go }];
    });
    return [...liveNotifications, ...backfilled].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }, [liveNotifications, derivedNotifications]);

  const hasUnread = useMemo(() => notifications.some((n) => !n.read), [notifications]);

  const filtered = useMemo(() => {
    const types = CATEGORY_TYPES[activeCategory];
    if (!types) return notifications;
    return notifications.filter((n) => types.includes(n.type));
  }, [notifications, activeCategory]);

  /** Today / Earlier — the list reads as a day, not as one long column. */
  type Row = DriverNotification | { id: string; header: string };
  const rows = useMemo<Row[]>(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const today = filtered.filter((n) => new Date(n.timestamp).getTime() >= startOfToday.getTime());
    const earlier = filtered.filter((n) => new Date(n.timestamp).getTime() < startOfToday.getTime());
    return [
      ...(today.length ? [{ id: 'h-today', header: 'Today' }, ...today] : []),
      ...(earlier.length ? [{ id: 'h-earlier', header: 'Earlier' }, ...earlier] : []),
    ];
  }, [filtered]);

  const handlePress = useCallback((n: DriverNotification & { go?: string }) => {
    if (!n.read) markRead(n.id);
    if (n.go) return goDeeper(n.go as any);
    if (!n.tripId) return;
    if (n.type === 'COMPLETED') {
      goDeeper(`/(trip)/complete/${n.tripId}` as any);
    } else if (n.type === 'TRIP_ASSIGNED') {
      goDeeper(`/(trip)/dispatch/${n.tripId}` as any);
    } else {
      // DRIVER_EN_ROUTE / ARRIVED_AT_PICKUP / IN_PROGRESS / everything else in-trip
      goDeeper(`/(trip)/active/${n.tripId}` as any);
    }
  }, [markRead, router]);

  const renderItem = useCallback(({ item: row }: { item: DriverNotification | { id: string; header: string } }) => {
    if ('header' in row) {
      return <Text style={styles.sectionHeader}>{row.header.toUpperCase()}</Text>;
    }
    const item = row;
    const cfg = TYPE_CONFIG[item.type] ?? TYPE_CONFIG.INFO;
    return (
      <Pressable
        style={[styles.card, !item.read && styles.cardUnread]}
        onPress={() => handlePress(item)}
        accessibilityRole="button"
      >
        <GlassSurface borderRadius={radii.xl} intensity="low" style={StyleSheet.absoluteFill} />
        {!item.read && <View style={styles.unreadStripe} />}
        <View style={[styles.iconCircle, { backgroundColor: cfg.color + '18' }]}>
          <Ionicons name={cfg.icon} size={20} color={cfg.color} />
        </View>
        <View style={styles.content}>
          <View style={styles.topRow}>
            <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
            <Text variant="caption" color={colors.onSurfaceVariant}>{formatTimestamp(item.timestamp)}</Text>
          </View>
          <Text variant="bodySmall" color={colors.onSurfaceVariant} numberOfLines={2}>
            {item.body}
          </Text>
        </View>
        {!item.read && <View style={styles.unreadDot} />}
        <Ionicons name="chevron-forward" size={14} color={colors.onSurfaceVariant} />
      </Pressable>
    );
  }, [styles, colors, handlePress]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <Entrance animation="slideUp" style={styles.header}>
        <LargeTitle title="Alerts" />
        {hasUnread && (
          <Pressable onPress={markAllRead} hitSlop={8} accessibilityRole="button" accessibilityLabel="Mark all read">
            <Text variant="label" color={colors.primary}>Mark all read</Text>
          </Pressable>
        )}
      </Entrance>

      {/* Category pills */}
      <Entrance animation="slideDown" delay={60} style={styles.categoryRow}>
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
      </Entrance>

      {/*
        Live dispatch, above the history. On the Dispatch tab it is always
        present — including its empty line, because "nothing is waiting on you"
        is the answer the driver came for and a blank screen is not it. On All
        it appears only when something is actually in flight, so the default
        view stays a notification list.
      */}
      {(activeCategory === 'Dispatch' ||
        (activeCategory === 'All' && pendingRequests.length > 0)) && (
        <Entrance animation="slideUp" delay={90}>
          <PendingDispatchList />
        </Entrance>
      )}

      {/* List */}
      {filtered.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIconWrapper}>
            <Ionicons name="notifications-off-outline" size={48} color={colors.onSurfaceVariant} style={{ opacity: 0.3 }} />
          </View>
          <Text variant="titleMedium" style={{ marginTop: spacing.base, color: colors.onSurface }}>All caught up!</Text>
          <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ marginTop: spacing.sm, textAlign: 'center' }}>
            {activeCategory === 'All' ? 'Trip updates and alerts will appear here.' : `No ${activeCategory.toLowerCase()} alerts yet.`}
          </Text>
        </View>
      ) : (
        <AnimatedList
          data={rows}
          keyExtractor={(item) => item.id}
          style={{ flex: 1 }}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={renderItem}
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      // LargeTitle carries its own 20pt gutter; this only pads the trailing action.
      paddingRight: 20,
      paddingTop: spacing.xl,
    },
    sectionHeader: {
      fontFamily: fonts.semiBold,
      fontSize: 11,
      letterSpacing: 1.1,
      color: colors.onSurfaceVariant,
      marginTop: spacing.md,
      marginBottom: 2,
    },
    categoryRow: {
      flexDirection: 'row',
      paddingHorizontal: 20,
      gap: spacing.lg,
      paddingBottom: spacing.base,
      borderBottomWidth: 1,
      borderBottomColor: colors.outline,
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
      lineHeight: 17,
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
      paddingHorizontal: 20,
      paddingBottom: 100,
      gap: spacing.sm,
    },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outline,
      padding: spacing.base,
      gap: spacing.md,
      position: 'relative',
      overflow: 'hidden',
    },
    cardUnread: {
      borderColor: colors.primary + '40',
      backgroundColor: colors.primary + '0F',
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
      right: spacing.base + 18,
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
    content: { flex: 1 },
    topRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: spacing.xs,
    },
    title: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.3),
      color: colors.onSurface,
      flex: 1,
      marginRight: spacing.sm,
    },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing['2xl'],
    },
    emptyIconWrapper: {
      width: 88,
      height: 88,
      borderRadius: 44,
      backgroundColor: colors.surfaceContainer,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
