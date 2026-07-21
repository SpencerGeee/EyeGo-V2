import React, { useMemo, useState, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { tripsApi, bookingsApi, queryKeys } from '@eyego/api';
import { useUnreadNotifications } from '../../hooks/useUnreadNotifications';
import { useAuthStore } from '../../stores/auth.store';
import { fonts, spacing, withOpacity } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, Skeleton, Avatar, GlowSearchPressable, MorphSource, type MorphSourceHandle, useMorph, backgroundScrollPauseProps, GradientGlowBorder, GlassSurface, ShinyText } from '@eyego/ui';
import * as Haptics from 'expo-haptics';
import { TAB_BAR_BASE_HEIGHT } from './_layout';
import MapboxGL from '../../utils/mapbox';
import { eyegoDarkStyle, eyegoLightStyle } from '@eyego/map-styles';
import { useThemeStore } from '../../stores/theme.store';

// Accra fallback center — same default used by apps/driver/app/(tabs)/home.tsx
// when no coordinate is available.
const DEFAULT_MAP_CENTER: [number, number] = [-0.187, 5.6037];

function activeBookingStatusLabel(status: string | undefined): string {
  switch (status) {
    case 'DRIVER_EN_ROUTE': return 'DRIVER ON THE WAY';
    case 'IN_PROGRESS': return 'TRIP IN PROGRESS';
    case 'FILLING': return 'CONFIRMED · FILLING';
    default: return 'CONFIRMED';
  }
}

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
  featured,
}: {
  trip: any;
  onPress: () => void;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
  /** Top pick gets the full animated glow sweep; the rest keep the same green
   * ring but static (GradientGlowBorder perf note: reserve rotation for one
   * card per screen). */
  featured: boolean;
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
      style={({ pressed }) => pressed && styles.pressed}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Book ${tier} ride`}
    >
      <GradientGlowBorder
        palette="green"
        fillColor={colors.surfaceCard}
        borderRadius={20}
        glow
        disabled={!featured}
        style={styles.tripCard}
      >
        <GlassSurface borderRadius={17} intensity="low" dark style={styles.tripGlassInset} />
        {featured && (
          <View style={styles.tripTopPickChip}>
            <Ionicons name="sparkles" size={10} color="#0A0A0C" />
            <Text style={styles.tripTopPickText}>TOP PICK</Text>
          </View>
        )}
      <View style={styles.tripCardRow}>
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
      </View>
      </GradientGlowBorder>
    </Pressable>
  );
}

export default function HomeScreen() {
  const colors = useColors();
  const isDark = useThemeStore((s) => s.isDark);
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

  // Shared with the notifications tab so the bell badge and the list agree on
  // what's unread — this was previously its own /unread-count query (active
  // paid bookings), a completely different signal from the notifications
  // list's read state, so the dot never cleared even after the rider read
  // everything in the tab.
  const { hasUnread } = useUnreadNotifications();

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

  const activeBooking = (activeBookings as any)?.data?.data?.booking ?? null;

  // searchTrips doesn't exclude trips the rider already booked, so without this
  // filter the trip they just booked (still OPEN/FILLING) could resurface here
  // and tapping it would route right back into the booking they just made.
  const rawTrips: any[] = (Array.isArray(realTrips) ? realTrips : []).filter(
    (t: any) => t.id !== activeBooking?.tripId
  );

  // Center for the tiny non-interactive map preview in the active-ride bento
  // card. Falls back to a fixed default when the booking has no coordinates.
  const activeBookingMapCenter = useMemo<[number, number]>(() => {
    const lng = activeBooking?.originLng ?? activeBooking?.pickupLng ?? activeBooking?.route?.originLng;
    const lat = activeBooking?.originLat ?? activeBooking?.pickupLat ?? activeBooking?.route?.originLat;
    if (typeof lng === 'number' && typeof lat === 'number') return [lng, lat];
    return DEFAULT_MAP_CENTER;
  }, [activeBooking]);

  const firstName = (user as any)?.firstName ?? (user as any)?.name?.split(' ')[0] ?? 'there';
  const initials = (firstName[0] ?? 'U').toUpperCase();

  const { morphTo } = useMorph();

  // MorphSource hides its children while a morph flight is in the air and
  // only un-hides via morphBack/the target-timeout fallback (see
  // MorphSourceHandle doc in packages/ui/src/morph/MorphSource.tsx). The
  // "Where to?" pill morphs into /trip's search stage, but that stage's
  // "Schedule" CTA pushes /ride/schedule forward — a totally different
  // screen, not the morph target's own back/close control — so morphBack
  // never fires. After scheduling completes and the rider is routed to
  // /scheduled-rides and back here, the pill was left invisible forever.
  // Self-heal on every focus so it's back regardless of how the rider
  // wandered away from the search stage.
  const whereToSourceRef = useRef<MorphSourceHandle>(null);
  const activeRideSourceRef = useRef<MorphSourceHandle>(null);
  useFocusEffect(
    useCallback(() => {
      whereToSourceRef.current?.show();
      activeRideSourceRef.current?.show();
    }, [])
  );

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
          onPress={() => router.push('/(tabs)/notifications' as any)}
          accessibilityLabel="Notifications"
        >
          <Ionicons name="notifications-outline" size={22} color={colors.onSurface} />
          {hasUnread && <View style={styles.notifDot} />}
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
            ref={whereToSourceRef}
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

        {/* Active Ride Bento Card — morphs into the tracking screen
            (container-transform, same engine as the where-to pill above)
            instead of a plain push, so it reads as one continuous surface. */}
        {activeBooking && (
          <MorphSource ref={activeRideSourceRef} id="home-active-ride" borderRadius={24} backgroundColor={colors.surfaceCard}>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              morphTo('home-active-ride', () => router.push(`/ride/${activeBooking.tripId}/tracking` as any));
            }}
          >
          <Animated.View entering={FadeIn.duration(250)} style={styles.activeBentoCard}>
            {/* Small non-interactive map preview area */}
            <View style={styles.activeBentoMapArea}>
              <MapboxGL.MapView
                style={StyleSheet.absoluteFillObject}
                styleURL={isDark ? eyegoDarkStyle : eyegoLightStyle}
                zoomEnabled={false}
                scrollEnabled={false}
                rotateEnabled={false}
                pitchEnabled={false}
                logoEnabled={false}
                attributionEnabled={false}
                compassEnabled={false}
                scaleBarEnabled={false}
              >
                <MapboxGL.Camera
                  centerCoordinate={activeBookingMapCenter}
                  zoomLevel={14}
                  animationMode="none"
                />
              </MapboxGL.MapView>
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
                    uri={activeBooking.trip?.driver?.profilePhoto}
                    name={activeBooking.trip?.driver?.name}
                    size={44}
                    borderColor={colors.rimLight}
                  />
                  <View>
                    <Text style={styles.activeBentoDriverName} numberOfLines={1}>
                      {activeBooking.trip?.driver?.name ?? 'Your Driver'}
                    </Text>
                    <Text style={styles.activeBentoDriverMeta}>
                      {activeBooking.trip?.vehicle
                        ? `${activeBooking.trip.vehicle.make} ${activeBooking.trip.vehicle.model}`
                        : '—'}
                    </Text>
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.activeBentoAway}>{activeBookingStatusLabel(activeBooking.trip?.status)}</Text>
                </View>
              </View>
              <View style={styles.activeBentoDestRow}>
                <Ionicons name="navigate-outline" size={15} color={colors.tierComfort} />
                <Text style={styles.activeBentoDestText} numberOfLines={1}>
                  {activeBooking.trip?.route?.destinationName ?? 'Your destination'}
                </Text>
              </View>
            </View>
          </Animated.View>
          </Pressable>
          </MorphSource>
        )}

        {/* Suggested Rides */}
        <View style={styles.suggestedSection}>
          <ShinyText baseColor={colors.onSurface} textStyle={styles.sectionTitle}>Suggested for you</ShinyText>

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
                featured={idx === 0}
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
    lineHeight: 20,
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
    lineHeight: 14,
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
    overflow: 'hidden',
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
    lineHeight: 20,
    color: colors.onSurface,
  },
  activeBentoDriverMeta: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 16,
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
    lineHeight: 18,
    color: colors.onSurface,
    flex: 1,
  },

  // ─── Suggested Rides ──────────────────────────────────────
  suggestedSection: { gap: 12 },
  sectionTitle: {
    fontFamily: fonts.semiBold,
    fontSize: 20,
    lineHeight: 26,
    color: colors.onSurface,
    letterSpacing: -0.3,
    marginBottom: 2,
  },
  pressed: { opacity: 0.82 },
  tripCard: {
    width: '100%',
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  tripGlassInset: {
    position: 'absolute',
    top: 3,
    left: 3,
    right: 3,
    bottom: 3,
  },
  tripTopPickChip: {
    position: 'absolute',
    top: 10,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    zIndex: 1,
  },
  tripTopPickText: {
    fontFamily: fonts.labelCaps,
    fontSize: 9,
    lineHeight: 12,
    color: '#0A0A0C',
    letterSpacing: 0.6,
  },
  tripCardRow: {
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
    lineHeight: 20,
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
    lineHeight: 21,
    color: colors.onSurfaceVariant,
  },
  emptyHint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
    color: colors.outline,
  },
});
