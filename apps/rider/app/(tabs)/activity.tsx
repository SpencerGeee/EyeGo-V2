import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { bookingsApi, notificationsApi } from '@eyego/api';
import { relativeTime } from '@eyego/utils';
import { colors, fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

type FilterTab = 'all' | 'trips' | 'alerts';

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: '#4be277',
  CANCELLED: '#EF4444',
  CONFIRMED: '#60A5FA',
  SEAT_HELD: '#60A5FA',
  BOARDED: '#F59E0B',
  PENDING: 'rgba(255,255,255,0.4)',
};

const NOTIF_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  TRIP_CONFIRMED: 'checkmark-circle',
  DRIVER_EN_ROUTE: 'navigate',
  ARRIVED_AT_PICKUP: 'location',
  TRIP_COMPLETED: 'flag',
  CHAT_MESSAGE: 'chatbubble',
  PROMO: 'gift',
  SYSTEM: 'information-circle',
};

function TripItem({ booking }: { booking: any }) {
  const router = useRouter();
  const statusColor = STATUS_COLORS[booking.status] ?? 'rgba(255,255,255,0.4)';

  return (
    <Pressable
      style={({ pressed }) => [styles.itemCard, pressed && { opacity: 0.75 }]}
      onPress={() => {
        Haptics.selectionAsync();
        router.push(`/ride/${booking.id}` as any);
      }}
    >
      <View style={[styles.itemIcon, { backgroundColor: `${statusColor}18` }]}>
        <Ionicons name="car-outline" size={18} color={statusColor} />
      </View>
      <View style={styles.itemBody}>
        <Text style={styles.itemTitle} numberOfLines={1}>
          {booking.routeOrigin ?? 'Unknown'} → {booking.routeDestination ?? 'Unknown'}
        </Text>
        <Text style={styles.itemMeta}>
          {relativeTime(booking.departureTime ?? booking.createdAt)} ·{' '}
          <Text style={[styles.itemStatus, { color: statusColor }]}>{booking.status}</Text>
        </Text>
      </View>
      {booking.totalFare != null && (
        <Text style={styles.itemFare}>
          GH₵{' '}
          {typeof booking.totalFare === 'number'
            ? booking.totalFare.toFixed(2)
            : booking.totalFare}
        </Text>
      )}
    </Pressable>
  );
}

function NotificationItem({ notification }: { notification: any }) {
  const iconName = NOTIF_ICONS[notification.type] ?? 'notifications-outline';

  return (
    <View style={[styles.itemCard, styles.notifCard]}>
      <View style={[styles.itemIcon, { backgroundColor: `${colors.primary}14` }]}>
        <Ionicons name={iconName} size={18} color={colors.primary} />
      </View>
      <View style={styles.itemBody}>
        <Text style={styles.itemTitle} numberOfLines={1}>{notification.title}</Text>
        <Text style={styles.itemMeta}>{relativeTime(notification.createdAt)}</Text>
      </View>
    </View>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

export default function ActivityScreen() {
  const [filter, setFilter] = useState<FilterTab>('all');
  const [refreshing, setRefreshing] = useState(false);

  const {
    data: bookings,
    isLoading: bookingsLoading,
    refetch: refetchBookings,
  } = useQuery({
    queryKey: ['bookings', 'history'],
    queryFn: () => bookingsApi.getHistory(),
    staleTime: 60_000,
  });

  const {
    data: notifications,
    isLoading: notifsLoading,
    refetch: refetchNotifs,
  } = useQuery({
    queryKey: ['notifications', 'all'],
    queryFn: () => notificationsApi.getAll({ limit: 50 }),
    staleTime: 30_000,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchBookings(), refetchNotifs()]);
    setRefreshing(false);
  }, [refetchBookings, refetchNotifs]);

  const isLoading = bookingsLoading || notifsLoading;

  const feedItems = React.useMemo(() => {
    const items: Array<{ type: 'trip' | 'notification'; data: any; date: string }> = [];

    // Unwrap AxiosResponse / paginated / plain-array shapes
    const rawBookings: any[] = Array.isArray(bookings)
      ? bookings
      : (bookings as any)?.data ?? [];

    const rawNotifs: any[] = Array.isArray(notifications)
      ? notifications
      : (notifications as any)?.data ?? [];

    if (filter !== 'alerts') {
      rawBookings.forEach((b: any) => {
        items.push({ type: 'trip', data: b, date: b.departureTime ?? b.createdAt });
      });
    }

    if (filter !== 'trips') {
      rawNotifs.forEach((n: any) => {
        items.push({ type: 'notification', data: n, date: n.createdAt });
      });
    }

    return items.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }, [bookings, notifications, filter]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Activity</Text>
      </View>

      <View style={styles.filterRow}>
        {(['all', 'trips', 'alerts'] as FilterTab[]).map((f) => (
          <FilterChip
            key={f}
            label={f === 'all' ? 'All' : f === 'trips' ? 'Trips' : 'Alerts'}
            active={filter === f}
            onPress={() => {
              Haptics.selectionAsync();
              setFilter(f);
            }}
          />
        ))}
      </View>

      {isLoading && !refreshing ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={feedItems}
          keyExtractor={(item, idx) => `${item.type}-${item.data.id ?? idx}`}
          renderItem={({ item }) =>
            item.type === 'trip' ? (
              <TripItem booking={item.data} />
            ) : (
              <NotificationItem notification={item.data} />
            )
          }
          contentContainerStyle={[
            styles.listContent,
            feedItems.length === 0 && styles.emptyContent,
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="time-outline" size={48} color="rgba(255,255,255,0.15)" />
              <Text style={styles.emptyText}>No activity yet</Text>
              <Text style={styles.emptyHint}>Your rides and alerts will appear here</Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundDeep,
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.headlineLarge,
    color: '#fff',
    letterSpacing: -0.5,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  chipActive: {
    backgroundColor: `${colors.primary}22`,
    borderColor: `${colors.primary}50`,
  },
  chipText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodySmall,
    color: 'rgba(255,255,255,0.5)',
  },
  chipTextActive: {
    color: colors.primary,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 120,
    gap: spacing.sm,
  },
  emptyContent: {
    flex: 1,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  notifCard: {
    borderColor: `${colors.primary}18`,
  },
  itemIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemBody: { flex: 1 },
  itemTitle: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    color: '#fff',
  },
  itemMeta: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.caption,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 3,
  },
  itemStatus: {
    fontFamily: fonts.medium,
  },
  itemFare: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    color: colors.primary,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: spacing.sm,
  },
  emptyText: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.titleSmall,
    color: 'rgba(255,255,255,0.35)',
  },
  emptyHint: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodySmall,
    color: 'rgba(255,255,255,0.2)',
    textAlign: 'center',
  },
});
