import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_BASE_HEIGHT } from './_layout';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { bookingsApi, notificationsApi, queryKeys } from '@eyego/api';
import { relativeTime } from '@eyego/utils';
import { fonts, fontSizes, spacing, radii, withOpacity } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, MorphSource, useMorph, backgroundScrollPauseProps, AnimatedList, Entrance, Button } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { tripsApi } from '@eyego/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';

type FilterTab = 'trips' | 'alerts' | 'scheduled';

const TABS: { key: FilterTab; label: string }[] = [
  { key: 'trips', label: 'Trips' },
  { key: 'alerts', label: 'Alerts' },
  { key: 'scheduled', label: 'Scheduled' },
];

const SCHEDULED_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Waiting for a match',
  MATCHED: 'Confirmed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

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
  const { morphTo } = useMorph();
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
    <MorphSource
      id={`ride-card-${booking.id}`}
      borderRadius={radii.lg}
      backgroundColor={colors.surfaceCard}
    >
    {/* Flat card with surfaceCard background — no blur layer per row.
        Dense lists should avoid GlassSurface (GPU compositing cost). */}
    <Pressable
      style={({ pressed }) => [styles.tripCardInner, styles.tripGlass, pressed && { opacity: 0.75 }]}
      onPress={() => {
        Haptics.selectionAsync();
        const tripId = booking.tripId ?? booking.trip?.id;
        // Every status used to push into /ride/[id] (the live booking/tracking
        // flow) regardless of what actually happened to this booking:
        //  - COMPLETED bookings landed on the live trip-tracking screen (meant
        //    for an active ride), since /ride/[id] treats "I have a booking on
        //    this trip" as "redirect to tracking" with no regard for status.
        //  - CANCELLED bookings fell through to /ride/[id]'s "Book This Seat"
        //    CTA, offering to book a trip that was never actually available —
        //    the server excludes cancelled bookings from the trip payload, so
        //    the client has no way to know it was ever booked at all.
        // Route each status to what's actually true about it instead.
        if (booking.status === 'COMPLETED') {
          Haptics.selectionAsync();
          router.push(`/ride/${tripId}/complete?bookingId=${booking.id}&viewOnly=1` as any);
          return;
        }
        if (booking.status === 'CANCELLED') {
          Alert.alert(
            'Ride cancelled',
            `${origin} → ${destination} — this ride was cancelled and can't be booked again from here.`,
          );
          return;
        }
        // Card expands into the ride detail screen (route animates 'fade' —
        // the morph overlay carries the motion).
        // /ride/[id] looks up by TRIP id (tripsApi.getById), not booking id —
        // booking.tripId is the FK to the actual trip; booking.id is a
        // different entity and would 404 the detail screen.
        morphTo(`ride-card-${booking.id}`, () => router.push(`/ride/${tripId}` as any));
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
    </MorphSource>
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

function ScheduledItem({
  intent,
  colors,
  styles,
  onCancel,
  cancelling,
}: {
  intent: any;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
  onCancel: (id: string) => void;
  cancelling: boolean;
}) {
  const statusColor = intent.status === 'MATCHED' ? colors.statusSuccess : colors.onSurfaceVariant;
  return (
    <View style={[styles.itemCard, styles.notifCard]}>
      <View style={[styles.itemIcon, { backgroundColor: withOpacity(colors.primary, 0.08) }]}>
        <Ionicons name="calendar-outline" size={18} color={colors.primary} />
      </View>
      <View style={styles.itemBody}>
        <Text style={styles.itemTitle} numberOfLines={1}>
          {intent.route?.originName ?? 'Unknown'} → {intent.route?.destinationName ?? 'Unknown'}
        </Text>
        <Text style={styles.itemMeta}>
          {new Date(intent.scheduledAt).toLocaleString('en-GH', {
            weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
          })}
          {'  ·  '}{intent.seatCount} seat{intent.seatCount > 1 ? 's' : ''}
        </Text>
        <View style={[styles.statusChip, { backgroundColor: withOpacity(statusColor, 0.15) }]}>
          <Text style={[styles.statusChipText, { color: statusColor }]}>
            {SCHEDULED_STATUS_LABEL[intent.status] ?? intent.status}
          </Text>
        </View>
      </View>
      {intent.status === 'PENDING' && (
        <Button
          label="Cancel"
          variant="ghost"
          onPress={() =>
            Alert.alert(
              'Cancel scheduled ride?',
              'This cannot be undone.',
              [
                { text: 'Keep it', style: 'cancel' },
                { text: 'Cancel ride', style: 'destructive', onPress: () => onCancel(intent.id) },
              ]
            )
          }
          disabled={cancelling}
          style={{ paddingHorizontal: spacing.sm }}
        />
      )}
    </View>
  );
}

// FlashList honors only padding in contentContainerStyle — row gaps come from
// a separator so spacing survives the migration off FlatList.
function ItemSeparator() {
  return <View style={{ height: spacing.sm }} />;
}

/** Partition a date string into a human-readable section label. */
function getDateLabel(dateStr: string): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const d = new Date(dateStr);
  const itemDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.floor(
    (today.getTime() - itemDate.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return 'This Week';
  return 'Earlier';
}

type FeedEntry = { type: 'trip' | 'notification'; data: any; date: string };
type SectionedEntry = { type: 'section'; label: string; date: string } | FeedEntry;

/** Groups a flat, date-sorted feed into Today / Yesterday / This Week / Earlier sections. */
function withDateSections(items: FeedEntry[]): SectionedEntry[] {
  if (items.length === 0) return [];

  const groups = new Map<string, FeedEntry[]>();
  for (const item of items) {
    const label = getDateLabel(item.date);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(item);
  }

  const order = ['Today', 'Yesterday', 'This Week', 'Earlier'];
  const result: SectionedEntry[] = [];
  for (const label of order) {
    const bucket = groups.get(label);
    if (bucket && bucket.length > 0) {
      result.push({ type: 'section', label, date: bucket[0].date });
      result.push(...bucket);
    }
  }
  return result;
}

function SectionHeader({
  label,
  colors,
  styles,
}: {
  label: string;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{label}</Text>
    </View>
  );
}

// Mirrors apps/driver/app/(tabs)/trips.tsx's AnimatedSegBtn — plain segmented
// control, no glow/pill card behind it, just a subtle track with a filled
// active pill.
function AnimatedSegBtn({
  label,
  isActive,
  onPress,
  colors,
  styles,
}: {
  label: string;
  isActive: boolean;
  onPress: () => void;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => { scale.value = withSpring(0.92, { stiffness: 700, damping: 15 }); }}
      onPressOut={() => { scale.value = withSpring(1, { stiffness: 700, damping: 15 }); }}
      style={styles.segmentBtn}
      accessibilityRole="button"
      accessibilityState={{ selected: isActive }}
    >
      <Animated.View style={[isActive && styles.segmentActive, animStyle, styles.segmentPill]}>
        <Text
          style={[
            styles.segmentText,
            { color: isActive ? colors.inverseOnSurface : colors.onSurfaceVariant },
          ]}
        >
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

export default function ActivityScreen() {
  const router = useRouter();
  const colors = useColors();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<FilterTab>('trips');
  const queryClient = useQueryClient();

  const {
    data: bookings,
    isLoading: bookingsLoading,
    isRefetching: bookingsRefetching,
    refetch: refetchBookings,
  } = useQuery({
    queryKey: queryKeys.bookings.myHistory(),
    queryFn: () => bookingsApi.getHistory(),
    staleTime: 60_000,
    refetchOnMount: true,
  });

  const {
    data: notifications,
    isLoading: notifsLoading,
    isRefetching: notifsRefetching,
    refetch: refetchNotifs,
  } = useQuery({
    queryKey: ['notifications', 'all'],
    queryFn: () => notificationsApi.getAll({ limit: 50 }),
    staleTime: 30_000,
  });

  const {
    data: scheduledData,
    isLoading: scheduledLoading,
    isRefetching: scheduledRefetching,
    refetch: refetchScheduled,
  } = useQuery({
    queryKey: ['trips', 'scheduled'],
    queryFn: () => tripsApi.getScheduledRides(),
  });

  const cancelScheduled = useMutation({
    mutationFn: (id: string) => tripsApi.cancelScheduledRide(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trips', 'scheduled'] }),
    onError: () => Alert.alert('Error', 'Could not cancel this scheduled ride. Please try again.'),
  });

  const scheduledIntents = useMemo(() => {
    const list = (scheduledData as any)?.data?.data?.intents ?? [];
    return [...list].sort((a: any, b: any) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  }, [scheduledData]);

  // apiClient.get() resolves to the raw axios response (pass-through
  // interceptor) wrapping the backend's own {success,message,data:{...}}
  // envelope — a two-level unwrap, same pattern as home.tsx. getHistory's
  // real payload is data.data.bookings (see bookings.service.js
  // getUserBookings return: {bookings,total,page,totalPages}); getAll's is
  // data.data.notifications. Skipping a level left `rawBookings`/`rawNotifs`
  // as the envelope object (no .forEach), crashing the moment the backend
  // returned real data.
  const rawBookings: any[] = useMemo(() => {
    const body = (bookings as any)?.data;
    return Array.isArray(body?.data?.bookings)
      ? body.data.bookings
      : Array.isArray(body?.data)
      ? body.data
      : [];
  }, [bookings]);

  const rawNotifs: any[] = useMemo(() => {
    const body = (notifications as any)?.data;
    return Array.isArray(body?.data?.notifications)
      ? body.data.notifications
      : Array.isArray(body?.data)
      ? body.data
      : [];
  }, [notifications]);

  const tripSections = useMemo(() => {
    const items: FeedEntry[] = rawBookings
      .map((b: any) => ({ type: 'trip' as const, data: b, date: b.departureTime ?? b.createdAt }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return withDateSections(items);
  }, [rawBookings]);

  const alertSections = useMemo(() => {
    const items: FeedEntry[] = rawNotifs
      .map((n: any) => ({ type: 'notification' as const, data: n, date: n.createdAt }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return withDateSections(items);
  }, [rawNotifs]);

  const isLoading =
    filter === 'trips' ? bookingsLoading :
    filter === 'alerts' ? notifsLoading :
    scheduledLoading;
  const isRefreshing =
    filter === 'trips' ? bookingsRefetching :
    filter === 'alerts' ? notifsRefetching :
    scheduledRefetching;
  const onRefresh = useCallback(() => {
    if (filter === 'trips') refetchBookings();
    else if (filter === 'alerts') refetchNotifs();
    else refetchScheduled();
  }, [filter, refetchBookings, refetchNotifs, refetchScheduled]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Entrance animation="slideDown" duration={300}>
        <View style={styles.header}>
          <Text style={styles.title}>Activity</Text>
        </View>
      </Entrance>

      {/* Segmented control — plain track, no glow/card behind it, matching
          apps/driver/app/(tabs)/trips.tsx. */}
      <Entrance animation="fadeIn" delay={100} duration={250} style={styles.segmentWrapper}>
        <View style={styles.segmentTrack}>
          {TABS.map((t) => (
            <AnimatedSegBtn
              key={t.key}
              label={t.label}
              isActive={filter === t.key}
              onPress={() => {
                Haptics.selectionAsync();
                setFilter(t.key);
              }}
              colors={colors}
              styles={styles}
            />
          ))}
        </View>
      </Entrance>

      {filter === 'scheduled' ? (
        scheduledLoading && !isRefreshing ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <AnimatedList
            style={{ flex: 1 }}
            entranceAnimation="slideUp"
            staggerDelay={30}
            entranceDuration={200}
            {...backgroundScrollPauseProps}
            data={scheduledIntents}
            keyExtractor={(item: any) => item.id}
            renderItem={({ item }: { item: any }) => (
              <ScheduledItem
                intent={item}
                colors={colors}
                styles={styles}
                onCancel={(id) => cancelScheduled.mutate(id)}
                cancelling={cancelScheduled.isPending}
              />
            )}
            ItemSeparatorComponent={ItemSeparator}
            contentContainerStyle={{
              paddingHorizontal: spacing.lg,
              paddingBottom: TAB_BAR_BASE_HEIGHT + insets.bottom + 24,
            }}
            refreshControl={
              <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={colors.primary} />
            }
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="calendar-outline" size={48} color={colors.onSurfaceVariant} />
                <Text style={styles.emptyText}>No scheduled rides</Text>
                <Text style={styles.emptyHint}>Rides you schedule ahead of time will appear here</Text>
                <Pressable
                  style={({ pressed }) => [styles.emptyCta, pressed && { opacity: 0.8 }, { marginTop: spacing.lg }]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    router.push('/ride/schedule' as any);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Schedule a ride"
                >
                  <Ionicons name="calendar-outline" size={16} color={colors.onSurface} />
                  <Text style={styles.emptyCtaText}>Schedule a ride</Text>
                </Pressable>
              </View>
            }
            showsVerticalScrollIndicator={false}
          />
        )
      ) : isLoading && !isRefreshing ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <AnimatedList
          style={{ flex: 1 }}
          entranceAnimation="slideUp"
          staggerDelay={30}
          entranceDuration={200}
          {...backgroundScrollPauseProps}
          data={filter === 'trips' ? tripSections : alertSections}
          keyExtractor={(item, idx) =>
            item.type === 'section'
              ? `section-${item.label}`
              : `${item.type}-${(item as FeedEntry).data?.id ?? idx}`
          }
          renderItem={({ item }) =>
            item.type === 'section' ? (
              <SectionHeader label={item.label} colors={colors} styles={styles} />
            ) : item.type === 'trip' ? (
              <TripItem booking={item.data} colors={colors} styles={styles} />
            ) : (
              <NotificationItem notification={item.data} colors={colors} styles={styles} />
            )
          }
          ItemSeparatorComponent={ItemSeparator}
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingBottom: TAB_BAR_BASE_HEIGHT + insets.bottom + 24,
          }}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            filter === 'trips' ? (
              <View style={styles.emptyWrap}>
                <Ionicons name="time-outline" size={48} color={colors.onSurfaceVariant} />
                <Text style={styles.emptyText}>No trips yet</Text>
                <Text style={styles.emptyHint}>Your rides will appear here</Text>
                <View style={styles.emptyCtaRow}>
                  <Pressable
                    style={({ pressed }) => [styles.emptyCta, pressed && { opacity: 0.8 }]}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      router.push('/trip?stage=search' as any);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Request a trip"
                  >
                    <Ionicons name="search" size={16} color={colors.onSurface} />
                    <Text style={styles.emptyCtaText}>Request a trip</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.emptyCta, styles.emptyCtaSecondary, pressed && { opacity: 0.8 }]}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      router.push('/ride/schedule' as any);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Schedule a ride"
                  >
                    <Ionicons name="calendar-outline" size={16} color={colors.onSurface} />
                    <Text style={styles.emptyCtaText}>Schedule</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={styles.emptyWrap}>
                <Ionicons name="notifications-outline" size={48} color={colors.onSurfaceVariant} />
                <Text style={styles.emptyText}>No alerts yet</Text>
                <Text style={styles.emptyHint}>Updates about your rides will appear here</Text>
              </View>
            )
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
  segmentWrapper: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  segmentTrack: {
    flexDirection: 'row',
  },
  segmentBtn: {
    flex: 1,
    alignItems: 'center',
  },
  segmentPill: {
    borderRadius: radii.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    width: '100%',
  },
  segmentActive: {
    backgroundColor: colors.onSurface,
  },
  segmentText: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    lineHeight: Math.round(fontSizes.bodyMedium * 1.3),
  },
  sectionHeader: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  sectionHeaderText: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.titleSmall,
    lineHeight: fontSizes.titleSmall * 1.25,
    color: colors.onSurfaceVariant,
    letterSpacing: -0.3,
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
  tripGlass: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.rimLight,
  },
  tripCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md,
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
    lineHeight: Math.round(fontSizes.bodySmall * 1.4),
    color: colors.onSurfaceVariant,
    textAlign: 'center',
  },
  emptyCtaRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.onSurface,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm + 2,
  },
  emptyCtaSecondary: {
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.rimLight,
  },
  emptyCtaText: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    lineHeight: fontSizes.bodyMedium * 1.3,
    color: colors.inverseOnSurface,
  },
});
