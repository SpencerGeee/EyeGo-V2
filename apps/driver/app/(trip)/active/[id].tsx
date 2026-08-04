'use strict';
import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { formatGhs } from '@eyego/utils';
import {
  View,
  StyleSheet,
  Pressable,
  Alert,
  Linking,
  Platform,
  Modal,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import * as KeepAwake from 'expo-keep-awake';
import * as Location from 'expo-location';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { driverApi, driverSocketEvents } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button, Skeleton, Entrance, GlassSurface, GradientGlowBorder, InlayPanel, SwipeToConfirm } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../../utils/useColors';
import { useDriverStore } from '../../../stores/driver.store';
import { useNotificationsStore } from '../../../stores/notifications.store';
import { useDriverSocket } from '../../../hooks/useDriverSocket';
import { useDriverLocation } from '../../../hooks/useDriverLocation';
import { SeatMap } from '../../../components/SeatMap';
import { offlineQueue } from '../../../utils/offlineQueue';
import { openExternalNavigation } from '../../../utils/externalNav';
// Driver app uses the blue-highway dark variant, not rider's brand-green default export.
import { eyegoDriverDarkStyle as eyegoDarkStyle } from '@eyego/map-styles';
import MapboxGL, { useDeviceHeading, useVehicleHeading } from '../../../utils/mapbox';
import { fetchRoute } from '../../../utils/routing';

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_FLOW: Record<string, { label: string; next: string | null; action: string }> = {
  // "Start Trip" is a SCHEDULED-ride concept only: the driver committed to a
  // trip earlier and taps it when they actually set off. An on-demand ride is
  // different — accepting the dispatch *is* setting off, so those trips are
  // created straight at DRIVER_EN_ROUTE server-side (trip-request.service.js)
  // and never surface a Start Trip button at all.
  //
  // CONFIRMED still reaches here for a scheduled trip whose bookings got paid
  // (payments.service.js promotes SCHEDULED → CONFIRMED), so it keeps the same
  // treatment as SCHEDULED/FILLING. Without an entry it fell through to a
  // fallback whose action VALID_ADVANCE_STATUSES didn't accept, throwing
  // "Cannot advance from status: CONFIRMED" client-side.
  CONFIRMED:          { label: 'Confirmed',            next: 'start',  action: 'Start Trip'    },
  SCHEDULED:          { label: 'Scheduled',           next: 'start',  action: 'Start Trip'    },
  FILLING:            { label: 'Boarding Open',        next: 'start',  action: 'Start Trip'    },
  DRIVER_EN_ROUTE:    { label: 'Heading to Pickup',    next: 'arrive', action: "I've Arrived"  },
  // Not "Start Trip" — the trip is long since started by this point; this is
  // the passenger-is-aboard, pulling-off action. Two buttons reading "Start
  // Trip" at different points in one flow is exactly what made this confusing.
  ARRIVED_AT_PICKUP:  { label: 'Arrived at Pickup',    next: 'depart', action: 'Start Ride'    },
  IN_PROGRESS:        { label: 'In Progress',          next: 'arrive', action: 'Mark Arrived'  },
  COMPLETED:          { label: 'Completed',            next: null,     action: ''              },
  CANCELLED:          { label: 'Cancelled',            next: null,     action: ''              },
};

const TRIP_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  CONFIRMED:          { label: 'Confirmed',         color: '#94A3B8' },
  SCHEDULED:          { label: 'Scheduled',        color: '#94A3B8' },
  FILLING:            { label: 'Boarding',          color: '#3B82F6' },
  DRIVER_EN_ROUTE:    { label: 'En Route',          color: '#F59E0B' },
  ARRIVED_AT_PICKUP:  { label: 'Arrived',           color: '#A78BFA' },
  IN_PROGRESS:        { label: 'In Progress',       color: '#4be277' },
  COMPLETED:          { label: 'Completed',         color: '#60A5FA' },
  CANCELLED:          { label: 'Cancelled',         color: '#F87171' },
};

const STATUS_STEPS = ['SCHEDULED', 'FILLING', 'DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'IN_PROGRESS', 'COMPLETED'];

/**
 * Active-route colours for the DRIVER app: bright core over a deep casing, the
 * two-layer arrangement every navigation renderer uses (Mapbox's own Nav SDK
 * ships #56A8FB over #2F7AC6).
 *
 * Two bugs are being fixed here at once, both reported from the road:
 *  1. The core used to be `statusCfg.color` — the STATUS pill's colour. So the
 *     line the driver has to follow was steel-grey while confirmed, blue while
 *     boarding and violet after arriving at pickup ("it's looking like a purple
 *     thing"), i.e. its most safety-critical property was a side effect of an
 *     unrelated label. It is now fixed, and status lives only in the pill.
 *  2. The driver map style paints its roads BLUE, so a blue-family route line
 *     disappeared into them — "isn't prominent enough and can get easily blended
 *     with the blue". Amber is the one hue that cannot collide with either the
 *     blue roads or the green "in progress" accent, and it is what Mapbox uses
 *     for the same reason in its traffic layers.
 *
 * The rider app deliberately uses the opposite pair (azure over navy) because
 * ITS map style paints roads green — see apps/rider/.../tracking.tsx.
 */
const ROUTE_CORE = '#FFB020';
const ROUTE_CASING = '#4A2B00';

// Fetches a road-following route from OSRM between the driver and a moving
// target (pickup, then destination), re-fetching whenever the target changes
// or every 60s while active — same source as tracking/[id].tsx.
function useRoadRoute(from: [number, number], to: [number, number]): [number, number][] {
  const [coords, setCoords] = React.useState<[number, number][]>([]);
  const fetchedForRef = useRef<string>('');

  useEffect(() => {
    const [dLng, dLat] = from;
    const [eLng, eLat] = to;
    if (isNaN(dLat) || isNaN(dLng) || isNaN(eLat) || isNaN(eLng)) return;
    const key = `${dLng.toFixed(4)},${dLat.toFixed(4)}-${eLng.toFixed(4)},${eLat.toFixed(4)}`;
    if (fetchedForRef.current === key) return;
    fetchedForRef.current = key;

    // Traffic-aware via /v1/geo/route rather than the public OSRM demo server —
    // see utils/routing.ts for why free-flow durations were wrong.
    fetchRoute([dLng, dLat], [eLng, eLat])
      .then((route) => {
        if (route && route.coordinates.length >= 2) setCoords(route.coordinates);
      })
      .catch(() => {
        // Routing unavailable — straight fallback line stays, no crash
      });
  }, [from[0], from[1], to[0], to[1]]);

  return coords;
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function ActiveTripScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const qc = useQueryClient();
  const { setActiveTripId } = useDriverStore();
  const { addNotification } = useNotificationsStore();
  const [showPaymentQr, setShowPaymentQr] = useState(false);
  // Physical handset orientation for the driver puck — see the marker below.
  const deviceHeading = useDeviceHeading();

  const { data: trip, isLoading } = useQuery({
    queryKey: ['driver', 'trip', 'active', id],
    // getTripById(id) — not getActiveTrip(), which is a findFirst that can
    // return the WRONG trip if the driver has more than one active trip.
    queryFn: () => driverApi.getTripById(id!),
    select: (r) => r.data.data?.trip ?? null,
    refetchInterval: 8000,
    enabled: !!id && typeof id === 'string',
  });

  useEffect(() => {
    if (!id || typeof id !== 'string') router.back();
  }, [id, router]);

  const isActiveTrip = !!trip && !['COMPLETED', 'CANCELLED'].includes(trip.status);

  useEffect(() => {
    if (isActiveTrip) KeepAwake.activateKeepAwake();
    else KeepAwake.deactivateKeepAwake();
    return () => { KeepAwake.deactivateKeepAwake(); };
  }, [isActiveTrip]);

  useDriverSocket({ tripId: id, enabled: !!trip });
  const { location } = useDriverLocation({ enabled: isActiveTrip });

  // Marker heading: GPS course while moving, last known heading while stopped,
  // compass only as a cold-start hint. See the puck marker below.
  const vehicleHeading = useVehicleHeading({
    latitude: location?.latitude,
    longitude: location?.longitude,
    gpsCourse: location?.heading,
    speedMps: location?.speed,
    compassHeading: deviceHeading,
  });

  useEffect(() => {
    if (!trip) return;
    if (['COMPLETED', 'CANCELLED'].includes(trip.status)) return;

    const unsubPayment = driverSocketEvents.onPaymentConfirmed((data) => {
      if (data.tripId === id) {
        addNotification({ type: 'PAYMENT_CONFIRMED', title: 'Payment Confirmed', body: 'A passenger just completed their payment.', tripId: id });
        Alert.alert('Payment Confirmed', 'A passenger just completed their payment.');
        qc.invalidateQueries({ queryKey: ['driver', 'trip', 'active', id] });
      }
    });

    const unsubSeat = driverSocketEvents.onSeatUpdate((data) => {
      if (data.tripId === id) qc.invalidateQueries({ queryKey: ['driver', 'trip', 'active', id] });
    });

    return () => { unsubPayment(); unsubSeat(); };
  }, [trip?.status, id, qc, addNotification]);

  // Route to the dedicated cancel screen (reason picker + note + penalty
  // warning) instead of a bare confirm Alert with no reason capture.
  const handleCancel = () => router.push(`/(trip)/cancel/${id}` as Href);

  // Dedicated no-show endpoint — not cancelTrip. It guards to pre-departure
  // states only, issues no-show-labeled refunds, and sends riders the
  // correct "driver no-show" push copy instead of a generic cancellation one.
  const noShowTrip = useMutation({
    mutationFn: () => driverApi.driverNoShow(id),
    onSuccess: () => {
      setActiveTripId(null);
      qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
      qc.invalidateQueries({ queryKey: ['driver', 'trips', 'all'] });
      router.replace('/(tabs)/home');
    },
    onError: (err: any) => Alert.alert('Error', err?.response?.data?.message ?? (err as Error).message),
  });

  const pendingFromStatus = useRef<string | null>(null);
  // CONFIRMED included: it's the status a trip has immediately after a driver
  // accepts (acceptDispatch/acceptTripRequest both set status: 'CONFIRMED'),
  // including on a resumed trip reopened from the home screen's "Resume Trip"
  // banner. Without it, "Start Trip" on a CONFIRMED trip threw client-side
  // instead of ever calling the backend.
  const VALID_ADVANCE_STATUSES = ['CONFIRMED', 'SCHEDULED', 'FILLING', 'DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'IN_PROGRESS'];

  const advanceStatus = useMutation({
    retry: 1,
    mutationFn: async () => {
      const status = trip?.status;
      if (!status || !VALID_ADVANCE_STATUSES.includes(status)) throw new Error(`Cannot advance from status: ${status ?? 'unknown'}`);
      pendingFromStatus.current = status;
      if (status === 'CONFIRMED' || status === 'SCHEDULED' || status === 'FILLING') return driverApi.startTrip(id);
      if (status === 'DRIVER_EN_ROUTE') return driverApi.arriveAtPickup(id);
      if (status === 'ARRIVED_AT_PICKUP') return driverApi.departTrip(id);
      if (status === 'IN_PROGRESS') return driverApi.arriveTrip(id);
      throw new Error('Cannot advance from current status');
    },
    onSuccess: (res) => {
      const fromStatus = pendingFromStatus.current;
      let toStatus: string | null = null;
      if (fromStatus === 'CONFIRMED' || fromStatus === 'SCHEDULED' || fromStatus === 'FILLING') toStatus = 'DRIVER_EN_ROUTE';
      else if (fromStatus === 'DRIVER_EN_ROUTE') toStatus = 'ARRIVED_AT_PICKUP';
      else if (fromStatus === 'ARRIVED_AT_PICKUP') toStatus = 'IN_PROGRESS';
      else if (fromStatus === 'IN_PROGRESS') toStatus = 'COMPLETED';

      if (toStatus === 'DRIVER_EN_ROUTE') {
        driverSocketEvents.emitTripStarted(id);
        addNotification({ type: 'DRIVER_EN_ROUTE', title: 'Trip started', body: 'You are now en route to the pickup stop.', tripId: id });
        qc.invalidateQueries({ queryKey: ['driver', 'trip', 'active', id] });
        qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
        // Redirect driver to the live tracking screen
        router.replace({ pathname: '/(trip)/tracking/[id]', params: { id } } as Href);
        return;
      }
      if (toStatus === 'ARRIVED_AT_PICKUP') {
        // Previously no socket emit fired here at all — a rider on the
        // tracking screen got no real-time signal the driver had arrived,
        // so the trip appeared to jump straight from "en route" to whatever
        // the driver's NEXT tap (depart) produced, looking like a skipped
        // step or a mixed-up status.
        driverSocketEvents.emitArrivedAtPickup(id);
        addNotification({ type: 'ARRIVED_AT_PICKUP', title: 'Arrived at pickup', body: 'You have arrived at the pickup stop.', tripId: id });
      }
      if (toStatus === 'IN_PROGRESS') {
        driverSocketEvents.emitTripDeparted(id);
        addNotification({ type: 'IN_PROGRESS', title: 'Trip in progress', body: 'You have departed. Ride is underway.', tripId: id });
      }

      if (toStatus === 'COMPLETED') {
        driverSocketEvents.emitArrived(id);
        setActiveTripId(null);
        qc.invalidateQueries({ queryKey: ['driver', 'trip', 'active', id] });
        qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
        qc.invalidateQueries({ queryKey: ['driver', 'trips', 'all'] });
        qc.invalidateQueries({ queryKey: ['driver', 'me'] });
        qc.invalidateQueries({ queryKey: ['driver', 'quests'] });
        // Refresh wallet balance + transaction list so home/earnings show the
        // new trip earnings immediately instead of a stale balance.
        qc.invalidateQueries({ queryKey: ['driver', 'wallet'] });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = (res as any)?.data;
        const earningsThisTrip = raw?.data?.earningsThisTrip ?? raw?.data?.totalEarningsPesewas ?? 0;
        const safeEarnings = (typeof earningsThisTrip === 'number' && !isNaN(earningsThisTrip)) ? earningsThisTrip : 0;
        addNotification({ type: 'COMPLETED', title: 'Trip completed!', body: `You earned ${formatGhs(safeEarnings)} from this trip.`, tripId: id });
        router.replace({ pathname: '/(trip)/complete/[id]', params: { id, earnings: String(safeEarnings) } } as Href);
        return;
      }

      qc.invalidateQueries({ queryKey: ['driver', 'trip', 'active', id] });
      qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
    },
    onError: (err) => Alert.alert('Error', (err as Error).message),
  });

  // Route coordinates for the road-following polyline. This MUST be computed
  // (and useRoadRoute called) before the loading early-return below, not
  // after it — useRoadRoute is a hook, and calling it only on renders where
  // `trip` has already loaded (skipped entirely on the first, loading render)
  // violates the Rules of Hooks: the hook count changes between renders,
  // which throws "Rendered more hooks than during the previous render" the
  // instant the query resolves. That uncaught render error is what the
  // root _layout.tsx ErrorBoundary was catching and showing as "Something
  // went wrong / Restart App" when resuming a trip from home (a fresh query,
  // guaranteed to render once in the loading state first) — trips reached via
  // the create-trip flow could avoid it if the data happened to already be
  // cached, which is why it looked resume-specific.
  // driverCoord's Accra fallback is fine to keep: it only ever seeds
  // NavCamera.fallbackCenter and the driver's own position pulse before a
  // live GPS fix arrives — a self-view convenience, never sent to the rider.
  const driverCoord: [number, number] = location
    ? [location.longitude, location.latitude]
    : [trip?.route?.originLng ?? -0.187, trip?.route?.originLat ?? 5.6037];
  // BUGFIX: pickup/dest markers used to silently collapse onto driverCoord's
  // Accra fallback whenever trip.route lacked real coordinates, rendering a
  // fake pickup/destination pin on the driver's own map. An active trip's
  // route should always carry real coordinates (route creation requires
  // successful geocoding), but stay null instead of fabricating one if it
  // somehow doesn't — the marker guards below then simply render nothing.
  const pickupCoord: [number, number] | null = typeof trip?.route?.originLat === 'number' && typeof trip?.route?.originLng === 'number'
    ? [trip.route.originLng, trip.route.originLat]
    : null;
  const destCoord: [number, number] | null = typeof trip?.route?.destLat === 'number' && typeof trip?.route?.destLng === 'number'
    ? [trip.route.destLng, trip.route.destLat]
    : pickupCoord;
  // Navigate to pickup while en-route/arrived, then to destination once the
  // trip is actually running — mirrors tracking/[id].tsx's target logic.
  // Falls back to driverCoord only as the OSRM/polyline target so the route
  // line has somewhere plausible to draw to — this is display-only geometry,
  // not a coordinate presented as a real pickup/destination.
  const routeTarget: [number, number] = (trip?.status === 'IN_PROGRESS' || trip?.status === 'COMPLETED'
    ? destCoord
    : pickupCoord) ?? driverCoord;
  const routeCoords = useRoadRoute(driverCoord, routeTarget);

  // What the external-navigation hand-off should aim at: the same phase rule as
  // the route line above, so tapping Navigate never contradicts the line the
  // driver is already following.
  const externalNavTarget = useCallback(() => {
    const inProgress = trip?.status === 'IN_PROGRESS' || trip?.status === 'COMPLETED';
    const coord = (inProgress ? destCoord : pickupCoord) ?? destCoord ?? pickupCoord;
    return {
      latitude: coord ? coord[1] : NaN,
      longitude: coord ? coord[0] : NaN,
      label: inProgress
        ? (trip?.route?.destinationName ?? 'Destination')
        : (trip?.route?.originName ?? 'Pickup'),
    };
  }, [trip?.status, trip?.route?.destinationName, trip?.route?.originName, destCoord, pickupCoord]);

  // ─── Loading skeleton ────────────────────────────────────────────────────

  if (isLoading || !trip) {
    return (
      <View style={styles.safe}>
        <MapboxGL.MapView
          style={StyleSheet.absoluteFillObject}
          styleURL={eyegoDarkStyle}
          logoEnabled={false}
          attributionEnabled={false}
          compassEnabled={false}
          rotateEnabled={false}
          scaleBarEnabled={false}
          zoomEnabled={false}
          scrollEnabled={false}
        />
        <View style={[styles.loadingOverlay, { paddingTop: insets.top + 20 }]}>
          {[120, 80, 160].map((w, i) => (
            <Skeleton key={i} width={w} height={16} borderRadius={radii.md} />
          ))}
        </View>
        {/* Escape hatch — without this, a trip that's no longer in getActiveTrip's
            result set (e.g. mid-transition) leaves the driver stuck on this skeleton
            with no way back short of force-closing the app. */}
        {!isLoading && !trip && (
          <Pressable
            onPress={() => router.replace('/(tabs)' as any)}
            hitSlop={12}
            style={[styles.backEscapeButton, { top: insets.top + 12 }]}
          >
            <Text style={{ color: '#fff', fontFamily: fonts.semiBold, fontSize: 13 }}>← Back to Home</Text>
          </Pressable>
        )}
      </View>
    );
  }

  // ─── Derived data ────────────────────────────────────────────────────────

  const statusInfo = STATUS_FLOW[trip.status] ?? STATUS_FLOW.FILLING;
  const statusCfg = TRIP_STATUS_CONFIG[trip.status] ?? { label: trip.status, color: colors.onSurfaceVariant };
  const rawBookings = trip.bookings ?? [];
  const total = trip.maxSeats ?? 14;
  // farePerSeatPesewas IS the full passenger-facing fare (same value as booking.fareAmountPesewas) —
  // it is NOT the driver's net cut. Use the backend-computed commissionRate/
  // driverEarningsPerSeatPesewas directly instead of guessing a split client-side.
  const fullFare      = trip.farePerSeatPesewas ?? 0;
  const commissionRate = trip.commissionRate ?? 0.15;
  // Integer pesewas: take the commission and keep the REMAINDER, exactly as
  // the server does, so the fallback can never disagree with the receipt by a
  // pesewa. `parseFloat(x.toFixed(2))` was the cedis-era way of saying this and
  // is now both wrong (the values are pesewas) and unnecessary.
  const fare          = trip.driverEarningsPerSeatPesewas ?? fullFare - Math.round(fullFare * commissionRate);
  const activeBookings = rawBookings.filter((b: any) => b.status !== 'CANCELLED');
  const passengers = activeBookings.length;
  const grossEarnings = passengers * fullFare;
  const platformFeePesewas   = passengers * (fullFare - fare);
  const netEarnings   = passengers * fare;
  const seats = activeBookings.map((b: any) => ({
    seatNumber: b.seatNumber,
    // Only show seat as occupied when payment is confirmed or it's an offline booking
    status: (
      b.status === 'BOARDED'
        ? 'BOARDED'
        : (b.paymentStatus === 'PAID' || b.isOffline || b.paymentMethod === 'CASH')
          ? 'BOOKED'
          : 'EMPTY'
    ) as 'BOARDED' | 'BOOKED' | 'EMPTY',
    userId: b.user?.id ?? b.userId,
    userName: b.user?.name ?? 'Passenger',
    bookingId: b.id,
  }));

  // driverCoord/pickupCoord/destCoord/routeTarget/routeCoords are computed
  // above (before the loading early-return) since routeCoords needs the
  // useRoadRoute hook call to happen unconditionally on every render.

  const currentStepIndex = STATUS_STEPS.indexOf(trip.status);

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <View style={styles.safe}>
      {/* Full-screen dark map */}
      <MapboxGL.MapView
        style={StyleSheet.absoluteFillObject}
        styleURL={eyegoDarkStyle}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={true}
        // BUGFIX: was `true` — user rotate gestures changed the map's bearing,
        // but the driver marker's `rotation` prop below is an absolute compass
        // heading applied as a screen-space transform (see AnimatedMarkerView
        // in @eyego/maps). It isn't compensated for map bearing, so any map
        // rotation (gesture, or NavCamera's old course-tracking — see that
        // component) desynced the marker from true GPS heading, making the
        // pin appear to turn only when the map was rotated by hand instead of
        // when the phone/vehicle actually changed direction. Matches the same
        // north-up-map + heading-driven-marker pattern already used on the
        // tracking/[id].tsx screen.
        // 3D rotate/tilt gestures are on. They were briefly disabled to stop
        // the driver pin spinning with the map; that desync is now fixed
        // properly — @eyego/maps compensates marker rotation for the live map
        // bearing — so the gesture is back without the side effect.
        rotateEnabled={true}
        pitchEnabled={true}
        scaleBarEnabled={false}
      >
        {/* 3D tilted follow camera — always on for this screen, matching the
            rider's tracking map. It used to flip to a flat overview outside
            DRIVER_EN_ROUTE/IN_PROGRESS, so the map lurched between 2D and 3D
            on every status change mid-trip. A trip screen is a nav screen for
            its whole life; the tilt shouldn't be an event-triggered surprise. */}
        <MapboxGL.NavCamera active fallbackCenter={driverCoord} />
        {/* Driver puck — heading comes from useVehicleHeading, which prefers GPS
            course over ground while moving, derives a bearing from consecutive
            fixes when the device reports no course, holds the last heading when
            stopped, and only ever consults the compass before any travel
            heading has been seen.
            Reported as "it moves as the phone moves, but the direction may be
            wrong and it turns too much": rotating by the COMPASS first is what
            caused that. A handset in a metal car cradle reads the cradle, not
            the road. `rotation` here is still a TRUE compass bearing that
            @eyego/maps compensates against the live map bearing — the artwork's
            own tilt stays on the artwork, inside DriverPulse. */}
        <MapboxGL.AnimatedMarkerView
          coordinate={driverCoord}
          rotation={vehicleHeading}
          duration={1000}
        >
          <DriverPulse color={statusCfg.color} />
        </MapboxGL.AnimatedMarkerView>

        {/* Pickup marker — hidden once the trip is actually running */}
        {trip.status !== 'IN_PROGRESS' && trip.status !== 'COMPLETED' && pickupCoord && (
          <MapboxGL.MarkerView coordinate={pickupCoord}>
            <View style={styles.pickupMarker}>
              <Ionicons name="location" size={14} color="#fff" />
            </View>
          </MapboxGL.MarkerView>
        )}

        {/* Destination marker */}
        {destCoord && (
          <MapboxGL.MarkerView coordinate={destCoord}>
            <View style={styles.destMarker}>
              <Ionicons name="flag" size={14} color="#fff" />
            </View>
          </MapboxGL.MarkerView>
        )}

        {/* Route polyline — road-following via OSRM, straight-line fallback until it resolves */}
        <MapboxGL.ShapeSource
          id="activeRouteLine"
          shape={{
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: routeCoords.length >= 2 ? routeCoords : [driverCoord, routeTarget],
            },
            properties: {},
          }}
        >
          {/* CASING + CORE, not a blurred shadow — see ROUTE_CORE. */}
          <MapboxGL.LineLayer
            id="activeRouteLineShadow"
            style={{ lineColor: ROUTE_CASING, lineWidth: 11, lineOpacity: 0.95, lineCap: 'round', lineJoin: 'round' }}
          />
          <MapboxGL.LineLayer
            id="activeRouteLineLayer"
            style={{
              lineColor: ROUTE_CORE,
              lineWidth: 6,
              lineOpacity: 1,
              lineCap: 'round',
              lineJoin: 'round',
              // Dashed while this is the straight-line stand-in, so the driver is
              // never shown a fabricated "road" to follow.
              ...(routeCoords.length >= 2 ? null : { lineDasharray: [1.6, 1.4] }),
            }}
            aboveLayerID="activeRouteLineShadow"
          />
        </MapboxGL.ShapeSource>
      </MapboxGL.MapView>

      {/* Glassmorphic top header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable style={styles.headerIconBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
        </Pressable>

        <View style={styles.headerCenter}>
          <Text style={styles.headerRoute} numberOfLines={1}>
            {trip.route?.originName ?? '—'} → {trip.route?.destinationName ?? '—'}
          </Text>
          <View style={styles.statusBadge}>
            <View style={[styles.statusDot, { backgroundColor: statusCfg.color }]} />
            <Text style={[styles.statusLabel, { color: statusCfg.color }]}>{statusCfg.label}</Text>
          </View>
        </View>

        <Pressable
          style={styles.sosBtn}
          onPress={() =>
            Alert.alert(
              'Emergency SOS',
              'This will call Ghana Police (191). Are you in immediate danger?',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Call 191',
                  style: 'destructive',
                  onPress: async () => {
                    let pos: Awaited<ReturnType<typeof Location.getLastKnownPositionAsync>> = null;
                    try { pos = await Location.getLastKnownPositionAsync(); } catch { /* no position — send alert without coords */ }
                    const payload = {
                      latitude: pos?.coords.latitude,
                      longitude: pos?.coords.longitude,
                      timestamp: new Date().toISOString(),
                    };
                    try {
                      await driverApi.emergencyAlert(id, payload);
                    } catch {
                      // Never block the actual emergency call — but the alert
                      // must still reach dispatch, so queue it for retry.
                      offlineQueue.enqueue('SOS', `/driver/trips/${id}/emergency`, 'POST', payload);
                    }
                    Linking.openURL('tel:191');
                  },
                },
              ],
            )
          }
        >
          <Text style={styles.sosBtnText}>SOS</Text>
        </Pressable>
      </View>

      {/* Draggable bottom sheet */}
      <InlayPanel
        snapPointsPct={[0.38, 0.75]}
        initialState="collapsed"
        sheetStyle={styles.sheetBackground}
        grabberColor={colors.outline}
      >
        <View style={styles.sheetContent}>
          {/* Route summary */}
          <Entrance animation="slideDown">
            <View style={styles.routeSummary}>
              <View style={styles.routeDot} />
              <Text variant="titleSmall" style={{ flex: 1 }} numberOfLines={1}>
                {trip.route?.originName ?? '—'}
              </Text>
            </View>
            <View style={styles.routeLine} />
            <View style={[styles.routeSummary, { marginBottom: spacing.xl }]}>
              <View style={[styles.routeDot, { backgroundColor: colors.secondary ?? '#7DD8F5', borderRadius: 3 }]} />
              <Text variant="titleSmall" style={{ flex: 1 }} numberOfLines={1}>
                {trip.route?.destinationName ?? '—'}
              </Text>
              <View style={styles.tripMeta}>
                <Text variant="caption" color={colors.onSurfaceVariant}>
                  {trip.departureTime
                    ? new Date(trip.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : '--:--'}{' '}
                  · {passengers}/{total} seats
                </Text>
              </View>
            </View>
          </Entrance>

          {/* Step progress chips */}
          <Entrance animation="slideDown" delay={40} style={styles.stepsRow}>
            {STATUS_STEPS.slice(0, -1).map((step, i) => {
              const cfg = TRIP_STATUS_CONFIG[step];
              const isDone = i < currentStepIndex;
              const isCurrent = i === currentStepIndex;
              return (
                <React.Fragment key={step}>
                  <View style={[
                    styles.stepChip,
                    isDone && { backgroundColor: colors.primary + '22', borderColor: colors.primary + '55' },
                    isCurrent && { backgroundColor: cfg.color + '22', borderColor: cfg.color + '66' },
                  ]}>
                    {isDone
                      ? <Ionicons name="checkmark" size={9} color={colors.primary} />
                      : <View style={[styles.stepDot, { backgroundColor: isCurrent ? cfg.color : colors.outlineVariant }]} />}
                    <Text style={[
                      styles.stepLabel,
                      isDone && { color: colors.primary },
                      isCurrent && { color: cfg.color },
                    ]}>
                      {cfg.label}
                    </Text>
                  </View>
                  {i < STATUS_STEPS.length - 2 && (
                    <View style={[styles.stepConnector, i < currentStepIndex && { backgroundColor: colors.primary }]} />
                  )}
                </React.Fragment>
              );
            })}
          </Entrance>

          {/* Seat map */}
          <Entrance animation="slideDown" delay={80} style={styles.card}>
            <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii['2xl']} intensity="low" />
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Seat Map</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Text variant="bodySmall" color={colors.onSurfaceVariant}>{passengers}/{total} booked</Text>
                <Pressable
                  onPress={() => setShowPaymentQr(true)}
                  style={styles.qrBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Show payment QR code"
                  hitSlop={8}
                >
                  <Ionicons name="qr-code-outline" size={16} color={colors.primary} />
                </Pressable>
              </View>
            </View>
            <SeatMap
              seats={seats}
              totalSeats={total}
              onSeatPress={(seat) => {
                const name = seat.userName ?? 'Passenger';
                Alert.alert(
                  `Seat ${seat.seatNumber} · ${name}`,
                  'What would you like to do?',
                  [
                    {
                      text: 'Message',
                      onPress: () =>
                        router.push({
                          pathname: '/(trip)/chat/[id]',
                          params: {
                            id,
                            seatNumber: String(seat.seatNumber),
                            recipientId: seat.userId ?? '',
                            riderName: encodeURIComponent(name),
                          },
                        } as any),
                    },
                    {
                      text: 'Mark Boarded',
                      onPress: () => {
                        if (!seat.bookingId) return;
                        driverApi.boardPassenger(id, seat.bookingId)
                          .then(() => qc.invalidateQueries({ queryKey: ['driver', 'trip', 'active', id] }))
                          .catch((err: any) => Alert.alert('Error', err?.response?.data?.message ?? 'Failed'));
                      },
                    },
                    { text: 'Cancel', style: 'cancel' },
                  ],
                );
              }}
            />
            <View style={styles.legend}>
              {[
                { color: colors.primary, label: 'Boarded' },
                { color: `${colors.primary}55`, label: 'Reserved' },
                { color: colors.surfaceContainerHighest, label: 'Empty' },
              ].map(({ color, label }) => (
                <View key={label} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: color }]} />
                  <Text variant="caption" color={colors.onSurfaceVariant}>{label}</Text>
                </View>
              ))}
            </View>
          </Entrance>

          {/* Earnings card — the screen's hero money surface gets the premium ring */}
          <Entrance animation="slideDown" delay={120}>
            <GradientGlowBorder
              palette="driver"
              fillColor={colors.surfaceContainer}
              borderRadius={radii['2xl']}
              glow
              style={styles.earningsCard}
            >
              <Text style={styles.earningsTitle}>Earnings Estimate</Text>
              <View style={styles.earningsRow}>
                <Text variant="bodySmall" color={colors.onSurfaceVariant}>Gross ({passengers} seats)</Text>
                <Text variant="bodyMedium">{formatGhs(grossEarnings)}</Text>
              </View>
              <View style={styles.earningsRow}>
                {/* The percentage is READ from the same commissionRate the amount
                    below is derived from. It was hardcoded to "30%" while the
                    server has always charged 15% (env.PLATFORM_COMMISSION), so
                    this screen told drivers they were losing twice what they
                    actually lose — and disagreed with the create-trip screen and
                    the trip-complete receipt on the same trip. */}
                <Text variant="bodySmall" color={colors.onSurfaceVariant}>
                  Platform fee ({Math.round(commissionRate * 100)}%)
                </Text>
                <Text variant="bodyMedium" color={colors.error}>− {formatGhs(platformFeePesewas)}</Text>
              </View>
              <View style={[styles.earningsRow, styles.earningsNet]}>
                <Text variant="label">Your earnings</Text>
                <Text style={styles.earningsNetValue}>{formatGhs(netEarnings)}</Text>
              </View>
            </GradientGlowBorder>
          </Entrance>

          {/* Quick-action row */}
          <Entrance animation="slideDown" delay={160} style={styles.actionRow}>
            {/* Hand off to Google/Apple Maps/Waze — the driver's own app, with
                the choice remembered (long-press to change it). See
                utils/externalNav.
                BUGFIX: this always navigated to the DESTINATION, even while the
                status was DRIVER_EN_ROUTE — i.e. exactly when the driver needs
                directions to the PICKUP. It also hard-coded Apple Maps on iOS
                with no way to choose Google, and used `maps://?ll=` (drop a pin)
                rather than a directions URL, so it didn't start navigation at
                all. Target now follows the trip phase, same rule as the in-app
                route line. */}
            <QuickAction
              icon="navigate-outline"
              label="Navigate"
              color={colors.primary}
              onPress={() => {
                void openExternalNavigation(externalNavTarget(), { forceChooser: false });
              }}
              onLongPress={() => {
                void openExternalNavigation(externalNavTarget(), { forceChooser: true });
              }}
              colors={colors}
            />
            <QuickAction
              icon="person-add-outline"
              label="Add Rider"
              color={colors.primary}
              onPress={() => router.push({ pathname: '/(trip)/add-passenger', params: { tripId: id } })}
              colors={colors}
            />
            <QuickAction
              icon="chatbubble-outline"
              label="Chat"
              color={colors.onSurfaceVariant}
              onPress={() => router.push(`/(trip)/chat/${id}`)}
              colors={colors}
            />
            <QuickAction
              icon="map-outline"
              label="Tracking"
              color={colors.onSurfaceVariant}
              onPress={() => router.push(`/(trip)/tracking/${id}`)}
              colors={colors}
            />
          </Entrance>

          {/* Primary CTA — SWIPE, not tap.
              Every action behind this control is irreversible (arriving at the
              pickup, pulling off with passengers aboard, ending the trip and
              settling the fares) and the phone lives in a cradle on a rough
              road, where a single accidental tap is entirely plausible. Uber and
              Bolt both moved these exact steps to a slide gesture for that
              reason. See @eyego/ui SwipeToConfirm. */}
          {statusInfo.next && (
            <Entrance animation="slideDown" delay={200}>
              <SwipeToConfirm
                label={`Swipe to ${statusInfo.action.replace(/^(I've|Mark)\s+/i, '').toLowerCase()}`}
                loadingLabel={`${statusInfo.action}…`}
                onConfirm={() => advanceStatus.mutate()}
                loading={advanceStatus.isPending}
                color={colors.primary}
                onColor={colors.onPrimary ?? '#0A0D14'}
                trackColor={colors.surfaceContainer}
                borderColor={colors.outline}
              />
            </Entrance>
          )}

          {/* No Show / Cancel */}
          {!['COMPLETED', 'CANCELLED'].includes(trip.status) && (
            <Entrance animation="slideDown" delay={220} style={styles.dangerRow}>
              <Pressable
                style={[styles.dangerBtn, { borderColor: '#F59E0B66' }]}
                onPress={() =>
                  Alert.alert(
                    'Mark as No Show',
                    'Mark this trip as a no-show? This will cancel all bookings.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Mark No Show', style: 'destructive', onPress: () => noShowTrip.mutate() },
                    ],
                  )
                }
                disabled={noShowTrip.isPending}
              >
                <Ionicons name="eye-off-outline" size={16} color="#F59E0B" />
                <Text style={[styles.dangerBtnText, { color: '#F59E0B' }]}>No Show</Text>
              </Pressable>
              <Pressable
                style={[styles.dangerBtn, { borderColor: colors.error + '66' }]}
                onPress={handleCancel}
                disabled={noShowTrip.isPending}
              >
                <Ionicons name="close-circle-outline" size={16} color={colors.error} />
                <Text style={[styles.dangerBtnText, { color: colors.error }]}>Cancel Trip</Text>
              </Pressable>
            </Entrance>
          )}
        </View>
      </InlayPanel>

      {/* Payment QR — lets a boarding rider scan straight into this trip's payment
          screen instead of the driver having no way to hand off a payable code at all. */}
      <Modal visible={showPaymentQr} transparent animationType="fade" onRequestClose={() => setShowPaymentQr(false)}>
        <Pressable style={styles.qrModalBackdrop} onPress={() => setShowPaymentQr(false)}>
          <Pressable style={styles.qrModalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.cardTitle}>Scan to Pay</Text>
            <View style={styles.qrWrap}>
              {/* A real universal-link URL, not the old bare `eyego:trip:<id>`
                  string — a phone's stock camera cannot act on a bare custom
                  scheme, so that version only worked from inside the rider
                  app's own scanner. */}
              <QRCode value={`https://eyego.app/ride/${id}`} size={220} />
            </View>
            <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ textAlign: 'center' }}>
              Passenger scans this with their camera or in the EyeGo app to pay their fare for this trip.
            </Text>
            <Pressable style={styles.qrCloseBtn} onPress={() => setShowPaymentQr(false)}>
              <Text variant="label" color={colors.onSurface}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DriverPulse({ color }: { color: string }) {
  // Just the pin. This used to wrap the glyph in PulseRing (2 expanding,
  // status-coloured rings), which read on-device as a big blue circle with the
  // driver's arrow floating inside it — the driver's own position is not an
  // event that needs a radar pulse; the pickup marker already uses one, and two
  // pulsing things on one map is noise. Rings also forced tracksViewChanges to
  // stay on for this marker, re-rasterising it every frame.
  //
  // A rotated circle looks identical to an unrotated one, so the puck keeps a
  // directional glyph for the AnimatedMarkerView's heading-bound rotation to be
  // visible at all — same "navigate" chevron as the pre-pickup tracking screen.
  return (
    <View style={[puckStyles.puck, { borderColor: color, shadowColor: color }]}>
      {/* -45° cancels the "navigate" glyph's built-in north-east tilt so the
          arrow points at the marker's true heading. Must stay on the glyph, not
          on the marker's `rotation` — see the AnimatedMarkerView note above. */}
      <Ionicons name="navigate" size={20} color={color} style={puckStyles.glyph} />
    </View>
  );
}

// Module-level: DriverPulse renders outside the screen component, so it can't
// reach makeStyles(colors). Matches tracking/[id].tsx's driverMarker puck.
const puckStyles = StyleSheet.create({
  glyph: { transform: [{ rotate: '-45deg' }] },
  puck: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    // Contact shadow only. A wide, half-opaque coloured shadow reads as a
    // second glowing disc around the puck, which is the look being removed
    // here — keep it tight enough to just lift the pin off the map.
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
  },
});

function QuickAction({
  icon,
  label,
  color,
  onPress,
  onLongPress,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
  onLongPress?: () => void;
  colors: DriverColors;
}) {
  return (
    <Pressable
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        backgroundColor: colors.surfaceContainer,
        borderRadius: radii.xl,
        borderWidth: 1,
        borderColor: colors.outline,
        paddingVertical: spacing.base,
      }}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={450}
    >
      <Ionicons name={icon} size={20} color={color} />
      <Text style={{ fontFamily: fonts.medium, fontSize: 10, lineHeight: 13, color, letterSpacing: 0.2 }}>{label}</Text>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: '#050508' },
    loadingOverlay: {
      position: 'absolute',
      top: 0, left: 0, right: 0,
      padding: spacing['2xl'],
      gap: spacing.lg,
      backgroundColor: 'rgba(5,5,8,0.5)',
    },
    backEscapeButton: {
      position: 'absolute',
      left: spacing.base,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.sm,
      borderRadius: radii.lg,
      backgroundColor: 'rgba(0,0,0,0.5)',
    },
    skeleton: {
      height: 20,
      borderRadius: 10,
      backgroundColor: colors.surfaceContainerHigh,
    },
    pickupMarker: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.secondary ?? '#7DD8F5',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: '#fff',
    },
    destMarker: {
      width: 28,
      height: 28,
      borderRadius: 8,
      backgroundColor: colors.error,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: '#fff',
    },
    // Glassmorphic header
    header: {
      position: 'absolute',
      top: 0, left: 0, right: 0,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.md,
      gap: spacing.md,
      backgroundColor: 'rgba(5,5,8,0.65)',
      zIndex: 10,
    },
    headerIconBtn: {
      width: 38,
      height: 38,
      borderRadius: radii.lg,
      backgroundColor: 'rgba(255,255,255,0.08)',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.12)',
    },
    headerCenter: {
      flex: 1,
      gap: 2,
    },
    headerRoute: {
      fontFamily: fonts.displaySemiBold,
      fontSize: fontSizes.titleSmall,
      lineHeight: Math.round(fontSizes.titleSmall * 1.4),
      color: colors.onSurface,
    },
    statusBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      alignSelf: 'flex-start',
    },
    statusDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    statusLabel: {
      fontFamily: fonts.semiBold,
      fontSize: 11,
      lineHeight: 14,
      letterSpacing: 0.3,
    },
    sosBtn: {
      backgroundColor: '#EF4444',
      borderRadius: radii.md,
      width: 44,
      height: 38,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sosBtnText: {
      fontFamily: fonts.displayBold,
      fontSize: 11,
      lineHeight: 14,
      color: '#fff',
      letterSpacing: 0.5,
    },
    // Bottom sheet
    sheetBackground: {
      borderTopLeftRadius: radii['3xl'],
      borderTopRightRadius: radii['3xl'],
    },
    sheetHandle: {
      backgroundColor: colors.outline,
      width: 40,
      height: 4,
    },
    sheetContent: {
      paddingHorizontal: spacing['2xl'],
      paddingBottom: 40,
      gap: spacing.lg,
    },
    // Route summary
    routeSummary: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    routeDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: '#4be277',
      flexShrink: 0,
    },
    routeLine: {
      width: 1,
      height: 16,
      backgroundColor: colors.outline,
      marginLeft: 5,
      marginVertical: 2,
    },
    tripMeta: {},
    // Step progress
    stepsRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    stepChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      borderRadius: radii.full,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      paddingHorizontal: 7,
      paddingVertical: 4,
    },
    stepDot: {
      width: 5,
      height: 5,
      borderRadius: 3,
    },
    stepLabel: {
      fontFamily: fonts.medium,
      fontSize: 9,
      lineHeight: 12,
      color: colors.onSurfaceVariant,
      letterSpacing: 0.1,
    },
    stepConnector: {
      flex: 1,
      height: 1,
      backgroundColor: colors.outlineVariant,
      marginHorizontal: 2,
    },
    // Cards
    card: {
      borderRadius: radii['2xl'],
      padding: spacing.xl,
      overflow: 'hidden',
    },
    earningsCard: {
      borderRadius: radii['2xl'],
      padding: spacing.xl,
    },
    cardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.lg,
    },
    cardTitle: {
      fontFamily: fonts.displaySemiBold,
      fontSize: fontSizes.titleSmall,
      lineHeight: Math.round(fontSizes.titleSmall * 1.4),
      color: colors.onSurface,
    },
    qrBtn: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary + '18',
    },
    qrModalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xl,
    },
    qrModalCard: {
      width: '100%',
      maxWidth: 320,
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii['2xl'],
      padding: spacing.xl,
      alignItems: 'center',
      gap: spacing.md,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
    },
    qrWrap: {
      backgroundColor: '#fff',
      padding: spacing.lg,
      borderRadius: radii.xl,
    },
    qrCloseBtn: {
      marginTop: spacing.sm,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.md,
      borderRadius: radii.full,
      backgroundColor: colors.surfaceContainerHigh,
    },
    legend: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: spacing.xl,
      marginTop: spacing.lg,
    },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    legendDot: { width: 10, height: 10, borderRadius: 3 },
    // Earnings
    earningsTitle: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodySmall,
      lineHeight: Math.round(fontSizes.bodySmall * 1.3),
      color: '#4be277',
      letterSpacing: 0.5,
      marginBottom: spacing.sm,
    },
    earningsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    earningsNet: {
      borderTopWidth: 1,
      borderTopColor: colors.outlineVariant,
      paddingTop: spacing.sm,
      marginTop: spacing.xs,
    },
    earningsNetValue: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.titleMedium,
      lineHeight: Math.round(fontSizes.titleMedium * 1.3),
      color: '#4be277',
    },
    // Quick actions
    actionRow: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    // Danger row
    dangerRow: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    dangerBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      borderWidth: 1,
      paddingVertical: spacing.md,
    },
    dangerBtnText: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodySmall,
      lineHeight: Math.round(fontSizes.bodySmall * 1.3),
    },
  });
