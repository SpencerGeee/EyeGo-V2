import React, { useRef, useMemo, useEffect, useState } from 'react';
import { View, StyleSheet, Pressable, Image, ScrollView } from 'react-native';
import MapboxGL from '../../utils/mapbox';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { tripsApi, bookingsApi, queryKeys } from '@eyego/api';
import { useRideStore } from '../../stores/ride.store';
import { useAuthStore } from '../../stores/auth.store';
import { fonts, fontSizes, spacing, radii, shadows } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, Button, Card, DriverInfoCard, SeatBar, AnimatedFareText, Skeleton } from '@eyego/ui';
import { formatCurrency, formatTripDate, formatDuration, formatDistance } from '@eyego/utils';


const TIERS = [
  { key: 'ECONOMY', label: 'Economy', icon: '🌿' },
  { key: 'COMFORT', label: 'Comfort', icon: '✨' },
] as const;
type TierKey = typeof TIERS[number]['key'];

export default function RideDetailScreen() {
  const colors = useColors();
  const { id, tier: tierParam } = useLocalSearchParams<{ id: string; tier?: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const { selectedTrip, setSelectedTrip, setActiveBooking, activeBooking, origin, destination, setSelectedTier: setStoreTier, computedFare } = useRideStore();
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['58%', '85%'], []);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [selectedTier, setSelectedTier] = useState<TierKey>(
    (tierParam?.toUpperCase() as TierKey) ?? 'ECONOMY'
  );
  // Lock tier once we get the trip data — rider can't change it from what the driver set
  const tripTier = (data?.data?.data?.trip?.tier as TierKey | undefined);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.rides.detail(id ?? ''),
    queryFn: () => tripsApi.getById(id ?? ''),
    enabled: !!id,
  });

  const trip = useMemo(() => {
    const rawTrip = data?.data?.data?.trip;
    if (!rawTrip) {
      return {
        id: id ?? '1',
        origin: {
          address: origin?.address ?? 'Accra Mall, Spintex',
          latitude: origin?.latitude ?? 5.6037,
          longitude: origin?.longitude ?? -0.187,
        },
        destination: {
          address: destination?.address ?? 'University of Ghana, Legon',
          latitude: destination?.latitude ?? 5.65,
          longitude: destination?.longitude ?? -0.19,
        },
        fare: selectedTrip?.fare ?? (id === '2' ? 15.0 : 8.5),
        availableSeats: 3,
        totalSeats: 10,
        departureTime: new Date(Date.now() + 10 * 60000).toISOString(),
        distanceKm: 8.2,
        durationMinutes: 15,
        driver: {
          name: 'Your Driver',
          rating: null,
          totalTrips: 0,
          avatarUrl: null,
        },
        vehicle: {
          plate: '—',
          color: '—',
          make: '—',
        },
      };
    }

    return {
      ...rawTrip,
      origin: {
        address: rawTrip.route?.originName ?? 'Origin',
        latitude: rawTrip.route?.originLat ?? 0,
        longitude: rawTrip.route?.originLng ?? 0,
      },
      destination: {
        address: rawTrip.route?.destinationName ?? 'Destination',
        latitude: rawTrip.route?.destLat ?? 0,
        longitude: rawTrip.route?.destLng ?? 0,
      },
      availableSeats: rawTrip.maxSeats - (rawTrip.bookings?.length ?? 0),
      totalSeats: rawTrip.maxSeats,
      distanceKm: rawTrip.route?.distanceKm ?? 0,
      durationMinutes: rawTrip.route?.distanceKm ? Math.round(rawTrip.route.distanceKm * 1.8) : 15,
    };
  }, [data, id, origin, destination]);

  const isAlreadyBooked = useMemo(() => {
    const rawTrip = data?.data?.data?.trip;
    if (rawTrip?.bookings && user?.id) {
      return rawTrip.bookings.some((b: any) => b.userId === user.id);
    }
    return activeBooking?.tripId === id;
  }, [data, user, activeBooking, id]);

  useEffect(() => {
    if (isAlreadyBooked && id) {
      router.replace(`/ride/${id}/tracking` as any);
    }
  }, [isAlreadyBooked, id]);

  useEffect(() => {
    if (trip && selectedTrip?.id !== trip.id) {
      setSelectedTrip(trip as any);
    }
  }, [trip, selectedTrip]);

  useEffect(() => {
    if (!trip) return;
    // Lock selectedTier to the trip's tier once data loads
    if (tripTier && tripTier !== selectedTier) {
      setSelectedTier(tripTier);
    }
    const serverFare = (trip as any).fare ?? 0;
    setStoreTier(selectedTier, serverFare);
  }, [selectedTier, trip, tripTier]);

  const bookTrip = useMutation({
    mutationFn: async () => {
      try {
        const { data } = await bookingsApi.create({
          tripId: id ?? '',
          seatId: 'seat-1', // default fallback seat
          paymentMethod: 'CASH',
        });
        return data.data;
      } catch (e) {
        // Mock fallback booking
        return {
          id: 'mock-booking-id-' + Math.random().toString(36).substr(2, 9),
          tripId: id ?? '',
          seatNumber: 1,
          status: 'PENDING',
        };
      }
    },
    onSuccess: (bookingData) => {
      setActiveBooking(bookingData as any);
      router.push(`/ride/${id}/payment` as any);
    },
  });

  const occupiedSeats = (trip?.totalSeats ?? 10) - (trip?.availableSeats ?? 5);
  const occupancyPercent = trip ? (occupiedSeats / trip.totalSeats) * 100 : 0;

  return (
    <View style={styles.container}>
      {/* Map background */}
      <MapboxGL.MapView
        style={[StyleSheet.absoluteFillObject, { backgroundColor: '#050508' }]}
        styleURL="mapbox://styles/mapbox/dark-v11"
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        rotateEnabled={false}
        scaleBarEnabled={false}
      >
        <MapboxGL.Camera
          bounds={{
            ne: [
              Math.max(trip.origin.longitude, trip.destination.longitude) + 0.02,
              Math.max(trip.origin.latitude, trip.destination.latitude) + 0.02,
            ],
            sw: [
              Math.min(trip.origin.longitude, trip.destination.longitude) - 0.02,
              Math.min(trip.origin.latitude, trip.destination.latitude) - 0.02,
            ],
            paddingTop: 80,
            paddingBottom: 380,
            paddingLeft: 40,
            paddingRight: 40,
          }}
          animationMode="none"
          animationDuration={0}
        />
        {trip?.origin && (
          <MapboxGL.MarkerView coordinate={[trip.origin.longitude, trip.origin.latitude]}>
            <View style={styles.markerOrigin}>
              <View style={styles.markerDot} />
            </View>
          </MapboxGL.MarkerView>
        )}
        {trip?.destination && (
          <MapboxGL.MarkerView coordinate={[trip.destination.longitude, trip.destination.latitude]}>
            <View style={styles.markerDestination}>
              <Ionicons name="location" size={20} color={colors.secondary} />
            </View>
          </MapboxGL.MarkerView>
        )}
        {trip?.origin && trip?.destination && (
          <MapboxGL.ShapeSource
            id="routeLine"
            shape={{
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: [
                  [trip.origin.longitude, trip.origin.latitude],
                  [trip.destination.longitude, trip.destination.latitude],
                ],
              },
              properties: {},
            }}
          >
            <MapboxGL.LineLayer
              id="routeLineLayer"
              style={{ lineColor: colors.primary, lineWidth: 3, lineDasharray: [2, 1] }}
            />
          </MapboxGL.ShapeSource>
        )}
      </MapboxGL.MapView>

      {/* Back button */}
      <Pressable
        style={[styles.backButton, { top: 60 }]}
        onPress={() => router.back()}
      >
        <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
      </Pressable>

      {/* Bottom sheet */}
      <BottomSheet
        ref={bottomSheetRef}
        index={0}
        snapPoints={snapPoints}
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.sheetHandle}
        enablePanDownToClose={false}
      >
        <BottomSheetScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
          {/* Tier selector */}
          <MotiView
            from={{ opacity: 0, translateY: -6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34 }}
            style={styles.tierRow}
          >
            {TIERS.map((t) => {
              const isActive = selectedTier === t.key;
              const activeColor = t.key === 'COMFORT' ? colors.secondary : colors.primary;
              // If the trip has a set tier, disable the non-matching option
              const isLocked = !!tripTier && t.key !== tripTier;
              return (
                <Pressable
                  key={t.key}
                  style={[
                    styles.tierChip,
                    isActive && { backgroundColor: activeColor, borderColor: activeColor },
                    isLocked && { opacity: 0.3 },
                  ]}
                  onPress={() => !isLocked && setSelectedTier(t.key)}
                  disabled={isLocked}
                >
                  <Text style={styles.tierChipIcon}>{t.icon}</Text>
                  <Text
                    variant="label"
                    color={isActive ? colors.onPrimary : colors.onSurfaceVariant}
                  >
                    {t.label}
                  </Text>
                </Pressable>
              );
            })}
          </MotiView>

          {isLoading ? (
            <View style={{ gap: spacing.base }}>
              {[120, 80, 100, 60].map((h, i) => (
                <Skeleton key={i} height={h} borderRadius={radii.xl} />
              ))}
            </View>
          ) : (
            <>
              {/* Route header */}
              <MotiView
                from={{ opacity: 0, translateY: 10 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: 'spring', stiffness: 600, damping: 34 }}
              >
                <View style={styles.routeHeader}>
                  <View style={styles.routeHeaderLeft}>
                    <Text variant="titleMedium" numberOfLines={1} style={{ flex: 1 }}>
                      {trip?.origin?.address?.split(',')[0] ?? 'Origin'}
                    </Text>
                    <Ionicons name="arrow-forward" size={16} color={colors.onSurfaceVariant} />
                    <Text variant="titleMedium" numberOfLines={1} style={{ flex: 1 }}>
                      {trip?.destination?.address?.split(',')[0] ?? 'Destination'}
                    </Text>
                  </View>
                </View>
                <View style={styles.metaRow}>
                  <MetaPill icon="time-outline" label={trip?.departureTime ? new Date(trip.departureTime).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' }) : '—'} />
                  <MetaPill icon="map-outline" label={trip?.distanceKm ? formatDistance(trip.distanceKm) : '—'} />
                  <MetaPill icon="speedometer-outline" label={trip?.durationMinutes ? formatDuration(trip.durationMinutes) : '—'} />
                </View>
              </MotiView>

              {/* Driver card */}
              <MotiView
                from={{ opacity: 0, translateY: 10 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 40 }}
              >
                <DriverInfoCard
                  driver={trip?.driver as any}
                  vehicle={trip?.vehicle as any}
                  showActions={false}
                />
              </MotiView>

              {/* HIDDEN — replaced by DriverInfoCard above */}
              {false && <View style={styles.driverCard}>
                <View style={styles.driverAvatar}>
                  <Ionicons name="person" size={22} color={colors.onSurfaceVariant} />
                </View>
                <View style={styles.driverInfo}>
                  <Text variant="titleSmall">{trip?.driver?.name ?? 'Your Driver'}</Text>
                  <View style={styles.ratingRow}>
                    <Text variant="caption" color={colors.primary}>★ {trip?.driver?.rating?.toFixed(1) ?? '4.9'}</Text>
                    <Text variant="caption" color={colors.onSurfaceVariant}> · {trip?.driver?.totalTrips ?? 0} trips</Text>
                  </View>
                </View>
                <View style={styles.vehicleInfo}>
                  <Text variant="label">{trip?.vehicle?.plate ?? '—'}</Text>
                  <Text variant="caption" color={colors.onSurfaceVariant}>
                    {trip?.vehicle?.color} {trip?.vehicle?.make}
                  </Text>
                </View>
              </View>}

              {/* Seat occupancy bar */}
              <MotiView
                from={{ opacity: 0, translateY: 10 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 65 }}
              >
                <SeatBar
                  total={trip?.totalSeats ?? 10}
                  confirmed={occupiedSeats}
                  pending={0}
                />
              </MotiView>

              {/* Fare */}
              <MotiView
                from={{ opacity: 0, translateY: 10 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 80 }}
                style={styles.fareSection}
              >
                <AnimatedFareText value={computedFare ?? trip?.fare ?? 0} variant="fareLarge" />
                <Text variant="caption" color={colors.onSurfaceVariant}>
                  per seat · drops as more join
                </Text>
                <View style={styles.fareBreakdown}>
                  <FareRow label="Base fare" value={formatCurrency(computedFare ?? trip?.fare ?? 0)} />
                  <View style={styles.fareDivider} />
                  <FareRow label="Total" value={formatCurrency(computedFare ?? trip?.fare ?? 0)} bold />
                </View>
              </MotiView>

              {/* Book CTA */}
              <MotiView
                from={{ opacity: 0, translateY: 20 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 100 }}
                style={styles.ctaSection}
              >
                <Button
                  label={`Book This Seat · ${computedFare != null ? formatCurrency(computedFare) : trip ? formatCurrency(trip.fare) : '...'}`}
                  onPress={() => router.push(`/ride/${id}/seat` as any)}
                  loading={bookTrip.isPending}
                />
                <Pressable
                  style={styles.inviteButton}
                  onPress={() => router.push(`/ride/${id}/invite` as any)}
                >
                  <Ionicons name="people-outline" size={18} color={colors.secondary} />
                  <Text variant="label" color={colors.secondary}>Book & invite my group</Text>
                </Pressable>
              </MotiView>
            </>
          )}
        </BottomSheetScrollView>
      </BottomSheet>
    </View>
  );
}

function MetaPill({ icon, label }: { icon: any; label: string }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.metaPill}>
      <Ionicons name={icon} size={12} color={colors.onSurfaceVariant} />
      <Text variant="caption" color={colors.onSurfaceVariant}>{label}</Text>
    </View>
  );
}

function FareRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.fareRow}>
      <Text variant={bold ? 'label' : 'bodySmall'} color={bold ? colors.onSurface : colors.onSurfaceVariant}>
        {label}
      </Text>
      <Text variant={bold ? 'label' : 'bodySmall'} color={bold ? colors.primary : colors.onSurfaceVariant}>
        {value}
      </Text>
    </View>
  );
}


const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundDeep },
  backButton: {
    position: 'absolute',
    left: spacing['2xl'],
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  sheetBackground: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii['3xl'],
    borderTopRightRadius: radii['3xl'],
  },
  sheetHandle: { backgroundColor: colors.outline, width: 40, height: 4 },
  sheetContent: { paddingHorizontal: spacing['2xl'], paddingBottom: spacing['3xl'], gap: spacing.base },
  routeHeader: { marginBottom: spacing.sm },
  routeHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  metaRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surfaceContainer,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.full,
  },
  driverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.xl,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    gap: spacing.md,
  },
  driverAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverInfo: { flex: 1 },
  ratingRow: { flexDirection: 'row', marginTop: 2 },
  vehicleInfo: { alignItems: 'flex-end' },
  seatSection: { gap: spacing.sm },
  seatHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  seatBar: {
    height: 6,
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: 3,
    overflow: 'hidden',
  },
  seatBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  fareSection: { alignItems: 'center', paddingVertical: spacing.base },
  fareAmount: { marginBottom: spacing.xs },
  fareBreakdown: {
    width: '100%',
    marginTop: spacing.base,
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.xl,
    padding: spacing.base,
    gap: spacing.sm,
  },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between' },
  fareDivider: { height: 1, backgroundColor: colors.outlineVariant },
  ctaSection: { gap: spacing.md },
  inviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radii['3xl'],
    borderWidth: 1.5,
    borderColor: colors.secondary,
  },
  markerOrigin: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.backgroundDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.backgroundDeep },
  markerDestination: {},
  tierRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  tierChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    height: 44,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceContainer,
    borderWidth: 1.5,
    borderColor: colors.outlineVariant,
  },
  tierChipIcon: {
    fontSize: 16,
  },
});
