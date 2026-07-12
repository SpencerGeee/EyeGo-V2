import React, { useMemo, useCallback, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Entrance, GlassSurface, AnimatedList, AppBackground } from '@eyego/ui';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useDriverStore } from '../../stores/driver.store';
import { useNotificationsStore, type DriverNotification, type NotificationType } from '../../stores/notifications.store';

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
  const { notifications, markRead, markAllRead } = useNotificationsStore();
  const [activeCategory, setActiveCategory] = useState<Category>('All');

  const hasUnread = useMemo(() => notifications.some((n) => !n.read), [notifications]);

  const filtered = useMemo(() => {
    const types = CATEGORY_TYPES[activeCategory];
    if (!types) return notifications;
    return notifications.filter((n) => types.includes(n.type));
  }, [notifications, activeCategory]);

  const handlePress = useCallback((n: DriverNotification) => {
    if (!n.read) markRead(n.id);
    if (!n.tripId) return;
    if (n.type === 'COMPLETED') {
      router.push(`/(trip)/complete/${n.tripId}` as any);
    } else if (n.type === 'TRIP_ASSIGNED') {
      router.push(`/(trip)/dispatch/${n.tripId}` as any);
    } else {
      // DRIVER_EN_ROUTE / ARRIVED_AT_PICKUP / IN_PROGRESS / everything else in-trip
      router.push(`/(trip)/active/${n.tripId}` as any);
    }
  }, [markRead, router]);

  const renderItem = useCallback(({ item }: { item: DriverNotification }) => {
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
      <AppBackground isDark={theme !== 'light'} />
      {/* Header */}
      <Entrance animation="slideUp" style={styles.header}>
        <Text variant="headlineMedium">Alerts</Text>
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
          data={filtered}
          keyExtractor={(item) => item.id}
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
      paddingHorizontal: spacing['2xl'],
      paddingBottom: 100,
      gap: spacing.sm,
    },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'rgba(255,255,255,0.04)',
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
      backgroundColor: 'rgba(255,255,255,0.07)',
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
