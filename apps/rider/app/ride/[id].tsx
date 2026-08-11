import React, { useMemo, useEffect, useState, useCallback, useRef } from 'react';
import { View, StyleSheet, Pressable, Image, ScrollView } from 'react-native';
import MapboxGL from '../../utils/mapbox';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { MotiView } from '@eyego/ui';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { tripsApi, queryKeys } from '@eyego/api';
import { useRideStore } from '../../stores/ride.store';
import { useAuthStore } from '../../stores/auth.store';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts, fontSizes, spacing, radii, shadows, withOpacity, springs } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { eyegoDarkStyle, eyegoLightStyle } from '@eyego/map-styles';
import { useThemeStore } from '../../stores/theme.store';
import { Text, Button, Card, DriverInfoCard, SeatBar, AnimatedFareText, Skeleton, Loader, MorphTarget, MorphBackSwipeDetector, useMorph, InlayPanel } from '@eyego/ui';

import { formatGhs, formatTripDate, formatDuration, formatDistance } from '@eyego/utils';
import { FareBreakdownSheet } from '../../components/FareBreakdownSheet';
import { fetchRoute, type RouteResult } from '../../utils/routing';


// Fallback camera center (Accra) — same value used by the map-pin picker.
// MapLibre's native camera sets its INITIAL position during the very first
// layoutSubviews pass, before fitBounds()'s useEffect below ever runs. A
// <Camera> with no centerCoordinate/defaultSettings at all left that first
// native layout with no valid coordinate to seed from, and MapLibre threw an
// uncaught C++ exception (SIGABRT, confirmed via on-device crash report —
// -[MLRNCamera _setInitialCamera] -> -[CameraUpdateItem _moveCamera:...]),
// killing the app the instant this screen mounted for ANY trip.
const CAMERA_FALLBACK_CENTER: [number, number] = [-0.187, 5.6037];

// Emoji tier marks replaced with Ionicons (vector) for consistent, crisp icons.
const TIERS = [
  { key: 'ECONOMY', label: 'Economy', icon: 'leaf' },
  { key: 'COMFORT', label: 'Comfort', icon: 'sparkles' },
] as const;
type TierKey = typeof TIERS[number]['key'];

export default function RideDetailScreen() {
  const colors = useColors();
  const isDark = useThemeStore((s) => s.isDark);
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
  const { selectedTrip, setSelectedTrip, activeBooking, origin, destination, setSelectedTier: setStoreTier, computedFare, guestInfo } = useRideStore();
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
      // BUGFIX: previously defaulted missing route coordinates to (0,0) — the
      // Gulf of Guinea — and rendered it as a real pickup/destination pin
      // since `trip?.origin` / `trip?.destination` are always truthy objects.
      // Keep lat/lng null when the route genuinely has no coordinates so the
      // marker/camera/route-line guards below (trip?.origin?.longitude etc.)
      // correctly skip rendering instead of showing a fabricated point.
      origin: {
        address: rawTrip.route?.originName ?? 'Origin',
        latitude: typeof rawTrip.route?.originLat === 'number' ? rawTrip.route.originLat : null,
        longitude: typeof rawTrip.route?.originLng === 'number' ? rawTrip.route.originLng : null,
      },
      destination: {
        address: rawTrip.route?.destinationName ?? 'Destination',
        latitude: typeof rawTrip.route?.destLat === 'number' ? rawTrip.route.destLat : null,
        longitude: typeof rawTrip.route?.destLng === 'number' ? rawTrip.route.destLng : null,
      },
      /**
       * Server-computed. This used to recount `bookings.length` locally, which
       * was a fourth independent formula for the same question and disagreed
       * with the home card and the join page the moment a seat was held but
       * unpaid — exactly what sharing an invite does. `getTrip` now derives it
       * once from the occupancy-filtered bookings; the fallback keeps an older
       * server from rendering NaN.
       */
      availableSeats: rawTrip.availableSeats ?? Math.max(0, rawTrip.maxSeats - (rawTrip.bookings?.length ?? 0)),
      totalSeats: rawTrip.maxSeats,
      distanceKm: rawTrip.route?.distanceKm ?? 0,
      // Duration comes from the traffic-aware route fetched below (see
      // `roadRoute`). The old inline `distanceKm * 1.8` was a fixed 33 km/h
      // free-flow guess that ignored congestion entirely, and it silently
      // reported "15 min" for any trip whose distance was missing.
      durationMinutes: rawTrip.route?.durationMin ?? null,
    };
  }, [data, id, origin, destination]);

  /**
   * Real road route between pickup and destination.
   *
   * The map used to draw a two-point LineString, i.e. a straight line across
   * whatever lay between the pins — buildings, water, the wrong side of a
   * motorway — which is not a route a rider can sanity-check. `fetchRoute` goes
   * through `/v1/geo/route` (Mapbox `driving-traffic`, then OSRM, then a
   * distance estimate), so we get road-following geometry AND a congestion-aware
   * duration from the same call.
   */
  const [roadRoute, setRoadRoute] = useState<RouteResult | null>(null);
  const originLng = trip?.origin?.longitude ?? null;
  const originLat = trip?.origin?.latitude ?? null;
  const destLng = trip?.destination?.longitude ?? null;
  const destLat = trip?.destination?.latitude ?? null;

  useEffect(() => {
    if (originLng == null || originLat == null || destLng == null || destLat == null) {
      setRoadRoute(null);
      return;
    }
    let cancelled = false;
    fetchRoute([originLng, originLat], [destLng, destLat]).then((r) => {
      // A failed lookup leaves `roadRoute` null and the straight-line fallback
      // below takes over, rather than blanking the route entirely.
      if (!cancelled && r && r.coordinates.length >= 2) setRoadRoute(r);
    });
    return () => { cancelled = true; };
  }, [originLng, originLat, destLng, destLat]);

  /** Traffic-aware minutes, preferring the live route over the stored value. */
  const durationMinutes = roadRoute
    ? Math.max(1, Math.round(roadRoute.durationMin))
    : (trip?.durationMinutes ?? null);

  const isAlreadyBooked = useMemo(() => {
    const rawTrip = (data?.data?.data as any)?.trip;
    if (rawTrip?.bookings && user?.id) {
      return rawTrip.bookings.some((b: any) => b.userId === user.id);
    }
    return activeBooking?.tripId === id;
  }, [data, user, activeBooking, id]);

  useEffect(() => {
    if (isAlreadyBooked && id) {
      router.replace('/trip?stage=assigned' as Href);
    }
  }, [isAlreadyBooked, id, router]);

  useEffect(() => {
    if (trip && selectedTrip?.id !== trip.id) {
      setSelectedTrip(trip);
    }
  }, [trip, selectedTrip, setSelectedTrip]);

  // MapboxGL.Camera has no declarative `bounds` prop (only an imperative
  // fitBounds via ref) — frame origin+destination here instead.
  const cameraRef = useRef<any>(null);
  useEffect(() => {
    // trip.origin/destination are always truthy objects (see the trip memo
    // above) — check the actual coordinates, not object presence, or a route
    // with no real coordinates would fitBounds to (undefined, undefined).
    if (trip?.origin?.latitude == null || trip?.origin?.longitude == null) return;
    if (trip?.destination?.latitude == null || trip?.destination?.longitude == null) return;
    cameraRef.current?.fitBounds(
      [
        [trip.origin.longitude, trip.origin.latitude],
        [trip.destination.longitude, trip.destination.latitude],
      ],
      { top: 80, bottom: 380, left: 40, right: 40 },
      false,
    );
  }, [trip?.origin?.longitude, trip?.origin?.latitude, trip?.destination?.longitude, trip?.destination?.latitude]);

  useEffect(() => {
    if (!trip) return;
    // Lock selectedTier to the trip's tier once data loads
    if (tripTier && tripTier !== selectedTier) {
      setSelectedTier(tripTier);
    }
    const serverFare = trip.farePerSeatPesewas ?? trip.fare ?? 0;
    setStoreTier(selectedTier, serverFare);
  }, [selectedTier, trip, tripTier, setStoreTier]);

  // `?? 10` was an invented capacity — a 14-seater rendered as 10 and a 4-seater
  // as 10, and the occupancy bar was wrong in both directions with nothing to
  // show for it. Unknown capacity now yields 0 occupancy rather than a fiction.
  const totalSeats = trip?.totalSeats ?? null;
  const occupiedSeats = totalSeats != null ? totalSeats - (trip?.availableSeats ?? 0) : 0;
  const occupancyPercent = totalSeats ? (occupiedSeats / totalSeats) * 100 : 0;

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
        styleURL={isDark ? eyegoDarkStyle : eyegoLightStyle}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        rotateEnabled={false}
        scaleBarEnabled={false}
      >
        <MapboxGL.Camera
          ref={cameraRef}
          centerCoordinate={CAMERA_FALLBACK_CENTER}
          zoomLevel={12}
          animationMode="none"
          animationDuration={0}
        />
        {/* BUGFIX: trip.origin/destination are always-truthy objects even when
            the route has no real coordinates (see the trip memo above) — guard
            on the actual lat/lng so a missing coordinate renders no pin instead
            of one at (undefined, undefined). */}
        {trip?.origin?.latitude != null && trip?.origin?.longitude != null && (
          <MapboxGL.MarkerView coordinate={[trip.origin.longitude, trip.origin.latitude]}>
            <View style={styles.markerOrigin}>
              <View style={styles.markerDot} />
            </View>
          </MapboxGL.MarkerView>
        )}
        {trip?.destination?.latitude != null && trip?.destination?.longitude != null && (
          <MapboxGL.MarkerView coordinate={[trip.destination.longitude, trip.destination.latitude]}>
            <View style={styles.markerDestination}>
              <Ionicons name="location" size={20} color={colors.secondary} />
            </View>
          </MapboxGL.MarkerView>
        )}
        {trip?.origin?.latitude != null && trip?.origin?.longitude != null &&
         trip?.destination?.latitude != null && trip?.destination?.longitude != null && (
          <MapboxGL.ShapeSource
            id="routeLine"
            shape={{
              type: 'Feature',
              geometry: {
                type: 'LineString',
                // Road geometry when we have it; the straight line survives only
                // as the "route service unreachable" fallback, and is drawn
                // dashed (below) so it never passes for a real route.
                coordinates: roadRoute?.coordinates ?? [
                  [trip.origin.longitude, trip.origin.latitude],
                  [trip.destination.longitude, trip.destination.latitude],
                ],
              },
              properties: {},
            }}
          >
            {/* Casing under the route so it stays legible over any road colour —
                the same treatment Uber/Bolt use. */}
            <MapboxGL.LineLayer
              id="routeLineCasing"
              style={{
                lineColor: colors.backgroundDeep,
                lineWidth: roadRoute ? 11 : 5,
                lineOpacity: roadRoute ? 0.9 : 0,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <MapboxGL.LineLayer
              id="routeLineLayer"
              style={{
                lineColor: colors.primary,
                lineWidth: roadRoute ? 6 : 3,
                lineCap: 'round',
                lineJoin: 'round',
                ...(roadRoute ? {} : { lineDasharray: [2, 1] }),
              }}
            />
          </MapboxGL.ShapeSource>
        )}
      </MapboxGL.MapView>

      {/* Swipe-back area (map layer only — matches Yango's pull-on-top pattern) */}
      {/* Swipe-back zone (top 80px only — map area preserved for interaction) */}
      <MorphBackSwipeDetector style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 80, zIndex: 10 }}>
        <View style={{ flex: 1 }} />
      </MorphBackSwipeDetector>

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

      {/* Bottom sheet — InlayPanel uses the same usePanelMotion engine as PanelSheet,
          same spring constants, no gorhom dependency. */}
      <InlayPanel
        snapPointsPct={[0.58, 0.85]}
        sheetStyle={styles.sheetBackground}
        grabberColor={colors.outline}
      >
        <View style={styles.sheetContent}>
          {/* Tier selector */}
          <MotiView
            from={{ opacity: 0, translateY: -6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', ...springs.snappy }}
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
                transition={{ type: 'spring', ...springs.snappy }}
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
                  <MetaPill icon="speedometer-outline" label={durationMinutes ? formatDuration(durationMinutes) : '—'} />
                </View>
              </MotiView>

              {/* Driver card */}
              <MotiView
                from={{ opacity: 0, translateY: 10 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: 'spring', ...springs.snappy, delay: 40 }}
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
                transition={{ type: 'spring', ...springs.snappy, delay: 65 }}
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
                transition={{ type: 'spring', ...springs.snappy, delay: 80 }}
                style={styles.fareSection}
              >
                <AnimatedFareText pesewas={computedFare ?? trip?.farePerSeatPesewas ?? 0} variant="fareLarge" shiny />
                <Text variant="caption" color={colors.onSurfaceVariant}>
                  per seat · drops as more join
                </Text>
                <View style={styles.fareBreakdown}>
                  <FareRow label="Base fare" value={formatGhs(computedFare ?? trip?.farePerSeatPesewas ?? 0)} />
                  <View style={styles.fareDivider} />
                  <FareRow label="Total" value={formatGhs(computedFare ?? trip?.farePerSeatPesewas ?? 0)} bold />
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
                transition={{ type: 'spring', ...springs.snappy, delay: 100 }}
                style={styles.ctaSection}
              >
                <Button
                  label={`Book This Seat · ${computedFare != null ? formatGhs(computedFare) : trip ? formatGhs(trip.farePerSeatPesewas ?? 0) : '...'}`}
                  onPress={() => router.push(`/ride/${id}/seat` as Href)}
                  accessibilityRole="button"
                  accessibilityLabel={`Book this seat for ${computedFare != null ? formatGhs(computedFare) : trip ? formatGhs(trip.farePerSeatPesewas ?? 0) : 'loading'}`}
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
                {/* BUGFIX ("I enter the guest's name and phone and just get sent
                    back with nothing showing it worked"): the guest details were
                    being saved to the ride store correctly, but NOTHING in the
                    booking flow ever rendered them — the screen this returns to
                    looked byte-for-byte identical afterwards, so a successful
                    save was indistinguishable from a silent failure. Reflect the
                    stored guest here, and let it be changed or cleared. */}
                <Pressable
                  style={[
                    styles.inviteButton,
                    { borderColor: guestInfo ? colors.primary : colors.outlineVariant },
                    guestInfo && { backgroundColor: withOpacity(colors.primary, 0.08) },
                  ]}
                  onPress={() => router.push('/ride/guest-selection' as Href)}
                  accessibilityRole="button"
                  accessibilityLabel={guestInfo ? `Booking for ${guestInfo.name}. Change passenger` : 'Book for someone else'}
                >
                  <Ionicons
                    name={guestInfo ? 'person-circle' : 'person-add-outline'}
                    size={18}
                    color={guestInfo ? colors.primary : colors.onSurfaceVariant}
                  />
                  <Text variant="label" color={guestInfo ? colors.primary : colors.onSurfaceVariant}>
                    {guestInfo ? `Booking for ${guestInfo.name}` : 'Book for someone else'}
                  </Text>
                </Pressable>
              </MotiView>
            </>
          )}
        </View>
      </InlayPanel>

      <FareBreakdownSheet
        visible={showFareBreakdown}
        onClose={() => setShowFareBreakdown(false)}
        farePesewas={computedFare ?? trip?.farePerSeatPesewas ?? 0}
        // `?? 4` invented a seat count in the PRICE BREAKDOWN, which is the one
        // sheet whose entire job is explaining how the number was reached.
        seats={trip?.maxSeats ?? trip?.totalSeats ?? 0}
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
  fareAmountPesewas: { marginBottom: spacing.xs },
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
