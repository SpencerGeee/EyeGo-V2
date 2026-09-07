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
import { useLoopsActive } from '@eyego/ui';
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
import { fetchRoute } from '../../utils/routing';

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
  /**
   * Fired when the driver actually touches the map — not when the camera moves.
   * The dispatch screen fades its top chrome out after a few idle seconds so
   * the map is readable, and uses this to bring it back.
   */
  onUserInteraction?: () => void;
}

/**
 * THE OFFER MAP DRAWS REAL ROADS.
 *
 * BUGFIX ("on the new dispatch screen shown to the driver, the route polyline
 * is showing a straight line").
 *
 * It was, and the reason is structural rather than cosmetic: a dispatch offer
 * is PRE-assignment, so `route-geometry.service` has never been asked for a leg
 * on this trip — `activeLeg('MATCHING')` is null — and the offer payload
 * therefore carries no geometry. The map fell through to `arcBetween`, a bowed
 * hint that at city scale is visually indistinguishable from a ruler laid
 * across the map. And the one question a driver asks about an offer is
 * geographic, so a fabricated line is worse than no line.
 *
 * So the screen fetches the two legs itself, through the same `/v1/geo/route`
 * proxy the create-trip screen already uses (Mapbox `driving-traffic` → OSRM →
 * estimate). Two calls, once, on a screen one driver looks at for 45 seconds —
 * the same cost `create.tsx` pays per destination change. The arc survives as
 * the frame-zero placeholder and as the answer when routing is genuinely down,
 * and `dashed` marks it as an estimate either way.
 */
function useRoadLeg(from: Coord | null | undefined, to: Coord | null | undefined) {
  const [road, setRoad] = useState<Coord[] | null>(null);
  const key = isUsableCoord(from) && isUsableCoord(to) ? `${from.join(',')}|${to.join(',')}` : null;

  useEffect(() => {
    setRoad(null);
    if (!key || !isUsableCoord(from) || !isUsableCoord(to)) return undefined;
    let cancelled = false;
    void fetchRoute(from, to).then((r) => {
      // `estimate` is the proxy's own straight-line fallback. Taking it would
      // paint a two-point line in the SOLID road style, which is precisely the
      // fabricated road this exists to avoid — so it stays on the dashed arc.
      if (cancelled || !r || r.source === 'estimate' || r.coordinates.length < 2) return;
      setRoad(r.coordinates as Coord[]);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return road;
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
    { pickup, dropoff, driver, routeGeoJson, accent, padding, onFramedChange, onUserInteraction },
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

    /**
     * Where the map opens before anything has framed it. The pickup is the
     * subject of the offer, so it is the honest single point; the driver's own
     * position is the fallback for a payload that has not landed yet. See the
     * note at `<Camera>` for why declaring this at all is the fix.
     */
    const initialCenter = useMemo<Coord | null>(() => {
      if (isUsableCoord(pickup)) return pickup;
      if (isUsableCoord(driver)) return driver;
      if (isUsableCoord(dropoff)) return dropoff;
      return null;
      // Frozen after the first usable value: this is the OPENING camera, and
      // re-declaring it later would yank a driver who has panned away.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [!!isUsableCoord(pickup), !!isUsableCoord(driver), !!isUsableCoord(dropoff)]);

    /**
     * A PROGRAMMATIC MOVE IS NOT A GESTURE.
     *
     * BUGFIX ("the Frame the ride pill doesn't seem to go when it appears").
     *
     * `frame()` sets `framed` true and then animates the camera. MapLibre
     * reports that animation through `onRegionIsChanging` like any other
     * change, and the `userInteraction` flag on those frames is not reliably
     * false for an eased camera stop — so the map immediately told the screen
     * "the driver panned", `framed` went back to false, and the control the
     * driver had just tapped reappeared before their finger left it. From the
     * outside that is a button that does nothing.
     *
     * Filtering on the flag alone cannot fix it, because the flag is the thing
     * that is wrong. A timestamp can: for as long as a move WE issued is still
     * running, no region change is allowed to count as a gesture. 700 ms covers
     * the 550 ms `setCamera`/`fitBounds` ease with room for the settle, and a
     * driver whose finger really is on the map for that window will release it
     * on the next frame anyway.
     */
    const suppressGestureUntilRef = useRef(0);
    /** The driver has panned. Stops the framing retries below dead. */
    const userOwnsCameraRef = useRef(false);

    const frame = useCallback(
      (animated = true) => {
        const cam = cameraRef.current;
        if (!cam || points.length === 0) return;
        suppressGestureUntilRef.current = Date.now() + (animated ? 700 : 250);
        // Asking to be framed is asking for the camera back.
        userOwnsCameraRef.current = false;
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
      /**
       * FRAME MORE THAN ONCE, BECAUSE THE FIRST ATTEMPT CAN LAND ON NOTHING.
       *
       * A single 140 ms shot assumes the native map is ready at 140 ms. On a
       * FIRST visit it usually is, because the offer itself arrives late and
       * the timer therefore starts late. On a RE-ENTRY the store is already
       * warm, the coordinates exist on the first render, and the shot is fired
       * into a map that has not finished loading its style — where it is
       * silently dropped, leaving the world view the driver reported.
       *
       * Three attempts across the first second, each one a no-op if the camera
       * has already settled where it wants to be. They stop the moment the
       * driver takes the camera, so this can never fight a pan.
       */
      const timers = [140, 500, 1100].map((delay) =>
        setTimeout(() => {
          // The driver has taken the camera — the retries are for a map that
          // never got framed, never for one they have deliberately moved.
          if (userOwnsCameraRef.current) return;
          frame(false);
          setReady(true);
        }, delay),
      );
      return () => timers.forEach(clearTimeout);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [frameKey]);

    /**
     * The pickup halo breathes. It is the one pin the driver is being asked
     * about, and on a map with three markers on it the difference between "the
     * place I am going" and "the other two" has to survive a two-second glance.
     * Opacity and scale only, so it stays on the compositor thread.
     */
    const halo = useSharedValue(0);
    const loopsActive = useLoopsActive();
    useEffect(() => {
      // A 45-second offer screen, but the driver can leave it mounted behind a
      // navigation and the halo would breathe on regardless.
      if (reducedMotion || !loopsActive) {
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

    /**
     * The two legs, on real roads.
     *
     * The approach is deliberately fetched too: "how far out is the pickup"
     * is the question the driver is actually answering, and a crow-flies arc
     * through a river or a one-way system is not an answer.
     */
    const approachRoad = useRoadLeg(driver, pickup);
    const rideRoad = useRoadLeg(routeGeoJson ? null : pickup, routeGeoJson ? null : dropoff);

    const approach = useMemo(() => {
      if (approachRoad) return approachRoad;
      return isUsableCoord(driver) && isUsableCoord(pickup) ? arcBetween(driver, pickup) : null;
    }, [approachRoad, driver, pickup]);
    /** False while we are still on the bowed placeholder — see the line styles. */
    const approachIsRoad = !!approachRoad;

    const ride = useMemo(() => {
      if (routeGeoJson) return null;
      if (rideRoad) return rideRoad;
      return isUsableCoord(pickup) && isUsableCoord(dropoff) ? arcBetween(pickup, dropoff) : null;
    }, [routeGeoJson, rideRoad, pickup, dropoff]);
    const rideIsRoad = !!routeGeoJson || !!rideRoad;

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
            if (!ready) return;
            // See `suppressGestureUntilRef` — our own camera animations arrive
            // here too, and taking them for a pan is what made the framing
            // control immortal.
            if (Date.now() < suppressGestureUntilRef.current) return;
            userOwnsCameraRef.current = true;
            onFramedChange?.(false);
            // Separate from `onFramedChange` on purpose: framing is about where
            // the camera is, this is about the driver being ACTIVE on the map.
            // The screen uses it to bring back chrome it has faded out.
            onUserInteraction?.();
          }}
        >
          {/*
            THE CAMERA STARTS ON THE RIDE, NOT ON THE PLANET.

            BUGFIX ("the map shown when you go back to the homepage and back to
            the dispatch offer page is a whole overview of the region and not
            the accurate location — the only way it corrects is the Frame the
            ride button").

            This was `<Camera ref animationMode="easeTo" />` with no centre and
            no zoom at all, and the adapter is explicit about what that means:
            `-[MLRNCamera setMap:]` applies no camera of its own, so a Camera
            that declares nothing sits at MapLibre's zoom-0 world view until
            something commands it. The only thing that ever did was the framing
            effect below, on a 140 ms timer — which on a re-entry (the store is
            already warm, so the coordinates exist on the first render) fires
            before the native map has finished loading its style and is
            swallowed. First visit: the offer arrives late, the timer fires
            late, it lands. Second visit: it does not. Exactly the report.

            Declaring the centre makes the FIRST PAINTED FRAME the right place
            regardless of how the framing race turns out — the adapter pushes
            the declared stop itself the moment the camera attaches. The fit
            still runs and still improves on it; this is the floor under it.
          */}
          <Camera
            ref={cameraRef}
            animationMode="easeTo"
            centerCoordinate={initialCenter ?? undefined}
            zoomLevel={initialCenter ? 13.5 : undefined}
          />

          {/* The approach: dashed and dimmer, because it is the part the driver
              has to drive before the fare starts. Dashes stay ON even once it
              is a real road — the dash is what distinguishes "the unpaid leg"
              from "the ride"; `approachIsRoad` only firms up its weight. */}
          {approach ? (
            <ShapeSource
              id="dispatch-live-approach"
              shape={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: approach } }}
            >
              <LineLayer
                id="dispatch-live-approach-line"
                style={{
                  lineColor: colors.onSurfaceVariant,
                  lineWidth: approachIsRoad ? 3.5 : 2.5,
                  lineOpacity: approachIsRoad ? 0.85 : 0.5,
                  lineDasharray: approachIsRoad ? [2.4, 1.8] : [1.6, 2.2],
                  lineCap: 'round',
                  lineJoin: 'round',
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
                style={{
                  lineColor: line,
                  lineWidth: 5,
                  lineOpacity: 1,
                  lineCap: 'round',
                  lineJoin: 'round',
                  // Until the road answers, the ride is a bowed placeholder.
                  // Dashing it is the honest way to say "this is roughly where
                  // it goes" without drawing a road that does not exist.
                  ...(rideIsRoad ? null : { lineDasharray: [2, 2] }),
                }}
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
