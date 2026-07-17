import React, { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { View, StyleSheet, Pressable, Alert, Animated, AppState, AppStateStatus, Platform, RefreshControl, Image, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import * as Location from 'expo-location';
import MapboxGL from '../../../utils/mapbox';
import { InlayPanel } from '@eyego/ui';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import * as KeepAwake from 'expo-keep-awake';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { socketEvents, connectSocket, disconnectSocket, tripsApi, bookingsApi, userApi } from '@eyego/api';
import { useRideStore } from '../../../stores/ride.store';
import { fonts, fontSizes, spacing, radii, withOpacity } from '@eyego/config';
import { useColors, Colors } from '../../../utils/useColors';
import { Text, GlassSurface, GradientGlowBorder, PulseRing, RollingDigits, AnimatedFareText, PREMIUM_RING_COLORS, PREMIUM_RING_LOCATIONS } from '@eyego/ui';
import { formatDuration } from '@eyego/utils';
import { eyegoDarkStyle, eyegoLightStyle } from '@eyego/map-styles';
import { useThemeStore } from '../../../stores/theme.store';
import { shareLiveTracking } from '../../../utils/safety';
import { haptic } from '../../../utils/haptics';


/**
 * Native blur is iOS-only here: on Android expo-blur (without
 * experimentalBlurMethod) renders a plain tint anyway, but still pays for the
 * native view + overdraw. Render the equivalent tint directly instead.
 */
function GlassPane({ intensity, style, children }: { intensity: number; style?: StyleProp<ViewStyle>; children?: React.ReactNode }) {
  if (Platform.OS === 'ios') {
    return <BlurView intensity={intensity} tint="dark" style={style}>{children}</BlurView>;
  }
  return <View style={[style, { backgroundColor: 'rgba(15,17,21,0.92)' }]}>{children}</View>;
}

/** Initial bearing (deg) from point 1 → point 2, for devices that send no compass heading. */
function bearingBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = Math.PI / 180;
  const dLng = (lng2 - lng1) * toRad;
  const y = Math.sin(dLng) * Math.cos(lat2 * toRad);
  const x =
    Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
    Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Driver-marker heading, derived once per (discrete) location update — no
 * per-frame JS work. Position gliding between updates is handled natively by
 * MapboxGL.AnimatedMarkerView; only the rotation prop changes here, once per
 * socket tick (~3.5s).
 */
function useDriverHeading(coord: { latitude: number; longitude: number; heading?: number } | null): number {
  const lastRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const headingRef = useRef(0);
  return useMemo(() => {
    if (!coord) return headingRef.current;
    if (coord.heading) {
      headingRef.current = coord.heading;
    } else if (lastRef.current) {
      // No compass heading from the driver device → derive bearing from
      // movement (only when the hop is > ~2m, otherwise GPS jitter spins the car).
      const last = lastRef.current;
      const moved = Math.abs(coord.latitude - last.latitude) + Math.abs(coord.longitude - last.longitude);
      if (moved > 0.00002) {
        headingRef.current = bearingBetween(last.latitude, last.longitude, coord.latitude, coord.longitude);
      }
    }
    lastRef.current = { latitude: coord.latitude, longitude: coord.longitude };
    return headingRef.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coord?.latitude, coord?.longitude, coord?.heading]);
}

// ── Polyline draw-in animation ───────────────────────────────────────────
function usePolylineReveal(coords: [number, number][], skipAnimation?: boolean) {
  const [revealed, setRevealed] = useState<[number, number][]>([]);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (coords.length < 2 || skipAnimation) {
      setRevealed(coords);
      return;
    }

    setRevealed([]);
    const total = coords.length;
    const duration = 1200;
    const stepMs = 16;
    const steps = Math.ceil(duration / stepMs);
    let frame = 0;

    const tick = () => {
      frame++;
      // ease-out: 1 - (1-t)^2
      const t = Math.min(frame / steps, 1);
      const easedIdx = Math.round((1 - (1 - t) * (1 - t)) * (total - 1));
      setRevealed(coords.slice(0, easedIdx + 1));
      if (frame < steps) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setRevealed(coords);
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [coords, skipAnimation]);

  return revealed;
}

// ── ETA rolling digits ───────────────────────────────────────────────────
// Per-digit odometer roll (RollingDigits); the "away" suffix stays static so
// only the numbers move on each socket tick.
function RollingETA({ minutes, color }: { minutes: number; color: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <RollingDigits
        text={formatDuration(minutes)}
        value={minutes}
        fontSize={fontSizes.bodySmall}
        color={color}
        fontFamily={fonts.semiBold}
      />
      <Text style={{ fontFamily: fonts.semiBold, fontSize: fontSizes.bodySmall, color }}>
        {' '}away
      </Text>
    </View>
  );
}

export default function TrackingScreen() {
  const colors = useColors();
  const isDark = useThemeStore((s) => s.isDark);
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

  // Speed Alerts: gated on the rider's safety-settings toggle (profile/safety.tsx).
  const { data: speedAlertsEnabled } = useQuery({
    queryKey: ['user', 'safety-settings', 'speedAlerts'],
    queryFn: async () => (await userApi.getSafetySettings()).data?.data?.settings?.speedAlerts ?? false,
    staleTime: 60_000,
  });
  const SPEED_ALERT_THRESHOLD_KMH = 100;
  const SPEED_ALERT_SUSTAINED_READINGS = 3;
  const highSpeedStreakRef = useRef(0);
  const speedAlertShownRef = useRef(false);

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
  const driverHeading = useDriverHeading(currentDriverCoord);

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
      ? [currentDriverCoord?.longitude ?? 0, currentDriverCoord?.latitude ?? 0]
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
    currentDriverCoord?.longitude,
    currentDriverCoord?.latitude,
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

  const { height: screenH } = useWindowDimensions();
  // Sheet-aware camera: bottom padding tracks the sheet snap so the focus
  // target stays centered in the visible window above it, and the camera
  // only follows while the user hasn't panned away (recenter chip resumes).
  const COLLAPSED_PCT = 0.44;
  const EXPANDED_PCT = 0.65;
  const sheetPadRef = useRef(screenH * COLLAPSED_PCT);
  const followingRef = useRef(true);
  const [following, setFollowing] = useState(true);
  const [panelState, setPanelState] = useState<'collapsed' | 'expanded'>('collapsed');
  const frameOnTarget = useCallback(
    (coord: [number, number], duration = 450) => {
      cameraRef.current?.setCamera({
        centerCoordinate: coord,
        zoomLevel: 14,
        animationDuration: duration,
        padding: { paddingTop: insets.top + 90, paddingBottom: sheetPadRef.current },
      });
    },
    [insets.top]
  );
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
  const revealedCoords = usePolylineReveal(routeCoords, routeCoords.length < 3);

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
  const handleShare = () =>
    shareLiveTracking(
      syncedTripRef.current?.shortId ?? id,
      syncedTripRef.current?.driver?.name ?? 'Your Driver',
      syncedTripRef.current?.vehicle?.plateNumber ?? (syncedTripRef.current?.vehicle as any)?.plate ?? 'Unknown'
    );

  // In-trip action menu for the floating "Options" button. Reuses the same
  // handlers as the panel CTAs so there are no dead entry points.
  const handleOptions = () => {
    Alert.alert('Trip options', undefined, [
      { text: 'Share trip', onPress: handleShare },
      { text: 'Contact driver', onPress: handleChat },
      { text: 'Safety / SOS', style: 'destructive', onPress: handleSOS },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

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
      // Glide until the next ping (~3.5s) with sheet-aware framing; never
      // fight the user — a manual pan pauses following until re-centered.
      if (followingRef.current) frameOnTarget([data.longitude, data.latitude], 3400);

      // Speed Alerts — data.speed is m/s (matches expo-location's convention,
      // and the driver socket forwards its own GPS speed verbatim).
      if (speedAlertsEnabled && !speedAlertShownRef.current && typeof data.speed === 'number') {
        const kmh = data.speed * 3.6;
        if (kmh >= SPEED_ALERT_THRESHOLD_KMH) {
          highSpeedStreakRef.current += 1;
          if (highSpeedStreakRef.current >= SPEED_ALERT_SUSTAINED_READINGS) {
            speedAlertShownRef.current = true;
            Alert.alert(
              'Speed Alert',
              `Your driver appears to be traveling at ~${Math.round(kmh)} km/h. This is faster than usual — you can share your trip or contact support if you're concerned.`,
              [
                { text: 'Dismiss', style: 'cancel' },
                { text: 'Share Trip', onPress: handleShare },
              ],
            );
          }
        } else {
          highSpeedStreakRef.current = 0;
        }
      }
    });

    const unsubEta = socketEvents.onTripEta((data) => {
      setTripEta(data.etaMinutes);
      setStopsAway(data.stopsAway ?? null);
      setEtaDistanceKm(data.distanceKm ?? null);
      // Pure-ETA ticks may omit `message`; only overwrite the status line when
      // a real label arrives so it doesn't blank out between updates.
      if (typeof data.message === 'string' && data.message.trim()) safeSetTripStatus(data.message);
      if (data.geometry?.coordinates && data.geometry.coordinates.length >= 2) {
        setRouteCoords(data.geometry.coordinates);
      }
    });

    const stageConfig: Record<string, {
      haptic?: () => void;
      statusLabel: string;
      banner: string;
      navigate?: { getTo: () => Href; delay: number };
      isCancellation?: true;
    }> = {
      COMPLETED: {
        haptic: () => haptic.success(),
        statusLabel: 'Arrived',
        banner: 'You have arrived! Rate your trip',
        navigate: {
          getTo: () => {
            const bid = capturedBookingIdRef.current || activeBookingRef.current?.id || '';
            return `/ride/${id}/complete${bid ? `?bookingId=${bid}` : ''}` as Href;
          },
          delay: 1200,
        },
      },
      DRIVER_EN_ROUTE: {
        haptic: () => haptic.heavy(),
        statusLabel: 'Driver on the way',
        banner: 'Your driver has started the trip',
      },
      IN_PROGRESS: {
        haptic: () => haptic.medium(),
        statusLabel: 'Trip in progress',
        banner: 'EyeGo has departed — enjoy the ride!',
      },
      CANCELLED: {
        haptic: () => haptic.warning(),
        statusLabel: 'Trip cancelled',
        banner: 'Trip cancelled',
        isCancellation: true,
      },
    };

    const unsubStatus = socketEvents.onTripStatus((data) => {
      const stage = stageConfig[data.status];
      if (!stage) return;

      stage.haptic?.();
      safeSetTripStatus(stage.statusLabel);
      showBanner(stage.banner);

      if (stage.isCancellation) {
        if (!mountedRef.current) return;
        disconnectSocket();
        useRideStore.getState().clearRideState();
        Alert.alert(
          'Trip cancelled',
          'Your driver cancelled this trip. You have not been charged for the ride. Please book another.',
          [{ text: 'OK', onPress: () => router.replace('/(tabs)/home' as Href) }],
          { cancelable: false }
        );
      } else if (stage.navigate) {
        const { getTo, delay } = stage.navigate;
        setTimeout(() => {
          if (!mountedRef.current) return;
          disconnectSocket();
          router.replace(getTo());
        }, delay);
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
        styleURL={isDark ? eyegoDarkStyle : eyegoLightStyle}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        rotateEnabled={false}
        scaleBarEnabled={false}
        onUserPan={() => {
          if (followingRef.current) {
            followingRef.current = false;
            setFollowing(false);
          }
        }}
      >
        {/* Camera only SEEDS the initial frame — live following is imperative
            (frameOnTarget) so the map glides instead of re-render snapping. */}
        <MapboxGL.Camera
          ref={cameraRef}
          centerCoordinate={passengerPickupCoord}
          zoomLevel={13}
          animationMode="none"
          animationDuration={0}
        />
        {/* Rider's current location — use UserLocation for native iOS/Android blue dot that updates automatically */}
        <MapboxGL.UserLocation visible={true} showsUserHeadingIndicator={true} />

        {/* Pickup marker — radar pulse while waiting, calm dot once riding.
            tracksViewChanges must be on for the rings to actually animate. */}
        <MapboxGL.MarkerView coordinate={passengerPickupCoord} tracksViewChanges={!tripInProgress}>
          {tripInProgress ? (
            <PulseMarker color={colors.secondary} />
          ) : (
            <PulseRing size={72} color={colors.secondary} duration={2200}>
              <PulseMarker color={colors.secondary} />
            </PulseRing>
          )}
        </MapboxGL.MarkerView>

        {/* Driver marker — position glides natively between socket updates
            (zero per-frame JS); rotation is a plain native prop update. */}
        <MapboxGL.AnimatedMarkerView
          coordinate={[currentDriverCoord.longitude, currentDriverCoord.latitude]}
          duration={3500}
          rotation={driverHeading}
          flat
        >
          <View style={styles.driverMarker}>
            <Ionicons name="car" size={18} color="#fff" />
          </View>
        </MapboxGL.AnimatedMarkerView>

        {/* Route line — OSRM road-following polyline, straight-line fallback */}
        <MapboxGL.ShapeSource
          id="routeLine"
          shape={{
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: routeCoords.length >= 2
                ? revealedCoords
                : tripInProgress
                  ? [[currentDriverCoord.longitude, currentDriverCoord.latitude], destCoord]
                  : [[currentDriverCoord.longitude, currentDriverCoord.latitude], passengerPickupCoord],
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
        <Pressable onPress={handleOptions} style={styles.homeFloatingBtn} accessibilityRole="button" accessibilityLabel="Trip options">
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
          <GlassPane intensity={80} style={styles.statusBannerBlur}>
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
          </GlassPane>
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
          <GlassPane intensity={60} style={styles.etaPillBlur}>
            <Ionicons name="time-outline" size={14} color={colors.primary} />
            <RollingETA minutes={tripEta} color={colors.primary} />
          </GlassPane>
        </MotiView>
      )}

      {/* Re-center chip — appears when the user pans away; rides the sheet edge */}
      {!following && (
        <MotiView
          from={{ opacity: 0, scale: 0.92, translateY: 10 }}
          animate={{
            opacity: 1,
            scale: 1,
            translateY: -(screenH * ((panelState === 'expanded' ? EXPANDED_PCT : COLLAPSED_PCT) - COLLAPSED_PCT)),
          }}
          transition={{ type: 'spring', stiffness: 500, damping: 32 }}
          style={[styles.recenterChip, { bottom: screenH * COLLAPSED_PCT + spacing.lg }]}
        >
          <Pressable
            onPress={() => {
              haptic.select();
              followingRef.current = true;
              setFollowing(true);
              frameOnTarget(
                tripInProgress
                  ? [currentDriverCoord.longitude, currentDriverCoord.latitude]
                  : (passengerPickupCoord as [number, number]),
                600
              );
            }}
            style={styles.recenterInner}
            accessibilityRole="button"
            accessibilityLabel="Re-center map"
          >
            <Ionicons name="locate" size={16} color={colors.primary} />
            <Text variant="labelMedium" color={colors.onSurface}>Re-center</Text>
          </Pressable>
        </MotiView>
      )}

      {/* Bottom sheet — InlayPanel with same snap points as before (44% / 65%).
          Uses the same usePanelMotion engine (spring: stiffness=320, damping=34)
          that matches the @gorhom config we removed. */}
      <InlayPanel
        snapPointsPct={[COLLAPSED_PCT, EXPANDED_PCT]}
        sheetStyle={styles.sheetBackground}
        grabberColor={colors.outline}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        onStateChange={(state) => {
          if (state !== 'collapsed' && state !== 'expanded') return; // non-dismissible panel: ignore transient states
          const pct = state === 'expanded' ? EXPANDED_PCT : COLLAPSED_PCT;
          sheetPadRef.current = screenH * pct;
          setPanelState(state);
          // Re-frame on snap settle so the target re-centers in the new window
          if (followingRef.current) {
            frameOnTarget(
              tripInProgress
                ? [currentDriverCoord.longitude, currentDriverCoord.latitude]
                : (passengerPickupCoord as [number, number]),
              400
            );
          }
        }}
      >
        <View style={styles.sheetContent}>
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
              <AnimatedFareText value={fare} variant="fareMedium" color={colors.primary} />
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

          {/* Driver row — hero card with premium green glow ring */}
          <MotiView
            from={{ opacity: 0, translateY: 6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 80 }}
          >
            <GradientGlowBorder
              colors={PREMIUM_RING_COLORS}
              locations={PREMIUM_RING_LOCATIONS}
              fillColor={colors.surfaceContainer}
              borderRadius={radii.xl}
              glow
              glowColor={colors.primary}
              style={styles.driverCard}
            >
              <GlassSurface borderRadius={radii.xl - 3} intensity="high" dark style={styles.glassInset} />
              <View style={styles.driverRowInner}>
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
              </View>
            </GradientGlowBorder>
          </MotiView>

          {/* ETA status */}
          {tripEta != null && (
            <View style={styles.etaRow}>
              <Ionicons name="time-outline" size={16} color={colors.primary} />
              <RollingETA minutes={tripEta} color={colors.primary} />
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
        </View>
      </InlayPanel>
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
  container: { flex: 1, backgroundColor: 'transparent' },
  recenterChip: {
    position: 'absolute',
    right: spacing['2xl'],
    zIndex: 5,
  },
  recenterInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: withOpacity(colors.primary, 0.3),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
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
    lineHeight: 14,
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
    lineHeight: 14,
    letterSpacing: 0.8,
  },
  fareBlock: { alignItems: 'flex-end' },
  fareEstLabel: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.caption,
    lineHeight: Math.round(fontSizes.caption * 1.3),
    color: colors.onSurfaceVariant,
    marginTop: 1,
  },
  vehicleName: {
    fontFamily: fonts.displayBold,
    fontSize: 28,
    lineHeight: 36,
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
    lineHeight: 13,
    color: colors.onSurfaceVariant,
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  routePlace: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
    color: colors.onSurface,
  },
  routeDivider: {
    height: 1,
    backgroundColor: colors.rimLightSubtle,
    marginLeft: 32 + spacing.md,
  },
  driverCard: {
    borderRadius: radii.xl,
    overflow: 'hidden',
  },
  glassInset: { position: 'absolute', top: 3, left: 3, right: 3, bottom: 3 },
  driverRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.base,
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
    lineHeight: 12,
    color: colors.onSurface,
  },
  driverName: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
    color: colors.onSurface,
  },
  driverMeta: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.caption,
    lineHeight: Math.round(fontSizes.caption * 1.3),
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
    lineHeight: 14,
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
    lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
    color: colors.primary,
  },
  etaStatusText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodySmall,
    lineHeight: Math.round(fontSizes.bodySmall * 1.4),
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
    lineHeight: Math.round(fontSizes.bodyMedium * 1.3),
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
    lineHeight: 12,
    color: colors.primary,
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  statusBannerText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodySmall,
    lineHeight: Math.round(fontSizes.bodySmall * 1.4),
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
    lineHeight: Math.round(fontSizes.bodySmall * 1.3),
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
