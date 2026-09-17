import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { driverSocketEvents } from '@eyego/api';
import { useRouteReveal, FOLLOW_ZOOM, NAV_PITCH, RESUME_AFTER_MS, type Coord } from '@eyego/maps';
import { eyegoDriverDarkStyle } from '@eyego/map-styles';
import { GlassSurface, PulseRing } from '@eyego/ui';
import MapboxGL from '../../utils/mapbox';
import { useColors } from '../../utils/useColors';

/**
 * The ONE MapView in the driver app — home, the offer, the whole trip.
 *
 * ── THE CAMERA IS NATIVE NOW ────────────────────────────────────────────────
 * "I sat inside an Uber this morning and the app was very fluid and smooth and
 * the map rotates accordingly." Three passes tuned the JS frame loop that used
 * to drive this map — dedupe, glide, per-axis springs — and it never got
 * there, because the architecture cannot: a `setCamera({ animationDuration:
 * 0 })` issued sixty times a second from the JS thread reaches the map engine
 * out of phase with its own display link, and a marker moved every 400 ms is a
 * marker that steps. Uber, Bolt and Apple Maps do not do this. They hand the
 * camera to the map engine's own user-tracking mode, which animates the camera
 * AND the puck between fixes on the render thread, in lockstep, rotated to the
 * course. That is `trackUserLocation="course"` + the native `UserLocation`
 * here, and it is why nothing in this file runs per frame any more.
 *
 * ── WHO OWNS WHAT ───────────────────────────────────────────────────────────
 *   the SCREEN  passes the trip's phase and its endpoints
 *   the ENGINE  follows the device, rotates to travel, animates the puck
 *   the USER    takes the camera by panning; the chip (or 12 s) gives it back
 *   the SERVER  owns the route line (`trip:route` / `trip:eta` geometry)
 *   this file   owns nothing but which of those to draw
 *
 * The bottom sheet is accounted for through the map's `contentInset`, which
 * is what the engine centres the puck inside — so the vehicle sits in the
 * visible third of the screen above the panel rather than under it.
 */

/** Amber core on a dark-brown casing. */
const ROUTE_CORE = '#FFB020';
const ROUTE_CASING = '#4A2B00';

/** Phases where the driver is carrying the rider rather than fetching them. */
const CARRYING = new Set(['IN_PROGRESS', 'COMPLETED']);
/** Where the map opens before the first GPS fix. */
const ACCRA: Coord = [-0.187, 5.6037];

type TrackMode = 'default' | 'course';

export interface DriverTripMapProps {
  tripId: string;
  /** Trip status. Chooses which leg the line and the framing belong to. */
  status?: string | null;
  pickup?: Coord | null;
  dropoff?: Coord | null;
  /** Live GPS fix from `useDriverLocation` — only the first stop before the engine takes over. */
  location?: { latitude: number; longitude: number; heading?: number | null; speed?: number | null } | null;
  /** Kept for callers; the platform puck wears the platform's colour. */
  puckColor?: string;
  /** Fraction of the screen the bottom sheet covers — the standing inset. */
  sheetFraction?: number;
  /** False while the screen is not visible. AND-ed with navigation focus. */
  active?: boolean;
  /** Server ETA for the CURRENT leg, so a screen can render it without its own routing call. */
  onEta?: (eta: { leg: 'toPickup' | 'toDropoff'; minutes: number; distanceKm: number | null; rerouted: boolean }) => void;
  /** Distance from the safe-area top to the re-center button, in points. */
  recenterOffset?: number;
  /** Renders inside the map, above the line — seat overlays, extra pins. */
  children?: React.ReactNode;
  /** No longer used: the offer frames its approach on its own mini map. */
  fitOverride?: Coord[] | null;
  /** Map style. Defaults to the driver's dark highway style. */
  styleURL?: any;
}

export function DriverTripMapImpl({
  tripId,
  status,
  pickup,
  dropoff,
  location,
  sheetFraction = 0.42,
  active = true,
  onEta,
  recenterOffset = 72,
  children,
  styleURL = eyegoDriverDarkStyle,
}: DriverTripMapProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const isFocused = useIsFocused();
  const live = active && isFocused;

  const carrying = CARRYING.has(status ?? '');
  const target = (carrying ? dropoff : pickup) ?? dropoff ?? pickup ?? null;

  // ── The route line ────────────────────────────────────────────────────────
  // Comes from the SERVER (route-geometry.service.js), so the driver and the
  // rider follow one line for one ride.
  const [line, setLine] = useState<[number, number][] | null>(null);
  useEffect(() => { setLine(null); }, [tripId]);

  useEffect(() => {
    if (!tripId) return undefined;

    const take = (payload: any) => {
      if (payload?.tripId && payload.tripId !== tripId) return;
      const coords = payload?.geometry?.coordinates;
      if (Array.isArray(coords) && coords.length >= 2) setLine(coords);
    };

    const offRoute = driverSocketEvents.onTripRoute?.(take) ?? (() => {});
    const offEta = driverSocketEvents.onTripEta?.((payload: any) => {
      take(payload);
      if (onEta && Number.isFinite(payload?.etaMinutes)) {
        onEta({
          leg: payload.leg ?? (carrying ? 'toDropoff' : 'toPickup'),
          minutes: payload.etaMinutes,
          distanceKm: Number.isFinite(payload?.distanceKm) ? payload.distanceKm : null,
          rerouted: Boolean(payload?.rerouted),
        });
      }
    }) ?? (() => {});

    driverSocketEvents.emitJoinTracking(tripId);
    const offConnect = driverSocketEvents.onConnect(() => driverSocketEvents.emitJoinTracking(tripId));

    return () => { offRoute(); offEta(); offConnect(); };
    // `carrying` is only a fallback for a payload with no `leg`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, onEta]);

  // A new leg invalidates the old line immediately.
  useEffect(() => { setLine(null); }, [carrying]);

  // ── The camera ────────────────────────────────────────────────────────────
  /**
   * `course` — up means ahead — whenever there is somewhere to drive to. With
   * no trip the map simply follows the device north-up: the nav pitch and the
   * rotation only make sense once there is a road to look down.
   */
  const wanted: TrackMode = target ? 'course' : 'default';

  /**
   * The mode the engine is IN, as the JS side last commanded it. A pan drops
   * the native mode to null and the engine tells us; the chip appears; taking
   * it back means commanding the mode AGAIN — and the native side only reacts
   * to a prop that changed, so the value goes through `null` on the way.
   */
  const [track, setTrack] = useState<TrackMode | null>(wanted);
  const [released, setReleased] = useState(false);
  const releasedAt = useRef<number | null>(null);
  const rearm = useCallback((mode: TrackMode) => {
    setTrack(null);
    setTimeout(() => setTrack(mode), 0);
  }, []);

  // The stage changed what the camera should do (a trip arrived, or ended).
  useEffect(() => {
    releasedAt.current = null;
    setReleased(false);
    rearm(wanted);
  }, [wanted, rearm]);

  const onTrackChange = useCallback((mode: TrackMode | 'heading' | null) => {
    if (mode == null) {
      releasedAt.current = Date.now();
      setReleased(true);
    } else {
      releasedAt.current = null;
      setReleased(false);
    }
  }, []);

  const recenter = useCallback(() => {
    releasedAt.current = null;
    setReleased(false);
    rearm(wanted);
  }, [rearm, wanted]);

  /**
   * Hand the camera back once the driver has stopped looking around — but only
   * where there is somewhere to return to. Twelve seconds, the same number the
   * rider's follow modes use; on the idle home a pan is permanent.
   */
  useEffect(() => {
    if (!released || !target || !live) return undefined;
    const t = setInterval(() => {
      const at = releasedAt.current;
      if (at != null && Date.now() - at >= RESUME_AFTER_MS) recenter();
    }, 1000);
    return () => clearInterval(t);
  }, [released, target, live, recenter]);

  /**
   * The standing inset: the sheet's resting height plus a little air, and the
   * safe area on top. The engine centres the puck inside what is left, which
   * on the nav view puts the vehicle in the lower-middle of the visible map
   * with the road ahead above it — the arrangement every navigation app uses.
   */
  const contentInset = useMemo(
    () => ({
      top: insets.top + 24,
      bottom: Math.round(screenHeight * Math.min(0.85, Math.max(0, sheetFraction))) + 24,
      left: 0,
      right: 0,
    }),
    [insets.top, screenHeight, sheetFraction],
  );

  const firstStop: Coord | null =
    location && Number.isFinite(location.longitude) && Number.isFinite(location.latitude)
      ? [location.longitude, location.latitude]
      : null;

  // Straight line only until the server's geometry lands — drawn dashed, so the
  // driver is never shown a fabricated road to follow.
  const isRoad = Array.isArray(line) && line.length >= 2;
  const coords = isRoad ? line! : firstStop && target ? [firstStop, target] : null;

  const revealed = useRouteReveal(isRoad ? (coords as [number, number][] | null) : null, {
    durationMs: 800,
  });
  const drawCoords = isRoad ? revealed : coords;

  const shape = useMemo(() => {
    if (!drawCoords || drawCoords.length < 2) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: drawCoords },
    };
  }, [drawCoords]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapboxGL.MapView
        style={StyleSheet.absoluteFill}
        styleURL={styleURL}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled
        rotateEnabled
        pitchEnabled
        scaleBarEnabled={false}
        contentInset={contentInset}
      >
        {/* A first stop so the surface is a city and not the world before the
            first fix; the engine takes the camera from here. In `course` the
            stop's zoom and pitch are what the tracking mode drives with. */}
        <MapboxGL.Camera
          centerCoordinate={firstStop ?? ACCRA}
          zoomLevel={track === 'course' ? FOLLOW_ZOOM : firstStop ? 14 : 12}
          pitch={track === 'course' ? NAV_PITCH : 0}
          trackUserLocation={live ? track ?? undefined : undefined}
          onTrackUserLocationChange={onTrackChange}
        />

        {/* The platform puck — drawn and animated by the engine, in step with
            the camera. The navigation arrow while driving, the plain dot when
            parked. */}
        <MapboxGL.UserLocation mode={track === 'course' ? 'course' : 'default'} />

        {shape && (
          <MapboxGL.ShapeSource id="driver-route" shape={shape}>
            {/* Inferred before the trip starts, committed once it has: thin,
                dim and dashed while the rider is not yet aboard; solid and
                full weight the moment the ride is under way. */}
            <MapboxGL.LineLayer
              id="driver-route-casing"
              style={{
                lineColor: ROUTE_CASING,
                lineWidth: carrying ? 11 : 8,
                lineOpacity: carrying ? 0.95 : 0.5,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <MapboxGL.LineLayer
              id="driver-route-core"
              style={{
                lineColor: ROUTE_CORE,
                lineWidth: carrying ? 6 : 4,
                lineOpacity: carrying ? 1 : 0.55,
                lineCap: 'round',
                lineJoin: 'round',
                ...(isRoad && carrying ? null : { lineDasharray: [1.6, 1.4] }),
              }}
              aboveLayerID="driver-route-casing"
            />
          </MapboxGL.ShapeSource>
        )}

        {/* Pickup — pulsing while it is the thing the driver is heading for,
            quiet once the rider is aboard, never gone. */}
        {!carrying && pickup && (
          <MapboxGL.MarkerView id="driver-pickup" coordinate={pickup}>
            <PulseRing size={40} color={colors.secondary} ringCount={2} duration={1500}>
              <View style={[styles.dot, { backgroundColor: colors.secondary }]} />
            </PulseRing>
          </MapboxGL.MarkerView>
        )}
        {carrying && pickup && (
          <MapboxGL.MarkerView id="driver-pickup-done" coordinate={pickup}>
            <View style={[styles.endDot, { borderColor: colors.secondary }]} />
          </MapboxGL.MarkerView>
        )}

        {dropoff && (
          <MapboxGL.MarkerView id="driver-dropoff" coordinate={dropoff}>
            <View style={[styles.pin, { backgroundColor: colors.primary }]}>
              <Ionicons name="flag" size={14} color="#fff" />
            </View>
          </MapboxGL.MarkerView>
        )}

        {children}
      </MapboxGL.MapView>

      {/* The affordance that makes taking the camera safe: pan and tilt freely,
          get the nav view back with one tap. */}
      {released && (
        <Pressable
          onPress={recenter}
          style={[styles.recenter, { top: insets.top + recenterOffset }]}
          accessibilityRole="button"
          accessibilityLabel="Re-center map"
          hitSlop={8}
        >
          <GlassSurface style={StyleSheet.absoluteFill} borderRadius={24} intensity="low" />
          <Ionicons name="locate" size={20} color={colors.primary} />
        </Pressable>
      )}
    </View>
  );
}

/**
 * Memoized: the map is the heaviest node in the tree and the surface
 * re-renders on every ETA tick, seat change and query refetch.
 */
export const DriverTripMap = React.memo(DriverTripMapImpl);

const styles = StyleSheet.create({
  pin: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff',
  },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#030C18' },
  endDot: {
    width: 13, height: 13, borderRadius: 6.5,
    backgroundColor: '#030C18', borderWidth: 2.5,
  },
  recenter: {
    position: 'absolute', right: 16,
    width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
});
