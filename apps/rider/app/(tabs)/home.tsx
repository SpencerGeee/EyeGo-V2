import React, { useMemo, useState, useCallback, useRef } from 'react';
import { formatGhs } from '@eyego/utils';
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
import { useRideStore } from '../../stores/ride.store';

// Accra fallback center — same default used by apps/driver/app/(tabs)/home.tsx
// when no coordinate is available.
const DEFAULT_MAP_CENTER: [number, number] = [-0.187, 5.6037];

/**
 * The status chip, or nothing.
 *
 * This used to `default: return 'CONFIRMED'`, which meant an unknown or absent
 * status asserted the single most reassuring thing this card can say. A rider
 * who had just cancelled read "Confirmed" off a ride that no longer existed.
 * An unrecognised status is not a confirmation — say nothing instead.
 */
function activeBookingStatusLabel(status: string | undefined): string | null {
  switch (status) {
    // ── no driver yet. These were all missing, so the live-trip card showed a
    // ride with NO status line for the entire dispatch window — the exact span
    // where the rider is most anxious and most likely to be staring at it.
    case 'REQUESTED': return 'REQUESTING…';
    case 'MATCHING': return 'FINDING A DRIVER…';
    case 'REASSIGNING': return 'FINDING A NEW DRIVER…';
    // ── pre-departure
    case 'SCHEDULED': return 'SCHEDULED';
    case 'FILLING': return 'CONFIRMED · FILLING';
    case 'CONFIRMED': return 'CONFIRMED';
    // ── driver attached
    case 'DRIVER_ASSIGNED': return 'DRIVER ASSIGNED';
    case 'DRIVER_EN_ROUTE': return 'DRIVER ON THE WAY';
    case 'ARRIVED_AT_PICKUP': return 'DRIVER ARRIVED';
    case 'IN_PROGRESS': return 'TRIP IN PROGRESS';
    // Terminal statuses deliberately fall through to null — a finished or dead
    // ride should not be occupying the "active booking" card at all, and
    // labelling one here would paper over whatever failed to clear it.
    default: return null;
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
      /*
       * BRIGHT, BUT STILL INSIDE THE GAP.
       *
       * The previous 0.5 was not a taste call — it was the only lever
       * available. Intensity scaled the halo's REACH as well as its
       * brightness (`36 × intensity`), and the card sits 20 pt below the
       * header, so anything brighter painted past the ScrollView's clip edge
       * and got sliced flat. Turning it down to fit is what left the bar
       * "very mild — it barely catches the attention".
       *
       * `maxGlowRadius` separates the two. Intensity now buys opacity only;
       * the reach is pinned at 18 pt, comfortably inside the 20 pt gap. The
       * bar can be as bright as the suggested cards without being pushed down
       * to make room for its own shadow.
       *
       * `brandGreen`, not `green`: that palette carries a gold counter-arc,
       * which is the colour that "isn't a match to the green Skia
       * background". brandGreen samples the pillar's own #4be277 → #005321.
       */
      palette="brandGreen"
      glowIntensity={1.5}
      maxGlowRadius={18}
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
  // `maxCapacity` is not a field on anything the server sends — searchTrips
  // returns the Trip row, whose capacity column is `maxSeats`. So this always
  // fell through to the literal 12, and a 14-seater advertised "12 seats left"
  // the moment it was created. Same name the fare uses as its denominator, so
  // the seats and the price now agree about how big the vehicle is.
  /**
   * Server-computed, with the old arithmetic kept only as a fallback.
   *
   * The local formula subtracted `confirmedSeats` and `pendingSeats`, which is
   * a different question from the one the booking page answered — it ignored
   * held-but-unpaid seats, so a trip whose host had cover-all on showed seats
   * free here and "0 left" one tap later. `availableSeats` is now derived once
   * on the server from the occupancy-filtered bookings.
   */
  const capacity = trip.maxSeats ?? trip.vehicle?.seaterCount ?? 0;
  const serverSeatsLeft = typeof trip.availableSeats === 'number' ? trip.availableSeats : null;
  const seatsLeft = serverSeatsLeft ?? Math.max(
    0,
    capacity - (trip.confirmedSeats ?? 0) - (trip.pendingSeats ?? 0),
  );
  const seatsLow = seatsLeft <= 2;

  // WHERE IT IS GOING. The card showed the tier, the seats and the price and
  // left out the one thing that decides whether the ride is any use — the
  // rider had to open it to find out, then come back.
  const destination: string | null =
    trip.route?.destinationName ?? trip.dropoffAddress ?? trip.destination ?? null;
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
          {destination && (
            <View style={styles.tripDestRow}>
              <Ionicons name="arrow-forward" size={11} color={colors.onSurfaceVariant} />
              <Text style={styles.tripDest} numberOfLines={1}>
                {destination}
              </Text>
            </View>
          )}
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
        {formatGhs(trip.farePerSeatPesewas ?? 0)}
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

  // Defence in depth for "I cancelled the ride but the live trip card is still
  // there". The server already excludes cancelled/completed bookings from
  // /bookings/active, and the cancel screen now clears the persisted ride store —
  // but this card is the one surface that can strand a rider in a dead ride (it
  // navigates straight into tracking), and it can also be showing a 30s-stale
  // cached response, or a ride the DRIVER cancelled while this screen sat in the
  // background. So the terminal states are filtered here too, on both the
  // booking and its trip.
  /**
   * A HELD SEAT IS NOT A RIDE — mirrors LIVE_BOOKING_STATUSES on the server.
   *
   * Sharing an invite link holds the remaining seats at SEAT_HELD so nobody
   * takes them mid-share. The deny-list below let that through as a live ride,
   * so a host who opened the invite page and came back found the live-trip card
   * on their home screen for a trip they never finished booking. PENDING is
   * excluded for the same reason: it is a booking row that exists before the
   * rider has committed to it.
   *
   * CONFIRMED is included even though cash bookings keep `paymentStatus:
   * PENDING` — the test is commitment, not cleared funds.
   */
  const LIVE_BOOKING = ['CONFIRMED', 'PAID', 'BOARDED'];
  const TERMINAL_BOOKING = ['CANCELLED', 'COMPLETED', 'NO_SHOW', 'REFUNDED', 'EXPIRED'];
  // NO_DRIVERS_FOUND was missing from this list, and it is the single most
  // likely way an on-demand ride ends. A request that nobody took therefore
  // read as live and drew the card. REASSIGNING is here for the opposite
  // reason: it is not terminal, but the driver has dropped out and the card
  // would name one who is no longer coming.
  const TERMINAL_TRIP = [
    'CANCELLED', 'COMPLETED', 'EXPIRED', 'NO_SHOW', 'NO_DRIVERS_FOUND', 'REASSIGNING',
  ];
  const activeBookingRaw = (activeBookings as any)?.data?.data?.booking ?? null;
  /**
   * A DRIVER IS WHAT MAKES THIS CARD TRUE.
   *
   * The rule is now the one the card actually claims: show it only once the
   * rider and a driver are on the same trip. Everything the card renders —
   * the driver's name, the vehicle, "on the way" — is a statement about a
   * driver, so without one attached every field falls through to its `??`
   * placeholder and the card says "Your driver" and "your destination" about a
   * ride that does not exist. Tapping it opened tracking, which had nothing to
   * track, and bounced the rider to the map.
   *
   * This also makes the terminal lists belt-and-braces rather than the only
   * defence: a REQUESTED trip whose dispatch died before it could be marked
   * terminal has no driver either, so it cannot reach the card by any route.
   *
   * A ride still being searched for is not lost by this — it has its own
   * surface, the pending-request card below, which is honest about having no
   * driver yet. Group and bus trips are unaffected: the driver creates those,
   * so `driverId` is set from the moment the trip exists.
   */
  const activeTripDriverId =
    activeBookingRaw?.trip?.driverId ?? activeBookingRaw?.trip?.driver?.id ?? null;
  const activeBooking =
    activeBookingRaw &&
    activeTripDriverId != null &&
    LIVE_BOOKING.includes(String(activeBookingRaw.status ?? '').toUpperCase()) &&
    // A LIVE CARD NEEDS A LIVE TRIP.
    //
    // "I cancelled, then landed on the index page with the live trip card
    // showing 'Your Driver', 'Confirmed' and 'your destination' — all
    // placeholders." Every one of those strings is this card's `??` fallback,
    // which means it rendered against a booking whose `trip` relation was
    // absent. The terminal filter below could not catch it either: with no
    // trip, `String(undefined).toUpperCase()` is the literal "UNDEFINED",
    // which is in neither terminal list, so a trip-less booking sailed
    // through as though it were healthy.
    //
    // There is nothing to show a rider about a ride with no trip on it. The
    // card is also a navigation target into tracking, so rendering it in that
    // state strands them in a dead ride. Require the relation.
    activeBookingRaw.trip &&
    !TERMINAL_BOOKING.includes(String(activeBookingRaw.status ?? '').toUpperCase()) &&
    !TERMINAL_TRIP.includes(String(activeBookingRaw.trip?.status ?? '').toUpperCase())
      ? activeBookingRaw
      : null;

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
  const pendingRequestSourceRef = useRef<MorphSourceHandle>(null);

  // A trip request the rider walked away from is still live on the server, so
  // the home screen has to surface it — otherwise Back from the request screen
  // looks like the request was abandoned.
  const pendingRequestId = useRideStore((s) => s.pendingTripRequestId);
  const pendingRequestDestination = useRideStore((s) => s.pendingTripRequestDestination);

  const { data: scheduledData } = useQuery({
    queryKey: ['trips', 'scheduled'],
    queryFn: () => tripsApi.getScheduledRides(),
    refetchInterval: 60000,
  });
  /** Soonest scheduled ride that is still going to happen. */
  const nextScheduledIntent = useMemo(() => {
    const list: any[] = (scheduledData as any)?.data?.data?.intents ?? [];
    return (
      list
        .filter((i) => ['PENDING', 'DISPATCHED', 'MATCHED'].includes(i.status))
        .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0] ?? null
    );
  }, [scheduledData]);
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
      {/*
        A SCRIM, NOT A PANEL.

        Two problems, one cause. The header had no background of its own, so
        (a) the greeting, the bell and the avatar were reading directly against
        a moving green light beam, which is the "make the text very legible…
        so they don't look faint" note, and (b) the Where-To bar's halo below is
        an iOS shadow clipped flat by the ScrollView's top edge, and with nothing
        over that boundary the slice showed as a hard horizontal line — "it's
        visibly showing the cutout of the glow intensity which makes it weird".

        A solid header bar would fix the legibility and make (b) worse, by
        turning a soft seam into a hard one. So this is a gradient scrim that is
        opaque at the very top and fades to nothing past the header's bottom
        edge: the type always has ground underneath it, the clip line lands
        inside the fade where there is no edge to see, and the background is
        still visibly the brand background rather than a grey bar.

        It extends `SCRIM_OVERHANG` past the header so the fade finishes BELOW
        the seam rather than at it.
      */}
      <LinearGradient
        pointerEvents="none"
        colors={[
          colors.backgroundDeep,
          withOpacity(colors.backgroundDeep, 0.82),
          withOpacity(colors.backgroundDeep, 0),
        ]}
        locations={[0, 0.62, 1]}
        style={[styles.headerScrim, { height: insets.top + 12 + HEADER_H + 12 + SCRIM_OVERHANG }]}
      />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        {/* THE UPLOADED PHOTO, NOT ALWAYS THE INITIAL.
            This rendered `<Text>{initials}</Text>` unconditionally, so a rider
            who had uploaded a profile picture saw it on the profile tab and a
            generic letter here. `Avatar` already owns the uri-then-initials
            fallback that the profile screen open-codes, so the two screens now
            answer the same question the same way. */}
        <Pressable
          style={styles.avatarBtn}
          onPress={() => router.push('/(tabs)/account' as any)}
          accessibilityLabel="Account"
        >
          {user?.avatarUrl ? (
            <Avatar uri={user.avatarUrl} name={firstName} size={AVATAR_SIZE} />
          ) : (
            <Text style={styles.avatarInitials}>{initials}</Text>
          )}
        </Pressable>

        <Text style={styles.greetingHeadline} numberOfLines={1}>
          {getGreeting()}, {firstName}
        </Text>

        <Pressable
          style={styles.notifBtn}
          onPress={() => router.push('/(tabs)/notifications' as any)}
          accessibilityLabel="Notifications"
        >
          <Ionicons name="notifications" size={21} color={colors.onSurface} />
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

        {/* Active Ride Bento Card — morphs into the persistent trip surface
            (container-transform, same engine as the where-to pill above)
            instead of a plain push, so it reads as one continuous surface.
            Both morph into the SAME route now, which is the point: the map
            behind them is one instance that never remounts between them. */}
        {activeBooking && (
          <MorphSource ref={activeRideSourceRef} id="home-active-ride" borderRadius={24} backgroundColor={colors.surfaceCard}>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              morphTo('home-active-ride', () => router.push('/trip?stage=assigned' as any));
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
              {/* Was a hardcoded "IN PROGRESS" — it said so over a ride that
                  had not started, and over one that had just been cancelled. */}
              <View style={styles.activeBentoRouteChip}>
                <View style={styles.activeBentoDot} />
                <Text style={styles.activeBentoStatusText}>
                  {activeBookingStatusLabel(activeBooking.trip?.status) ?? 'LIVE'}
                </Text>
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
                  {activeBookingStatusLabel(activeBooking.trip?.status) ? (
                    <Text style={styles.activeBentoAway}>
                      {activeBookingStatusLabel(activeBooking.trip?.status)}
                    </Text>
                  ) : null}
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

        {/* Pending trip request — item 5. Backing out of the request screen used
            to leave nothing behind, so a rider who tapped Back had no way to see
            (or get back to) the request that was still running. Same
            container-transform treatment as the active-ride card above, so it
            morphs back into the request surface rather than hard-pushing. */}
        {!activeBooking && pendingRequestId && (
          <MorphSource
            ref={pendingRequestSourceRef}
            id="home-pending-request"
            borderRadius={24}
            backgroundColor={colors.surfaceCard}
          >
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                morphTo('home-pending-request', () =>
                  router.push(
                    `/trip?stage=request&morphId=home-pending-request&resumeRequestId=${pendingRequestId}` as any,
                  ),
                );
              }}
            >
              <Animated.View entering={FadeIn.duration(250)} style={styles.statusBentoCard}>
                <GradientGlowBorder
                  palette="green"
                  fillColor={colors.surfaceCard}
                  borderRadius={24}
                  glow
                  style={styles.statusBentoInner}
                >
                  <View style={styles.statusBentoRow}>
                    <View style={[styles.statusBentoIcon, { backgroundColor: withOpacity(colors.primary, 0.12) }]}>
                      <Ionicons name="search" size={20} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.statusBentoLabelRow}>
                        <View style={[styles.statusBentoDot, { backgroundColor: colors.primary }]} />
                        <Text style={styles.statusBentoLabel}>FINDING YOUR DRIVER</Text>
                      </View>
                      <Text style={styles.statusBentoTitle} numberOfLines={1}>
                        {pendingRequestDestination ?? 'Your destination'}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceVariant} />
                  </View>
                </GradientGlowBorder>
              </Animated.View>
            </Pressable>
          </MorphSource>
        )}

        {/* Next scheduled ride — item 6. The rider had to go digging in Activity
            to find out they had one booked at all. */}
        {nextScheduledIntent && (
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push(`/scheduled/${nextScheduledIntent.id}` as any);
            }}
          >
            <Animated.View entering={FadeIn.duration(250)} style={styles.statusBentoCard}>
              <GradientGlowBorder
                palette="green"
                fillColor={colors.surfaceCard}
                borderRadius={24}
                glow={false}
                style={styles.statusBentoInner}
              >
                <View style={styles.statusBentoRow}>
                  <View style={[styles.statusBentoIcon, { backgroundColor: withOpacity(colors.tierComfort, 0.12) }]}>
                    <Ionicons name="calendar" size={20} color={colors.tierComfort} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.statusBentoLabelRow}>
                      <View style={[styles.statusBentoDot, { backgroundColor: colors.tierComfort }]} />
                      <Text style={styles.statusBentoLabel}>
                        {nextScheduledIntent.status === 'MATCHED' ? 'DRIVER CONFIRMED' : 'SCHEDULED RIDE'}
                      </Text>
                    </View>
                    <Text style={styles.statusBentoTitle} numberOfLines={1}>
                      {nextScheduledIntent.route?.destinationName ?? 'Your destination'}
                    </Text>
                    <Text style={styles.statusBentoMeta}>
                      {new Date(nextScheduledIntent.scheduledAt).toLocaleString('en-GH', {
                        weekday: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceVariant} />
                </View>
              </GradientGlowBorder>
            </Animated.View>
          </Pressable>
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

/** Header control height — avatar and bell are both this tall. */
const HEADER_H = 40;
const AVATAR_SIZE = 40;
/** How far the header scrim fades past the header's own bottom edge, so the
 *  Where-To halo's clip line lands inside the fade instead of at its end. */
const SCRIM_OVERHANG = 28;

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1 },

  /** See the render site. Opaque at the status bar, gone by `SCRIM_OVERHANG`. */
  headerScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 0,
  },

  // ─── Header ──────────────────────────────────────────────
  header: {
    // Above the scrim it sits on.
    zIndex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    // The Where-To bar lives inside the ScrollView below, a ScrollView clips to
    // its own bounds, and the bar's glow is an iOS shadow that paints ABOVE the
    // bar. If the halo reaches further than the gap here plus
    // `scrollContent.paddingTop`, its top is sliced off flat at the viewport
    // edge — and a hard horizontal line where a soft glow should be reads
    // exactly like a notch cut out of the header.
    //
    // That was previously solved by pushing the card 36 pt further down, which
    // bought the room but moved the card:
    //
    //   "i know i told you to give a little space to the where to field on the
    //    homepage but now it's looking awkward, revert it to the initial
    //    position since it was looking nice then."
    //
    // So the card goes back to 12 + 8 pt, and the halo is sized to FIT that gap
    // instead of the gap being sized to fit the halo — see `glowIntensity` on
    // the GlowSearchPressable above. Nothing clips, and nothing moved.
    paddingBottom: 12,
    gap: 10,
  },
  /**
   * The avatar and bell used a ~13 %-alpha brand tint on a ~20 %-alpha brand
   * rim, which over the lit green background left both reading as faint smudges
   * ("make the bell/profile picture ok as well so they don't look faint"). They
   * are now on the app's own card surface with a real rim, so they read as
   * controls at any point in the background's cycle rather than only over the
   * dark part of it. `overflow: 'hidden'` clips a square uploaded photo to the
   * circle.
   */
  avatarBtn: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: withOpacity(colors.surfaceCard, 0.92),
    borderWidth: 1.5,
    borderColor: withOpacity(colors.primary, 0.55),
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
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
    // Belt and braces with the scrim: a tight dark halo keeps the greeting
    // readable even at the moment the light beam sweeps directly behind it.
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  notifBtn: {
    width: HEADER_H,
    height: HEADER_H,
    borderRadius: HEADER_H / 2,
    // Was 50 % of an already-translucent container colour, i.e. barely there.
    backgroundColor: withOpacity(colors.surfaceCard, 0.92),
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
  /**
   * Pulled up by exactly the headroom `scrollContent.paddingTop` adds.
   *
   * "i know i told you to give a little space to the where to field on the
   * homepage but now it's looking awkward, revert it to the initial position."
   *
   * The space was not decoration — it was the fix for the Where-To glow being
   * sliced flat at the ScrollView's clip edge (which read as a cutout in the
   * header above it). Simply reverting `paddingTop` to 8 would bring the notch
   * straight back.
   *
   * The two requirements are only in conflict if the padding has to move the
   * card. It doesn't: the padding exists so the halo has somewhere to paint
   * INSIDE the scroll bounds, and moving the whole scroll view up by the same
   * amount keeps that headroom while putting the card back exactly where it
   * used to sit. 52 − 44 = 8 pt below the header, the original position.
   */
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20,
    // Back to the original 8. Together with the header's 12 this is the 20 pt
    // the halo now has to live within — see `glowIntensity` on the
    // GlowSearchPressable and the note on `header`.
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
  // Compact sibling of activeBentoCard, for states that have no live map to
  // show yet (a request still searching, a ride scheduled for later).
  statusBentoCard: {
    marginTop: spacing.base,
  },
  statusBentoInner: {
    padding: spacing.base,
  },
  statusBentoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
  },
  statusBentoIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBentoLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 3,
  },
  statusBentoDot: { width: 6, height: 6, borderRadius: 3 },
  statusBentoLabel: {
    fontFamily: fonts.medium,
    fontSize: 9,
    lineHeight: Math.round(9 * 1.3),
    letterSpacing: 0.9,
    color: colors.onSurfaceVariant,
  },
  statusBentoTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 15,
    lineHeight: Math.round(15 * 1.3),
    color: colors.onSurface,
    letterSpacing: -0.2,
  },
  statusBentoMeta: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: Math.round(12 * 1.3),
    color: colors.onSurfaceVariant,
    marginTop: 1,
  },
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
  tripDestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  tripDest: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: Math.round(12 * 1.35),
    color: colors.onSurface,
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
