import React, { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { View, StyleSheet, Pressable, Alert, Animated, AppState, AppStateStatus, RefreshControl, Image } from 'react-native';
import { BlurView } from 'expo-blur';
import * as Location from 'expo-location';
import MapboxGL from '../../../utils/mapbox';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import * as KeepAwake from 'expo-keep-awake';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { socketEvents, connectSocket, disconnectSocket, tripsApi, bookingsApi } from '@eyego/api';
import { useRideStore } from '../../../stores/ride.store';
import { fonts, fontSizes, spacing, radii, withOpacity } from '@eyego/config';
import { useColors, Colors } from '../../../utils/useColors';
import { Text } from '@eyego/ui';
import { formatDuration, formatCurrency } from '@eyego/utils';
import eyegoDarkStyle from '@eyego/map-styles';
import { shareLiveTracking } from '../../../utils/safety';
import { haptic } from '../../../utils/haptics';

// MapLibre RN expects a JSON string via styleJSON, not a style object.
const EYEGO_MAP_STYLE = JSON.stringify(eyegoDarkStyle);

function useLocationInterpolation(targetCoords: { latitude: number; longitude: number; heading?: number } | null) {
  const [coords, setCoords] = useState(targetCoords);
  const animRef = useRef<any>(null);
  const lastTargetRef = useRef<{ lat: number; lng: number; heading: number } | null>(null);
  // Keep a ref to the latest rendered coords so the effect closure never goes stale.
  const coordsRef = useRef(coords);
  coordsRef.current = coords;

  useEffect(() => {
    if (!targetCoords) return;
    const targetLat = targetCoords.latitude;
    const targetLng = targetCoords.longitude;
    const targetHeading = targetCoords.heading ?? 0;

    // Prevent re-triggering animation if target coordinates are effectively the same
    // (within 5 decimal places ≈ ~1m at the equator). This avoids restarting the
    // interpolation loop when the store emits the same location with a new object ref.
    const prev = lastTargetRef.current;
    if (
      prev &&
      Math.abs(prev.lat - targetLat) < 0.00001 &&
      Math.abs(prev.lng - targetLng) < 0.00001 &&
      Math.abs(prev.heading - targetHeading) < 1
    ) {
      return;
    }
    lastTargetRef.current = { lat: targetLat, lng: targetLng, heading: targetHeading };

    const currentCoords = coordsRef.current;
    if (!currentCoords) {
      setCoords(targetCoords);
      return;
    }

    const startLat = currentCoords.latitude;
    const startLng = currentCoords.longitude;
    const startHeading = currentCoords.heading ?? 0;

    const startTime = Date.now();
    const duration = 3500; // 3.5 seconds match the socket interval

    if (animRef.current) cancelAnimationFrame(animRef.current);

    const animate = () => {
      const now = Date.now();
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Lerp latitude and longitude
      const currentLat = startLat + (targetLat - startLat) * progress;
      const currentLng = startLng + (targetLng - startLng) * progress;

      // Interpolate heading (shortest path)
      let diff = targetHeading - startHeading;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      const currentHeading = startHeading + diff * progress;

      setCoords({
        latitude: currentLat,
        longitude: currentLng,
        heading: (currentHeading + 360) % 360,
      });

      if (progress < 1) {
        animRef.current = requestAnimationFrame(animate);
      }
    };

    animRef.current = requestAnimationFrame(animate);

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [
    targetCoords?.latitude,
    targetCoords?.longitude,
    targetCoords?.heading,
  ]);

  return coords;
}

export default function TrackingScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { selectedTrip, activeBooking, driverLocation, tripEta, setDriverLocation, setTripEta } = useRideStore();

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['trip', id] }),
        queryClient.invalidateQueries({ queryKey: ['bookings', 'active'] }),
        queryClient.invalidateQueries({ queryKey: ['bookings', 'active-tracking'] }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [id, queryClient]);

  const { data: tripData } = useQuery({
    queryKey: ['trip', id],
    queryFn: () => tripsApi.getById(id ?? ''),
    enabled: !!id,
    staleTime: 0,
    refetchOnMount: true,
  });

  // Fetch active booking from API so bookingId is always available for rating,
  // even if the rider navigated here from the Trips tab (store may be empty).
  const { data: apiActiveBooking } = useQuery({
    queryKey: ['bookings', 'active-tracking'],
    queryFn: () => bookingsApi.getActive(),
    select: (r) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (r.data as any)?.data;
      return (raw?.booking ?? raw) ?? null;
    },
    staleTime: 30_000,
    refetchOnMount: true,
  });

  // Track mount state so delayed callbacks don't act after unmount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Capture bookingId early (while trip is still active) into a stable ref.
  // By the time COMPLETED fires, getActive() returns null — the ref keeps the ID.
  const capturedBookingIdRef = useRef<string>('');
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const id = activeBooking?.id ?? (apiActiveBooking as any)?.id ?? '';
    if (id && !capturedBookingIdRef.current) {
      capturedBookingIdRef.current = id;
    }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }, [activeBooking?.id, (apiActiveBooking as any)?.id]);

  // Prefer fresh API data over potentially stale Zustand selectedTrip
  const syncedTrip = useMemo(() => {
    return (tripData?.data?.data as any)?.trip ?? selectedTrip;
  }, [selectedTrip, tripData]);

  const trip = useMemo(() => {
    if (!syncedTrip) return null;
    return {
      ...syncedTrip,
      origin: {
        address: syncedTrip.route?.originName ?? 'Origin',
        latitude: syncedTrip.route?.originLat ?? 5.6037,
        longitude: syncedTrip.route?.originLng ?? -0.187,
      },
      destination: {
        address: syncedTrip.route?.destinationName ?? 'Destination',
        latitude: syncedTrip.route?.destLat ?? 5.65,
        longitude: syncedTrip.route?.destLng ?? -0.19,
      },
    };
  }, [syncedTrip]);

  const passengerPickupCoord: [number, number] = useMemo(() => {
    if (trip?.origin && trip.origin.longitude && trip.origin.latitude) {
      return [trip.origin.longitude, trip.origin.latitude];
    }
    return [-0.187, 5.6037];
  }, [trip?.origin?.longitude, trip?.origin?.latitude]);

  const destCoord: [number, number] = useMemo(() => {
    if (trip?.destination?.longitude && trip?.destination?.latitude) {
      return [trip.destination.longitude, trip.destination.latitude];
    }
    return [-0.19, 5.65];
  }, [trip?.destination?.longitude, trip?.destination?.latitude]);

  // Trip phase determines routing direction
  const tripInProgress = syncedTrip?.status === 'IN_PROGRESS';

  // Driver location with interpolation — seed from DB coords so marker shows immediately.
  const driverDbLat = syncedTrip?.driver?.currentLat ?? 5.61;
  const driverDbLng = syncedTrip?.driver?.currentLng ?? -0.187;
  const fallbackCoordRef = useRef({ latitude: driverDbLat, longitude: driverDbLng, heading: 0 });
  useEffect(() => { fallbackCoordRef.current = { latitude: driverDbLat, longitude: driverDbLng, heading: 0 }; }, [driverDbLat, driverDbLng]);
  const currentDriverCoord = driverLocation ?? fallbackCoordRef.current;
  const animatedDriverCoord = useLocationInterpolation(currentDriverCoord);

  // Rider's own GPS — used for pre-trip routing (rider → pickup)
  const [riderLocation, setRiderLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  useEffect(() => {
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      .then(pos => setRiderLocation(pos.coords))
      .catch(() => {});
  }, []);

  // OSRM road-following route.
  // Pre-trip: rider GPS → pickup  (so rider knows how to get there)
  // In-trip:  driver GPS → destination  (live trip tracking)
  const routeFetchedRef = useRef(false);
  useEffect(() => {
    if (routeFetchedRef.current) return;
    const origin: [number, number] | null = tripInProgress
      ? [animatedDriverCoord?.longitude ?? 0, animatedDriverCoord?.latitude ?? 0]
      : riderLocation
        ? [riderLocation.longitude, riderLocation.latitude]
        : null;
    const target: [number, number] = tripInProgress ? destCoord : passengerPickupCoord;
    if (!origin || isNaN(origin[0]) || isNaN(origin[1])) return;

    routeFetchedRef.current = true;
    fetch(
      `https://router.project-osrm.org/route/v1/driving/${origin[0]},${origin[1]};${target[0]},${target[1]}?overview=full&geometries=geojson`
    )
      .then(r => r.json())
      .then(data => {
        const route = data?.routes?.[0];
        if (!route) return;
        const coords: [number, number][] = route.geometry?.coordinates ?? [];
        const durationSec: number = route.duration ?? 0;
        if (coords.length >= 2) setRouteCoords(coords);
        if (durationSec > 0) setTripEta(Math.max(1, Math.ceil(durationSec / 60)));
      })
      .catch(() => {});
  }, [
    tripInProgress,
    riderLocation?.longitude,
    riderLocation?.latitude,
    animatedDriverCoord?.longitude,
    animatedDriverCoord?.latitude,
    destCoord[0], destCoord[1],
    passengerPickupCoord[0], passengerPickupCoord[1],
  ]);

  // Reset OSRM fetch flag when trip phase changes (DRIVER_EN_ROUTE → IN_PROGRESS)
  // so the route is re-fetched for the new origin/target pair.
  const prevInProgressRef = useRef(tripInProgress);
  useEffect(() => {
    if (prevInProgressRef.current !== tripInProgress) {
      prevInProgressRef.current = tripInProgress;
      routeFetchedRef.current = false;
      setRouteCoords([]);
    }
  }, [tripInProgress]);

  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['44%', '65%'], []);
  const cameraRef = useRef<any>(null);
  // Guarded setters — only update if the value actually changed to prevent
  // unnecessary re-renders that could cascade into a "Maximum update depth exceeded" loop.
  const [tripStatus, setTripStatus] = useState('Boarding');
  const tripStatusRef = useRef(tripStatus);
  const safeSetTripStatus = useCallback((next: string) => {
    if (next !== tripStatusRef.current) {
      tripStatusRef.current = next;
      setTripStatus(next);
    }
  }, []);
  const [stopsAway, setStopsAway] = useState<number | null>(null);
  const [etaDistanceKm, setEtaDistanceKm] = useState<number | null>(null);
  // Real route polyline from Mapbox Directions — [lng, lat][] pairs
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);

  // In-app status banner
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);
  const bannerAnim = useRef(new Animated.Value(-80)).current;
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showBanner = useCallback((msg: string) => {
    setBannerMsg(msg);
    Animated.spring(bannerAnim, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 6 }).start();
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => {
      Animated.timing(bannerAnim, { toValue: -80, duration: 300, useNativeDriver: true }).start(() => setBannerMsg(null));
    }, 4000);
  }, [bannerAnim]);

  // Ref so the onConnect callback always sees the latest trip (avoids stale closure)
  const syncedTripRef = useRef(syncedTrip);
  useEffect(() => { syncedTripRef.current = syncedTrip; }, [syncedTrip]);

  // Ref so the onTripStatus callback always sees the latest activeBooking (avoids stale closure)
  const activeBookingRef = useRef(activeBooking);
  useEffect(() => { activeBookingRef.current = activeBooking; }, [activeBooking]);

  const handleSOS = () => router.push(`/ride/${id}/sos` as Href);
  const handleChat = () => router.push(`/ride/${id}/chat` as Href);

  // Tier display data
  const tier = ((syncedTrip as any)?.tier as string) ?? 'ECONOMY';
  const TIER_COLORS_MAP: Record<string, string> = {
    ECONOMY: colors.tierEconomy,
    COMFORT: colors.tierComfort,
    PREMIUM: colors.tierPremium,
    ROYAL: colors.tierRoyal,
  };
  const TIER_ICON_MAP: Record<string, keyof typeof Ionicons.glyphMap> = {
    ECONOMY: 'car-outline',
    COMFORT: 'shield-checkmark-outline',
    PREMIUM: 'diamond-outline',
    ROYAL: 'ribbon-outline',
  };
  const tierColor = TIER_COLORS_MAP[tier] ?? colors.primary;
  const tierIcon = TIER_ICON_MAP[tier] ?? 'car-outline';
  const fare = (syncedTrip as any)?.fare ?? (syncedTrip as any)?.baseFare ?? 0;
  const vehicleDisplay = [syncedTrip?.vehicle?.make, syncedTrip?.vehicle?.model].filter(Boolean).join(' ') || 'Your Vehicle';

  KeepAwake.useKeepAwake();

  // BUGFIX: Split into a single useEffect with both appstate handlers merged together
  // and stale-closure-safe callbacks. The previous code had TWO separate
  // AppState.addEventListener('change', ...) subscriptions — both running on every
  // foreground event, doubling API calls and socket joins.
  useEffect(() => {
    const handleAppState = async (nextState: AppStateStatus) => {
      if (nextState !== 'active') return;

      // 1. Stale booking detection
      if (activeBookingRef.current?.id) {
        try {
          const { bookingsApi } = require('@eyego/api');
          const response = await bookingsApi.getActive();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const fresh = (response.data as any)?.data?.booking;
          if (!fresh) {
            showBanner('Trip status changed while you were away');
            setTimeout(() => {
              if (!mountedRef.current) return;
              disconnectSocket();
              router.replace(`/ride/${id}/complete` as Href);
            }, 2000);
          }
        } catch (err) {
          console.warn('[Tracking] AppState booking check failed:', err);
        }
      }

      // 2. Re-join trip room
      if (id) {
        const trip = syncedTripRef.current;
        const driverId = trip?.driverId ?? trip?.driver?.id;
        if (driverId) {
          socketEvents.joinTripRoom(id, driverId);
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppState);
    return () => subscription.remove();
  }, [id, router, showBanner]);

  useEffect(() => {
    // connectSocket is idempotent — safe to call even if already connected
    connectSocket();

    // If socket is already connected (e.g. user navigated away and came back),
    // join the room immediately rather than waiting for the next 'connect' event.
    const trip = syncedTripRef.current;
    const driverId = trip?.driverId ?? trip?.driver?.id;
    if (id && driverId) socketEvents.joinTripRoom(id, driverId);

    const unsubConnect = socketEvents.onConnect(() => {
      // Re-join trip room on every (re)connect so we never miss events
      // after a network blip. syncedTripRef always holds the latest value.
      const trip = syncedTripRef.current;
      const driverId = trip?.driverId ?? trip?.driver?.id;
      if (id && driverId) socketEvents.joinTripRoom(id, driverId);
    });

    const unsubLocation = socketEvents.onDriverLocation((data) => {
      setDriverLocation({ latitude: data.latitude, longitude: data.longitude, heading: data.heading });
      cameraRef.current?.setCamera({
        centerCoordinate: [data.longitude, data.latitude],
        animationDuration: 1000,
      });
    });

    const unsubEta = socketEvents.onTripEta((data) => {
      setTripEta(data.etaMinutes);
      setStopsAway(data.stopsAway ?? null);
      setEtaDistanceKm(data.distanceKm ?? null);
      safeSetTripStatus(data.message);
      if (data.geometry?.coordinates && data.geometry.coordinates.length >= 2) {
        setRouteCoords(data.geometry.coordinates);
      }
    });

    const unsubStatus = socketEvents.onTripStatus((data) => {
      if (data.status === 'COMPLETED') {
        haptic.success();
        showBanner('You have arrived! Rate your trip');
        const completedBookingId =
          capturedBookingIdRef.current || activeBookingRef.current?.id || '';
        setTimeout(() => {
          if (!mountedRef.current) return;
          disconnectSocket();
          router.replace(`/ride/${id}/complete${completedBookingId ? `?bookingId=${completedBookingId}` : ''}` as Href);
        }, 1200);
      } else if (data.status === 'DRIVER_EN_ROUTE') {
        haptic.heavy();
        safeSetTripStatus('Driver on the way');
        showBanner('Your driver has started the trip');
      } else if (data.status === 'IN_PROGRESS') {
        haptic.medium();
        safeSetTripStatus('Trip in progress');
        showBanner('EyeGo has departed — enjoy the ride!');
      } else if (data.status === 'CANCELLED') {
        haptic.warning();
        safeSetTripStatus('Trip cancelled');
        if (!mountedRef.current) return;
        disconnectSocket();
        useRideStore.getState().clearRideState();
        Alert.alert(
          'Trip cancelled',
          'Your driver cancelled this trip. You have not been charged for the ride. Please book another.',
          [{ text: 'OK', onPress: () => router.replace('/(tabs)/home' as Href) }],
          { cancelable: false }
        );
      }
    });

    return () => {
      // Only unsubscribe event handlers — keep the socket CONNECTED so events
      // aren't missed if the user navigates away and comes back mid-trip.
      // disconnectSocket() is called only when the trip reaches COMPLETED above.
      unsubConnect();
      unsubLocation();
      unsubEta();
      unsubStatus();
      if (bannerTimer.current) clearTimeout(bannerTimer.current);
    };
  }, [id, showBanner, setDriverLocation, setTripEta, safeSetTripStatus, setStopsAway, setEtaDistanceKm, setRouteCoords, router]);

  // ── Additional foreground detection for re-joining trip room ──
  // BUGFIX: Removed — now merged into the single AppState handler above to avoid
  // duplicate subscriptions.

  // Re-join trip room once driverId is resolved from async trip data
  // This is separate because syncedTrip loads after the socket connects
  // BUGFIX: Guarded with a ref to prevent double-join on re-renders.
  // Previous code joined unconditionally every time deps changed.
  const joinedRoomRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const driverId = syncedTrip?.driverId ?? syncedTrip?.driver?.id;
    if (!id || !driverId) return;
    if (joinedRoomRef.current === driverId) return; // Already joined for this driver
    joinedRoomRef.current = driverId;
    socketEvents.joinTripRoom(id, driverId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, syncedTrip?.driverId, syncedTrip?.driver?.id]);

  // Driver location with interpolation (declared above in the block)

  return (
    <View style={styles.container}>
      {/* Map */}
      <MapboxGL.MapView
        style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.backgroundDeep }]}
        styleJSON={EYEGO_MAP_STYLE}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        rotateEnabled={false}
        scaleBarEnabled={false}
      >
        <MapboxGL.Camera
          ref={cameraRef}
          centerCoordinate={
            tripInProgress
              ? [animatedDriverCoord!.longitude, animatedDriverCoord!.latitude]
              : passengerPickupCoord
          }
          zoomLevel={13}
          animationMode="none"
          animationDuration={0}
        />
        {/* Rider's current location — use UserLocation for native iOS/Android blue dot that updates automatically */}
        <MapboxGL.UserLocation visible={true} showsUserHeadingIndicator={true} />

        {/* Pickup marker */}
        <MapboxGL.MarkerView coordinate={passengerPickupCoord}>
          <PulseMarker color={colors.secondary} />
        </MapboxGL.MarkerView>

        {/* Driver marker — styled circle with car icon */}
        <MapboxGL.MarkerView coordinate={[animatedDriverCoord!.longitude, animatedDriverCoord!.latitude]}>
          <View style={[styles.driverMarker, { transform: [{ rotate: `${animatedDriverCoord!.heading ?? 0}deg` }] }]}>
            <Ionicons name="car" size={18} color="#fff" />
          </View>
        </MapboxGL.MarkerView>

        {/* Route line — OSRM road-following polyline, straight-line fallback */}
        <MapboxGL.ShapeSource
          id="routeLine"
          shape={{
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: routeCoords.length >= 2
                ? routeCoords
                : tripInProgress
                  ? [[animatedDriverCoord!.longitude, animatedDriverCoord!.latitude], destCoord]
                  : [[animatedDriverCoord!.longitude, animatedDriverCoord!.latitude], passengerPickupCoord],
            },
            properties: {},
          }}
        >
          {/* Subtle shadow beneath the route for depth */}
          <MapboxGL.LineLayer
            id="routeLineShadow"
            style={{
              lineColor: '#000000',
              lineWidth: 7,
              lineOpacity: 0.18,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
          <MapboxGL.LineLayer
            id="routeLineLayer"
            style={{
              lineColor: colors.primary,
              lineWidth: 4,
              lineOpacity: 0.9,
              lineCap: 'round',
              lineJoin: 'round',
            }}
            aboveLayerID="routeLineShadow"
          />
        </MapboxGL.ShapeSource>
      </MapboxGL.MapView>

      {/* Back button */}
      <MotiView
        from={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 50 }}
        style={[styles.homeFloating, { top: insets.top + 12 }]}
      >
        <Pressable onPress={() => router.back()} style={styles.homeFloatingBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </Pressable>
      </MotiView>
      {/* Options button */}
      <MotiView
        from={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 70 }}
        style={[styles.optionsFloating, { top: insets.top + 12 }]}
      >
        <Pressable style={styles.homeFloatingBtn} accessibilityRole="button" accessibilityLabel="Trip options">
          <Ionicons name="ellipsis-vertical" size={20} color={colors.onSurface} />
        </Pressable>
      </MotiView>

      {/* Top overlay — LIVE badge */}
      <View style={[styles.topOverlay, { paddingTop: insets.top + 12 }]}>
        <MotiView
          from={{ opacity: 0, translateY: -6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34 }}
          style={styles.statusChip}
        >
          <MotiView
            from={{ opacity: 0.5 }}
            animate={{ opacity: 1 }}
            transition={{ type: 'timing', duration: 500, loop: true }}
            style={styles.liveDot}
          />
          <Text style={styles.statusText}>LIVE</Text>
        </MotiView>
      </View>

      {/* In-app status banner — prominent toast-style notification */}
      {bannerMsg != null && (
        <Animated.View style={[styles.statusBanner, { top: insets.top + 64, transform: [{ translateY: bannerAnim }] }]}>
          <BlurView intensity={80} tint="dark" style={styles.statusBannerBlur}>
            <MotiView
              from={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 20 }}
              style={styles.statusBannerIcon}
            >
              <Ionicons name="notifications" size={18} color="#050508" />
            </MotiView>
            <View style={{ flex: 1 }}>
              <Text style={styles.statusBannerLabel}>TRIP UPDATE</Text>
              <Text style={styles.statusBannerText}>{bannerMsg}</Text>
            </View>
            <MotiView
              from={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 20, delay: 200 }}
            >
              <Ionicons name="chevron-forward" size={16} color={colors.primary} />
            </MotiView>
          </BlurView>
        </Animated.View>
      )}

      {/* Floating ETA pill — bottom-left of map */}
      {tripEta != null && (
        <MotiView
          from={{ opacity: 0, translateX: -6 }}
          animate={{ opacity: 1, translateX: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34 }}
          style={styles.etaPill}
        >
          <BlurView intensity={60} tint="dark" style={styles.etaPillBlur}>
            <Ionicons name="time-outline" size={14} color={colors.primary} />
            <Text style={styles.etaPillText}>
              {formatDuration(tripEta)} away
            </Text>
          </BlurView>
        </MotiView>
      )}

      {/* Bottom sheet */}
      <BottomSheet
        ref={bottomSheetRef}
        index={0}
        snapPoints={snapPoints}
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.sheetHandle}
        enablePanDownToClose={false}
      >
        <BottomSheetScrollView
          contentContainerStyle={styles.sheetContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {/* Tier badge + fare */}
          <MotiView
            from={{ opacity: 0, translateY: 6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34 }}
            style={styles.sheetHeader}
          >
            <View style={[styles.tierBadge, { borderColor: withOpacity(tierColor, 0.25) }]}>
              <Ionicons name={tierIcon} size={13} color={tierColor} />
              <Text style={[styles.tierLabel, { color: tierColor }]}>{tier}</Text>
            </View>
            <View style={styles.fareBlock}>
              <Text style={styles.fareAmount}>{formatCurrency(fare)}</Text>
              <Text style={styles.fareEstLabel}>Est. total</Text>
            </View>
          </MotiView>

          {/* Vehicle name */}
          <Text style={styles.vehicleName}>{vehicleDisplay}</Text>

          {/* Route card */}
          <MotiView
            from={{ opacity: 0, translateY: 6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 40 }}
            style={styles.routeCard}
          >
            <View style={styles.routeRow}>
              <View style={[styles.routeIcon, { backgroundColor: withOpacity(tierColor, 0.12) }]}>
                <Ionicons name="ellipse" size={10} color={tierColor} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.routeLabel}>Pick-up</Text>
                <Text style={styles.routePlace} numberOfLines={1}>
                  {trip?.origin?.address?.split(',')[0] ?? 'Origin'}
                </Text>
              </View>
            </View>
            <View style={styles.routeDivider} />
            <View style={styles.routeRow}>
              <View style={styles.routeIcon}>
                <Ionicons name="location" size={12} color={colors.onSurfaceVariant} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.routeLabel}>Drop-off</Text>
                <Text style={styles.routePlace} numberOfLines={1}>
                  {trip?.destination?.address?.split(',')[0] ?? 'Destination'}
                </Text>
              </View>
            </View>
          </MotiView>

          {/* Driver row */}
          <MotiView
            from={{ opacity: 0, translateY: 6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 80 }}
            style={styles.driverRow}
          >
            <View style={styles.driverAvatarWrap}>
              {syncedTrip?.driver?.profilePhoto ? (
                <Image source={{ uri: syncedTrip.driver.profilePhoto }} style={styles.driverAvatar} />
              ) : (
                <View style={[styles.driverAvatar, { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceContainerHigh }]}>
                  <Ionicons name="person" size={22} color={colors.onSurfaceVariant} />
                </View>
              )}
              <View style={styles.ratingBadge}>
                <Ionicons name="star" size={9} color={colors.tierPremium} />
                <Text style={styles.ratingText}>{syncedTrip?.driver?.rating?.toFixed(1) ?? '4.9'}</Text>
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.driverName}>{syncedTrip?.driver?.name ?? 'Your Driver'}</Text>
              <Text style={styles.driverMeta}>
                {(syncedTrip?.driver as any)?.totalTrips ?? 25} Trips
                {(syncedTrip?.vehicle?.plateNumber ?? (syncedTrip?.vehicle as any)?.plate)
                  ? ` · ${syncedTrip?.vehicle?.plateNumber ?? (syncedTrip?.vehicle as any)?.plate}`
                  : ''}
              </Text>
            </View>
            {(syncedTrip?.availableSeats != null) && (
              <View style={styles.seatsChip}>
                <Ionicons name="people-outline" size={13} color={colors.primary} />
                <Text style={styles.seatsText}>{syncedTrip.availableSeats} Seats Left</Text>
              </View>
            )}
          </MotiView>

          {/* ETA status */}
          {tripEta != null && (
            <View style={styles.etaRow}>
              <Ionicons name="time-outline" size={16} color={colors.primary} />
              <Text style={styles.etaText}>{formatDuration(tripEta)} away</Text>
              <Text style={styles.etaStatusText}>· {tripStatus}</Text>
            </View>
          )}

          {/* Action bar */}
          <View style={styles.actionBar}>
            <Pressable style={styles.iconActionBtn} onPress={handleChat} accessibilityRole="button" accessibilityLabel="Chat with driver">
              <Ionicons name="chatbubble-ellipses-outline" size={22} color={colors.onSurface} />
            </Pressable>
            <Pressable style={styles.sosIconBtn} onPress={handleSOS} accessibilityRole="button" accessibilityLabel="Emergency SOS">
              <Ionicons name="warning-outline" size={22} color={colors.statusError} />
            </Pressable>
            <Pressable
              style={styles.primaryCta}
              onPress={() => shareLiveTracking(syncedTrip?.shortId ?? id, syncedTrip?.driver?.name ?? 'Your Driver', syncedTrip?.vehicle?.plateNumber ?? (syncedTrip?.vehicle as any)?.plate ?? 'Unknown')}
              accessibilityRole="button"
              accessibilityLabel="Share trip"
            >
              <Text style={styles.primaryCtaText}>Share Trip</Text>
            </Pressable>
          </View>
        </BottomSheetScrollView>
      </BottomSheet>
    </View>
  );
}

function PulseMarker({ color }: { color?: string }) {
  const colors = useColors();
  const resolvedColor = color ?? colors.primary;
  return (
    <View style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
      <MotiView
        style={[pulseStyles.ring, { backgroundColor: resolvedColor }]}
        from={{ scale: 1, opacity: 0.7 }}
        animate={{ scale: 1.8, opacity: 0 }}
        transition={{ type: 'timing', duration: 1500, loop: true }}
      />
      <View style={[pulseStyles.dot, { backgroundColor: resolvedColor, borderColor: colors.backgroundDeep }]} />
    </View>
  );
}

const pulseStyles = StyleSheet.create({
  ring: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
  },
});

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundDeep },
  homeFloating: {
    position: 'absolute',
    left: spacing['2xl'],
    zIndex: 15,
  },
  optionsFloating: {
    position: 'absolute',
    right: spacing['2xl'],
    zIndex: 15,
  },
  homeFloatingBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: withOpacity(colors.surfaceCard, 0.8),
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.rimLight,
  },
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: withOpacity(colors.backgroundDeep, 0.85),
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: withOpacity(colors.primary, 0.4),
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  statusText: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    color: colors.primary,
    letterSpacing: 1.5,
  },
  sheetBackground: {
    backgroundColor: colors.surfaceCard,
    borderTopLeftRadius: radii['4xl'],
    borderTopRightRadius: radii['4xl'],
  },
  sheetHandle: { backgroundColor: colors.outline, width: 40, height: 4 },
  sheetContent: {
    paddingHorizontal: spacing['2xl'],
    paddingBottom: spacing['3xl'],
    gap: spacing.base,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tierBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
    borderWidth: 1,
    backgroundColor: colors.rimLightSubtle,
  },
  tierLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    letterSpacing: 0.8,
  },
  fareBlock: { alignItems: 'flex-end' },
  fareAmount: {
    fontFamily: fonts.displayBold,
    fontSize: 22,
    color: colors.primary,
    letterSpacing: -0.5,
  },
  fareEstLabel: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.caption,
    color: colors.onSurfaceVariant,
    marginTop: 1,
  },
  vehicleName: {
    fontFamily: fonts.displayBold,
    fontSize: 28,
    color: colors.onSurface,
    letterSpacing: -0.5,
    marginTop: spacing.xs,
  },
  routeCard: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.xl,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.rimLight,
    gap: spacing.sm,
  },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  routeIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeLabel: {
    fontFamily: fonts.medium,
    fontSize: 10,
    color: colors.onSurfaceVariant,
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  routePlace: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    color: colors.onSurface,
  },
  routeDivider: {
    height: 1,
    backgroundColor: colors.rimLightSubtle,
    marginLeft: 32 + spacing.md,
  },
  driverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.xl,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.rimLight,
  },
  driverAvatarWrap: { position: 'relative', marginBottom: 8 },
  driverAvatar: {
    width: 52,
    height: 52,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: withOpacity(colors.primary, 0.6),
  },
  ratingBadge: {
    position: 'absolute',
    bottom: -8,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.surfaceContainerHigh,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.rimLight,
  },
  ratingText: {
    fontFamily: fonts.semiBold,
    fontSize: 9,
    color: colors.onSurface,
  },
  driverName: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    color: colors.onSurface,
  },
  driverMeta: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.caption,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
  seatsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: withOpacity(colors.primary, 0.08),
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: withOpacity(colors.primary, 0.2),
  },
  seatsText: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    color: colors.primary,
  },
  etaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  etaText: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    color: colors.primary,
  },
  etaStatusText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodySmall,
    color: colors.onSurfaceVariant,
  },
  actionBar: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  iconActionBtn: {
    width: 52,
    height: 52,
    borderRadius: radii.xl,
    backgroundColor: colors.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: colors.rimLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosIconBtn: {
    width: 52,
    height: 52,
    borderRadius: radii.xl,
    backgroundColor: withOpacity(colors.statusError, 0.08),
    borderWidth: 1,
    borderColor: withOpacity(colors.statusError, 0.3),
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryCta: {
    flex: 1,
    height: 52,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryCtaText: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    color: colors.onPrimary,
    letterSpacing: 0.2,
  },
  statusBanner: {
    position: 'absolute',
    top: 110,
    left: spacing.base,
    right: spacing.base,
    zIndex: 20,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 12,
    borderRadius: radii['2xl'],
    overflow: 'hidden',
  },
  statusBannerBlur: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.base,
    borderWidth: 1.5,
    borderColor: withOpacity(colors.primary, 0.6),
    borderRadius: radii['2xl'],
    overflow: 'hidden',
  },
  statusBannerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBannerLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 9,
    color: colors.primary,
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  statusBannerText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodySmall,
    color: colors.onSurface,
  },
  etaPill: {
    position: 'absolute',
    left: spacing['2xl'],
    bottom: '50%',
    zIndex: 5,
  },
  etaPillBlur: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: withOpacity(colors.primary, 0.2),
  },
  etaPillText: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodySmall,
    color: colors.primary,
  },
  driverMarker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 8,
  },
});
