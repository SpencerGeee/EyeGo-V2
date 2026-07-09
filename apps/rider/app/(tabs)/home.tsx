import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { tripsApi, notificationsApi, bookingsApi, queryKeys } from '@eyego/api';
import { useAuthStore } from '../../stores/auth.store';
import { fonts, spacing, withOpacity } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, Skeleton, Avatar, GlowSearchPressable, MorphSource, useMorph, backgroundScrollPauseProps } from '@eyego/ui';
import * as Haptics from 'expo-haptics';
import { TAB_BAR_BASE_HEIGHT } from './_layout';

function getTierColors(colors: Colors): Record<string, string> {
  return {
    ECONOMY: colors.tierEconomy,
    COMFORT: colors.tierComfort,
    PREMIUM: colors.tierPremium,
    ROYAL: colors.tierRoyal,
  };
}

const QUICK_ACTIONS = [
  { id: 'saved',    label: 'Saved',    icon: 'bookmark-outline'   as const },
  { id: 'schedule', label: 'Schedule', icon: 'calendar-outline'   as const },
  { id: 'promos',   label: 'Promos',   icon: 'pricetag-outline'   as const },
  { id: 'wallet',   label: 'Wallet',   icon: 'wallet-outline'     as const },
];

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function WhereToPressable({
  onPress,
  colors,
  styles,
}: {
  onPress: () => void;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <GlowSearchPressable
      onPress={onPress}
      accessibilityLabel="Open destination search"
      style={styles.whereToCard}
    >
      <View style={styles.whereToIconWrap}>
        <Ionicons name="search" size={20} color={colors.primary} />
      </View>
      <View style={styles.whereToTextWrap}>
        <Text style={styles.whereToTitle}>Where to?</Text>
        <Text style={styles.whereToSub}>Search destination or route</Text>
      </View>
      <Ionicons name="mic-outline" size={20} color={colors.onSurfaceVariant} />
    </GlowSearchPressable>
  );
}

function SuggestedTripCard({
  trip,
  onPress,
  colors,
  styles,
}: {
  trip: any;
  onPress: () => void;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const tierColors = getTierColors(colors);
  const tier = (trip.tier as string) ?? 'ECONOMY';
  const tierColor = tierColors[tier] ?? tierColors.ECONOMY;
  const seatsLeft = Math.max(
    0,
    (trip.maxCapacity ?? 12) - (trip.confirmedSeats ?? 0) - (trip.pendingSeats ?? 0),
  );
  const seatsLow = seatsLeft <= 2;
  const tierIcon =
    tier === 'ECONOMY' ? 'car-outline' as const :
    tier === 'COMFORT' ? 'bus-outline' as const :
    tier === 'PREMIUM' ? 'car-sport' as const :
    'ribbon-outline' as const;
  const tierBadgeLabel =
    tier === 'ECONOMY' ? 'SHARED' :
    tier === 'COMFORT' ? 'AC · WIFI' :
    tier === 'PREMIUM' ? 'PREMIUM' : 'ROYAL';

  return (
    <Pressable
      style={({ pressed }) => [
        styles.tripCard,
        { borderLeftColor: tierColor },
        pressed && { opacity: 0.82 },
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Book ${tier} ride`}
    >
      <View style={styles.tripCardLeft}>
        <View style={[styles.tripTierIcon, { backgroundColor: `${tierColor}1A`, borderColor: `${tierColor}33` }]}>
          <Ionicons name={tierIcon} size={22} color={tierColor} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.tripTierRow}>
            <Text style={styles.tripTierName}>
              {tier.charAt(0) + tier.slice(1).toLowerCase()}
            </Text>
            <View style={[styles.tripTierBadge, { backgroundColor: `${tierColor}1A` }]}>
              <Text style={[styles.tripTierBadgeText, { color: tierColor }]}>
                {tierBadgeLabel}
              </Text>
            </View>
          </View>
          <Text style={styles.tripMeta}>
            {trip.scheduledAt
              ? new Date(trip.scheduledAt).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' })
              : 'Departing soon'}
            {'  ·  '}
            <Text style={{ color: seatsLow ? colors.statusError : colors.onSurfaceVariant }}>
              {seatsLeft} seat{seatsLeft !== 1 ? 's' : ''} left
            </Text>
          </Text>
        </View>
      </View>
      <Text style={[styles.tripFare, { color: colors.onSurface }]}>
        GH₵{' '}{(trip.farePerSeat ?? 0).toFixed(2)}
      </Text>
    </Pressable>
  );
}

export default function HomeScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
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

  // apiClient.get() resolves to the raw axios response — the response
  // interceptor is a pass-through, it does NOT unwrap to response.data (see
  // ride/select.tsx's onSuccess for the same two-level unwrap pattern:
  // response.data is the JSON envelope {success,message,data:{...}}, and the
  // real payload is one level deeper). Skipping this unwrap left `rawTrips`
  // as that envelope object (not an array) whenever the backend actually
  // responded, and `rawTrips.slice(...)` crashed with "undefined is not a
  // function" — only reproducible with a live backend, since without one the
  // query never resolves and rawTrips stayed the [] fallback.
  const tripsBody = (tripsData as any)?.data;
  const realTrips = (tripsBody?.data as any)?.trips ?? tripsBody?.data ?? [];
  const rawTrips: any[] = Array.isArray(realTrips) ? realTrips : [];

  const activeBooking = (activeBookings as any)?.data?.data?.booking ?? null;
  const unreadCount: number = (notifsData as any)?.data?.data?.total ?? 0;
  const firstName = (user as any)?.firstName ?? (user as any)?.name?.split(' ')[0] ?? 'there';
  const initials = (firstName[0] ?? 'U').toUpperCase();

  const { morphTo } = useMorph();

  const handleWhereTo = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Container-transform: the pill flies into the trip surface's search card
    // (route uses animation 'none' + transparentModal, see root _layout).
    morphTo('where-to-pill', () => router.push('/trip?stage=search' as any));
  };

  const handleQuickAction = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const routes: Record<string, string> = {
      saved:    '/profile/saved-places',
      schedule: '/ride/schedule',
      promos:   '/profile/promotions',
      wallet:   '/profile/wallet',
    };
    if (routes[id]) router.push(routes[id] as any);
  };

  return (
    <View style={[styles.root, { backgroundColor: 'transparent' }]}>
      {/* ── Header ───────────────────────────────────────── */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable
          style={styles.avatarBtn}
          onPress={() => router.push('/(tabs)/account' as any)}
          accessibilityLabel="Account"
        >
          <Text style={styles.avatarInitials}>{initials}</Text>
        </Pressable>

        <Text style={styles.greetingHeadline} numberOfLines={1}>
          {getGreeting()}, {firstName}
        </Text>

        <Pressable
          style={styles.notifBtn}
          onPress={() => router.push('/(tabs)/activity' as any)}
          accessibilityLabel="Notifications"
        >
          <Ionicons name="notifications-outline" size={22} color={colors.onSurface} />
          {unreadCount > 0 && <View style={styles.notifDot} />}
        </Pressable>
      </View>

      {/* ── Content ──────────────────────────────────────── */}
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        {...backgroundScrollPauseProps}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* Where To Search Bar */}
        <Animated.View entering={FadeIn.duration(250)}>
          <MorphSource
            id="where-to-pill"
            borderRadius={24}
            backgroundColor={colors.surfaceCard}
          >
            <WhereToPressable onPress={handleWhereTo} colors={colors} styles={styles} />
          </MorphSource>
        </Animated.View>

        {/* Quick Action Circles */}
        <Animated.View entering={FadeIn.delay(80).duration(250)}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quickActionsRow}
          >
            {QUICK_ACTIONS.map((action) => (
              <Pressable
                key={action.id}
                style={({ pressed }) => [styles.quickActionItem, pressed && { opacity: 0.7 }]}
                onPress={() => handleQuickAction(action.id)}
                accessibilityRole="button"
                accessibilityLabel={action.label}
              >
                <View style={styles.quickActionCircle}>
                  <Ionicons name={action.icon} size={24} color={colors.onSurface} />
                </View>
                <Text style={styles.quickActionLabel}>{action.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </Animated.View>

        {/* Active Ride Bento Card */}
        {activeBooking && (
          <Animated.View entering={FadeIn.duration(250)} style={styles.activeBentoCard}>
            {/* Dark map placeholder area */}
            <View style={styles.activeBentoMapArea}>
              <View style={styles.activeBentoRouteChip}>
                <View style={styles.activeBentoDot} />
                <Text style={styles.activeBentoStatusText}>IN PROGRESS</Text>
              </View>
              {/* Gradient fade blending the map into the docked card below */}
              <LinearGradient
                colors={['transparent', colors.surfaceCard]}
                style={styles.activeBentoMapFade}
                pointerEvents="none"
              />
            </View>
            {/* Driver + Route Info — docked over the map, pulled up to overlap it */}
            <View style={styles.activeBentoBody}>
              <View style={styles.activeBentoTopRow}>
                <View style={styles.activeBentoDriverLeft}>
                  <Avatar
                    uri={activeBooking.driverAvatarUrl}
                    name={activeBooking.driverName}
                    size={44}
                    borderColor={colors.rimLight}
                  />
                  <View>
                    <Text style={styles.activeBentoDriverName} numberOfLines={1}>
                      {activeBooking.driverName ?? 'Your Driver'}
                    </Text>
                    <Text style={styles.activeBentoDriverMeta}>
                      ★ {activeBooking.rating?.toFixed(1) ?? '—'} · {activeBooking.vehicle ?? '—'}
                    </Text>
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.activeBentoEta}>{activeBooking.eta ?? '5 min'}</Text>
                  <Text style={styles.activeBentoAway}>AWAY</Text>
                </View>
              </View>
              <View style={styles.activeBentoDestRow}>
                <Ionicons name="navigate-outline" size={15} color={colors.tierComfort} />
                <Text style={styles.activeBentoDestText} numberOfLines={1}>
                  {activeBooking.routeDestination ?? 'Your destination'}
                </Text>
              </View>
            </View>
          </Animated.View>
        )}

        {/* Suggested Rides */}
        <View style={styles.suggestedSection}>
          <Text style={styles.sectionTitle}>Suggested for you</Text>

          {tripsLoading && (
            <View style={{ gap: spacing.sm }}>
              {[1, 2].map((i) => (
                <Skeleton key={i} style={styles.skeletonCard} />
              ))}
            </View>
          )}

          {!tripsLoading && rawTrips.length === 0 && (
            <View style={styles.emptyState}>
              <Ionicons name="car-outline" size={36} color={colors.outline} />
              <Text style={styles.emptyText}>No rides available right now</Text>
              <Text style={styles.emptyHint}>Pull down to refresh</Text>
            </View>
          )}

          {!tripsLoading && rawTrips.slice(0, 6).map((trip: any, idx: number) => (
            <Animated.View
              key={trip.id ?? idx}
              entering={FadeIn.delay(idx * 60).duration(200)}
            >
              <SuggestedTripCard
                trip={trip}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push(`/ride/${trip.id}` as any);
                }}
                colors={colors}
                styles={styles}
              />
            </Animated.View>
          ))}
        </View>

        <View style={{ height: TAB_BAR_BASE_HEIGHT + insets.bottom + 24 }} />
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1 },

  // ─── Header ──────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 10,
  },
  avatarBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: `${colors.primary}22`,
    borderWidth: 2,
    borderColor: `${colors.primary}33`,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarInitials: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.primary,
  },
  greetingHeadline: {
    flex: 1,
    fontFamily: fonts.displayMedium,
    fontSize: 19,
    lineHeight: 25,
    color: colors.onSurface,
    letterSpacing: -0.2,
  },
  notifBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: withOpacity(colors.surfaceContainer, 0.5),
    borderWidth: 1,
    borderColor: colors.rimLight,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  notifDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOpacity: 0.6,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },

  // ─── Scroll ───────────────────────────────────────────────
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    gap: 16,
    paddingBottom: 8,
  },

  // ─── Where To (glass panel) ───────────────────────────────
  whereToCard: {
    // Background, ring, and glow are drawn by GlowSearchPressable's
    // GradientGlowBorder — this only supplies layout.
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    gap: spacing.base,
  },
  whereToIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  whereToTextWrap: { flex: 1 },
  whereToTitle: {
    fontFamily: fonts.medium,
    fontSize: 16,
    lineHeight: 21,
    color: colors.onSurface,
    letterSpacing: -0.1,
  },
  whereToSub: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.onSurfaceVariant,
    marginTop: 1,
  },

  // ─── Quick Action Circles ─────────────────────────────────
  quickActionsRow: {
    gap: 8,
    paddingVertical: 4,
  },
  quickActionItem: {
    alignItems: 'center',
    gap: 6,
    minWidth: 72,
  },
  quickActionCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: withOpacity(colors.surfaceCard, 0.6),
    borderWidth: 1,
    borderColor: colors.rimLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionLabel: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
  },

  // ─── Active Ride Bento Card ───────────────────────────────
  activeBentoCard: {
    backgroundColor: colors.surfaceCard,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: `${colors.tierComfort}30`,
    overflow: 'hidden',
  },
  activeBentoMapArea: {
    height: 128,
    backgroundColor: colors.backgroundDeep,
    position: 'relative',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    padding: 12,
  },
  activeBentoMapFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 48,
  },
  activeBentoRouteChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: withOpacity(colors.backgroundDeep, 0.85),
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.rimLight,
    zIndex: 1,
  },
  activeBentoDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.tierComfort,
    shadowColor: colors.tierComfort,
    shadowOpacity: 0.7,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  activeBentoStatusText: {
    fontFamily: fonts.labelCaps,
    fontSize: 10,
    lineHeight: 14,
    color: colors.onSurface,
    letterSpacing: 0.7,
  },
  activeBentoBody: {
    padding: 16,
    gap: 10,
    backgroundColor: withOpacity(colors.surfaceCard, 0.6),
    marginTop: -16,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderTopColor: colors.rimLightSubtle,
  },
  activeBentoTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  activeBentoDriverLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  activeBentoDriverName: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: colors.onSurface,
  },
  activeBentoDriverMeta: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.onSurfaceVariant,
    marginTop: 1,
  },
  activeBentoEta: {
    fontFamily: fonts.displayBold,
    fontSize: 24,
    lineHeight: 30,
    color: colors.tierComfort,
    letterSpacing: -0.5,
  },
  activeBentoAway: {
    fontFamily: fonts.labelCaps,
    fontSize: 9,
    lineHeight: 13,
    color: colors.onSurfaceVariant,
    letterSpacing: 0.8,
    textAlign: 'right',
    marginTop: 1,
  },
  activeBentoDestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.backgroundDeep,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.rimLightSubtle,
  },
  activeBentoDestText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.onSurface,
    flex: 1,
  },

  // ─── Suggested Rides ──────────────────────────────────────
  suggestedSection: { gap: 10 },
  sectionTitle: {
    fontFamily: fonts.semiBold,
    fontSize: 20,
    lineHeight: 26,
    color: colors.onSurface,
    letterSpacing: -0.3,
    marginBottom: 2,
  },
  tripCard: {
    backgroundColor: colors.surfaceCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.rimLight,
    borderLeftWidth: 4,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tripCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  tripTierIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    flexShrink: 0,
  },
  tripTierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tripTierName: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: colors.onSurface,
  },
  tripTierBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  tripTierBadgeText: {
    fontFamily: fonts.labelCaps,
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.6,
  },
  tripMeta: {
    fontFamily: fonts.monoRegular,
    fontSize: 11,
    lineHeight: 16,
    color: colors.onSurfaceVariant,
    marginTop: 3,
  },
  tripFare: {
    fontFamily: fonts.displayBold,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.3,
    paddingLeft: 8,
    flexShrink: 0,
  },

  // ─── Empty / Skeleton ─────────────────────────────────────
  skeletonCard: { height: 82, borderRadius: 16 },
  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyText: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: colors.onSurfaceVariant,
  },
  emptyHint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.outline,
  },
});
