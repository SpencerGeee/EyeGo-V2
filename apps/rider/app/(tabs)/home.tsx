import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  ScrollView,
  RefreshControl,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { tripsApi, notificationsApi, bookingsApi, queryKeys } from '@eyego/api';
import { useAuthStore } from '../../stores/auth.store';
import { fonts, spacing, radii } from '@eyego/config';
import { useColors } from '../../utils/useColors';
import { Text, RideCard, Skeleton } from '@eyego/ui';
import * as Haptics from 'expo-haptics';

const PRIMARY = '#4be277';
const TIERS = ['All', 'Economy', 'Comfort', 'Premium'];

const QUICK_ACTIONS = [
  { id: 'saved', label: 'Saved', icon: 'bookmark-outline' as const },
  { id: 'schedule', label: 'Schedule', icon: 'calendar-outline' as const },
  { id: 'promos', label: 'Promos', icon: 'gift-outline' as const },
  { id: 'wallet', label: 'Wallet', icon: 'wallet-outline' as const },
];

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function WhereToPressable({ onPress }: { onPress: () => void }) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={[animStyle, { marginHorizontal: spacing.lg, marginVertical: spacing.md }]}>
      <Pressable
        onPress={onPress}
        onPressIn={() => { scale.value = withSpring(0.97, { stiffness: 400, damping: 15 }); }}
        onPressOut={() => { scale.value = withSpring(1, { stiffness: 400, damping: 15 }); }}
        style={styles.whereToCard}
        accessibilityRole="button"
        accessibilityLabel="Where to? Open destination search"
      >
        <View style={styles.whereToIconWrap}>
          <Ionicons name="search" size={18} color={PRIMARY} />
        </View>
        <Text style={styles.whereToText}>Where to?</Text>
        <View style={styles.whereToArrow}>
          <Ionicons name="arrow-forward" size={16} color={PRIMARY} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

function QuickActionChip({ item, onPress }: { item: typeof QUICK_ACTIONS[0]; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}
      onPress={onPress}
    >
      <Ionicons name={item.icon} size={16} color={PRIMARY} />
      <Text style={styles.chipLabel}>{item.label}</Text>
    </Pressable>
  );
}

function ActiveTripBanner({ booking }: { booking: any }) {
  const router = useRouter();

  return (
    <MotiView
      from={{ opacity: 0, translateY: -8 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 300 }}
      style={styles.activeBanner}
    >
      <View style={styles.activeDot} />
      <View style={{ flex: 1 }}>
        <Text style={styles.activeBannerTitle}>Active ride</Text>
        <Text style={styles.activeBannerSub} numberOfLines={1}>
          {booking.routeOrigin ?? '—'} → {booking.routeDestination ?? '—'}
        </Text>
      </View>
      <Pressable
        style={styles.activeBannerBtn}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push(`/ride/${booking.id}/tracking` as any);
        }}
      >
        <Text style={styles.activeBannerBtnText}>View</Text>
      </Pressable>
    </MotiView>
  );
}

function TierChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[styles.tierChip, active && styles.tierChipActive]}
      onPress={onPress}
    >
      <Text style={[styles.tierChipText, active && styles.tierChipTextActive]}>{label}</Text>
    </Pressable>
  );
}

export default function HomeScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  const [activeTier, setActiveTier] = useState('All');
  const [refreshing, setRefreshing] = useState(false);

  const { data: tripsData, isLoading: tripsLoading } = useQuery({
    queryKey: queryKeys.rides.list({ status: 'OPEN' }),
    queryFn: () => tripsApi.search({ status: 'OPEN' } as any),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const { data: notifsData } = useQuery({
    queryKey: ['notifications', 'count'],
    queryFn: () => notificationsApi.getAll({ limit: 1 }),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const { data: activeBookings } = useQuery({
    queryKey: ['bookings', 'active'],
    queryFn: () => (bookingsApi as any).getActive?.() ?? Promise.resolve([]),
    staleTime: 30_000,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.rides.list({ status: 'OPEN' }) }),
      queryClient.invalidateQueries({ queryKey: ['bookings', 'active'] }),
    ]);
    setRefreshing(false);
  }, [queryClient]);

  const rawTrips: any[] = Array.isArray(tripsData)
    ? tripsData
    : (tripsData as any)?.data ?? [];

  const filteredTrips = useMemo(() => {
    if (activeTier === 'All') return rawTrips;
    return rawTrips.filter(
      (t: any) => t.tier?.toLowerCase() === activeTier.toLowerCase()
    );
  }, [rawTrips, activeTier]);

  const activeBooking = Array.isArray(activeBookings) ? activeBookings[0] : null;
  const unreadCount: number = (notifsData as any)?.total ?? 0;
  const firstName = (user as any)?.firstName ?? (user as any)?.name?.split(' ')[0] ?? 'there';

  const handleWhereTo = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push('/where-to' as any);
  };

  const handleQuickAction = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const routes: Record<string, string> = {
      saved: '/profile/saved-places',
      schedule: '/ride/schedule',
      promos: '/profile/promotions',
      wallet: '/profile/wallet',
    };
    if (routes[id]) router.push(routes[id] as any);
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.backgroundDeep ?? '#091009' }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.logoText}>EyeGo</Text>
        <View style={styles.headerRight}>
          <Pressable
            style={styles.iconBtn}
            onPress={() => router.push('/(tabs)/activity' as any)}
            accessibilityLabel="Notifications"
          >
            <Ionicons name="notifications-outline" size={22} color="#fff" />
            {unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : String(unreadCount)}</Text>
              </View>
            )}
          </Pressable>
          <Pressable
            style={styles.avatar}
            onPress={() => router.push('/(tabs)/account' as any)}
            accessibilityLabel="Account"
          >
            <Text style={styles.avatarText}>
              {((user as any)?.firstName?.[0] ?? (user as any)?.name?.[0] ?? 'U').toUpperCase()}
            </Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={PRIMARY}
          />
        }
      >
        {/* Greeting */}
        <View style={styles.greetingRow}>
          <Text style={styles.greeting}>{getGreeting()},</Text>
          <Text style={styles.greetingName}>{firstName} 👋</Text>
        </View>

        {/* Where to card */}
        <WhereToPressable onPress={handleWhereTo} />

        {/* Quick Actions */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.quickActionsContent}
          style={styles.quickActions}
        >
          {QUICK_ACTIONS.map((action) => (
            <QuickActionChip
              key={action.id}
              item={action}
              onPress={() => handleQuickAction(action.id)}
            />
          ))}
        </ScrollView>

        {/* Active Trip Banner */}
        {activeBooking ? <ActiveTripBanner booking={activeBooking} /> : null}

        {/* Available Rides */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Available Now</Text>
            <View style={styles.liveBadge}>
              <MotiView
                from={{ opacity: 0.3 }}
                animate={{ opacity: 1 }}
                transition={{ loop: true, type: 'timing', duration: 800 }}
                style={styles.liveDot}
              />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tierRow}
          >
            {TIERS.map((tier) => (
              <TierChip
                key={tier}
                label={tier}
                active={activeTier === tier}
                onPress={() => {
                  Haptics.selectionAsync();
                  setActiveTier(tier);
                }}
              />
            ))}
          </ScrollView>

          {tripsLoading && (
            <View style={styles.skeletonWrap}>
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} style={styles.skeletonCard} />
              ))}
            </View>
          )}

          {!tripsLoading && filteredTrips.length === 0 && (
            <View style={styles.emptyState}>
              <Ionicons name="car-outline" size={40} color="rgba(255,255,255,0.15)" />
              <Text style={styles.emptyText}>No rides available</Text>
              <Text style={styles.emptyHint}>Pull down to refresh</Text>
            </View>
          )}

          {!tripsLoading && filteredTrips.map((trip: any, idx: number) => (
            <MotiView
              key={trip.id ?? idx}
              from={{ opacity: 0, translateY: 8 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 250, delay: idx * 60 }}
            >
              <RideCard
                ride={trip}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push(`/ride/${trip.id}` as any);
                }}
              />
            </MotiView>
          ))}
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  logoText: {
    fontFamily: fonts.displayBold,
    fontSize: 22,
    color: '#fff',
    letterSpacing: -0.5,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: '#EF4444',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: '#fff',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: `${PRIMARY}22`,
    borderWidth: 1.5,
    borderColor: `${PRIMARY}60`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: PRIMARY,
  },
  scroll: { flex: 1 },
  greetingRow: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: 4,
  },
  greeting: {
    fontFamily: fonts.displayMedium,
    fontSize: 20,
    color: 'rgba(255,255,255,0.6)',
  },
  greetingName: {
    fontFamily: fonts.displayBold,
    fontSize: 26,
    color: '#fff',
    letterSpacing: -0.5,
    marginTop: 2,
  },
  whereToCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(75,226,119,0.08)',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: `${PRIMARY}30`,
    paddingHorizontal: spacing.lg,
    paddingVertical: 16,
    gap: spacing.md,
  },
  whereToIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: `${PRIMARY}18`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  whereToText: {
    flex: 1,
    fontFamily: fonts.semiBold,
    fontSize: 18,
    color: 'rgba(255,255,255,0.7)',
  },
  whereToArrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: `${PRIMARY}18`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActions: { marginTop: spacing.sm },
  quickActionsContent: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    paddingBottom: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  chipLabel: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
  },
  activeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    backgroundColor: `${PRIMARY}12`,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: `${PRIMARY}35`,
    padding: spacing.md,
    gap: spacing.md,
  },
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: PRIMARY,
  },
  activeBannerTitle: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: PRIMARY,
  },
  activeBannerSub: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 2,
  },
  activeBannerBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: PRIMARY,
  },
  activeBannerBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: '#091009',
  },
  section: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontFamily: fonts.semiBold,
    fontSize: 18,
    color: '#fff',
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: `${PRIMARY}15`,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: PRIMARY,
  },
  liveText: {
    fontFamily: fonts.semiBold,
    fontSize: 9,
    color: PRIMARY,
    letterSpacing: 0.8,
  },
  tierRow: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  tierChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  tierChipActive: {
    backgroundColor: `${PRIMARY}20`,
    borderColor: `${PRIMARY}50`,
  },
  tierChipText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
  },
  tierChipTextActive: {
    color: PRIMARY,
  },
  skeletonWrap: { gap: spacing.md },
  skeletonCard: {
    height: 100,
    borderRadius: radii.xl,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: spacing.sm,
  },
  emptyText: {
    fontFamily: fonts.semiBold,
    fontSize: 16,
    color: 'rgba(255,255,255,0.3)',
  },
  emptyHint: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.18)',
  },
});
