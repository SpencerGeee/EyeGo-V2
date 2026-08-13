import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { driverSocketEvents } from '@eyego/api';
import { useMapCamera, useRouteReveal, paddingForSheet, type Coord } from '@eyego/maps';
import { eyegoDriverDarkStyle } from '@eyego/map-styles';
import { GlassSurface, PulseRing } from '@eyego/ui';
import MapboxGL from '../../utils/mapbox';
import { useColors } from '../../utils/useColors';

/**
 * The ONE MapView in the driver app's trip flow.
 *
 * There were three: `(trip)/active/[id].tsx` mounted one for its loading
 * skeleton and another for the real screen, and `(trip)/tracking/[id].tsx`
 * mounted a third with entirely separate camera code. Each had its own zoom,
 * its own pitch, its own idea of when to stop following the vehicle — and the
 * tracking screen had no user-gesture release at all, so panning away was
 * undone by the next GPS fix. Navigating between the two screens tore a map
 * down and built another one mid-trip.
 *
 * ── WHO OWNS WHAT ───────────────────────────────────────────────────────────
 *   the SCREEN  passes the trip's phase and its live GPS fix
 *   the USER    overrides the camera to `free` by panning; the chip gives it back
 *   the SERVER  owns the route line (`trip:route` / `trip:eta` geometry)
 *   this file   owns nothing but which of those to draw
 *
 * No `setCamera` call appears below — `useMapCamera` runs the only frame loop,
 * and it is the same one the rider's `TripMap` runs. That shared loop is what
 * makes the two halves of one trip finally look like one product.
 */

/** Amber core on a dark-brown casing. */
const ROUTE_CORE = '#FFB020';
const ROUTE_CASING = '#4A2B00';

/** Phases where the driver is carrying the rider rather than fetching them. */
const CARRYING = new Set(['IN_PROGRESS', 'COMPLETED']);

export interface DriverTripMapProps {
  tripId: string;
  /** Trip status. Chooses which leg the line and the framing belong to. */
  status?: string | null;
  pickup?: Coord | null;
  dropoff?: Coord | null;
  /** Live GPS fix from `useDriverLocation`. */
  location?: { latitude: number; longitude: number; heading?: number | null; speed?: number | null } | null;
  /** Colour for the vehicle puck — the screen's status colour. */
  puckColor?: string;
  /** Fraction of the screen the bottom sheet covers, for camera padding. */
  sheetFraction?: number;
  /**
   * False while the screen is not visible: stops the frame loop dead.
   *
   * Defaults to true and is AND-ed with navigation focus, so a caller never has
   * to remember it — neither of the two did, and a driver opening chat or the
   * passenger list over the tracking screen left 60 Hz of bounds arithmetic and
   * native camera calls running under a map nobody could see. Pass `false`
   * explicitly for a reason focus cannot know about (a modal covering the map
   * within the same screen).
   */
  active?: boolean;
  /** Server ETA for the CURRENT leg, so a screen can render it without its own routing call. */
  onEta?: (eta: { leg: 'toPickup' | 'toDropoff'; minutes: number; distanceKm: number | null; rerouted: boolean }) => void;
  /**
   * Distance from the safe-area top to the re-center button, in points.
   *
   * A prop rather than a constant because the button shares the top-right
   * corner with whatever the HOST screen floats there. On the tracking screen
   * that is the "n/m boarded" pill, and since the map renders first, the pill
   * was painted straight over the button — "the icon to reset the camera view
   * seems to be behind the number of seats boarded". A screen with something in
   * that corner passes an offset that clears it.
   */
  recenterOffset?: number;
  /** Renders inside the map, above the line — seat overlays, extra pins. */
  children?: React.ReactNode;
}

export function DriverTripMapImpl({
  tripId,
  status,
  pickup,
  dropoff,
  location,
  puckColor = ROUTE_CORE,
  sheetFraction = 0.42,
  active = true,
  onEta,
  recenterOffset = 72,
  children,
}: DriverTripMapProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  // False for a screen that is still mounted but covered — see `active` above.
  const isFocused = useIsFocused();

  const carrying = CARRYING.has(status ?? '');
  const target = (carrying ? dropoff : pickup) ?? dropoff ?? pickup ?? null;

  // ── The route line ────────────────────────────────────────────────────────
  // Comes from the SERVER (route-geometry.service.js). Both screens used to
  // call Directions themselves — one through a local `useRoadRoute`, the other
  // through an effect with a 60 s refetch timer — which meant the driver and
  // the rider could be following two different lines for one ride, and each
  // screen spent its own routing quota to get there.
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

    // The server publishes the leg's geometry on join, so a screen opened
    // mid-trip gets a line without waiting for the next GPS fix to trigger one.
    driverSocketEvents.emitJoinTracking(tripId);
    const offConnect = driverSocketEvents.onConnect(() => driverSocketEvents.emitJoinTracking(tripId));

    return () => { offRoute(); offEta(); offConnect(); };
    // `carrying` is only a fallback for a payload with no `leg`; re-subscribing
    // on every phase flip would drop events during the swap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, onEta]);

  // A new leg invalidates the old line immediately rather than leaving the
  // driver following the way back to a pickup they have already made.
  useEffect(() => { setLine(null); }, [carrying]);

  // ── Camera ────────────────────────────────────────────────────────────────
  // `followCourse` — up means ahead. This is the one place the driver app
  // deliberately differs from the rider's `overview`: the person driving needs
  // the navigation convention, the passenger finds it disorienting.
  const camera = useMapCamera({
    mode: 'followCourse',
    center: target,
    padding: paddingForSheet({ screenHeight, sheetFraction, safeTop: insets.top }),
    active: active && isFocused,
  });
  const { pushSample, resetPuck } = camera;

  useEffect(() => {
    if (!location) return;
    if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) return;
    pushSample({
      latitude: location.latitude,
      longitude: location.longitude,
      heading: location.heading ?? null,
      speed: location.speed ?? null,
      at: Date.now(),
    });
  }, [location?.latitude, location?.longitude, location?.heading, location?.speed, pushSample]);

  useEffect(() => { resetPuck(); }, [tripId, resetPuck]);

  const puckCoord: Coord | null = camera.puck
    ? [camera.puck.longitude, camera.puck.latitude]
    : location && Number.isFinite(location.longitude) && Number.isFinite(location.latitude)
      ? [location.longitude, location.latitude]
      : null;

  // Straight line only until the server's geometry lands — drawn dashed, so the
  // driver is never shown a fabricated road to follow.
  const isRoad = Array.isArray(line) && line.length >= 2;
  const coords = isRoad ? line! : puckCoord && target ? [puckCoord, target] : null;

  /**
   * A real ROAD route draws itself on; a two-point straight-line estimate does
   * not. Animating the estimate would be animating one segment, which reads as a
   * glitch, and the estimate is also re-derived from the puck on every location
   * ping — revealing it each time would make the line flicker continuously.
   */
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
        styleURL={eyegoDriverDarkStyle}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled
        rotateEnabled
        pitchEnabled
        scaleBarEnabled={false}
        onRegionDidChange={camera.onRegionChange}
      >
        <MapboxGL.Camera ref={camera.cameraRef} />

        {shape && (
          <MapboxGL.ShapeSource id="driver-route" shape={shape}>
            {/*
              INFERRED BEFORE THE TRIP STARTS, COMMITTED ONCE IT HAS.

              "The polyline should be faint and inferred and become bold when
              the trip has started." Before the rider is aboard, the line is a
              plan — the driver has not committed to it and may still be told
              to go elsewhere — so it is drawn thinner, dimmer and dashed. The
              moment the ride is under way it firms up into the solid, full
              weight line, and that change is itself the confirmation that the
              swipe landed.

              `isRoad` is a separate question: a dashed line ALSO means "this
              is a straight-line estimate, not a road route yet". Both reasons
              to dash are honoured.
            */}
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

        {/* Pickup — dropped as soon as the rider is aboard. The pulse is the
            one marker on this map that earns it: it marks the thing the driver
            is currently heading for. The vehicle puck deliberately does NOT
            pulse — two pulsing things on one map is noise. */}
        {!carrying && pickup && (
          <MapboxGL.MarkerView id="driver-pickup" coordinate={pickup}>
            <PulseRing size={40} color={colors.secondary} ringCount={2} duration={1500}>
              <View style={[styles.dot, { backgroundColor: colors.secondary }]} />
            </PulseRing>
          </MapboxGL.MarkerView>
        )}

        {/* Once the rider is aboard the pickup stops PULSING but it does not
            stop existing: a route that simply begins in the middle of nothing
            gives the driver no way to see where this ride started, and the
            same complaint that produced the destination flag applies to both
            ends of the line. Quiet, unpulsed, still there. */}
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

        {/* The vehicle. Bearing comes from the shared puck interpolator, which
            prefers GPS course while moving and holds the last heading below
            walking pace — a handset in a metal cradle reads the cradle, not the
            road, so the compass is only ever a cold-start hint. */}
        {puckCoord && (
          <MapboxGL.AnimatedMarkerView
            coordinate={puckCoord}
            rotation={camera.puck?.bearing ?? 0}
            duration={450}
          >
            <View style={[styles.puck, { borderColor: puckColor, shadowColor: puckColor }]}>
              {/* -45° cancels the "navigate" glyph's built-in north-east tilt so
                  the arrow points at the marker's true heading. */}
              <Ionicons name="navigate" size={20} color={puckColor} style={styles.puckGlyph} />
            </View>
          </MapboxGL.AnimatedMarkerView>
        )}

        {children}
      </MapboxGL.MapView>

      {/* The affordance that makes taking the camera safe: pan and tilt freely,
          get the nav view back with one tap. */}
      {camera.released && (
        <Pressable
          onPress={camera.recenter}
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
 * Memoized: the map is the heaviest node in the tree and the trip screens
 * re-render on every ETA tick, seat change and query refetch.
 */
export const DriverTripMap = React.memo(DriverTripMapImpl);

const styles = StyleSheet.create({
  pin: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff',
  },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#030C18' },
  /** The quiet "this end of the line is a real place" mark. Hollow, so it
   *  reads as a waypoint already passed rather than a live target. */
  endDot: {
    width: 13, height: 13, borderRadius: 6.5,
    backgroundColor: '#030C18', borderWidth: 2.5,
  },
  puckGlyph: { transform: [{ rotate: '-45deg' }] },
  puck: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2,
    // Contact shadow only — a wide coloured shadow reads as a second glowing
    // disc around the puck.
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
  },
  recenter: {
    position: 'absolute', right: 16,
    width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
});
