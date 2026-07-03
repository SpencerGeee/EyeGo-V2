import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_BASE_HEIGHT } from './_layout';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { bookingsApi, notificationsApi } from '@eyego/api';
import { relativeTime } from '@eyego/utils';
import { fonts, fontSizes, spacing, radii, withOpacity } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

type FilterTab = 'all' | 'trips' | 'alerts';

function getStatusColors(colors: Colors): Record<string, string> {
  return {
    COMPLETED: colors.statusSuccess,
    CANCELLED: colors.statusError,
    CONFIRMED: colors.statusInfo,
    SEAT_HELD: colors.statusInfo,
    BOARDED: colors.statusWarning,
    PENDING: colors.onSurfaceVariant,
  };
}

const NOTIF_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  TRIP_CONFIRMED: 'checkmark-circle',
  DRIVER_EN_ROUTE: 'navigate',
  ARRIVED_AT_PICKUP: 'location',
  TRIP_COMPLETED: 'flag',
  CHAT_MESSAGE: 'chatbubble',
  PROMO: 'gift',
  SYSTEM: 'information-circle',
};

function TripItem({ booking, colors, styles }: { booking: any; colors: Colors; styles: ReturnType<typeof makeStyles> }) {
  const router = useRouter();
  const statusColors = getStatusColors(colors);
  const statusColor = statusColors[booking.status] ?? colors.onSurfaceVariant;

  // Raw Prisma booking includes trip: { route, driver, vehicle } — origin/
  // destination/departure live nested under trip.route, not flat on the
  // booking (fareAmount is the real column name, not totalFare).
  const route = booking.trip?.route;
  const origin = route?.originName ?? booking.routeOrigin ?? 'Unknown';
  const destination = route?.destinationName ?? booking.routeDestination ?? 'Unknown';
  const departureTime = booking.trip?.departureTime ?? booking.departureTime ?? booking.createdAt;
  const fare = booking.fareAmount ?? booking.totalFare;

  return (
    <Pressable
      style={({ pressed }) => [styles.itemCard, pressed && { opacity: 0.75 }]}
      onPress={() => {
        Haptics.selectionAsync();
        router.push(`/ride/${booking.id}` as any);
      }}
    >
      <View style={[styles.itemIcon, { backgroundColor: withOpacity(statusColor, 0.1) }]}>
        <Ionicons name="car-outline" size={18} color={statusColor} />
      </View>
      <View style={styles.itemBody}>
        <Text style={styles.itemTitle} numberOfLines={1}>
          {origin} → {destination}
        </Text>
        <Text style={styles.itemMeta}>
          {relativeTime(departureTime)}
        </Text>
        <View style={[styles.statusChip, { backgroundColor: withOpacity(statusColor, 0.15) }]}>
          <Text style={[styles.statusChipText, { color: statusColor }]}>{booking.status}</Text>
        </View>
      </View>
      {fare != null && (
        <Text style={styles.itemFare}>
          GH₵{' '}
          {typeof fare === 'number' ? fare.toFixed(2) : fare}
        </Text>
      )}
    </Pressable>
  );
}

function NotificationItem({ notification, colors, styles }: { notification: any; colors: Colors; styles: ReturnType<typeof makeStyles> }) {
  const iconName = NOTIF_ICONS[notification.type] ?? 'notifications-outline';

  return (
    <View style={[styles.itemCard, styles.notifCard]}>
      <View style={[styles.itemIcon, { backgroundColor: withOpacity(colors.primary, 0.08) }]}>
        <Ionicons name={iconName} size={18} color={colors.primary} />
      </View>
      <View style={styles.itemBody}>
        <Text style={styles.itemTitle} numberOfLines={1}>{notification.title}</Text>
        <Text style={styles.itemMeta}>{relativeTime(notification.createdAt)}</Text>
      </View>
    </View>
  );
}

function FilterChip({ label, active, onPress, styles }: { label: string; active: boolean; onPress: () => void; styles: ReturnType<typeof makeStyles> }) {
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
  const colors = useColors();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
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

    // apiClient.get() resolves to the raw axios response (pass-through
    // interceptor) wrapping the backend's own {success,message,data:{...}}
    // envelope — a two-level unwrap, same pattern as home.tsx. getHistory's
    // real payload is data.data.bookings (see bookings.service.js
    // getUserBookings return: {bookings,total,page,totalPages}); getAll's is
    // data.data.notifications. Skipping a level left `rawBookings`/`rawNotifs`
    // as the envelope object (no .forEach), crashing the moment the backend
    // returned real data.
    const bookingsBody = (bookings as any)?.data;
    const rawBookings: any[] = Array.isArray(bookingsBody?.data?.bookings)
      ? bookingsBody.data.bookings
      : Array.isArray(bookingsBody?.data)
      ? bookingsBody.data
      : [];

    const notifsBody = (notifications as any)?.data;
    const rawNotifs: any[] = Array.isArray(notifsBody?.data?.notifications)
      ? notifsBody.data.notifications
      : Array.isArray(notifsBody?.data)
      ? notifsBody.data
      : [];

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
            styles={styles}
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
              <TripItem booking={item.data} colors={colors} styles={styles} />
            ) : (
              <NotificationItem notification={item.data} colors={colors} styles={styles} />
            )
          }
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: TAB_BAR_BASE_HEIGHT + insets.bottom + 24 },
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
              <Ionicons name="time-outline" size={48} color={colors.onSurfaceVariant} />
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

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.headlineLarge,
    lineHeight: fontSizes.headlineLarge * 1.25,
    color: colors.onSurface,
    letterSpacing: -0.5,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.base,
    paddingVertical: 8,
    borderRadius: radii.lg,
    backgroundColor: colors.rimLightSubtle,
    borderWidth: 1,
    borderColor: colors.rimLight,
  },
  chipActive: {
    backgroundColor: colors.onSurface,
    borderColor: colors.onSurface,
  },
  chipText: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    lineHeight: fontSizes.bodyMedium * 1.3,
    color: colors.onSurfaceVariant,
  },
  chipTextActive: {
    color: colors.inverseOnSurface,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  emptyContent: {
    flex: 1,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceCard,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.rimLight,
  },
  notifCard: {
    borderColor: withOpacity(colors.primary, 0.1),
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
    fontSize: fontSizes.titleSmall,
    lineHeight: fontSizes.titleSmall * 1.3,
    color: colors.onSurface,
  },
  itemMeta: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.caption,
    lineHeight: fontSizes.caption * 1.4,
    color: colors.onSurfaceVariant,
    marginTop: 3,
  },
  statusChip: {
    alignSelf: 'flex-start',
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginTop: spacing.xs,
  },
  statusChipText: {
    fontFamily: fonts.labelCaps,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  itemFare: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.titleSmall,
    lineHeight: fontSizes.titleSmall * 1.3,
    color: colors.onSurface,
    letterSpacing: -0.3,
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
    lineHeight: fontSizes.titleSmall * 1.3,
    color: colors.onSurfaceVariant,
  },
  emptyHint: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodySmall,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
  },
});
