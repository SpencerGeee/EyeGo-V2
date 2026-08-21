import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  MapView,
  Camera,
  MarkerView,
  ShapeSource,
  LineLayer,
  boundsFor,
  isUsableCoord,
  type Coord,
  type CameraRef,
} from '@eyego/maps';
import { eyegoDriverDarkStyle } from '@eyego/map-styles';
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
  /** Tints the route line and the pickup ring — the screen's urgency colour. */
  accent?: string;
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
  accent,
}: DispatchMiniMapProps) {
  const colors = useColors();
  const cameraRef = useRef<CameraRef | null>(null);
  const line = accent ?? colors.accent;

  const points = useMemo(
    () => [pickup, dropoff, driver].filter((c): c is Coord => isUsableCoord(c)),
    [pickup, dropoff, driver],
  );

  const approach = useMemo(
    () => (isUsableCoord(driver) && isUsableCoord(pickup) ? arcBetween(driver, pickup) : null),
    [driver, pickup],
  );

  const ride = useMemo(() => {
    if (routeGeoJson) return null;
    return isUsableCoord(pickup) && isUsableCoord(dropoff) ? arcBetween(pickup, dropoff) : null;
  }, [routeGeoJson, pickup, dropoff]);

  // Frame once, when the points settle. Keyed on the coordinates rather than on
  // mount so an offer that arrives before its geometry does still gets framed.
  const frameKey = points.map((p) => p.join(',')).join('|');
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
      cam.fitBounds([box.ne, box.sw], { top: 44, bottom: 44, left: 40, right: 40 }, false);
    }, 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey]);

  return (
    <View style={[styles.wrap, { height, backgroundColor: colors.surfaceInput }]}>
      <MapView
        style={StyleSheet.absoluteFill}
        styleURL={eyegoDriverDarkStyle}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        scaleBarEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        zoomEnabled={false}
        scrollEnabled={false}
      >
        <Camera ref={cameraRef} animationMode="none" />

        {/* The approach: dashed and dimmer, because it is the part the driver
            has to drive before the fare starts. */}
        {approach ? (
          <ShapeSource
            id="dispatch-approach"
            shape={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: approach } }}
          >
            <LineLayer
              id="dispatch-approach-line"
              style={{
                lineColor: colors.onSurfaceVariant,
                lineWidth: 2,
                lineOpacity: 0.55,
                lineDasharray: [1.6, 2.2],
                lineCap: 'round',
              }}
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

        {isUsableCoord(driver) ? (
          <MarkerView coordinate={driver} anchor="center">
            <View style={[styles.you, { borderColor: colors.background }]}>
              <View style={[styles.youCore, { backgroundColor: colors.onSurface }]} />
            </View>
          </MarkerView>
        ) : null}

        {isUsableCoord(pickup) ? (
          <MarkerView coordinate={pickup} anchor="center">
            <View style={styles.pinWrap}>
              <View style={[styles.pickupHalo, { backgroundColor: line + '2E' }]} />
              <View style={[styles.pickup, { backgroundColor: line, borderColor: colors.background }]} />
            </View>
          </MarkerView>
        ) : null}

        {isUsableCoord(dropoff) ? (
          <MarkerView coordinate={dropoff} anchor="center">
            <View style={[styles.dropoff, { borderColor: line, backgroundColor: colors.background }]}>
              <View style={[styles.dropoffCore, { backgroundColor: line }]} />
            </View>
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
  you: {
    width: 18, height: 18, borderRadius: 9, borderWidth: 3,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  youCore: { width: 8, height: 8, borderRadius: 4 },
  pinWrap: { alignItems: 'center', justifyContent: 'center', width: 40, height: 40 },
  pickupHalo: { position: 'absolute', width: 38, height: 38, borderRadius: 19 },
  pickup: { width: 14, height: 14, borderRadius: 7, borderWidth: 3 },
  dropoff: {
    width: 16, height: 16, borderRadius: 4, borderWidth: 3,
    alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '45deg' }],
  },
  dropoffCore: { width: 4, height: 4, borderRadius: 1 },
});

export default DispatchMiniMap;
