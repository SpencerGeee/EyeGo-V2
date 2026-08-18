import React, { useState, useMemo, useCallback } from 'react';
import { View, StyleSheet, Pressable, RefreshControl, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import Animated from 'react-native-reanimated';
import { useRouter, type Href } from 'expo-router';
import { MotiView } from '@eyego/ui';
import { FlashList } from '@shopify/flash-list';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { bookingsApi, queryKeys } from '@eyego/api';
import { useRideStore } from '../../stores/ride.store';
import { spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, Skeleton, EmptyState, StatusBadge, backgroundScrollPauseProps, usePressScale } from '@eyego/ui';
import { formatGhs, formatTripDate } from '@eyego/utils';
import { Ionicons } from '@expo/vector-icons';
import type { Booking } from '@eyego/types';

const SEGMENTS = ['Upcoming', 'Past'] as const;
type Segment = typeof SEGMENTS[number];

function displayStatusFor(booking: Booking): string {
  return booking.trip?.status === 'COMPLETED' ? 'COMPLETED' : booking.status;
}

const emptyLottie = require('../../assets/lottie/empty-state.json');

export default function TripsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const [segment, setSegment] = useState<Segment>('Upcoming');
  const { activeBooking: storeActiveBooking } = useRideStore();
  const queryClient = useQueryClient();

  // Navigate to the cancel screen (with reason picker) instead of a bare Alert
  const handleCancel = useCallback((bookingId: string) => {
    router.push({ pathname: '/ride/[id]/cancel', params: { id: bookingId } } as Href);
  }, [router]);

  const { data: activeData } = useQuery({
    queryKey: ['bookings', 'active'],
    queryFn: () => bookingsApi.getActive(),
    refetchInterval: 15_000,
    refetchOnMount: true,
  });
  // Backend returns { data: { booking: {...} } } — unwrap both shapes for safety
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawActive = activeData?.data?.data as any;
  const rawBooking = (rawActive?.booking ?? rawActive) as Booking | null ?? storeActiveBooking;
  // Only surface the banner when the booking is genuinely in-flight (not completed/cancelled)
  const ACTIVE_STATUSES = ['CONFIRMED', 'SEAT_HELD', 'BOARDED'] as const;
  const activeBooking: Booking | null =
    rawBooking && ACTIVE_STATUSES.includes(rawBooking.status as typeof ACTIVE_STATUSES[number])
      ? rawBooking
      : null;

  const { data, isLoading, refetch: refetchBookings } = useQuery({
    queryKey: [...queryKeys.bookings.myHistory(), segment],
    queryFn: () =>
      bookingsApi.getHistory(
        segment === 'Upcoming'
          ? { status: 'CONFIRMED,SEAT_HELD,BOARDED,PENDING' }
          : {}  // No status filter for Past — fetch all and filter client-side so stuck-status bookings on completed trips still appear
      ),
    refetchOnMount: true,
  });

  const renderTripItem = useCallback(({ item }: { item: Booking }) => (
    <View style={styles.cardWrapper}>
      <Pressable
        style={[
          styles.tripCard,
          { borderLeftWidth: 3, borderLeftColor: segment === 'Upcoming' ? colors.primary : colors.outlineVariant },
        ]}
        onPress={() => router.push(`/ride/${item.tripId}` as Href)}
        accessibilityRole="button"
        accessibilityLabel={`Trip from ${item.trip?.route?.originName ?? 'Origin'} to ${item.trip?.route?.destinationName ?? 'Destination'}`}
      >
        <TripCard
          booking={item}
          showCancel={segment === 'Upcoming' && ['CONFIRMED', 'SEAT_HELD', 'BOARDED'].includes(item.status)}
          onCancel={() => handleCancel(item.id)}
          showDispute={segment === 'Past' && ['COMPLETED', 'CANCELLED'].includes(displayStatusFor(item))}
          onDispute={() => router.push({ pathname: '/ride/[id]/dispute', params: { id: item.id } } as Href)}
        />
      </Pressable>
    </View>
  ), [styles, colors, segment, router, handleCancel]);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: [...queryKeys.bookings.myHistory(), segment] });
    await refetchBookings();
    setRefreshing(false);
  }, [queryClient, refetchBookings, segment]);

  const rawBookings = ((data?.data?.data as any)?.bookings ?? []) as Booking[];
  const bookings = useMemo(() => {
    if (segment === 'Upcoming') {
      // Exclude bookings whose underlying trip is already completed — they belong in Past
      return rawBookings.filter(b =>
        ['CONFIRMED', 'SEAT_HELD', 'PENDING', 'BOARDED'].includes(b.status) &&
        !['COMPLETED', 'CANCELLED'].includes(b.trip?.status ?? '')
      );
    } else {
      // Include bookings with a completed status OR whose trip is marked COMPLETED
      return rawBookings.filter(b =>
        ['COMPLETED', 'CANCELLED', 'REFUNDED', 'NO_SHOW'].includes(b.status) ||
        b.trip?.status === 'COMPLETED'
      );
    }
  }, [rawBookings, segment]);

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <MotiView
        from={{ opacity: 0, translateY: -6 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        style={styles.header}
      >
        <Text variant="headlineMedium">My Trips</Text>
      </MotiView>

      {/* Active booking banner */}
      {activeBooking && (
        <Pressable
          onPress={() => router.push('/trip?stage=assigned' as Href)}
          style={[styles.activeBanner, { borderLeftColor: colors.primary }]}
          accessibilityRole="button"
          accessibilityLabel="Active ride — tap to track"
        >
          <View style={styles.activeBannerLeft}>
            <View style={[styles.activeDot, { backgroundColor: colors.primary }]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="labelSmall" color={colors.primary} style={{ letterSpacing: 0.8, marginBottom: 2 }}>
              RIDE IN PROGRESS
            </Text>
            <Text variant="titleSmall" numberOfLines={1}>
              {activeBooking.trip?.route?.originName ??
                activeBooking.trip?.origin?.address?.split(',')[0] ?? 'Active Ride'}
              {' → '}
              {activeBooking.trip?.route?.destinationName ??
                activeBooking.trip?.destination?.address?.split(',')[0] ?? ''}
            </Text>
            <Text variant="caption" color={colors.onSurfaceVariant}>
              Seat #{activeBooking.seatNumber ?? '—'} ·{' '}
              {formatGhs(
                activeBooking.fareAmountPesewas ??
                activeBooking.fare ??
                activeBooking.trip?.farePerSeatPesewas ?? 0
              )}
            </Text>
          </View>
          <View style={[styles.trackBtn, { backgroundColor: colors.primary + '22' }]}>
            <Text variant="labelSmall" color={colors.primary}>Track →</Text>
          </View>
        </Pressable>
      )}

      {/* Segmented control — animated glass pill */}
      <MotiView
        from={{ opacity: 0, translateY: 6 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 50 }}
        style={styles.segmentRow}
      >
        {SEGMENTS.map((s) => (
          <AnimatedSegment
            key={s}
            label={s}
            isActive={segment === s}
            onPress={() => setSegment(s)}
            colors={colors}
            styles={styles}
          />
        ))}
      </MotiView>

      {/* List */}
      {isLoading ? (
        <View style={styles.skeletonContainer}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} height={96} borderRadius={radii.xl} style={styles.skeletonItem} />
          ))}
        </View>
      ) : bookings.length === 0 ? (
        <EmptyState
          lottieSource={emptyLottie}
          icon="bus-outline"
          title={`No ${segment.toLowerCase()} trips`}
          subtitle={
            segment === 'Upcoming'
              ? 'Book your first ride to get started.'
              : 'Your completed rides will appear here.'
          }
        />
      ) : (
        <FlashList
          {...backgroundScrollPauseProps}
          data={bookings}
          keyExtractor={(item: Booking) => item.id}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          {...({ estimatedItemSize: 108 } as any)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          renderItem={renderTripItem}
        />
      )}
    </SafeAreaView>
  );
}

function AnimatedSegment({
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
      style={styles.segmentItem}
      accessibilityRole="button"
      accessibilityState={{ selected: isActive }}
      accessibilityLabel={`${label} trips${isActive ? ', selected' : ''}`}
    >
      <Animated.View style={[
        { paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md, borderRadius: radii.xl, overflow: 'hidden' },
        isActive && styles.segmentItemActive,
        press.style,
      ]}>
        {isActive && Platform.OS === 'ios' && (
          <BlurView intensity={20} tint="light" style={StyleSheet.absoluteFill} />
        )}
        <Text variant="label" color={isActive ? colors.backgroundDeep : colors.onSurfaceVariant}>
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

/**
 * The first of these that is a real place name, or the fallback.
 *
 * BUGFIX ("on the activity page it's just showing Unknown for all the trips").
 * The card read `trip.origin.address` and `trip.destination.address`. Neither
 * field exists — the serializer emits `pickup` / `dropoff`, and the raw Prisma
 * shape uses `pickupAddress` / `dropoffAddress`. So the optional chain resolved
 * `undefined` every time and every row printed its placeholder, for on-demand
 * and group trips alike. Reading all three shapes means the card cannot be
 * broken again by which endpoint happened to serve it.
 */
const PLACEHOLDER_NAMES = new Set(['unknown', 'null', 'undefined', 'n/a', '-', '—']);
function endpointLabel(...candidates: (string | null | undefined)[]): string {
  const fallback = String(candidates[candidates.length - 1] ?? '—');
  for (const c of candidates.slice(0, -1)) {
    if (typeof c !== 'string') continue;
    const trimmed = c.trim();
    // A blank is obvious; the placeholder WORDS matter just as much. Endpoint
    // columns are non-nullable, so rows written before the ad-hoc paths learned
    // to name themselves hold the literal text "Unknown" — which passed the old
    // length check and printed straight onto the card.
    if (trimmed.length === 0 || PLACEHOLDER_NAMES.has(trimmed.toLowerCase())) continue;
    return trimmed.split(',')[0].trim();
  }
  return fallback;
}

/** Rounded coordinates, for an endpoint that never had a name. */
const coordName = (lat?: number | null, lng?: number | null) =>
  Number.isFinite(lat) && Number.isFinite(lng) ? `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}` : null;

/** When this ride actually happened, for the activity list's timestamp. */
function tripWhen(trip: any, booking: any): string | null {
  return trip?.requestedAt ?? trip?.createdAt ?? booking?.createdAt ?? trip?.departureTime ?? null;
}

function TripCard({ booking, showCancel, onCancel, showDispute, onDispute }: {
  booking: Booking;
  showCancel?: boolean;
  onCancel?: () => void;
  showDispute?: boolean;
  onDispute?: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Widened deliberately: this list is served by more than one endpoint and the
  // shapes differ (snapshot `pickup`/`dropoff` vs raw `pickupAddress`). See
  // `endpointLabel`, which reads whichever arrived.
  const trip = booking.trip as any;

  // If the trip itself is COMPLETED, show COMPLETED regardless of booking status
  // (handles stuck SEAT_HELD/CONFIRMED bookings on completed trips)
  const displayStatus = trip?.status === 'COMPLETED' ? 'COMPLETED' : booking.status;

  return (
    <View style={styles.cardInner}>
      <View style={styles.cardHeader}>
        <View style={styles.routeRow}>
          <Text variant="titleSmall" numberOfLines={1} style={{ flex: 1 }}>
            {endpointLabel(
              trip?.route?.originName,
              trip?.pickup?.address,
              trip?.pickupAddress,
              booking?.pickupAddress,
              coordName(trip?.pickupLat ?? trip?.pickup?.lat, trip?.pickupLng ?? trip?.pickup?.lng),
              'Pickup',
            )}
          </Text>
          <Text variant="caption" color={colors.onSurfaceVariant} style={{ marginHorizontal: spacing.sm }}>
            →
          </Text>
          <Text variant="titleSmall" numberOfLines={1} style={{ flex: 1, textAlign: 'right' }}>
            {endpointLabel(
              trip?.route?.destinationName,
              trip?.dropoff?.address,
              trip?.dropoffAddress,
              coordName(trip?.dropoffLat ?? trip?.dropoff?.lat, trip?.dropoffLng ?? trip?.dropoff?.lng),
              'Destination',
            )}
          </Text>
        </View>
        <StatusBadge status={displayStatus} />
      </View>

      <View style={styles.cardMeta}>
        <Text variant="caption" color={colors.onSurfaceVariant}>
          {/*
            WHEN THE RIDE HAPPENED, NOT WHEN IT WAS SCHEDULED TO.

            BUGFIX ("one of the timestamps is showing as 3h ago and the other as
            5m ago" for two trips booked a minute apart). This read
            `departureTime` alone. For an on-demand ride that equals the request
            time and looks right; for a driver-published group trip it is the
            bus's DEPARTURE — often hours away from when the rider booked their
            seat — so two entries created seconds apart legitimately printed
            timestamps hours apart. `requestedAt`/`createdAt` is the fact the
            activity list is actually reporting.
          */}
          {tripWhen(trip, booking) ? formatTripDate(tripWhen(trip, booking)) : '—'}
        </Text>
        <Text variant="fareSmall">
          {formatGhs(booking.fareAmountPesewas ?? booking.fare ?? 0)}
        </Text>
      </View>

      {/* Your rating of the driver */}
      {booking.rating && (
        <View style={styles.ratingRow}>
          <Text variant="caption" color={colors.onSurfaceVariant} style={{ marginRight: spacing.sm }}>
            Your rating:
          </Text>
          {Array.from({ length: 5 }).map((_, i) => (
            <Ionicons
              key={i}
              name={i < booking.rating! ? 'star' : 'star-outline'}
              size={12}
              color={i < booking.rating! ? '#F59E0B' : colors.outlineVariant}
            />
          ))}
        </View>
      )}
      {/* Driver's rating of you (passenger rating) */}
      {booking.passengerRating != null && (
        <View style={styles.ratingRow}>
          <Ionicons name="people-outline" size={12} color={colors.onSurfaceVariant} />
          <Text variant="caption" color={colors.onSurfaceVariant} style={{ marginRight: spacing.xs }}>
            Driver rated you:
          </Text>
          {Array.from({ length: 5 }).map((_, i) => (
            <Ionicons
              key={i}
              name={i < booking.passengerRating! ? 'star' : 'star-outline'}
              size={11}
              color={i < booking.passengerRating! ? '#A78BFA' : colors.outlineVariant}
            />
          ))}
        </View>
      )}

      {showCancel && (
        <Pressable style={[styles.cancelBtn, { borderColor: colors.error + '50' }]} onPress={onCancel}>
          <Ionicons name="close-circle-outline" size={14} color={colors.error} />
          <Text variant="caption" color={colors.error}>Cancel booking</Text>
        </Pressable>
      )}
      {showDispute && (
        <Pressable style={[styles.cancelBtn, { borderColor: colors.onSurfaceVariant + '50' }]} onPress={onDispute}>
          <Ionicons name="flag-outline" size={14} color={colors.onSurfaceVariant} />
          <Text variant="caption" color={colors.onSurfaceVariant}>Report an issue</Text>
        </Pressable>
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.xl, paddingBottom: spacing.base },
  segmentRow: {
    flexDirection: 'row',
    marginHorizontal: spacing['2xl'],
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii['2xl'],
    padding: 4,
    marginBottom: spacing.base,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
  },
  segmentItemActive: {
    backgroundColor: colors.primary,
    borderRadius: radii.xl,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    overflow: 'hidden',
  },
  skeletonContainer: {
    paddingHorizontal: spacing['2xl'],
    gap: spacing.md,
  },
  skeletonItem: {
    marginBottom: spacing.md,
  },
  listContent: {
    paddingHorizontal: spacing['2xl'],
    paddingBottom: 100,
  },
  cardWrapper: {
    marginBottom: spacing.md,
  },
  tripCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    overflow: 'hidden',
  },
  cardInner: { padding: spacing.base },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  routeRow: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: spacing.sm },
  cardMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ratingRow: { flexDirection: 'row', marginTop: spacing.sm, gap: 2 },
  cancelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  activeBanner: {
    marginHorizontal: spacing['2xl'],
    marginBottom: spacing.base,
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderLeftWidth: 4,
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.base,
    gap: spacing.md,
  },
  activeBannerLeft: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
  },
  activeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  trackBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.md,
  },
});
