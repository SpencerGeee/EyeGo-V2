import React, { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { View, StyleSheet, Pressable, Image, ScrollView } from 'react-native';
import MapboxGL from '../../utils/mapbox';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { MotiView } from 'moti';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { tripsApi, queryKeys } from '@eyego/api';
import { useRideStore } from '../../stores/ride.store';
import { useAuthStore } from '../../stores/auth.store';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts, fontSizes, spacing, radii, shadows, withOpacity } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import eyegoDarkStyle from '@eyego/map-styles';
import { Text, Button, Card, DriverInfoCard, SeatBar, AnimatedFareText, Skeleton, Loader, MorphTarget, useMorph } from '@eyego/ui';

// MapLibre RN expects a JSON string via styleJSON, not a style object.
const EYEGO_MAP_STYLE = JSON.stringify(eyegoDarkStyle);
import { formatCurrency, formatTripDate, formatDuration, formatDistance } from '@eyego/utils';
import { FareBreakdownSheet } from '../../components/FareBreakdownSheet';


// Emoji tier marks replaced with Ionicons (vector) for consistent, crisp icons.
const TIERS = [
  { key: 'ECONOMY', label: 'Economy', icon: 'leaf' },
  { key: 'COMFORT', label: 'Comfort', icon: 'sparkles' },
] as const;
type TierKey = typeof TIERS[number]['key'];

export default function RideDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id, tier: tierParam, group } = useLocalSearchParams<{ id: string; tier?: string; group?: string }>();
  const isGroupFlow = group === '1';
  const router = useRouter();
  const { morphBack } = useMorph();
  // Reverse the container-transform back into the originating card. Falls back
  // to a plain pop when no morph is in flight (deep link / no source measured).
  const handleBack = useCallback(() => {
    morphBack(() => router.back());
  }, [morphBack, router]);
  const { user } = useAuthStore();
  const { selectedTrip, setSelectedTrip, activeBooking, origin, destination, setSelectedTier: setStoreTier, computedFare } = useRideStore();
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['58%', '85%'], []);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [selectedTier, setSelectedTier] = useState<TierKey>(
    (tierParam?.toUpperCase() as TierKey) ?? 'ECONOMY'
  );
  const [showFareBreakdown, setShowFareBreakdown] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.rides.detail(id ?? ''),
    queryFn: () => tripsApi.getById(id ?? ''),
    enabled: !!id,
  });

  // Lock tier once we get the trip data — rider can't change it from what the driver set
  const tripTier = ((data?.data?.data as any)?.trip?.tier as TierKey | undefined);

  const trip = useMemo(() => {
    const rawTrip = (data?.data?.data as any)?.trip;
    if (!rawTrip) {
      // Return undefined while loading so we don't render stale/fake data
      return undefined;
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
    const rawTrip = (data?.data?.data as any)?.trip;
    if (rawTrip?.bookings && user?.id) {
      return rawTrip.bookings.some((b: any) => b.userId === user.id);
    }
    return activeBooking?.tripId === id;
  }, [data, user, activeBooking, id]);

  useEffect(() => {
    if (isAlreadyBooked && id) {
      router.replace(`/ride/${id}/tracking` as Href);
    }
  }, [isAlreadyBooked, id, router]);

  useEffect(() => {
    if (trip && selectedTrip?.id !== trip.id) {
      setSelectedTrip(trip);
    }
  }, [trip, selectedTrip, setSelectedTrip]);

  useEffect(() => {
    if (!trip) return;
    // Lock selectedTier to the trip's tier once data loads
    if (tripTier && tripTier !== selectedTier) {
      setSelectedTier(tripTier);
    }
    const serverFare = trip.farePerSeat ?? trip.fare ?? 0;
    setStoreTier(selectedTier, serverFare);
  }, [selectedTier, trip, tripTier, setStoreTier]);

  const occupiedSeats = trip ? (trip.totalSeats ?? 10) - (trip.availableSeats ?? 0) : 0;
  const occupancyPercent = trip ? (occupiedSeats / (trip.totalSeats ?? 10)) * 100 : 0;

  // Show loading spinner while trip data is not yet available
  if (isLoading && !trip) {
    return (
      <MorphTarget id={`ride-card-${id}`} borderRadius={0} style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' }}>
          <Loader label="Loading your ride…" />
        </View>
      </MorphTarget>
    );
  }

  // API failed or trip not found — show a proper error state instead of crashing
  if (!isLoading && !trip) {
    return (
      <View style={{ flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
        <Ionicons name="car-outline" size={48} color={colors.onSurfaceVariant} />
        <Text variant="titleSmall" style={{ color: colors.onSurface, marginTop: 16, textAlign: 'center' }}>
          Trip not found
        </Text>
        <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ textAlign: 'center', marginTop: 8, lineHeight: 20 }}>
          This ride may have been cancelled or the link is invalid.
        </Text>
        <Button
          label="Go back"
          variant="secondary"
          onPress={() => router.back()}
          style={{ marginTop: 24 }}
        />
      </View>
    );
  }

  return (
    <MorphTarget id={`ride-card-${id}`} borderRadius={0} style={{ flex: 1 }}>
    <View style={styles.container}>
      {/* Map background */}
      <MapboxGL.MapView
        style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.backgroundDeep }]}
        styleJSON={EYEGO_MAP_STYLE}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        rotateEnabled={false}
        scaleBarEnabled={false}
      >
        {trip?.origin && trip?.destination && (
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
        )}
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
        style={[styles.backButton, { top: insets.top + 12 }]}
        onPress={handleBack}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        accessibilityRole="button"
        accessibilityLabel="Go back"
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
                  <Ionicons
                    name={t.icon}
                    size={16}
                    color={isActive ? colors.onPrimary : colors.onSurfaceVariant}
                    style={styles.tierChipIcon}
                  />
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
                  driver={trip?.driver}
                  vehicle={trip?.vehicle}
                  showActions={false}
                  premium
                />
              </MotiView>


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
                <AnimatedFareText value={computedFare ?? trip?.farePerSeat ?? 0} variant="fareLarge" shiny />
                <Text variant="caption" color={colors.onSurfaceVariant}>
                  per seat · drops as more join
                </Text>
                <View style={styles.fareBreakdown}>
                  <FareRow label="Base fare" value={formatCurrency(computedFare ?? trip?.farePerSeat ?? 0)} />
                  <View style={styles.fareDivider} />
                  <FareRow label="Total" value={formatCurrency(computedFare ?? trip?.farePerSeat ?? 0)} bold />
                </View>
                {/* Tappable link → full per-trip price breakdown sheet */}
                <Pressable
                  onPress={() => setShowFareBreakdown(true)}
                  style={styles.fareDetailsLink}
                  accessibilityRole="button"
                  accessibilityLabel="View full price breakdown"
                >
                  <Ionicons name="receipt-outline" size={15} color={colors.primary} />
                  <Text variant="label" color={colors.primary}>View price breakdown</Text>
                  <Ionicons name="chevron-forward" size={14} color={colors.primary} />
                </Pressable>
              </MotiView>

              {/* Book CTA */}
              <MotiView
                from={{ opacity: 0, translateY: 20 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 100 }}
                style={styles.ctaSection}
              >
                <Button
                  label={`Book This Seat · ${computedFare != null ? formatCurrency(computedFare) : trip ? formatCurrency(trip.farePerSeat ?? 0) : '...'}`}
                  onPress={() => router.push(`/ride/${id}/seat` as Href)}
                  accessibilityRole="button"
                  accessibilityLabel={`Book this seat for ${computedFare != null ? formatCurrency(computedFare) : trip ? formatCurrency(trip.farePerSeat ?? 0) : 'loading'}`}
                />
                {isGroupFlow && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                    <Ionicons name="people" size={14} color={colors.secondary} />
                    <Text variant="caption" color={colors.secondary}>
                      Group ride — book and share the invite link with your group
                    </Text>
                  </View>
                )}
                <Pressable
                  style={[styles.inviteButton, isGroupFlow && { backgroundColor: colors.secondary + '14', borderWidth: 1.5 }]}
                  onPress={() => router.push(`/ride/${id}/invite` as Href)}
                  accessibilityRole="button"
                  accessibilityLabel="Book and invite my group"
                >
                  <Ionicons name="people-outline" size={18} color={colors.secondary} />
                  <Text variant="label" color={colors.secondary}>Book & invite my group</Text>
                </Pressable>
                <Pressable
                  style={[styles.inviteButton, { borderColor: colors.outlineVariant }]}
                  onPress={() => router.push(`/ride/${id}/guest-selection` as Href)}
                  accessibilityRole="button"
                  accessibilityLabel="Book for someone else"
                >
                  <Ionicons name="person-add-outline" size={18} color={colors.onSurfaceVariant} />
                  <Text variant="label" color={colors.onSurfaceVariant}>Book for someone else</Text>
                </Pressable>
              </MotiView>
            </>
          )}
        </BottomSheetScrollView>
      </BottomSheet>

      <FareBreakdownSheet
        visible={showFareBreakdown}
        onClose={() => setShowFareBreakdown(false)}
        fare={computedFare ?? trip?.farePerSeat ?? 0}
        seats={trip?.maxSeats ?? 4}
        surge={!!((trip as any)?.surgeMultiplier && (trip as any).surgeMultiplier > 1)}
      />
    </View>
    </MorphTarget>
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
  container: { flex: 1, backgroundColor: 'transparent' },
  backButton: {
    position: 'absolute',
    left: spacing['2xl'],
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: withOpacity(colors.surfaceCard, 0.8),
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    borderWidth: 1,
    borderColor: colors.rimLight,
  },
  sheetBackground: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii['4xl'],
    borderTopRightRadius: radii['4xl'],
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
  fareDetailsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingVertical: spacing.xs,
  },
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
    borderColor: colors.rimLight,
  },
  tierChipIcon: {
    fontSize: 16,
    lineHeight: 21,
  },
});
