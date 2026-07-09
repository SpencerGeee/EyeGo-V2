import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  Alert,
  Linking,
  Platform,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import MapboxGL from '../../../utils/mapbox';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import * as KeepAwake from 'expo-keep-awake';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { driverApi, driverSocketEvents, connectDriverSocket, disconnectDriverSocket } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button, Entrance, Skeleton, PulseRing, GlassSurface, GradientGlowBorder, InlayPanel, AppBackground } from '@eyego/ui';
import { useColors, type DriverColors } from '../../../utils/useColors';
import { useDriverStore } from '../../../stores/driver.store';
import { useNotificationsStore } from '../../../stores/notifications.store';
import eyegoDarkStyle from '@eyego/map-styles';
import { useDriverLocation } from '../../../hooks/useDriverLocation';

// Initial great-circle bearing from `a` to `b`, in degrees — feeds the 3D nav
// camera's rotation so it faces the direction of travel (Uber/Bolt/Yango-style).
function bearingBetween(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const [lng1, lat1] = a.map(toRad) as [number, number];
  const [lng2, lat2] = b.map(toRad) as [number, number];
  const y = Math.sin(lng2 - lng1) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lng2 - lng1);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const STATUS_FLOW: Record<string, { label: string; next: string | null; action: string }> = {
  SCHEDULED:          { label: 'Scheduled',          next: 'start',  action: 'Start Trip'    },
  FILLING:            { label: 'Boarding Open',       next: 'start',  action: 'Start Trip'    },
  DRIVER_EN_ROUTE:    { label: 'En Route to Stop',    next: 'arrive', action: "I've Arrived"  },
  ARRIVED_AT_PICKUP:  { label: 'Arrived at Pickup',   next: 'depart', action: 'Depart Now'    },
  IN_PROGRESS:        { label: 'In Progress',         next: 'finish', action: 'Mark Arrived'  },
  COMPLETED:          { label: 'Completed',           next: null,     action: ''              },
  CANCELLED:          { label: 'Cancelled',           next: null,     action: ''              },
};

export default function DriverTrackingScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { setActiveTripId, isOnline } = useDriverStore();
  const { addNotification } = useNotificationsStore();

  const { data: trip, isLoading } = useQuery({
    queryKey: ['driver', 'trip', id],
    // Use getTripById so the screen stays populated through all status transitions.
    // getActiveTrip() returns null after ARRIVED_AT_PICKUP, causing an infinite skeleton.
    queryFn: () => driverApi.getTripById(id),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (r: any) => r.data?.data?.trip ?? null,
    refetchInterval: 8000,
    enabled: !!id,
  });

  const isActiveTrip = !!trip && !['COMPLETED', 'CANCELLED'].includes(trip.status);

  // Live driver location
  const { location: driverLocation } = useDriverLocation({ enabled: isActiveTrip });
  const locationRef = useRef(driverLocation);
  useEffect(() => { locationRef.current = driverLocation; }, [driverLocation]);

  // ETA state
  const [etaMinutes, setEtaMinutes] = useState<number | null>(null);
  const [etaDistanceKm, setEtaDistanceKm] = useState<number | null>(null);
  const [etaMessage, setEtaMessage] = useState<string | null>(null);
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);

  // Keep screen on while trip is active
  useEffect(() => {
    if (isActiveTrip) {
      KeepAwake.activateKeepAwake();
    } else {
      KeepAwake.deactivateKeepAwake();
    }
    return () => { KeepAwake.deactivateKeepAwake(); };
  }, [isActiveTrip]);

  // Socket setup — connect to driver namespace for ETA + events
  useEffect(() => {
    if (!trip || !isActiveTrip) return;

    connectDriverSocket();

    const unsubConnect = driverSocketEvents.onConnect(() => {
      console.log('[DriverTracking] Socket connected');
      driverSocketEvents.emitJoinTracking(id);
    });

    // Listen for ETA updates emitted to the driver namespace
    const unsubEta = driverSocketEvents.onTripEta?.((data) => {
      if (data.tripId === id) {
        setEtaMinutes(data.etaMinutes);
        setEtaDistanceKm(data.distanceKm ?? null);
        setEtaMessage(data.message ?? null);
        if (data.geometry?.coordinates && data.geometry.coordinates.length >= 2) {
          setRouteCoords(data.geometry.coordinates);
        }
      }
    }) ?? (() => {});

    const unsubPayment = driverSocketEvents.onPaymentConfirmed((data) => {
      if (data.tripId === id) {
        addNotification({
          type: 'PAYMENT_CONFIRMED',
          title: 'Payment Confirmed',
          body: 'A passenger just completed their payment.',
          tripId: id,
        });
        qc.invalidateQueries({ queryKey: ['driver', 'trip', id] });
      }
    });

    const unsubSeat = driverSocketEvents.onSeatUpdate(() => {
      qc.invalidateQueries({ queryKey: ['driver', 'trip', id] });
    });

    // Emit location every 4s so rider gets updates AND ETA is calculated
    const interval = setInterval(() => {
      const loc = locationRef.current;
      if (loc) {
        driverSocketEvents.emitLocation({
          lat: loc.latitude,
          lng: loc.longitude,
          heading: loc.heading ?? 0,
          speed: loc.speed ?? 0,
        });
      }
    }, 4000);

    return () => {
      clearInterval(interval);
      unsubConnect();
      unsubEta();
      unsubPayment();
      unsubSeat();
      disconnectDriverSocket();
    };
  }, [trip?.id, isActiveTrip, id, qc, addNotification, setEtaMinutes, setEtaDistanceKm, setEtaMessage, setRouteCoords]);

  // Map camera ref — follows driver location
  const cameraRef = useRef<any>(null);
  const driverCoord = useMemo(() => {
    if (!driverLocation) return null;
    return [driverLocation.longitude, driverLocation.latitude] as [number, number];
  }, [driverLocation?.latitude, driverLocation?.longitude]);

  // Camera follows driver — tilted/rotated 3D nav view while actively driving
  // to/with passengers (Uber/Bolt/Yango-style), flat overview otherwise.
  useEffect(() => {
    if (driverCoord && cameraRef.current) {
      const isDriving = trip?.status === 'DRIVER_EN_ROUTE' || trip?.status === 'IN_PROGRESS';
      const target: [number, number] | null = !isDriving
        ? null
        : trip?.status === 'IN_PROGRESS'
          ? (trip?.route?.destLat && trip?.route?.destLng ? [trip.route.destLng, trip.route.destLat] : null)
          : (trip?.route?.originLat && trip?.route?.originLng ? [trip.route.originLng, trip.route.originLat] : null);
      cameraRef.current.setCamera({
        centerCoordinate: driverCoord,
        animationDuration: 1000,
        zoomLevel: isDriving ? 17.5 : 14,
        heading: isDriving && target ? bearingBetween(driverCoord, target) : 0,
        pitch: isDriving ? 55 : 0,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // driverCoord is a tuple — index access is the stable primitive dep; cameraRef is a stable ref
  }, [driverCoord?.[0], driverCoord?.[1], trip?.status]);

  // Destination + pickup coords — declared HERE so the OSRM effect below can reference them
  const destCoord: [number, number] = useMemo(() => {
    const lat = trip?.route?.destLat;
    const lng = trip?.route?.destLng;
    if (lat && lng) return [lng, lat];
    return [-0.187, 5.6037]; // fallback Accra center
  }, [trip?.route?.destLat, trip?.route?.destLng]);

  const pickupCoord: [number, number] = useMemo(() => {
    const lat = trip?.route?.originLat;
    const lng = trip?.route?.originLng;
    if (lat && lng) return [lng, lat];
    return destCoord;
  }, [trip?.route?.originLat, trip?.route?.originLng, destCoord]);

  // Route target: pickup when en-route/arrived, destination when trip is running.
  // This makes the driver's map show "navigate to pickup" first, then "navigate to destination".
  const driverRouteTarget: [number, number] = useMemo(() => {
    return (trip?.status === 'IN_PROGRESS' || trip?.status === 'COMPLETED')
      ? destCoord
      : pickupCoord;
  }, [trip?.status, destCoord, pickupCoord]);

  // Fetch road-following route from OSRM and compute local ETA immediately.
  // This runs as soon as driver coordinates are available — no need to wait for
  // the backend socket to emit trip:eta, which can take several seconds.
  const routeFetchedRef = useRef(false);
  useEffect(() => {
    if (!driverCoord || !driverRouteTarget || routeFetchedRef.current) return;
    const [dLng, dLat] = driverCoord;
    const [eLng, eLat] = driverRouteTarget;
    if (isNaN(dLat) || isNaN(dLng) || isNaN(eLat) || isNaN(eLng)) return;

    routeFetchedRef.current = true;
    const url =
      `https://router.project-osrm.org/route/v1/driving/${dLng},${dLat};${eLng},${eLat}` +
      `?overview=full&geometries=geojson`;

    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        const route = data?.routes?.[0];
        if (!route) return;
        const coords: [number, number][] = route.geometry?.coordinates ?? [];
        const durationSec: number = route.duration ?? 0;
        const distanceM: number = route.distance ?? 0;
        if (coords.length >= 2) setRouteCoords(coords);
        const mins = Math.max(1, Math.ceil(durationSec / 60));
        const km = parseFloat((distanceM / 1000).toFixed(1));
        // Only set if socket hasn't already provided a fresher value
        setEtaMinutes((prev) => prev ?? mins);
        setEtaDistanceKm((prev) => prev ?? km);
        setEtaMessage((prev) => prev ?? `${km} km via roads`);
      })
      .catch(() => {
        // OSRM unavailable — route line stays as straight fallback, no crash
      });
  }, [driverCoord?.[0], driverCoord?.[1], driverRouteTarget[0], driverRouteTarget[1]]);

  // Reset OSRM fetch when route target changes (en-route → in-progress phase switch)
  const prevRouteTargetRef = useRef(driverRouteTarget);
  useEffect(() => {
    if (
      prevRouteTargetRef.current[0] !== driverRouteTarget[0] ||
      prevRouteTargetRef.current[1] !== driverRouteTarget[1]
    ) {
      prevRouteTargetRef.current = driverRouteTarget;
      routeFetchedRef.current = false;
      setRouteCoords([]);
    }
  }, [driverRouteTarget]);

  // Refresh OSRM route every 60 s while the trip is active (updates as driver moves)
  useEffect(() => {
    if (!isActiveTrip) return;
    const interval = setInterval(() => {
      routeFetchedRef.current = false; // allow re-fetch on next location update
    }, 60000);
    return () => clearInterval(interval);
  }, [isActiveTrip]);

  // ── In-app banner ──
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

  // ── Trip status management ──
  const pendingFromStatus = useRef<string | null>(null);

  const advanceStatus = useMutation({
    mutationFn: async () => {
      const status = trip?.status;
      pendingFromStatus.current = status ?? null;
      if (status === 'SCHEDULED' || status === 'FILLING') return driverApi.startTrip(id);
      if (status === 'DRIVER_EN_ROUTE') return driverApi.arriveAtPickup(id);
      if (status === 'ARRIVED_AT_PICKUP') return driverApi.departTrip(id);
      if (status === 'IN_PROGRESS') return driverApi.arriveTrip(id);
      throw new Error('Cannot advance from current status');
    },
    onSuccess: (res) => {
      const fromStatus = pendingFromStatus.current;
      let toStatus: string | null = null;
      if (fromStatus === 'SCHEDULED' || fromStatus === 'FILLING') toStatus = 'DRIVER_EN_ROUTE';
      else if (fromStatus === 'DRIVER_EN_ROUTE') toStatus = 'ARRIVED_AT_PICKUP';
      else if (fromStatus === 'ARRIVED_AT_PICKUP') toStatus = 'IN_PROGRESS';
      else if (fromStatus === 'IN_PROGRESS') toStatus = 'COMPLETED';

      if (toStatus === 'DRIVER_EN_ROUTE') {
        driverSocketEvents.emitTripStarted(id);
        showBanner('Trip started — en route to pickup');
      }
      if (toStatus === 'ARRIVED_AT_PICKUP') {
        showBanner('Arrived at pickup — ready to depart');
      }
      if (toStatus === 'IN_PROGRESS') {
        driverSocketEvents.emitTripDeparted(id);
        showBanner('Trip is now in progress');
      }
      if (toStatus === 'COMPLETED') {
        driverSocketEvents.emitArrived(id);
        setActiveTripId(null);
        qc.invalidateQueries({ queryKey: ['driver', 'trip', id] });
        qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
        qc.invalidateQueries({ queryKey: ['driver', 'trips', 'all'] });
        qc.invalidateQueries({ queryKey: ['driver', 'me'] });
        qc.invalidateQueries({ queryKey: ['driver', 'quests'] });
        // Refresh wallet balance + transactions so home/earnings update.
        qc.invalidateQueries({ queryKey: ['driver', 'wallet'] });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = (res as any)?.data;
        const earningsThisTrip = raw?.data?.earningsThisTrip ?? raw?.data?.totalEarnings ?? 0;
        addNotification({
          type: 'COMPLETED',
          title: 'Trip completed!',
          body: `You earned GHS ${Number(earningsThisTrip).toFixed(2)}`,
          tripId: id,
        });
        router.replace({ pathname: '/(trip)/complete/[id]', params: { id, earnings: String(earningsThisTrip) } } as Href);
        return;
      }

      qc.invalidateQueries({ queryKey: ['driver', 'trip', id] });
      qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
    },
    onError: (err) => Alert.alert('Error', (err as Error).message),
  });

  const cancelTrip = useMutation({
    mutationFn: () => driverApi.cancelTrip(id),
    onSuccess: () => {
      setActiveTripId(null);
      qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
      qc.invalidateQueries({ queryKey: ['driver', 'trips', 'all'] });
      router.replace('/(tabs)/home');
    },
    onError: (err: any) => Alert.alert('Error', err?.response?.data?.message ?? (err as Error).message),
  });

  const handleCancel = () => {
    Alert.alert(
      'Cancel Trip',
      'Are you sure you want to cancel this trip? All passenger bookings will also be cancelled.',
      [
        { text: 'Keep Trip', style: 'cancel' },
        { text: 'Cancel Trip', style: 'destructive', onPress: () => cancelTrip.mutate() },
      ],
    );
  };

  const handleOpenMaps = () => {
    const destLat = trip?.route?.destLat;
    const destLng = trip?.route?.destLng;
    const label = encodeURIComponent(trip?.route?.destinationName ?? 'Destination');
    if (!destLat || !destLng) {
      Alert.alert('No destination', 'Destination coordinates are not available.');
      return;
    }
    const url = Platform.OS === 'ios'
      ? `maps://?ll=${destLat},${destLng}&q=${label}`
      : `google.navigation:q=${destLat},${destLng}`;
    Linking.openURL(url).catch(() =>
      Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLng}`)
    );
  };

  // Navigate home when trip disappears (deleted/cancelled upstream).
  // Must be in a useEffect — calling router.replace() during render causes
  // "Cannot update NavigationContainerInner while rendering DriverTrackingScreen".
  useEffect(() => {
    if (!isLoading && !trip && id) {
      router.replace('/(tabs)/home');
    }
  }, [isLoading, trip, id, router]);

  // ── Computed values ──
  const statusInfo = STATUS_FLOW[trip?.status] ?? STATUS_FLOW.FILLING;
  const rawBookings = trip?.bookings ?? [];
  const activeBookings = rawBookings.filter((b: any) => b.status !== 'CANCELLED');
  const passengers = activeBookings.length;
  const total = trip?.maxSeats ?? 14;
  const fare = trip?.farePerSeat ?? 0;
  const boarded = activeBookings.filter((b: any) => b.status === 'BOARDED').length;

  // ── Render ──
  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <AppBackground variant="static" />
        <View style={styles.loadingContainer}>
          {[80, 160, 120].map((w, i) => (
            <Skeleton key={i} width={w} height={16} borderRadius={radii.md} />
          ))}
        </View>
      </SafeAreaView>
    );
  }

  if (!trip) return null;

  return (
    <View style={styles.container}>
      <AppBackground variant="static" />
      {/* Map */}
      <MapboxGL.MapView
        style={StyleSheet.absoluteFill}
        styleURL={eyegoDarkStyle}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        rotateEnabled={false}
        scaleBarEnabled={false}
      >
        <MapboxGL.Camera
          ref={cameraRef}
          centerCoordinate={driverCoord ?? pickupCoord}
          zoomLevel={14}
          animationMode="none"
          animationDuration={0}
        />

        {/* Driver's current location — always visible, starts at pickup until GPS fix */}
        <MapboxGL.MarkerView coordinate={driverCoord ?? pickupCoord}>
          <View style={styles.driverMarker}>
            <Ionicons name="navigate" size={20} color="#3B82F6" style={{ transform: [{ rotate: '45deg' }] }} />
          </View>
        </MapboxGL.MarkerView>

        {/* Pickup marker */}
        {trip?.status !== 'IN_PROGRESS' && (
          <MapboxGL.MarkerView coordinate={pickupCoord}>
            <PulseMarker color={colors.secondary} />
          </MapboxGL.MarkerView>
        )}

        {/* Destination marker */}
        <MapboxGL.MarkerView coordinate={destCoord}>
          <View style={styles.destMarker}>
            <Ionicons name="flag" size={14} color="#fff" />
          </View>
        </MapboxGL.MarkerView>

        {/* Route polyline */}
        <MapboxGL.ShapeSource
          id="routeLine"
          shape={{
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: routeCoords.length >= 2
                ? routeCoords
                : driverCoord
                ? [driverCoord, driverRouteTarget]
                : [pickupCoord, destCoord],
            },
            properties: {},
          }}
        >
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

      {/* Floating header */}
      <View style={styles.headerOverlay}>
        <View style={styles.headerRow}>
          <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii['2xl']} intensity="low" />
          <Pressable onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
          </Pressable>
          <View style={styles.headerRouteInfo}>
            <Text style={styles.headerRoute} numberOfLines={1}>
              {trip?.route?.originName ?? '—'} → {trip?.route?.destinationName ?? '—'}
            </Text>
          </View>
          <TripStatusBadge status={trip.status} colors={colors} />
        </View>
      </View>

      {/* LIVE badge */}
      <View style={styles.liveBadge}>
        <MotiView
          from={{ opacity: 0.5 }}
          animate={{ opacity: 1 }}
          transition={{ type: 'timing', duration: 500, loop: true }}
          style={styles.liveDot}
        />
        <Text style={styles.liveText}>LIVE</Text>
      </View>

      {/* ETA pill */}
      {etaMinutes != null && (
        <Entrance animation="slideLeft" style={styles.etaPill}>
          <BlurView intensity={60} tint="dark" style={styles.etaPillBlur}>
            <Ionicons name="time-outline" size={14} color={colors.primary} />
            <Text style={styles.etaPillText}>
              {etaMinutes < 2 ? 'Arriving now' : `${etaMinutes} min to destination`}
            </Text>
          </BlurView>
        </Entrance>
      )}

      {/* Passenger count pill */}
      <Entrance animation="slideRight" style={styles.passengerPill}>
        <BlurView intensity={60} tint="dark" style={styles.etaPillBlur}>
          <Ionicons name="people-outline" size={14} color={colors.primary} />
          <Text style={styles.etaPillText}>{boarded}/{passengers} boarded</Text>
        </BlurView>
      </Entrance>

      {/* In-app banner */}
      {bannerMsg != null && (
        <Animated.View style={[styles.statusBanner, { transform: [{ translateY: bannerAnim }] }]}>
          <BlurView intensity={80} tint="dark" style={styles.statusBannerBlur}>
            <View style={styles.statusBannerIcon}>
              <Ionicons name="notifications" size={16} color="#050508" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.statusBannerLabel}>TRIP UPDATE</Text>
              <Text style={styles.statusBannerText}>{bannerMsg}</Text>
            </View>
          </BlurView>
        </Animated.View>
      )}

      {/* Bottom sheet */}
      <InlayPanel
        snapPointsPct={[0.32, 0.6]}
        initialState="collapsed"
        sheetStyle={styles.sheetBackground}
        grabberColor={colors.outline}
      >
        <View style={styles.sheetContent}>
          {/* ETA + Status — the screen's hero data gets the driver-blue premium ring */}
          <Entrance animation="slideDown">
            <GradientGlowBorder
              palette="driver"
              fillColor={colors.surfaceContainer}
              borderRadius={radii.xl}
              glow
              style={styles.etaSection}
            >
              <GlassSurface borderRadius={radii.xl - 3} intensity="high" dark style={styles.glassInset} />
              <View style={styles.etaLeft}>
                <Text style={styles.etaValue}>
                  {etaMinutes != null ? `${etaMinutes} min` : '...'}
                </Text>
                <Text variant="bodySmall" color={colors.onSurfaceVariant}>
                  {etaMinutes != null ? 'to destination' : 'Calculating ETA...'}
                </Text>
              </View>
              <View style={styles.etaDivider} />
              <View style={styles.etaRight}>
                <Text style={styles.etaStatus}>{etaMessage ?? statusInfo.label}</Text>
                <Text variant="bodySmall" color={colors.onSurfaceVariant}>
                  {etaDistanceKm != null ? `${etaDistanceKm} km` : `${passengers} passenger${passengers !== 1 ? 's' : ''}`}
                </Text>
              </View>
            </GradientGlowBorder>
          </Entrance>

          {/* Passenger list */}
          <Entrance animation="slideDown" delay={40} style={styles.passengerListCard}>
            <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.xl} intensity="low" />
            <View style={styles.passengerListHeader}>
              <Text style={styles.passengerListTitle}>Passengers</Text>
              <Text variant="caption" color={colors.onSurfaceVariant}>{passengers}/{total}</Text>
            </View>
            {activeBookings.length === 0 ? (
              <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ paddingVertical: spacing.sm }}>
                No passengers yet. Trip is open for boarding.
              </Text>
            ) : (
              activeBookings.slice(0, 6).map((b: any, i: number) => (
                <View key={b.id ?? i} style={styles.passengerRow}>
                  <View style={[styles.passengerAvatar, !b.user?.name && { backgroundColor: colors.surfaceContainerHighest }]}>
                    <Text style={styles.passengerInitial}>
                      {(b.user?.name?.[0] ?? b.seatNumber ?? '?').toString().toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.passengerName}>
                      {b.user?.name ?? b.guestName ?? `Seat ${b.seatNumber ?? '—'}`}
                    </Text>
                    <Text variant="caption" color={colors.onSurfaceVariant}>
                      Seat {b.seatNumber ?? '—'} · {
                        b.paymentStatus === 'PAID' ? 'Paid'
                        : b.paymentStatus === 'FAILED' ? 'Payment failed'
                        : b.paymentMethod === 'CASH' ? 'Cash'
                        : b.paymentStatus === 'PENDING' ? 'Pending payment'
                        : b.status
                      }
                    </Text>
                  </View>
                  <View style={[
                    styles.boardedBadge,
                    { backgroundColor: b.status === 'BOARDED' ? `${colors.online}22` : `${colors.outline}22` },
                  ]}>
                    <Text style={[
                      styles.boardedText,
                      { color: b.status === 'BOARDED' ? colors.online : colors.onSurfaceVariant },
                    ]}>
                      {b.status === 'BOARDED' ? 'On board' : 'Waiting'}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </Entrance>

          {/* Primary action button */}
          {statusInfo.next && (
            <Entrance animation="slideDown" delay={80}>
              <Button
                label={statusInfo.action}
                onPress={() => advanceStatus.mutate()}
                loading={advanceStatus.isPending}
                disabled={advanceStatus.isPending}
              />
            </Entrance>
          )}

          {/* Secondary actions row */}
          <Entrance animation="slideDown" delay={100} style={styles.secondaryActions}>
            <Pressable
              style={styles.secondaryBtn}
              onPress={() => router.push(`/(trip)/chat/${id}`)}
            >
              <Ionicons name="chatbubble-outline" size={18} color={colors.onSurfaceVariant} />
              <Text style={[styles.secondaryBtnText, { color: colors.onSurfaceVariant }]}>Chat</Text>
            </Pressable>
            <Pressable
              style={styles.secondaryBtn}
              onPress={handleOpenMaps}
            >
              <Ionicons name="navigate-outline" size={18} color={colors.primary} />
              <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>Navigate</Text>
            </Pressable>
            <Pressable
              style={styles.secondaryBtn}
              onPress={() => router.push(`/(trip)/active/${id}`)}
            >
              <Ionicons name="grid-outline" size={18} color={colors.primary} />
              <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>Manage</Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryBtn, { borderColor: colors.error + '55' }]}
              onPress={() => {
                Alert.alert(
                  'Emergency SOS',
                  'This will call Ghana Police (191). Are you in immediate danger?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Call 191', style: 'destructive', onPress: () => Linking.openURL('tel:191') },
                  ],
                );
              }}
            >
              <Ionicons name="warning" size={18} color={colors.error} />
              <Text style={[styles.secondaryBtnText, { color: colors.error }]}>SOS</Text>
            </Pressable>
          </Entrance>

          {/* No Show + Cancel actions */}
          {!['COMPLETED', 'CANCELLED'].includes(trip.status) && (
            <Entrance animation="slideDown" delay={120} style={styles.cancelRow}>
              <Pressable
                style={[styles.cancelBtn, { flex: 1, borderColor: '#F59E0B55' }]}
                onPress={() => {
                  Alert.alert(
                    'Mark as No Show',
                    'Mark this trip as a no-show? This will cancel all bookings and may affect your cancellation rate.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Mark No Show', style: 'destructive', onPress: () => {
                          if (['CANCELLED', 'COMPLETED'].includes(trip?.status ?? '')) {
                            Alert.alert('Already resolved', 'This trip has already been cancelled or completed.');
                            return;
                          }
                          cancelTrip.mutate();
                        }},
                    ],
                  );
                }}
                disabled={cancelTrip.isPending}
              >
                <Ionicons name="eye-off-outline" size={18} color="#F59E0B" />
                <Text style={[styles.secondaryBtnText, { color: '#F59E0B' }]}>
                  {cancelTrip.isPending ? '…' : 'No Show'}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.cancelBtn, { flex: 1 }]}
                onPress={handleCancel}
                disabled={cancelTrip.isPending}
              >
                <Ionicons name="close-circle-outline" size={18} color={colors.error} />
                <Text style={[styles.secondaryBtnText, { color: colors.error }]}>
                  {cancelTrip.isPending ? 'Cancelling…' : 'Cancel Trip'}
                </Text>
              </Pressable>
            </Entrance>
          )}
        </View>
      </InlayPanel>
    </View>
  );
}

// ── Status badge ──
const TRIP_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  SCHEDULED:          { label: 'Scheduled',       color: '#94A3B8' },
  FILLING:            { label: 'Boarding',         color: '#3B82F6' },
  DRIVER_EN_ROUTE:    { label: 'En Route',         color: '#F59E0B' },
  ARRIVED_AT_PICKUP:  { label: 'Arrived',          color: '#A78BFA' },
  IN_PROGRESS:        { label: 'In Progress',      color: '#22C55E' },
  COMPLETED:          { label: 'Completed',        color: '#60A5FA' },
  CANCELLED:          { label: 'Cancelled',        color: '#F87171' },
};

function TripStatusBadge({ status, colors }: { status: string; colors: DriverColors }) {
  const cfg = TRIP_STATUS_CONFIG[status] ?? { label: status, color: colors.onSurfaceVariant };
  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: `${cfg.color}22`,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: `${cfg.color}55`,
      paddingHorizontal: 10,
      paddingVertical: 4,
    }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: cfg.color }} />
      <Text style={{ fontFamily: fonts.semiBold, fontSize: 11, color: cfg.color }}>{cfg.label}</Text>
    </View>
  );
}

// ── Pulsing pickup marker ──
function PulseMarker({ color }: { color?: string }) {
  const colors = useColors();
  const resolvedColor = color ?? colors.primary;
  return (
    <PulseRing size={40} color={resolvedColor} ringCount={2} duration={1500}>
      <View style={[pulseStyles.dot, { backgroundColor: resolvedColor, borderColor: '#030C18' }]} />
    </PulseRing>
  );
}

const pulseStyles = StyleSheet.create({
  ring: { position: 'absolute', width: 20, height: 20, borderRadius: 10 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
});

// ── Styles ──
const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: 'transparent' },
    loadingContainer: { padding: spacing['2xl'], gap: spacing.lg },
    skeleton: { height: 20, borderRadius: 10, backgroundColor: colors.surfaceContainerHigh },
    headerOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      paddingTop: 50,
      paddingHorizontal: spacing.xl,
      zIndex: 10,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: 'rgba(6,15,26,0.9)',
      borderRadius: radii['2xl'],
      borderWidth: 1,
      borderColor: colors.outline,
      padding: spacing.sm,
    },
    headerBtn: {
      width: 36,
      height: 36,
      borderRadius: 12,
      backgroundColor: colors.surfaceContainer,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerRouteInfo: { flex: 1 },
    headerRoute: {
      fontFamily: fonts.displaySemiBold,
      fontSize: fontSizes.bodySmall,
      color: colors.onSurface,
    },
    liveBadge: {
      position: 'absolute',
      top: 110,
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      backgroundColor: 'rgba(6,15,26,0.85)',
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.xs,
      borderRadius: radii.full,
      borderWidth: 1,
      borderColor: colors.primary + '40',
      zIndex: 10,
    },
    liveDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.primary,
    },
    liveText: {
      fontFamily: fonts.semiBold,
      fontSize: 11,
      color: colors.primary,
      letterSpacing: 1.5,
    },
    etaPill: {
      position: 'absolute',
      left: spacing.xl,
      top: 155,
      zIndex: 10,
    },
    passengerPill: {
      position: 'absolute',
      right: spacing.xl,
      top: 155,
      zIndex: 10,
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
      borderColor: colors.primary + '30',
    },
    etaPillText: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodySmall,
      color: colors.primary,
    },
    statusBanner: {
      position: 'absolute',
      top: 150,
      left: spacing.base,
      right: spacing.base,
      zIndex: 20,
      borderRadius: radii['2xl'],
      overflow: 'hidden',
    },
    statusBannerBlur: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.sm,
      borderWidth: 1.5,
      borderColor: colors.primary + '60',
      borderRadius: radii['2xl'],
      overflow: 'hidden',
    },
    statusBannerIcon: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    statusBannerLabel: {
      fontFamily: fonts.semiBold,
      fontSize: 9,
      color: colors.primary,
      letterSpacing: 1.5,
      marginBottom: 1,
    },
    statusBannerText: {
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodySmall,
      color: colors.onSurface,
    },
    sheetBackground: {
      backgroundColor: colors.background,
      borderTopLeftRadius: radii['3xl'],
      borderTopRightRadius: radii['3xl'],
    },
    sheetHandle: { backgroundColor: colors.outline, width: 40, height: 4 },
    sheetContent: {
      paddingHorizontal: spacing['2xl'],
      paddingBottom: spacing['2xl'],
      gap: spacing.base,
    },
    etaSection: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: radii.xl,
      padding: spacing.base,
      overflow: 'hidden',
    },
    glassInset: StyleSheet.absoluteFillObject,
    etaLeft: { alignItems: 'center', flex: 1 },
    etaValue: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.titleLarge,
      lineHeight: Math.round(fontSizes.titleLarge * 1.4),
      color: colors.primary,
    },
    etaDivider: { width: 1, height: 40, backgroundColor: colors.outlineVariant },
    etaRight: { flex: 2, paddingLeft: spacing.base },
    etaStatus: {
      fontFamily: fonts.displaySemiBold,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
      color: colors.onSurface,
    },
    passengerListCard: {
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outline,
      padding: spacing.base,
      gap: spacing.sm,
    },
    passengerListHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    passengerListTitle: {
      fontFamily: fonts.displaySemiBold,
      fontSize: fontSizes.bodyMedium,
      color: colors.onSurface,
    },
    passengerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.xs,
    },
    passengerAvatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surfaceContainerHigh,
      alignItems: 'center',
      justifyContent: 'center',
    },
    passengerInitial: {
      fontFamily: fonts.semiBold,
      fontSize: 13,
      color: colors.onSurface,
    },
    passengerName: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodySmall,
      color: colors.onSurface,
    },
    boardedBadge: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: radii.full,
    },
    boardedText: {
      fontFamily: fonts.semiBold,
      fontSize: 9,
      letterSpacing: 0.3,
    },
    secondaryActions: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    secondaryBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outline,
      paddingVertical: spacing.sm,
    },
    secondaryBtnText: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.caption,
    },
    cancelRow: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    cancelBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.error + '55',
      paddingVertical: spacing.sm,
    },
    driverMarker: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: '#fff',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: '#3B82F6',
      shadowColor: '#3B82F6',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.5,
      shadowRadius: 8,
      elevation: 8,
    },
    destMarker: {
      width: 32,
      height: 32,
      borderRadius: 8,
      backgroundColor: colors.error,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: '#fff',
    },
  });
