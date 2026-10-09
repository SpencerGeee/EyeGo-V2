import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import {
  MapView,
  Camera,
  MarkerView,
  Marker3D,
  ShapeSource,
  LineLayer,
  boundsFor,
  bearingBetween,
  isUsableCoord,
  minibus,
  pickupPin,
  dropoffPin,
  useRouteReveal,
  type Coord,
  type CameraRef,
} from '@eyego/maps';
import { eyegoDriverDarkStyle } from '@eyego/map-styles';
import { PulseRing, Text } from '@eyego/ui';
import { useColors } from '../../utils/useColors';

/**
 * THE MAP ON THE OFFER — one instance, frozen, framed on the ride.
 *
 * The offer screens used to describe a ride in two lines of text: "From —" and
 * "To —". A driver decides on an offer geographically ("is that on my way, is
 * that pickup through town, is the drop-off somewhere I want to end up") and
 * two truncated street names cannot answer any of it. This is the picture.
 *
 * ── WHY IT IS DELIBERATELY INERT ────────────────────────────────────────────
 * Every gesture is off and there is no follow loop. An offer is a twenty-second
 * decision; a driver who pans this map is not reading it, they are fighting it,
 * and a camera that recentres under their finger is worse than one that never
 * moves. It frames once and holds.
 *
 * ── WHY IT IS NOT IN THE LIST ROWS ──────────────────────────────────────────
 * One MapView is a native surface with its own GL context and tile cache.
 * Mounting one PER ROW of the dispatch list would put four or five of them on a
 * scrolling screen — the same mistake as the stacked Skia canvases that cooked
 * the phone. The list gets a single shared map above it; the rows get a drawn
 * glyph. This component is for the one ride being decided on.
 *
 * ── THE SIGABRT ─────────────────────────────────────────────────────────────
 * `fitBounds` on a degenerate box is the MLRNCamera crash, not NaN. A trip
 * whose pickup and dropoff resolve to the same point — which happens on a
 * route trip whose Route rows are half-filled — produces exactly that box. So
 * bounds go through `boundsFor`, which enforces MIN_BOUNDS_SPAN_DEG, and a
 * single usable coordinate falls back to `setCamera` instead.
 */

export interface DispatchMiniMapProps {
  pickup?: Coord | null;
  dropoff?: Coord | null;
  /** Where the driver is now, so the offer can show the approach as well as the ride. */
  driver?: Coord | null;
  height?: number;
  /** Road geometry when the server has it; a straight line is drawn otherwise. */
  routeGeoJson?: GeoJSON.Feature | null;
  /**
   * The ROAD from the driver to the pickup, `[lng, lat][]`.
   *
   * BUGFIX ("the route to the pickup point doesn't follow the road — it's a
   * straight line"). The approach used to be drawn as a bowed arc no matter
   * what, because nothing ever handed this map the leg the cascade fetches for
   * every offer (see `geometry` on DispatchOffer). With the road in hand the
   * approach becomes the hero line — it is the only leg the driver is being
   * asked to judge — and the arc survives only as the honest "no road data yet"
   * placeholder.
   */
  approachGeometry?: Coord[] | null;
  /** Tints the route line and the pickup ring — the screen's urgency colour. */
  accent?: string;
  /**
   * Fill the parent and take pan/zoom — the full-screen offer, where this map
   * IS the page and the card floats over it. The inline card map stays inert.
   */
  fill?: boolean;
  /** Edge insets the fit keeps the ride clear of (the floating card, the status bar). */
  framePadding?: { top: number; bottom: number; left: number; right: number };
  /** A bubble on the approach road, at its middle — "4 min · 1.2 km". */
  approachLabel?: string | null;
}

/**
 * A gentle arc between two points, so the "we have no road geometry" case still
 * reads as a journey rather than as a ruler laid across the city. Bowed
 * perpendicular to the line by an eighth of its length, which is enough to look
 * intentional and little enough that nobody mistakes it for a real route.
 */
function arcBetween(a: Coord, b: Coord, samples = 24): Coord[] {
  const [ax, ay] = a;
  const [bx, by] = b;
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const cx = mx - dy * 0.125;
  const cy = my + dx * 0.125;
  const out: Coord[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const u = 1 - t;
    out.push([
      u * u * ax + 2 * u * t * cx + t * t * bx,
      u * u * ay + 2 * u * t * cy + t * t * by,
    ]);
  }
  return out;
}

export function DispatchMiniMap({
  pickup,
  dropoff,
  driver,
  height = 190,
  routeGeoJson,
  approachGeometry,
  accent,
  fill = false,
  framePadding,
  approachLabel,
}: DispatchMiniMapProps) {
  const colors = useColors();
  const cameraRef = useRef<CameraRef | null>(null);
  const line = accent ?? colors.accent;

  const isRoad = Array.isArray(approachGeometry) && approachGeometry.length >= 2;
  const points = useMemo(
    () =>
      [pickup, dropoff, driver, ...(isRoad ? (approachGeometry as Coord[]) : [])].filter(
        (c): c is Coord => isUsableCoord(c),
      ),
    [pickup, dropoff, driver, isRoad, approachGeometry],
  );

  const approach = useMemo(
    () =>
      isRoad
        ? (approachGeometry as Coord[])
        : isUsableCoord(driver) && isUsableCoord(pickup)
          ? arcBetween(driver, pickup)
          : null,
    [isRoad, approachGeometry, driver, pickup],
  );

  // The road draws itself from the driver to the pickup — the leg being offered.
  const approachShown = useRouteReveal(approach, { durationMs: 900 });
  const revealed = !!approach && !!approachShown && approachShown.length === approach.length;

  /** The bus faces down its road: along the first stretch of the approach. */
  const driverHeading = useMemo(() => {
    if (!isUsableCoord(driver)) return 0;
    const ahead = approach && approach.length > 1 ? approach[Math.min(3, approach.length - 1)] : pickup;
    return isUsableCoord(ahead) ? bearingBetween(driver[1], driver[0], ahead[1], ahead[0]) : 0;
  }, [driver, approach, pickup]);

  const approachMid = approach && approach.length > 1 ? approach[Math.floor(approach.length / 2)] : null;

  const ride = useMemo(() => {
    if (routeGeoJson) return null;
    return isUsableCoord(pickup) && isUsableCoord(dropoff) ? arcBetween(pickup, dropoff) : null;
  }, [routeGeoJson, pickup, dropoff]);

  // Frame once, when the points settle. Keyed on the coordinates rather than on
  // mount so an offer that arrives before its geometry does still gets framed.
  const pad = framePadding ?? { top: 44, bottom: 44, left: 40, right: 40 };
  const frameKey = `${points.map((p) => p.join(',')).join('|')}#${Math.round(pad.top / 16)},${Math.round(pad.bottom / 16)}`;
  useEffect(() => {
    const cam = cameraRef.current;
    if (!cam || points.length === 0) return;
    const t = setTimeout(() => {
      if (points.length === 1) {
        cam.setCamera({ centerCoordinate: points[0], zoomLevel: 14, animationDuration: 0 });
        return;
      }
      const box = boundsFor(points);
      if (!box) {
        cam.setCamera({ centerCoordinate: points[0], zoomLevel: 13, animationDuration: 0 });
        return;
      }
      cam.fitBounds([box.ne, box.sw], pad, false, { bearing: 0, pitch: 0 });
    }, 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey]);

  return (
    <View style={[fill ? StyleSheet.absoluteFill : [styles.wrap, { height }], { backgroundColor: colors.surfaceInput }]}>
      <MapView
        style={StyleSheet.absoluteFill}
        styleURL={eyegoDriverDarkStyle}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        scaleBarEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        zoomEnabled={fill}
        scrollEnabled={fill}
      >
        <Camera ref={cameraRef} animationMode="none" />

        {/* The approach: dashed and dimmer, because it is the part the driver
            has to drive before the fare starts. */}
        {approach ? (
          <ShapeSource
            id="dispatch-approach"
            shape={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: approachShown ?? approach } }}
          >
            {/* A real road is the hero line — solid, cased, in the accent. The
                arc placeholder stays dashed and dim so it never passes for one. */}
            {isRoad ? (
              <LineLayer
                id="dispatch-approach-casing"
                style={{ lineColor: '#04101F', lineWidth: 8, lineOpacity: 0.9, lineCap: 'round', lineJoin: 'round' }}
              />
            ) : null}
            <LineLayer
              id="dispatch-approach-line"
              style={
                isRoad
                  ? { lineColor: line, lineWidth: 4, lineOpacity: 1, lineCap: 'round', lineJoin: 'round' }
                  : {
                      lineColor: colors.onSurfaceVariant,
                      lineWidth: 2,
                      lineOpacity: 0.55,
                      lineDasharray: [1.6, 2.2],
                      lineCap: 'round',
                    }
              }
            />
          </ShapeSource>
        ) : null}

        {/* The ride itself: solid, cased, in the accent — the earning leg. */}
        {routeGeoJson || ride ? (
          <ShapeSource
            id="dispatch-ride"
            shape={
              routeGeoJson ?? {
                type: 'Feature',
                properties: {},
                geometry: { type: 'LineString', coordinates: ride as Coord[] },
              }
            }
          >
            <LineLayer
              id="dispatch-ride-casing"
              style={{ lineColor: '#04101F', lineWidth: 8, lineOpacity: 0.9, lineCap: 'round', lineJoin: 'round' }}
            />
            <LineLayer
              id="dispatch-ride-line"
              style={{ lineColor: line, lineWidth: 4, lineOpacity: 1, lineCap: 'round', lineJoin: 'round' }}
            />
          </ShapeSource>
        ) : null}

        {/* The pickup breathes — it is where the driver is being asked to go. */}
        {isUsableCoord(pickup) ? (
          <MarkerView coordinate={pickup} anchor="center">
            <PulseRing size={fill ? 96 : 56} color={line} ringCount={2} duration={1600} />
          </MarkerView>
        ) : null}

        {/* The ends and the driver as the shared 3D models: this bus at the
            start of its road, facing down it; the pickup standing on its kerb. */}
        {isUsableCoord(pickup) ? (
          <Marker3D coordinate={pickup} model={pickupPin(line)} size={fill ? 84 : 60} minPitch={40} />
        ) : null}

        {isUsableCoord(dropoff) ? (
          <Marker3D coordinate={dropoff} model={dropoffPin(line, '#FFFFFF')} heading={35} size={fill ? 76 : 56} minPitch={40} />
        ) : null}

        {isUsableCoord(driver) ? (
          <Marker3D coordinate={driver} model={minibus({ accent: line })} heading={driverHeading} size={fill ? 72 : 50} />
        ) : null}

        {/* How far, said where the distance is: on the road, once it has drawn. */}
        {fill && revealed && approachLabel && isUsableCoord(approachMid) ? (
          <MarkerView coordinate={approachMid} anchor="center">
            <Animated.View
              entering={FadeIn.duration(260).reduceMotion(ReduceMotion.System)}
              style={[styles.etaBubble, { backgroundColor: line }]}
            >
              <Text style={[styles.etaText, { color: colors.background }]}>{approachLabel}</Text>
            </Animated.View>
          </MarkerView>
        ) : null}
      </MapView>

      {/* Vignette. The panel below is glass, and glass over a bright map edge
          reads as a seam; this darkens the join so the two feel like one
          surface rather than a map with a card sitting on it. */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(3,12,24,0.55)', 'rgba(3,12,24,0)', 'rgba(3,12,24,0.85)']}
        locations={[0, 0.42, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', overflow: 'hidden' },
  etaBubble: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 6,
  },
  etaText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.2, fontVariant: ['tabular-nums'] },
});

export default DispatchMiniMap;
