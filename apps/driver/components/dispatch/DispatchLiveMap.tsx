import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
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
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useColors } from '../../utils/useColors';

/**
 * ── THE OFFER MAP THE DRIVER CAN ACTUALLY LOOK AROUND ───────────────────────
 *
 * FEATURE ("the page needs to show the map so the driver can pan the map and
 * see how far out the pickup point is and all. Right now it's looking basic and
 * not well thought of").
 *
 * `DispatchMiniMap` is deliberately inert — every gesture is off — and that is
 * the right call for the thumbnail embedded in the takeover sheet, where the map
 * is one element inside a card and a driver dragging it would be fighting the
 * card. It is the wrong call for the dispatch SCREEN, where the map is the
 * screen: the single question a driver asks about an offer is geographic ("is
 * that pickup through town, is the drop-off somewhere I want to end up") and a
 * frozen 208pt thumbnail cannot answer it. They need to pan out, look at the
 * road, and pan back.
 *
 * ── WHY PANNING NEEDED SOMETHING BUILT AROUND IT ────────────────────────────
 * The reason the original was frozen is sound: an offer is a short decision and
 * a driver who pans away has no way back, so a stray drag can lose the ride
 * behind the horizon. That is a missing control, not a reason to nail the camera
 * down. So: gestures are on, and the moment the camera stops matching the ride
 * the screen offers "Frame the ride" (`onFramedChange` → the FAB above the
 * sheet). The camera is never yanked back under the driver's finger.
 *
 * ── THE SIGABRT ─────────────────────────────────────────────────────────────
 * `fitBounds` on a degenerate box is the MLRNCamera crash, not NaN. Bounds go
 * through `boundsFor`, which enforces a minimum span, and a single usable
 * coordinate falls back to `setCamera`. Same rule as the mini map.
 */

export interface DispatchLiveMapHandle {
  /** Re-frame on the whole ride. Called by the screen's framing control. */
  frame: (animated?: boolean) => void;
}

export interface DispatchLiveMapProps {
  pickup?: Coord | null;
  dropoff?: Coord | null;
  driver?: Coord | null;
  /** Road geometry when the server has it; a bowed hint is drawn otherwise. */
  routeGeoJson?: GeoJSON.Feature | null;
  /** Tints the ride line and the pickup ring — the screen's urgency colour. */
  accent?: string;
  /**
   * Padding for `fitBounds`, in points. The sheet covers the bottom of the
   * screen, so the ride has to be framed into the space ABOVE it or half of it
   * is behind the panel — which looks exactly like a map that will not show you
   * the pickup.
   */
  padding?: { top: number; bottom: number; left: number; right: number };
  /** Fires false as soon as the driver moves the camera off the framed view. */
  onFramedChange?: (framed: boolean) => void;
}

/**
 * A gentle arc between two points, so the "we have no road geometry" case reads
 * as a journey rather than a ruler laid across the city. Bowed perpendicular by
 * an eighth of its length: enough to look intentional, little enough that nobody
 * mistakes it for a real route.
 */
function arcBetween(a: Coord, b: Coord, samples = 28): Coord[] {
  const [ax, ay] = a;
  const [bx, by] = b;
  const cx = (ax + bx) / 2 - (by - ay) * 0.125;
  const cy = (ay + by) / 2 + (bx - ax) * 0.125;
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

export const DispatchLiveMap = forwardRef<DispatchLiveMapHandle, DispatchLiveMapProps>(
  function DispatchLiveMap(
    { pickup, dropoff, driver, routeGeoJson, accent, padding, onFramedChange },
    ref,
  ) {
    const colors = useColors();
    const cameraRef = useRef<CameraRef | null>(null);
    const line = accent ?? colors.accent;
    const reducedMotion = useReducedMotion();
    const [ready, setReady] = useState(false);

    const points = useMemo(
      () => [pickup, dropoff, driver].filter((c): c is Coord => isUsableCoord(c)),
      [pickup, dropoff, driver],
    );

    const pad = padding ?? { top: 120, bottom: 360, left: 56, right: 56 };

    const frame = useCallback(
      (animated = true) => {
        const cam = cameraRef.current;
        if (!cam || points.length === 0) return;
        if (points.length === 1) {
          cam.setCamera({
            centerCoordinate: points[0],
            zoomLevel: 14,
            animationDuration: animated ? 550 : 0,
          });
          onFramedChange?.(true);
          return;
        }
        const box = boundsFor(points);
        if (!box) {
          cam.setCamera({
            centerCoordinate: points[0],
            zoomLevel: 13,
            animationDuration: animated ? 550 : 0,
          });
          onFramedChange?.(true);
          return;
        }
        cam.fitBounds([box.ne, box.sw], pad, animated);
        onFramedChange?.(true);
      },
      // `pad` is an object literal from props; keyed on its values rather than
      // its identity so a re-render does not re-frame under the driver.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [points, pad.top, pad.bottom, pad.left, pad.right, onFramedChange],
    );

    useImperativeHandle(ref, () => ({ frame }), [frame]);

    /**
     * Frame once when the points settle, never again on their own.
     *
     * Keyed on the COORDINATES rather than on mount, so an offer that arrives
     * before its geometry does still gets framed — and so a driver who has
     * panned away is not snapped back every time a socket frame lands with the
     * same pickup in it.
     */
    const frameKey = points.map((p) => p.join(',')).join('|');
    useEffect(() => {
      if (!frameKey) return;
      const t = setTimeout(() => {
        frame(false);
        setReady(true);
      }, 140);
      return () => clearTimeout(t);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [frameKey]);

    /**
     * The pickup halo breathes. It is the one pin the driver is being asked
     * about, and on a map with three markers on it the difference between "the
     * place I am going" and "the other two" has to survive a two-second glance.
     * Opacity and scale only, so it stays on the compositor thread.
     */
    const halo = useSharedValue(0);
    useEffect(() => {
      if (reducedMotion) {
        cancelAnimation(halo);
        halo.value = 0.5;
        return;
      }
      halo.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 900, easing: Easing.in(Easing.quad) }),
        ),
        -1,
        false,
      );
      return () => cancelAnimation(halo);
    }, [reducedMotion, halo]);
    const haloStyle = useAnimatedStyle(() => ({
      opacity: 0.45 - halo.value * 0.35,
      transform: [{ scale: 0.7 + halo.value * 0.85 }],
    }));

    const approach = useMemo(
      () => (isUsableCoord(driver) && isUsableCoord(pickup) ? arcBetween(driver, pickup) : null),
      [driver, pickup],
    );

    const ride = useMemo(() => {
      if (routeGeoJson) return null;
      return isUsableCoord(pickup) && isUsableCoord(dropoff) ? arcBetween(pickup, dropoff) : null;
    }, [routeGeoJson, pickup, dropoff]);

    return (
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surfaceInput }]}>
        <MapView
          style={StyleSheet.absoluteFill}
          styleURL={eyegoDriverDarkStyle}
          logoEnabled={false}
          attributionEnabled={false}
          compassEnabled={false}
          scaleBarEnabled={false}
          // Pan and zoom are the whole point of this component. Rotation and
          // pitch stay off: a tilted, spun map is harder to read at a glance and
          // there is no way for a driver to undo either by accident.
          rotateEnabled={false}
          pitchEnabled={false}
          zoomEnabled
          scrollEnabled
          /**
           * The driver has taken the camera; the screen offers a way back rather
           * than taking it from them. See `onFramedChange`.
           *
           * `onUserGesture` and not `onRegionDidChange`: the latter also fires
           * for the programmatic `fitBounds` this component issues itself, which
           * would raise the "Frame the ride" control the instant the screen
           * framed the ride.
           */
          onUserGesture={() => {
            if (ready) onFramedChange?.(false);
          }}
        >
          <Camera ref={cameraRef} animationMode="easeTo" />

          {/* The approach: dashed and dimmer, because it is the part the driver
              has to drive before the fare starts. */}
          {approach ? (
            <ShapeSource
              id="dispatch-live-approach"
              shape={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: approach } }}
            >
              <LineLayer
                id="dispatch-live-approach-line"
                style={{
                  lineColor: colors.onSurfaceVariant,
                  lineWidth: 2.5,
                  lineOpacity: 0.6,
                  lineDasharray: [1.6, 2.2],
                  lineCap: 'round',
                }}
              />
            </ShapeSource>
          ) : null}

          {/* The ride itself: solid, cased, in the accent — the earning leg. */}
          {routeGeoJson || ride ? (
            <ShapeSource
              id="dispatch-live-ride"
              shape={
                routeGeoJson ?? {
                  type: 'Feature',
                  properties: {},
                  geometry: { type: 'LineString', coordinates: ride as Coord[] },
                }
              }
            >
              <LineLayer
                id="dispatch-live-ride-casing"
                style={{ lineColor: '#04101F', lineWidth: 10, lineOpacity: 0.9, lineCap: 'round', lineJoin: 'round' }}
              />
              <LineLayer
                id="dispatch-live-ride-line"
                style={{ lineColor: line, lineWidth: 5, lineOpacity: 1, lineCap: 'round', lineJoin: 'round' }}
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
                <Animated.View
                  style={[styles.pickupHalo, { backgroundColor: line }, haloStyle]}
                  pointerEvents="none"
                />
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
      </View>
    );
  },
);

const styles = StyleSheet.create({
  you: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 3,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  youCore: { width: 9, height: 9, borderRadius: 5 },
  pinWrap: { alignItems: 'center', justifyContent: 'center', width: 56, height: 56 },
  pickupHalo: { position: 'absolute', width: 52, height: 52, borderRadius: 26 },
  pickup: { width: 16, height: 16, borderRadius: 8, borderWidth: 3.5 },
  dropoff: {
    width: 18, height: 18, borderRadius: 5, borderWidth: 3.5,
    alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '45deg' }],
  },
  dropoffCore: { width: 4, height: 4, borderRadius: 1 },
});

export default DispatchLiveMap;
