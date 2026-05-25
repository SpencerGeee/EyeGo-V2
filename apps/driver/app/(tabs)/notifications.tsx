import React, { useMemo, useCallback } from 'react';
import { View, StyleSheet, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text } from '@eyego/ui';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useNotificationsStore, type DriverNotification, type NotificationType } from '../../stores/notifications.store';

const TYPE_CONFIG: Record<NotificationType, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  TRIP_ASSIGNED:      { icon: 'car-sport', color: '#3B82F6' },
  PAYMENT_CONFIRMED:  { icon: 'wallet', color: '#22C55E' },
  DRIVER_EN_ROUTE:    { icon: 'navigate', color: '#F59E0B' },
  IN_PROGRESS:        { icon: 'play', color: '#4BE277' },
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
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function NotificationsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { notifications, markRead, markAllRead } = useNotificationsStore();

  const hasUnread = useMemo(() => notifications.some((n) => !n.read), [notifications]);

  const handlePress = useCallback((n: DriverNotification) => {
    if (!n.read) markRead(n.id);
    if (n.tripId) {
      router.push(`/(trip)/active/${n.tripId}` as any);
    }
  }, [markRead, router]);

  const renderItem = ({ item, index }: { item: DriverNotification; index: number }) => {
    const cfg = TYPE_CONFIG[item.type] ?? TYPE_CONFIG.INFO;
    return (
      <MotiView
        from={{ opacity: 0, translateY: 10 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30, delay: index * 35 }}
      >
        <Pressable
          style={[styles.card, !item.read && styles.cardUnread]}
          onPress={() => handlePress(item)}
        >
          {!item.read && <View style={styles.unreadDot} />}
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
          <Ionicons name="chevron-forward" size={14} color={colors.onSurfaceVariant} />
        </Pressable>
      </MotiView>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <MotiView
        from={{ opacity: 0, translateY: -6 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        style={styles.header}
      >
        <Text variant="headlineMedium">Alerts</Text>
        {hasUnread && (
          <Pressable onPress={markAllRead} hitSlop={8}>
            <Text variant="label" color={colors.primary}>Mark all read</Text>
          </Pressable>
        )}
      </MotiView>

      {/* List */}
      {notifications.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="notifications-off-outline" size={48} color={colors.onSurfaceVariant} />
          <Text variant="titleMedium" style={{ marginTop: spacing.base, color: colors.onSurface }}>All caught up!</Text>
          <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ marginTop: spacing.sm }}>
            Trip updates and alerts will appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
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
    safe: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing.xl,
      paddingBottom: spacing.base,
    },
    list: {
      paddingHorizontal: spacing['2xl'],
      paddingBottom: spacing['3xl'],
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
    },
    cardUnread: {
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
  });
