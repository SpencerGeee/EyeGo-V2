import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  StyleSheet,
  RefreshControl,} from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_BASE_HEIGHT } from './_layout';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { bookingsApi, notificationsApi, queryKeys } from '@eyego/api';
import { relativeTime, formatGhs } from '@eyego/utils';
import { fonts, fontSizes, spacing, radii, withOpacity } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
// `Pressable` from @eyego/ui, never react-native — NativeWind's interop runtime
// drops the `({ pressed }) => style` function form on RN's Pressable, which
// silently deletes the whole style. See the note in components/trip/stages/SearchStage.tsx.
import { Text, Pressable, MorphSource, useMorph, backgroundScrollPauseProps, AnimatedList, Entrance, Button, GradientGlowBorder, usePressScale, bookingStatusLabel, Loader } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { tripsApi } from '@eyego/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { useRideStore } from '../../stores/ride.store';

type FilterTab = 'trips' | 'alerts' | 'scheduled';

const TABS: { key: FilterTab; label: string }[] = [
  { key: 'trips', label: 'Trips' },
  { key: 'alerts', label: 'Alerts' },
  { key: 'scheduled', label: 'Scheduled' },
];

const SCHEDULED_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Waiting for a match',
  DISPATCHED: 'Looking for a nearby driver',
  MATCHED: 'Confirmed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

function getStatusColors(colors: Colors): Record<string, string> {
  return {
    COMPLETED: colors.statusSuccess,
    CANCELLED: colors.statusError,
    CONFIRMED: colors.statusInfo,
    // Amber, matching StatusBadge and the seat map: a hold is not yet a
    // booking, and colouring it the same blue as CONFIRMED told the rider the
    // seat was theirs while payment was still outstanding.
    SEAT_HELD: colors.statusWarning,
    BOARDED: colors.statusWarning,
    PENDING: colors.onSurfaceVariant,
    // A ride that never found a driver is not an error the rider caused, and it
    // is not a cancellation either. It had no colour at all before, so it fell
    // to the neutral default and read as if it were still pending.
    EXPIRED: colors.statusWarning,
    REFUNDED: colors.statusInfo,
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
  // booking (fareAmountPesewas is the real column name, not totalFare).
  const route = booking.trip?.route;
  /**
   * AN ON-DEMAND RIDE HAS NO ROUTE.
   *
   * BUGFIX ("the trips tab shows unknown → unknown for the trip i just did").
   * This chain only ever looked at `trip.route`, which exists for scheduled and
   * group trips and is NULL for every ride hailed from the map — those carry
   * their endpoints as `pickupAddress`/`dropoffAddress` columns on the trip
   * itself. So the single most common kind of ride in the product rendered as
   * "Unknown → Unknown", including in the cancel-confirmation copy and the
   * accessibility label below.
   *
   * Coordinates are the last resort rather than the word "Unknown": a rider who
   * booked from a dropped pin genuinely may have no address string, and a
   * rounded lat/lng at least identifies which ride this was.
   */
  const coordLabel = (lat?: number | null, lng?: number | null) =>
    lat != null && lng != null ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : null;
  const origin =
    route?.originName ??
    booking.trip?.pickupAddress ??
    booking.pickupAddress ??
    booking.routeOrigin ??
    coordLabel(booking.trip?.pickupLat, booking.trip?.pickupLng) ??
    'Pickup';
  const destination =
    route?.destinationName ??
    booking.trip?.dropoffAddress ??
    booking.routeDestination ??
    coordLabel(booking.trip?.dropoffLat, booking.trip?.dropoffLng) ??
    'Destination';
  const departureTime = booking.trip?.departureTime ?? booking.departureTime ?? booking.createdAt;
  const fare = booking.fareAmountPesewas ?? booking.totalFare;

  // MORPH FIX: the source id was keyed on the BOOKING id while /ride/[id]'s
  // MorphTarget is keyed on the TRIP id (`ride-card-${id}`, and `id` there is
  // the trip route param). The two ids could never match, so `targetReady` was
  // never called: every ride-card tap ran the clone out to the 700ms
  // TARGET_TIMEOUT and dissolved it mid-air over a screen that had appeared
  // underneath it by then. That is the "weird while in motion" morph. Key both
  // sides off the trip id so the flight actually lands.
  const morphTripId = booking.tripId ?? booking.trip?.id;
  const cardMorphId = `ride-card-${morphTripId}`;

  return (
    <MorphSource
      id={cardMorphId}
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
        /**
         * A DEAD RIDE HAS NO DETAIL SCREEN — SAY WHAT HAPPENED INSTEAD.
         *
         * BUGFIX ("if i tap on the trip that says unknown, it tells me trip not
         * found"). Only CANCELLED was handled here. EXPIRED and NO_DRIVERS_FOUND
         * — what an on-demand request becomes when the dispatch search runs out
         * — fell through to `/ride/<tripId>`, which loads the *bookable* trip and
         * 404s on a trip that is no longer offerable. The rider's own ride
         * answered "trip not found", which reads like data loss rather than the
         * ordinary outcome it is.
         */
        const DEAD: Record<string, { title: string; body: string }> = {
          CANCELLED: {
            title: 'Ride cancelled',
            body: "this ride was cancelled and can't be booked again from here.",
          },
          EXPIRED: {
            title: 'Request expired',
            body: 'no driver accepted in time, so the request was closed. Nothing was charged.',
          },
          NO_DRIVERS_FOUND: {
            title: 'No driver found',
            body: 'nobody was available for this ride. Nothing was charged.',
          },
          REFUNDED: {
            title: 'Ride refunded',
            body: 'this ride was refunded.',
          },
        };
        const dead = DEAD[booking.status];
        if (dead) {
          Alert.alert(dead.title, `${origin} → ${destination} — ${dead.body}`);
          return;
        }
        // An orphaned booking row with no trip FK is the other way this screen
        // produced "Trip not found": `/ride/undefined` resolves to the detail
        // route and 404s.
        if (!tripId) {
          Alert.alert('Ride unavailable', 'This ride is no longer available to open.');
          return;
        }
        // Card expands into the ride detail screen (route animates 'fade' —
        // the morph overlay carries the motion).
        // /ride/[id] looks up by TRIP id (tripsApi.getById), not booking id —
        // booking.tripId is the FK to the actual trip; booking.id is a
        // different entity and would 404 the detail screen.
        morphTo(cardMorphId, () => router.push(`/ride/${tripId}` as any));
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
          {/* BUGFIX: this printed `booking.status` straight from Prisma, so a
              rider mid-payment read the literal "SEAT_HELD". One label map for
              the whole app — see `bookingStatusLabel`. */}
          <Text style={[styles.statusChipText, { color: statusColor }]}>
            {bookingStatusLabel(booking.status)}
          </Text>
        </View>
      </View>
      <View style={{ alignItems: 'flex-end', gap: spacing.xs }}>
        {fare != null && (
          <Text style={styles.itemFare}>
            {typeof fare === 'number' ? formatGhs(fare) : fare}
          </Text>
        )}
        {/* CANCEL, where the rider actually looks for it.
            A booked ride could only be cancelled from the Trips tab's banner,
            which shows one booking at a time — so a rider with a booked seat
            anywhere else in their history had no way out of it at all. The
            row keeps its tap-to-open behaviour; this is a separate hit area. */}
        {CANCELLABLE_BOOKING_STATUSES.includes(booking.status) && (
          <Pressable
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Cancel ride from ${origin} to ${destination}`}
            onPress={(e) => {
              e.stopPropagation();
              Haptics.selectionAsync();
              router.push({ pathname: '/ride/[id]/cancel', params: { id: booking.id } } as any);
            }}
            style={({ pressed }) => [styles.rowCancel, pressed && { opacity: 0.6 }]}
          >
            <Text style={[styles.rowCancelText, { color: colors.error }]}>Cancel</Text>
          </Pressable>
        )}
      </View>
    </Pressable>
    </MorphSource>
  );
}

/**
 * Statuses a rider may still back out of. BOARDED and everything terminal are
 * deliberately absent — once you are in the vehicle, cancelling is a dispute,
 * not a cancellation.
 */
const CANCELLABLE_BOOKING_STATUSES = ['PENDING', 'SEAT_HELD', 'CONFIRMED', 'PAID'];

// Live card for a pending/dispatched on-demand trip request — polls status
// and clears itself from ride.store once matched or cancelled/expired
// (mirrors home.tsx's "home-active-ride" bento card treatment, in the green
// palette used for other in-flight-state surfaces).
function LiveRequestCard({ colors, styles }: { colors: Colors; styles: ReturnType<typeof makeStyles> }) {
  const router = useRouter();
  const { pendingTripRequestId, pendingTripRequestDestination, setPendingTripRequest } = useRideStore();

  const { data } = useQuery({
    queryKey: ['trips', 'request-status', pendingTripRequestId],
    queryFn: () => tripsApi.getTripRequest(pendingTripRequestId!),
    enabled: !!pendingTripRequestId,
    // Was 4s. On a tab a rider can leave open that is 900 requests an hour and
    // a full list re-render each time, for a screen whose live rows are
    // already kept current by the trip channel.
    refetchInterval: 20000,
  });

  const req = (data as any)?.data?.data;

  useEffect(() => {
    if (!req) return;
    if (req.status === 'ACCEPTED' && req.matchedTripId) {
      // Guard against RequestStage (the full "looking for a driver" screen —
      // reachable by tapping this very card) polling the same request in
      // parallel and already having navigated. Both watch pendingTripRequestId;
      // re-check it's still this card's id before claiming it, so only one
      // side fires router navigation. Without this, returning to this card
      // right as a driver accepted could fire two competing navigations
      // (this push + RequestStage's dismissTo) and crash the app.
      if (useRideStore.getState().pendingTripRequestId !== pendingTripRequestId) return;
      setPendingTripRequest(null);
      router.push('/trip?stage=assigned' as any);
    } else if (req.status === 'CANCELLED') {
      setPendingTripRequest(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req?.status, req?.matchedTripId]);

  if (!pendingTripRequestId) return null;

  return (
    <GradientGlowBorder
      palette="green"
      fillColor={colors.surfaceCard}
      borderRadius={radii.xl}
      glow
      style={styles.liveRequestCard}
    >
      <Pressable
        onPress={() => {
          Haptics.selectionAsync();
          router.push({ pathname: '/trip', params: { stage: 'request', resumeRequestId: pendingTripRequestId } } as any);
        }}
      >
        <View style={styles.liveDotWrap}>
          <View style={styles.liveDot} />
          <Text style={styles.liveLabel}>REQUESTING A TRIP</Text>
        </View>
        <View style={styles.liveDestRow}>
          <Ionicons name="navigate-outline" size={16} color={colors.tierComfort} />
          <Text style={styles.liveDestText} numberOfLines={1}>
            {pendingTripRequestDestination ?? 'Your destination'}
          </Text>
        </View>
        <Text style={styles.liveStatus}>Looking for a nearby driver — tap to view</Text>
      </Pressable>
    </GradientGlowBorder>
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

/** Statuses that mean the scheduled ride is still going to happen. */
const LIVE_SCHEDULED_STATUSES = ['PENDING', 'DISPATCHED', 'MATCHED'];

/**
 * Vertical room a glowing card needs above it inside a scroll container.
 * GradientGlowBorder's widest bloom is a shadowRadius-36 shadow, so anything
 * less than this clips the top of the halo (and visually the card edge).
 */
const GLOW_BLEED = 20;

/**
 * The hero card for the next scheduled ride — the same one /scheduled-rides
 * shows. It was missing here entirely, so the Scheduled tab led with expired
 * rides and rendered the one live ride as a plain dark row with a Cancel
 * button, which read as "a black card and a cancel option".
 */
function LiveScheduledCard({
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
  const router = useRouter();
  const matched = intent.status === 'MATCHED';
  const cancellable = intent.status === 'PENDING' || intent.status === 'DISPATCHED';

  return (
    <GradientGlowBorder
      palette="green"
      fillColor={colors.surfaceCard}
      borderRadius={radii.xl}
      glow
      style={styles.liveRequestCard}
    >
      {/* BUGFIX (item 6, "tapping the scheduled card does nothing"): this only
          navigated once a driver had been matched, so for the entire PENDING /
          DISPATCHED life of a scheduled ride — which is most of it — the card
          was inert. It now always opens the ride's own detail screen, and jumps
          straight to live tracking once there is a trip to track. */}
      <Pressable
        onPress={() => {
          Haptics.selectionAsync();
          if (intent.matchedTripId) {
            router.push('/trip?stage=assigned' as any);
          } else {
            router.push(`/scheduled/${intent.id}` as any);
          }
        }}
      >
        <View style={styles.liveDotWrap}>
          <View style={[styles.liveDot, { backgroundColor: matched ? colors.statusSuccess : colors.primary }]} />
          <Text style={styles.liveLabel}>
            {matched ? 'DRIVER CONFIRMED' : 'NEXT SCHEDULED RIDE'}
          </Text>
        </View>
        <View style={styles.liveDestRow}>
          <Ionicons name="navigate-outline" size={16} color={colors.tierComfort} />
          <Text style={styles.liveDestText} numberOfLines={1}>
            {intent.route?.destinationName ?? 'Your destination'}
          </Text>
        </View>
        <Text style={styles.liveStatus}>
          {new Date(intent.scheduledAt).toLocaleString('en-GH', {
            weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
          })}
          {'  ·  '}
          {SCHEDULED_STATUS_LABEL[intent.status] ?? intent.status}
        </Text>
      </Pressable>

      {/* BUGFIX (item 4, "I cancelled but the next-scheduled card stayed"): the
          hero had no cancel of its own. The only Cancel on screen belonged to a
          DIFFERENT ride in the list below, so cancelling it correctly left this
          card in place — which read as the cancel having silently failed. */}
      {cancellable && (
        <Button
          label="Cancel this ride"
          variant="ghost"
          onPress={() =>
            Alert.alert('Cancel scheduled ride?', 'This cannot be undone.', [
              { text: 'Keep it', style: 'cancel' },
              { text: 'Cancel ride', style: 'destructive', onPress: () => onCancel(intent.id) },
            ])
          }
          disabled={cancelling}
          style={{ marginTop: spacing.sm, alignSelf: 'flex-start', paddingHorizontal: 0 }}
        />
      )}
    </GradientGlowBorder>
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
      {(intent.status === 'PENDING' || intent.status === 'DISPATCHED') && (
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
  const press = usePressScale();
  return (
    <Pressable
      onPress={onPress}
      {...press.handlers}
      style={styles.segmentBtn}
      accessibilityRole="button"
      accessibilityState={{ selected: isActive }}
    >
      <Animated.View style={[isActive && styles.segmentActive, press.style, styles.segmentPill]}>
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

  // Nearest still-live ride becomes the hero card; everything else lists
  // below it, live rides first so expired/cancelled history can never push
  // an upcoming ride off the top of the screen.
  const { liveScheduledIntent, scheduledIntents } = useMemo(() => {
    const list: any[] = (scheduledData as any)?.data?.data?.intents ?? [];
    const byTime = (a: any, b: any) =>
      new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();

    const live = list.filter((i) => LIVE_SCHEDULED_STATUSES.includes(i.status)).sort(byTime);
    const past = list.filter((i) => !LIVE_SCHEDULED_STATUSES.includes(i.status)).sort(byTime).reverse();
    const hero = live[0] ?? null;

    return {
      liveScheduledIntent: hero,
      // The hero ride is not repeated in the list — that duplicate row was
      // the confusing plain dark card with a lone Cancel button.
      scheduledIntents: [...live.filter((i) => i.id !== hero?.id), ...past],
    };
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
            <Loader size={20} color={colors.primary} />
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
            ListHeaderComponent={
              liveScheduledIntent ? (
                <LiveScheduledCard
                  intent={liveScheduledIntent}
                  colors={colors}
                  styles={styles}
                  onCancel={(id) => cancelScheduled.mutate(id)}
                  cancelling={cancelScheduled.isPending}
                />
              ) : undefined
            }
            contentContainerStyle={{
              paddingHorizontal: spacing.lg,
              // GLOW-CLIP FIX: GradientGlowBorder's bloom is an iOS shadow that
              // spreads ~28-36px past the card's own bounds. With the list
              // content starting at y=0 the whole upper half of that bloom —
              // and with it the visual top edge of the card — was cut off by
              // the scroll container, which read as "the card is clipped at
              // the top". Reserve room for the bloom instead.
              paddingTop: GLOW_BLEED,
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
          <Loader size={20} color={colors.primary} />
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
          ListHeaderComponent={filter === 'trips' ? <LiveRequestCard colors={colors} styles={styles} /> : undefined}
          ItemSeparatorComponent={ItemSeparator}
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            // See GLOW_BLEED — without this the "REQUESTING A TRIP" card's
            // halo (and its top edge) is clipped by the scroll container.
            paddingTop: GLOW_BLEED,
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
  rowCancel: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withOpacity(colors.error, 0.4),
  },
  rowCancelText: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    lineHeight: Math.round(11 * 1.4),
  },
  liveRequestCard: {
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  liveDotWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  liveLabel: { fontFamily: fonts.semiBold, fontSize: 10, letterSpacing: 0.8, color: colors.onSurfaceVariant },
  liveDestRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  liveDestText: { flex: 1, fontFamily: fonts.semiBold, fontSize: fontSizes.bodyLarge, color: colors.onSurface },
  liveStatus: { fontFamily: fonts.medium, fontSize: fontSizes.bodySmall, color: colors.onSurfaceVariant },
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
