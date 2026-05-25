import React, { useState, useMemo } from 'react';
import { View, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { FlashList } from '@shopify/flash-list';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { bookingsApi, queryKeys } from '@eyego/api';
import { useRideStore } from '../../stores/ride.store';
import { fonts, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, Skeleton, EmptyState, StatusBadge } from '@eyego/ui';
import { formatCurrency, formatTripDate } from '@eyego/utils';
import { Ionicons } from '@expo/vector-icons';
import type { Booking } from '@eyego/types';

const SEGMENTS = ['Upcoming', 'Past'] as const;
type Segment = typeof SEGMENTS[number];

function displayStatusFor(booking: Booking): string {
  return (booking as any).trip?.status === 'COMPLETED' ? 'COMPLETED' : booking.status;
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
  const handleCancel = (bookingId: string) => {
    router.push({ pathname: '/ride/[id]/cancel', params: { id: bookingId } } as any);
  };

  const { data: activeData } = useQuery({
    queryKey: ['bookings', 'active'],
    queryFn: () => bookingsApi.getActive(),
    refetchInterval: 15_000,
    refetchOnMount: true,
  });
  // Backend returns { data: { booking: {...} } } — unwrap both shapes for safety
  const rawActive = activeData?.data?.data as any;
  const rawBooking = (rawActive?.booking ?? rawActive) as Booking | null ?? storeActiveBooking;
  // Only surface the banner when the booking is genuinely in-flight (not completed/cancelled)
  const ACTIVE_STATUSES = ['CONFIRMED', 'SEAT_HELD', 'BOARDED'];
  const activeBooking: Booking | null =
    rawBooking && ACTIVE_STATUSES.includes((rawBooking as any).status ?? '')
      ? rawBooking
      : null;

  const { data, isLoading } = useQuery({
    queryKey: [...queryKeys.bookings.myHistory(), segment],
    queryFn: () =>
      bookingsApi.getHistory(
        segment === 'Upcoming'
          ? { status: 'CONFIRMED,SEAT_HELD,BOARDED,PENDING' }
          : {}  // No status filter for Past — fetch all and filter client-side so stuck-status bookings on completed trips still appear
      ),
    refetchOnMount: true,
  });

  const rawBookings = (data?.data?.data?.bookings ?? []) as Booking[];
  const bookings = useMemo(() => {
    if (segment === 'Upcoming') {
      // Exclude bookings whose underlying trip is already completed — they belong in Past
      return rawBookings.filter(b =>
        ['CONFIRMED', 'SEAT_HELD', 'PENDING', 'BOARDED'].includes(b.status) &&
        !['COMPLETED', 'CANCELLED'].includes((b as any).trip?.status ?? '')
      );
    } else {
      // Include bookings with a completed status OR whose trip is marked COMPLETED
      return rawBookings.filter(b =>
        ['COMPLETED', 'CANCELLED', 'REFUNDED', 'NO_SHOW'].includes(b.status) ||
        (b as any).trip?.status === 'COMPLETED'
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
        <MotiView
          from={{ opacity: 0, translateY: -8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34 }}
          style={styles.activeBanner}
        >
          <Pressable
            style={styles.activeBannerInner}
            onPress={() => router.push(`/ride/${activeBooking.tripId}/tracking` as any)}
          >
            <View style={styles.activeBadge}>
              <Text style={styles.activeBadgeText}>In Progress</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="titleSmall" numberOfLines={1}>
                {(activeBooking as any).trip?.origin?.address?.split(',')[0] ?? 'Active Ride'}
                {' → '}
                {(activeBooking as any).trip?.destination?.address?.split(',')[0] ?? ''}
              </Text>
              <Text variant="caption" color={colors.onSurfaceVariant}>
                Seat #{activeBooking.seatNumber ?? '—'} · Tap to track
              </Text>
            </View>
            <Text variant="fareSmall" color={colors.primary}>
              {formatCurrency(
                (activeBooking as any).fareAmount ??
                (activeBooking as any).fare ??
                (activeBooking as any).trip?.farePerSeat ?? 0
              )}
            </Text>
          </Pressable>
        </MotiView>
      )}

      {/* Segmented control */}
      <MotiView
        from={{ opacity: 0, translateY: 6 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 50 }}
        style={styles.segmentRow}
      >
        {SEGMENTS.map((s) => (
          <Pressable
            key={s}
            style={[styles.segmentItem, segment === s && styles.segmentItemActive]}
            onPress={() => setSegment(s)}
          >
            <Text
              variant="label"
              color={segment === s ? colors.backgroundDeep : colors.onSurfaceVariant}
            >
              {s}
            </Text>
          </Pressable>
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
          icon="🚌"
          title={`No ${segment.toLowerCase()} trips`}
          subtitle={
            segment === 'Upcoming'
              ? 'Book your first ride to get started.'
              : 'Your completed rides will appear here.'
          }
        />
      ) : (
        <FlashList
          data={bookings}
          keyExtractor={(item) => item.id}
          estimatedItemSize={108}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => (
            <MotiView
              from={{ opacity: 0, translateY: 10 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'spring', stiffness: 600, damping: 34, delay: index * 40 }}
              style={styles.cardWrapper}
            >
              <Pressable
                style={styles.tripCard}
                onPress={() => router.push(`/ride/${item.tripId}` as any)}
              >
                <TripCard
                  booking={item}
                  showCancel={segment === 'Upcoming' && ['CONFIRMED', 'SEAT_HELD', 'BOARDED'].includes(item.status)}
                  onCancel={() => handleCancel(item.id)}
                  showDispute={segment === 'Past' && ['COMPLETED', 'CANCELLED'].includes(displayStatusFor(item as Booking))}
                  onDispute={() => router.push({ pathname: '/ride/[id]/dispute', params: { id: item.id } } as any)}
                />
              </Pressable>
            </MotiView>
          )}
        />
      )}
    </SafeAreaView>
  );
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
  const trip = booking.trip;

  // If the trip itself is COMPLETED, show COMPLETED regardless of booking status
  // (handles stuck SEAT_HELD/CONFIRMED bookings on completed trips)
  const displayStatus = (trip as any)?.status === 'COMPLETED' ? 'COMPLETED' : booking.status;

  return (
    <View style={styles.cardInner}>
      <View style={styles.cardHeader}>
        <View style={styles.routeRow}>
          <Text variant="titleSmall" numberOfLines={1} style={{ flex: 1 }}>
            {(trip as any)?.route?.originName ?? trip?.origin?.address?.split(',')[0] ?? 'Origin'}
          </Text>
          <Text variant="caption" color={colors.onSurfaceVariant} style={{ marginHorizontal: spacing.sm }}>
            →
          </Text>
          <Text variant="titleSmall" numberOfLines={1} style={{ flex: 1, textAlign: 'right' }}>
            {(trip as any)?.route?.destinationName ?? trip?.destination?.address?.split(',')[0] ?? 'Destination'}
          </Text>
        </View>
        <StatusBadge status={displayStatus as any} />
      </View>

      <View style={styles.cardMeta}>
        <Text variant="caption" color={colors.onSurfaceVariant}>
          {trip?.departureTime ? formatTripDate(trip.departureTime) : '—'}
        </Text>
        <Text variant="fareSmall">
          {formatCurrency((booking as any).fareAmount ?? booking.fare ?? 0)}
        </Text>
      </View>

      {booking.rating && (
        <View style={styles.ratingRow}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Text key={i} style={{ fontSize: 12 }}>
              {i < booking.rating! ? '★' : '☆'}
            </Text>
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
  safe: { flex: 1, backgroundColor: colors.backgroundDeep },
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
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
    borderRadius: radii.xl,
  },
  segmentItemActive: {
    backgroundColor: colors.primary,
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
    paddingBottom: spacing['3xl'],
  },
  cardWrapper: {
    marginBottom: spacing.md,
  },
  tripCard: {
    backgroundColor: colors.surfaceContainer,
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
  },
  activeBannerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: 'rgba(75, 226, 119, 0.10)',
    borderRadius: radii.xl,
    padding: spacing.base,
    borderWidth: 1.5,
    borderColor: colors.primary + '50',
  },
  activeBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.full,
  },
  activeBadgeText: {
    fontFamily: fonts.semiBold,
    fontSize: 10,
    color: '#050508',
    letterSpacing: 0.5,
  },
});
