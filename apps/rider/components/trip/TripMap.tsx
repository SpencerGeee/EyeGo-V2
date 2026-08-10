import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { VehicleMarker } from './VehicleMarker';
import MapboxGL from '../../utils/mapbox';
import mapStyles from '@eyego/map-styles';
import {
  useMapCamera,
  paddingForSheet,
  type CameraMode,
  type Coord,
} from '@eyego/maps';
import { socketEvents, type TripSnapshot, type TripStatus } from '@eyego/api';
import { useThemeStore } from '../../stores/theme.store';
import { useTripFlow } from '../../stores/tripFlow.store';
import { useTripStore } from '../../stores/trip.store';
import { useColors, Colors } from '../../utils/useColors';

/**
 * The ONE MapView in the rider app.
 *
 * Mounted once by app/trip.tsx and never unmounted while a ride runs. Stages
 * change what is DRAWN on it — pins, the route line, the camera mode — not the
 * map itself. That is the whole difference between this and what was here
 * before: five screens each mounted their own MapView with their own camera
 * code, so every navigation tore a map down and built another one, and the two
 * apps framed the same ride differently at every step.
 *
 * ── WHO OWNS WHAT ────────────────────────────────────────────────────────────
 *   the STAGE  asks for a camera mode (see `modeForStatus`)
 *   the USER   overrides it to `free` by panning; the recenter chip gives it back
 *   the SERVER owns the route line (`snapshot.path`) and the driver's position
 *   this file  owns nothing except which of those to show
 *
 * No `setCamera` call appears below. `useMapCamera` runs the only frame loop,
 * and it is the same one the driver app runs.
 */

/** Fraction of the screen the bottom sheet covers, per stage. */
const SHEET_FRACTION: Record<string, number> = {
  search: 0.62,
  select: 0.5,
  request: 0.44,
  assigned: 0.44,
  tracking: 0.4,
};

/**
 * What the camera should be doing, given where the ride is.
 *
 * The rider always gets `overview`, never `followCourse`. Rotating the world to
 * the car's heading is the navigation convention and it is right for the person
 * driving; for a passenger watching a car approach it is disorienting, and it
 * was one of the reasons the two apps felt like different products.
 */
function modeForStatus(hasFit: boolean): CameraMode {
  // `free` when there is nothing worth framing — a camera that fits an empty
  // set is the degenerate-bounds crash, and `boundsFor` returning null is the
  // second half of that guard.
  return hasFit ? 'overview' : 'free';
}

function coord(lng: number | null | undefined, lat: number | null | undefined): Coord | null {
  return typeof lng === 'number' && typeof lat === 'number' && Number.isFinite(lng) && Number.isFinite(lat)
    ? [lng, lat]
    : null;
}

/**
 * Everything that must stay framed, for the leg of the ride we are on.
 *
 * Deliberately NOT "everything we know". While the driver is coming to fetch
 * you, framing the destination as well zooms the map out to the whole city and
 * the car becomes a dot; while you are in the car, framing the pickup you have
 * already left does the same thing backwards.
 */
/**
 * The route line's colour.
 *
 * NOT `colors.primary`. The rider brand green is very close to the green the
 * map style paints trunk roads and motorways in, so the route disappeared into
 * exactly the roads it was drawn on top of — reported as "the polyline is green
 * and blends with the main highway which is also green". Amber is the one hue
 * the base map never uses for a road, water or park, which is also why the
 * driver app settled on it (`DriverTripMap.ROUTE_CORE`); both apps now draw the
 * same ride in the same colour.
 */
const ROUTE_LINE = '#FFB020';

function fitFor(
  status: TripStatus | null,
  snapshot: TripSnapshot | null,
  puck: Coord | null,
  searchPin: Coord | null,
  userPos: Coord | null,
  driverPins: Coord[],
): Coord[] {
  const pickup = coord(snapshot?.pickup?.lng, snapshot?.pickup?.lat);
  const dropoff = coord(snapshot?.dropoff?.lng, snapshot?.dropoff?.lat);
  const driver = puck ?? coord(snapshot?.driver?.lng, snapshot?.driver?.lat);

  switch (status) {
    case 'DRIVER_ASSIGNED':
    case 'DRIVER_EN_ROUTE':
    case 'ARRIVED_AT_PICKUP':
      return [driver, pickup].filter(Boolean) as Coord[];
    case 'IN_PROGRESS':
      return [driver ?? pickup, dropoff].filter(Boolean) as Coord[];
    case 'REQUESTED':
    case 'MATCHING':
    case 'REASSIGNING':
      // While dispatch is running, the nearby drivers ARE the content — this is
      // the rider watching the search actually progress.
      return [pickup, ...driverPins].filter(Boolean).slice(0, 8) as Coord[];
    default:
      // No trip yet: frame wherever the rider is and whatever they searched for.
      return [userPos, searchPin].filter(Boolean) as Coord[];
  }
}

function TripMapImpl() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { isDark } = useThemeStore();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();

  const stage = useTripFlow((s) => s.stage);
  const searchPlace = useTripFlow((s) => s.searchPlace);
  const nearbyDrivers = useTripFlow((s) => s.nearbyDrivers);
  const dispatchOffer = useTripFlow((s) => s.dispatchOffer);
  const pickupCoord = useTripFlow((s) => s.pickupCoord);
  const snapshot = useTripStore((s) => s.snapshot);
  const status = snapshot?.status ?? null;

  const [userCoords, setUserCoords] = useState<Coord | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const Location = await import('expo-location');
        const { status: perm } = await Location.requestForegroundPermissionsAsync();
        if (perm === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setUserCoords([loc.coords.longitude, loc.coords.latitude]);
        }
      } catch { /* non-fatal — the map is still usable without a blue dot */ }
    })();
  }, []);

  // ── The route line ───────────────────────────────────────────────────────
  // Comes from the SERVER, via the trip store — which seeds it from
  // `snapshot.path` and refreshes it from `trip:eta`/`trip:route`. This screen
  // used to call Mapbox Directions itself on a retry timer, so the rider and
  // the driver drew different lines for one ride and the line vanished on every
  // navigation. It also used to hold its OWN `trip:eta` subscription, which
  // meant the map and the panel could show two different countdowns; the store
  // is now the single subscriber and this reads its output.
  const path = useTripStore((s) => s.path);

  const routeLine = useMemo(() => {
    const coords = path?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: coords },
    };
  }, [path]);

  const driverPins = useMemo(
    () => nearbyDrivers.map((d) => [d.longitude, d.latitude] as Coord),
    [nearbyDrivers],
  );

  // The fit is computed from the SERVER's driver position, not from the
  // interpolated puck: the puck is produced by the hook below, so deriving the
  // hook's input from it would be a cycle. `fitIncludesPuck` tells the frame
  // loop to fold the live position in for us.
  const fit = useMemo(
    () => fitFor(
      status,
      snapshot,
      null,
      searchPlace ? ([searchPlace.longitude, searchPlace.latitude] as Coord) : null,
      userCoords,
      driverPins,
    ),
    [status, snapshot, searchPlace, userCoords, driverPins],
  );

  const mode = modeForStatus(fit.length > 0);

  // ── The driver puck ──────────────────────────────────────────────────────
  // GPS fixes arrive every couple of seconds; a marker moved straight to each
  // one teleports. `useMapCamera` interpolates between them and smooths the
  // bearing the short way round, so the car drives instead of blinking.
  // PERF: the frame loop is 60 Hz of bounds arithmetic and native camera calls,
  // and this map is deliberately never unmounted — so pushing payment, chat or
  // the receipt over the trip surface used to leave it running underneath, for
  // a map nobody could see. `useIsFocused` is false for a screen that is still
  // mounted but covered, which is exactly the condition the hook's `active`
  // flag exists for. The interpolator keeps buffering GPS fixes while paused,
  // so coming back re-frames from the real position rather than a stale one.
  const isFocused = useIsFocused();

  const camera = useMapCamera({
    mode,
    fit,
    fitIncludesPuck: true,
    padding: paddingForSheet({
      screenHeight,
      sheetFraction: SHEET_FRACTION[stage] ?? 0.44,
      safeTop: insets.top,
    }),
    active: isFocused,
  });
  const { pushSample, resetPuck } = camera;

  useEffect(() => {
    const off = socketEvents.onDriverLocation((d) => {
      if (!Number.isFinite(d.latitude) || !Number.isFinite(d.longitude)) return;
      pushSample({
        latitude: d.latitude,
        longitude: d.longitude,
        heading: d.heading ?? null,
        speed: d.speed ?? null,
        at: Date.now(),
      });
    });
    return () => { off(); };
  }, [pushSample]);

  /**
   * Second source for the same interpolator: the snapshot's own driver position.
   *
   * BUGFIX ("on the tracking page the marker pin doesn't seem to move"). The
   * puck was fed EXCLUSIVELY by `onDriverLocation`. That channel is the fast
   * one, but it is not the only one carrying the driver's position — every
   * `trip:event` snapshot carries `driver.lat/lng/heading` too — and it is the
   * one most likely to be quiet: a dropped subscription, a reconnect, a driver
   * app that has gone to the background and is posting locations over HTTP
   * rather than the socket. With nothing pushing samples the interpolator has
   * nothing to interpolate, so `camera.puck` stays where it was and the marker
   * sits frozen on the map while the panel above it updates normally.
   *
   * Pushing the snapshot position as well means the marker advances on whatever
   * arrives first. Samples are idempotent as far as the interpolator is
   * concerned — a repeated position is a zero-length move — so the two sources
   * cannot fight, and the fast one still wins on smoothness when it is healthy.
   */
  useEffect(() => {
    const lat = snapshot?.driver?.lat;
    const lng = snapshot?.driver?.lng;
    if (!Number.isFinite(lat as number) || !Number.isFinite(lng as number)) return;
    pushSample({
      latitude: lat as number,
      longitude: lng as number,
      heading: snapshot?.driver?.heading ?? null,
      speed: null,
      at: Date.now(),
    });
  }, [snapshot?.driver?.lat, snapshot?.driver?.lng, snapshot?.driver?.heading, pushSample]);

  // Reassignment and trip end both mean the old puck is a lie.
  useEffect(() => { resetPuck(); }, [snapshot?.driver?.id, resetPuck]);

  const [zoom, setZoom] = useState(14);
  const handleRegionChange = useCallback(
    (e: { properties?: { zoomLevel?: number } }) => {
      camera.onRegionChange(e as never);
      const z = e?.properties?.zoomLevel;
      if (typeof z === 'number' && Number.isFinite(z)) setZoom(z);
    },
    [camera],
  );

  const puckCoord: Coord | null = camera.puck
    ? [camera.puck.longitude, camera.puck.latitude]
    : coord(snapshot?.driver?.lng, snapshot?.driver?.lat);

  // A straight pickup→driver line rather than a road route: the offer only
  // lasts ~20 seconds and moves between drivers, so a per-offer Directions call
  // would spend quota on a line that is about to be replaced.
  const dispatchLine = useMemo(() => {
    if (!dispatchOffer || !pickupCoord) return null;
    if (!Number.isFinite(dispatchOffer.longitude) || !Number.isFinite(dispatchOffer.latitude)) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: [pickupCoord, [dispatchOffer.longitude, dispatchOffer.latitude]],
      },
    };
  }, [dispatchOffer, pickupCoord]);

  const pickup = coord(snapshot?.pickup?.lng, snapshot?.pickup?.lat);
  const dropoff = coord(snapshot?.dropoff?.lng, snapshot?.dropoff?.lat)
    ?? (searchPlace ? ([searchPlace.longitude, searchPlace.latitude] as Coord) : null);

  /**
   * The vehicle grows with the zoom, the way it does in Uber and Bolt.
   *
   * A marker is laid out in POINTS, so it stays a fixed size on screen no
   * matter how far in the map is. Zoomed out that reads fine; zoomed all the
   * way in, the same 34pt bus sits on a road drawn several times wider than it
   * is and looks like a speck that has come loose from the street — "the
   * minibus puck becomes very small when zoomed in". Interpolating between two
   * bounds keeps it roughly the width of the carriageway at every zoom.
   *
   * Fed by `onRegionDidChange`, which fires when a gesture SETTLES rather than
   * per frame, so this is a handful of re-renders per pan, not sixty a second.
   */
  const vehicleSize = useMemo(() => {
    const MIN_Z = 13, MAX_Z = 18, MIN_PT = 30, MAX_PT = 62;
    const t = Math.min(1, Math.max(0, (zoom - MIN_Z) / (MAX_Z - MIN_Z)));
    return Math.round(MIN_PT + t * (MAX_PT - MIN_PT));
  }, [zoom]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapboxGL.MapView
        style={StyleSheet.absoluteFill}
        styleURL={isDark ? mapStyles.eyegoDarkStyle : mapStyles.eyegoLightStyle}
        compassEnabled={false}
        rotateEnabled={false}
        attributionEnabled={false}
        logoEnabled={false}
        onRegionDidChange={handleRegionChange}
      >
        <MapboxGL.Camera ref={camera.cameraRef} />
        {userCoords && !puckCoord && <MapboxGL.UserLocation visible />}

        {/* The road line, drawn under everything else.
            The casing used to be `backgroundDeep` at 0.55 — a dark grey on a
            dark map, which is to say nearly nothing. Over a motorway (the
            style's widest, brightest casing) the route simply disappeared into
            the road under it. Solid black at full opacity and two points wider
            is what separates the line from the road it is drawn on; every
            mapping app does exactly this. */}
        {routeLine && (
          <MapboxGL.ShapeSource id="trip-route" shape={routeLine}>
            <MapboxGL.LineLayer
              id="trip-route-casing"
              style={{ lineColor: '#000000', lineWidth: 11, lineCap: 'round', lineJoin: 'round', lineOpacity: 0.9 }}
            />
            <MapboxGL.LineLayer
              id="trip-route-line"
              style={{ lineColor: ROUTE_LINE, lineWidth: 5, lineCap: 'round', lineJoin: 'round' }}
            />
          </MapboxGL.ShapeSource>
        )}

        {dispatchLine && (
          <MapboxGL.ShapeSource id="dispatch-line" shape={dispatchLine}>
            <MapboxGL.LineLayer
              id="dispatch-line-layer"
              style={{ lineColor: colors.primary, lineWidth: 4, lineOpacity: 0.9, lineCap: 'round' }}
            />
          </MapboxGL.ShapeSource>
        )}

        {/* Idle nearby drivers, only while dispatch is actually running —
            leaving them on during the ride is visual noise the rider reads as
            "which one of these is mine?". */}
        {!snapshot?.driver && nearbyDrivers.map((d) => {
          const isOffered = d.id === dispatchOffer?.driverId;
          return (
            <MapboxGL.MarkerView key={d.id} id={`driver-${d.id}`} coordinate={[d.longitude, d.latitude]}>
              <View style={[styles.driverPuck, isOffered && styles.driverPuckActive]}>
                <Ionicons
                  name="car-sport"
                  size={isOffered ? 16 : 13}
                  color={isOffered ? colors.onPrimary : colors.onSurfaceVariant}
                />
              </View>
            </MapboxGL.MarkerView>
          );
        })}

        {/* THE assigned driver. Rotated to the smoothed bearing, so it points
            where the car is going rather than spinning on every fix. */}
        {puckCoord && snapshot?.driver && (
          <MapboxGL.MarkerView id="assigned-driver" coordinate={puckCoord}>
            {/* The vehicle, not a pin — see VehicleMarker. Bearing prefers the
                interpolator's smoothed value and falls back to the server's
                last reported heading, so a puck that has not yet accumulated
                two fixes still points the right way instead of due north. */}
            <VehicleMarker
              bearing={camera.puck?.bearing ?? snapshot.driver.heading ?? 0}
              size={vehicleSize}
            />
          </MapboxGL.MarkerView>
        )}

        {pickup && (
          <MapboxGL.MarkerView id="pickup-pin" coordinate={pickup}>
            <View style={styles.pickupDot} />
          </MapboxGL.MarkerView>
        )}

        {/* THE DESTINATION.
            `anchor` was omitted, so the pin defaulted to 'center' and its tip
            pointed at nothing in particular. 'bottom' puts the tail on the
            coordinate, which is what a pin means. */}
        {dropoff && (
          <MapboxGL.MarkerView id="destination-pin" coordinate={dropoff} anchor="bottom">
            <View style={styles.destPin}>
              <View style={styles.destPinBubble}>
                <Ionicons name="location" size={22} color={colors.onPrimary} />
              </View>
              <View style={styles.destPinTail} />
            </View>
          </MapboxGL.MarkerView>
        )}
      </MapboxGL.MapView>

      {/* The affordance that makes taking the camera safe: pan freely, get it
          back with one tap. Without this, auto-following reads as the map
          fighting you. */}
      {camera.released && mode !== 'free' && (
        <Pressable
          onPress={camera.recenter}
          style={[styles.recenter, { top: insets.top + 12 }]}
          hitSlop={8}
        >
          <Ionicons name="locate" size={18} color={colors.onSurface} />
        </Pressable>
      )}
    </View>
  );
}

/**
 * Memoized so the persistent map skips re-render during stage crossfades in
 * trip.tsx — it takes no props and reads its own store slices, so parent
 * re-renders never need to touch it. The map is the heaviest node in the tree.
 */
export const TripMap = React.memo(TripMapImpl);

const makeStyles = (colors: Colors) => StyleSheet.create({
  driverPuck: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: colors.surfaceCard,
    borderWidth: 1, borderColor: colors.rimLight,
    alignItems: 'center', justifyContent: 'center',
  },
  driverPuckActive: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7, shadowRadius: 8,
    elevation: 8,
  },
  vehiclePuck: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.onPrimary,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3, shadowRadius: 5, elevation: 7,
  },
  pickupDot: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: colors.onSurface,
    borderWidth: 3, borderColor: colors.surfaceCard,
  },
  destPin: { alignItems: 'center' },
  destPinBubble: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 6,
    elevation: 6,
  },
  destPinTail: {
    width: 0, height: 0,
    borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 8,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: colors.primary,
    marginTop: -1,
  },
  recenter: {
    position: 'absolute', right: 16,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surfaceCard,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.rimLight,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2, shadowRadius: 6, elevation: 5,
  },
});
