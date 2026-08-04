/**
 * @eyego/maps — shared MapLibre v11 adapter for both apps.
 *
 * Exposes the SAME Mapbox-style component API both apps' screens already
 * call (MapView/Camera/MarkerView/ShapeSource/LineLayer with old prop names
 * like `centerCoordinate`/`zoomLevel`/`coordinate`/`style.lineColor`) so
 * screen JSX doesn't need a rewrite. Internally it translates to the real
 * @maplibre/maplibre-react-native v11 API (Map/Camera/ViewAnnotation/
 * GeoJSONSource/Layer with `center`/`zoom`/`lngLat`/`paint`) — verified
 * against the installed v11.3.x package source, not just the migration docs.
 *
 * v11 is a native module — this package's actual rendering/gesture/plugin
 * behavior cannot be exercised by typecheck alone. Confirm on the first
 * native (dev-client/EAS) build after this lands.
 */
import React, { useEffect, useImperativeHandle, useRef, useState, useCallback } from 'react';
import { View, Text, Pressable, Dimensions } from 'react-native';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const MapLibreModule = require('@maplibre/maplibre-react-native');
const MapLibre = MapLibreModule.default ?? MapLibreModule;

const NativeMap = MapLibre.Map;
const NativeCamera = MapLibre.Camera;
const NativeViewAnnotation = MapLibre.ViewAnnotation;
// v11 renamed the GeoJSON source component to `GeoJSONSource` (there is no
// `ShapeSource` export) — verified against the installed package source.
const NativeGeoJSONSource = MapLibre.GeoJSONSource;
const NativeLayer = MapLibre.Layer;
const NativeUserLocation = MapLibre.UserLocation;

// ── Types (mirrors the old Mapbox-style API both apps' screens call) ───────

export type LngLat = [number, number];

// Guards against handing MLRNCamera a NaN/Infinity coordinate — its native
// `_setInitialCamera`/camera-stop code throws an uncaught exception (SIGABRT)
// on non-finite input with no JS-catchable error. See BUGFIX comments below.
function isFiniteLngLat(c: LngLat | undefined | null): c is LngLat {
  return !!c && Number.isFinite(c[0]) && Number.isFinite(c[1]);
}

// ── Map bearing ──────────────────────────────────────────────────────────
// Marker rotation is applied as a plain screen-space transform, so a marker
// whose `rotation` is a TRUE compass heading only points the right way while
// the map happens to be north-up. Rotate the map (gesture or course-tracking
// camera) and every heading marker silently desyncs from the world — the pin
// looked like it was turning with the map instead of with the vehicle.
//
// Rather than disabling map rotation (which is what the first fix did, and it
// cost the 3D tilt/rotate gesture), MapView now publishes its live bearing
// here and the marker components subtract it. Rotation gestures are back, and
// a marker fed a real compass heading stays locked to the world regardless of
// how the map is oriented.
const MapBearingContext = React.createContext(0);

/** Current map bearing in degrees clockwise from north. 0 when outside a MapView. */
export function useMapBearing(): number {
  return React.useContext(MapBearingContext);
}

// ── Map layout gate ──────────────────────────────────────────────────────
//
// ROOT-CAUSE CRASH FIX (EyeGo-2026-07-28-164400.ips and every earlier
// -[MLRNCamera _setInitialCamera] SIGABRT).
//
// Read maplibre-react-native 11.3.6's native camera code end to end:
//
//  * MLRNCameraComponentView.updateProps ALWAYS builds a non-nil
//    `initialViewState` on its first pass — even when JS passes none, it
//    still writes a `padding` key. So `_initialViewState` is never nil and
//    `-[MLRNCamera _setInitialCamera]`'s `if (!_initialViewState) return;`
//    guard never fires.
//  * That empty dictionary yields a CameraStop with an INVALID centre and
//    INVALID bounds, so `-[CameraUpdateItem _makeCamera:]` falls through to
//    `[mapView.camera copy]` and hands whatever that is straight to
//    `-[MLNMapView setCamera:…]`.
//  * `-[MLRNMapView layoutSubviews]` calls `initialLayout` on the FIRST
//    layout pass — including the pass where the map's frame is still
//    CGRectZero (a map inside a screen that mounts at zero size: a morph
//    target, a stack card mid-transition, a collapsed flex parent). On a
//    zero-size map `mapView.camera` is degenerate/NaN, mbgl rejects it, and
//    the C++ exception aborts the process. That is the crash — not our
//    coordinates, which is why guarding every call site never fixed it.
//
// The library gives JS no way to disarm `_setInitialCamera`, so the fix is
// to make sure NO camera is attached when that first layout pass runs:
// MapView publishes its measured size here and Camera/NavCamera render
// nothing until the map has real pixels. `_pendingInitialLayout` is then
// consumed with `_reactCamera == nil` and `_setInitialCamera` never runs.
//
// The trade-off is that `-[MLRNCamera setMap:]` does NOT apply a camera
// (both calls in it are commented out upstream), so a late-attached camera
// would otherwise sit at MapLibre's world-view default — the "map shows the
// whole continent" bug. Camera below compensates by pushing its stop
// imperatively once attached.
const MapReadyContext = React.createContext(true);

/** True once the enclosing MapView has been laid out with a real size. */
export function useMapReady(): boolean {
  return React.useContext(MapReadyContext);
}

export interface MapViewProps {
  style?: any;
  /** URL string or a full MapLibre style-spec JSON object (e.g. @eyego/map-styles' default export) — the native Map component JSON.stringifies objects internally. */
  styleURL?: string | object;
  mapStyle?: string | object;
  logoEnabled?: boolean;
  attributionEnabled?: boolean;
  compassEnabled?: boolean;
  rotateEnabled?: boolean;
  pitchEnabled?: boolean;
  scaleBarEnabled?: boolean;
  zoomEnabled?: boolean;
  scrollEnabled?: boolean;
  onRegionDidChange?: (e: { geometry: { coordinates: LngLat }; properties: { zoomLevel: number; isUserInteraction: boolean } }) => void;
  onUserPan?: () => void;
  children?: React.ReactNode;
}

export interface CameraRef {
  setCamera: (opts: {
    centerCoordinate?: LngLat;
    zoomLevel?: number;
    heading?: number;
    pitch?: number;
    animationDuration?: number;
    padding?: { paddingTop?: number; paddingBottom?: number; paddingLeft?: number; paddingRight?: number };
  }) => void;
  fitBounds: (coords: LngLat[], edgePadding?: { top?: number; bottom?: number; left?: number; right?: number }, animated?: boolean) => void;
}

/**
 * Panning/zoom envelope for EVERY map in both apps: the Republic of Ghana plus a
 * small margin, as `[west, south, east, north]` (MapLibre's `LngLatBounds`
 * order — flat GeoJSON-RFC style, south-west corner first).
 *
 * Ghana's actual extent is roughly W -3.26, S 4.53, E 1.20, N 11.18; the margin
 * keeps the border regions comfortably reachable and leaves room for the tilt.
 *
 * WHY: the map read as "capped to Accra" — pan or zoom out and the world simply
 * stopped at the city's outskirts, which would have made the app unusable for a
 * rider or driver in Kumasi, Tamale or Takoradi. Nothing was actually clamped;
 * the tiles are the global OpenFreeMap planet set. The cause is that the style
 * has no low-zoom land/landcover layer, so once you left the metro area (and its
 * z12+ road layers) there was nothing left to draw but the background colour, and
 * an empty dark canvas reads exactly like missing tiles. Two fixes, together:
 * this envelope — which stops anyone from panning off into that void at all and
 * is what the user asked for ("capped in ghana alone and not accra") — and the
 * lowered `minzoom`s in @eyego/map-styles so the country keeps drawing roads,
 * towns and labels when zoomed out to see it whole.
 */
export const GHANA_BOUNDS: [number, number, number, number] = [-3.75, 4.25, 1.65, 11.45];
/** Zoomed all the way out, this frames Ghana end to end rather than the planet. */
export const GHANA_MIN_ZOOM = 6;

export interface CameraProps {
  centerCoordinate?: LngLat;
  zoomLevel?: number;
  heading?: number;
  pitch?: number;
  animationMode?: 'flyTo' | 'linearTo' | 'easeTo' | 'none';
  animationDuration?: number;
  /** v11 `trackUserLocation` passthrough — 'course' rotates to travel heading (nav-style). Prefer <NavCamera> for the active-trip camera instead of setting this directly. */
  trackUserLocation?: 'default' | 'heading' | 'course';
  /** `[west, south, east, north]`. Defaults to {@link GHANA_BOUNDS}; pass `null` to un-cap. */
  maxBounds?: [number, number, number, number] | null;
  /** Defaults to {@link GHANA_MIN_ZOOM}; pass `null` to un-cap. */
  minZoom?: number | null;
}

// ── MapView ──────────────────────────────────────────────────────────────

export const MapView = React.forwardRef<any, MapViewProps>(function MapView(
  {
    children,
    style,
    styleURL,
    mapStyle,
    logoEnabled,
    attributionEnabled,
    compassEnabled,
    rotateEnabled,
    pitchEnabled,
    scaleBarEnabled,
    zoomEnabled,
    scrollEnabled,
    onRegionDidChange,
    onUserPan,
  },
  ref,
) {
  // Diagnostic fallback — the native Map view otherwise fails *silently*
  // (a black frame with only the app background layer showing) when the
  // style JSON or its tile sources don't load, which is indistinguishable
  // from "still loading" without device logs. Surface it visibly instead so
  // the next build reports *why*, not just *that* it's black.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Bumped to force-remount NativeMap on retry — a fresh mount re-issues the
  // style/tile fetch instead of retrying a native view stuck in a failed state.
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (loaded || loadError) return;
    // onDidFailLoadingMap fires for a bad style document, but tile-fetch
    // failures (e.g. OpenFreeMap unreachable) don't trip it — they just
    // never finish loading. A generous timeout catches that silent case too.
    // 25s (not 12s): on a cold start over a slow mobile connection the vector
    // tiles + glyph PBFs can legitimately take >12s, and the old value was
    // firing a *false* "check your connection" error on maps that were in fact
    // still loading fine — the exact bug reported on-device.
    const timer = setTimeout(() => {
      if (!loaded) setLoadError('style/tiles did not finish loading — check your connection');
    }, 25000);
    return () => clearTimeout(timer);
  }, [loaded, loadError, retryKey]);

  // Any of these three native signals means the map is live and we must drop
  // the loading veil / cancel the timeout. onDidFinishLoadingMap alone is
  // unreliable on Android (it can silently never fire even on a good render),
  // which is what left the map stuck behind the veil and then flipped to the
  // false timeout error. Style-loaded and first-frame-rendered are the
  // belt-and-suspenders fallbacks.
  const markLoaded = useCallback(() => setLoaded(true), []);

  // Live map bearing, published to markers so heading-driven rotation can be
  // compensated for map orientation (see MapBearingContext above). Only
  // re-renders on a >1° change so a rotate gesture doesn't thrash React.
  const [mapBearing, setMapBearing] = useState(0);

  // See the MapReadyContext note above — the camera must not be attached
  // during the native map's first layout pass, which can run at zero size.
  const [hasSize, setHasSize] = useState(false);
  const onMapLayout = useCallback((e: any) => {
    const { width, height } = e?.nativeEvent?.layout ?? {};
    if (width > 1 && height > 1) setHasSize(true);
  }, []);

  const handleRetry = useCallback(() => {
    setLoadError(null);
    setLoaded(false);
    setRetryKey((k) => k + 1);
  }, []);

  return (
    // Provider wraps (rather than sits inside) NativeMap so no non-host node
    // is injected into the native map's children — v11 components walk their
    // own children to inject source/layer props.
    <MapBearingContext.Provider value={mapBearing}>
    <MapReadyContext.Provider value={hasSize}>
    <View style={style} onLayout={onMapLayout}>
      <NativeMap
        key={retryKey}
        ref={ref}
        style={{ flex: 1 }}
        mapStyle={mapStyle ?? styleURL}
        logo={logoEnabled ?? false}
        attribution={attributionEnabled ?? false}
        compass={compassEnabled ?? false}
        touchRotate={rotateEnabled ?? true}
        touchPitch={pitchEnabled ?? true}
        touchZoom={zoomEnabled ?? true}
        dragPan={scrollEnabled ?? true}
        scaleBar={scaleBarEnabled ?? false}
        // BUGFIX ("the map-picker Confirm button stays greyed out until you
        // type an address"): v11 replaced the old Mapbox-style GeoJSON region
        // payload — `{ geometry: { coordinates }, properties: { zoomLevel,
        // isUserInteraction } }` — with a flat ViewStateChangeEvent:
        // `{ center, zoom, bearing, pitch, bounds, animated, userInteraction }`
        // (see ViewState in the installed Map.tsx). Every screen still reads
        // the old shape, so `feature.geometry.coordinates` was always
        // undefined: the place picker never learned where its centre pin was,
        // never reverse-geocoded, and so never enabled Confirm — the only way
        // to populate it was the search field, which sets the place directly.
        // The same miss meant `onUserPan` never fired and the published map
        // bearing was stuck at 0, silently disabling marker-rotation
        // compensation. Normalise back to the legacy shape here so the screens
        // stay unchanged.
        // BUGFIX ("the pin turns with the map when you rotate/tilt, then snaps
        // back in place"): the map bearing was published ONLY from
        // onRegionDidChange, which fires once the gesture has ENDED. So for the
        // whole duration of a rotate the compensation below was working off a
        // stale bearing — the marker rotated along with the map — and the instant
        // the finger lifted the real bearing arrived and the marker snapped to
        // its correct world-locked angle. onRegionIsChanging fires continuously
        // DURING the gesture, so the compensation now tracks the map frame by
        // frame and the marker never visibly moves at all.
        //
        // Bearing only — no onUserPan and no onRegionDidChange forwarding from
        // here: those are one-shot semantics ("the user moved the map", "settle
        // and reverse-geocode the centre") and firing them per frame would spam
        // the geocoder and fight the camera.
        onRegionIsChanging={(e: any) => {
          const s = e?.nativeEvent ?? e;
          const bearing = s?.bearing ?? s?.properties?.bearing ?? s?.properties?.heading;
          // 1.5° dead-band: this runs on every frame of a rotate gesture and each
          // accepted value re-renders every marker consuming the context, so the
          // threshold is what keeps a rotate from turning into a 60 fps React
          // render storm. Below ~2° of marker rotation is imperceptible anyway.
          if (Number.isFinite(bearing)) {
            setMapBearing((prev) => (Math.abs(prev - bearing) > 1.5 ? bearing : prev));
          }
        }}
        onRegionDidChange={(e: any) => {
          const s = e?.nativeEvent ?? e;
          const coordinates = s?.center ?? s?.geometry?.coordinates;
          const zoomLevel = s?.zoom ?? s?.properties?.zoomLevel;
          const bearing = s?.bearing ?? s?.properties?.bearing ?? s?.properties?.heading;
          const isUserInteraction = s?.userInteraction ?? s?.properties?.isUserInteraction ?? false;

          if (isUserInteraction) onUserPan?.();
          if (Number.isFinite(bearing)) {
            setMapBearing((prev) => (Math.abs(prev - bearing) > 1 ? bearing : prev));
          }
          if (!Array.isArray(coordinates) || coordinates.length !== 2) return;
          onRegionDidChange?.({
            geometry: { type: 'Point', coordinates: coordinates as LngLat },
            properties: { zoomLevel, isUserInteraction },
          } as any);
        }}
        onDidFinishLoadingMap={markLoaded}
        onDidFinishLoadingStyle={markLoaded}
        onDidFinishRenderingMap={markLoaded}
        onDidFinishRenderingMapFully={markLoaded}
        onDidFailLoadingMap={() => setLoadError('bad style document or unreachable style URL')}
      >
        {children}
      </NativeMap>
      {/* Branded loading veil — replaces the raw black frame while the style/
          tiles are still fetching, so a slow network reads as "loading"
          instead of "broken". */}
      {!loaded && !loadError && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(10,10,15,0.55)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600', letterSpacing: 0.4 }}>
            Loading map…
          </Text>
        </View>
      )}
      {loadError && (
        <View
          style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(10,10,15,0.85)',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            paddingHorizontal: 24,
          }}
        >
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '600', textAlign: 'center' }}>
            Map couldn't load
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, textAlign: 'center' }}>
            {loadError}
          </Text>
          <Pressable
            onPress={handleRetry}
            style={{
              marginTop: 4,
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderRadius: 20,
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.3)',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>Retry</Text>
          </Pressable>
        </View>
      )}
    </View>
    </MapReadyContext.Provider>
    </MapBearingContext.Provider>
  );
});

// ── Camera ───────────────────────────────────────────────────────────────

const EASING_MAP: Record<string, string | undefined> = {
  flyTo: 'fly',
  linearTo: 'linear',
  easeTo: 'ease',
  none: undefined,
};

/**
 * Pushes a camera stop imperatively, tolerating a native view that hasn't
 * finished mounting yet.
 *
 * `Camera.setStop` in maplibre-react-native THROWS ("NativeCameraComponent ref
 * is null") when `findNodeHandle` comes back empty, which it does for the
 * first tick or two after mount because Fabric mounts the view on the main
 * thread while React effects run on the JS thread. Retrying across a couple of
 * frames covers that window; giving up quietly after that is correct, since by
 * then a real prop update has taken over.
 */
function pushStop(nativeRef: React.MutableRefObject<any>, stop: Record<string, unknown>, attempt = 0) {
  try {
    const api = nativeRef.current;
    if (api?.setStop) {
      api.setStop(stop);
      return;
    }
  } catch {
    // fall through to retry
  }
  if (attempt < 5) requestAnimationFrame(() => pushStop(nativeRef, stop, attempt + 1));
}

export const Camera = React.forwardRef<CameraRef, CameraProps>(function Camera(
  {
    centerCoordinate,
    zoomLevel,
    heading,
    pitch,
    animationMode,
    animationDuration,
    trackUserLocation,
    maxBounds = GHANA_BOUNDS,
    minZoom = GHANA_MIN_ZOOM,
  },
  ref,
) {
  const nativeRef = useRef<any>(null);
  // See MapReadyContext — mounting before the map has a real size is what
  // aborted the process in -[MLRNCamera _setInitialCamera].
  const mapReady = useMapReady();

  // Screens call fitBounds/setCamera from mount effects, which can land before
  // the map has been laid out and therefore before this camera is attached.
  // Those calls used to be silently swallowed by the `?.` guards below, which
  // would leave the map framed on nothing. Hold the most recent one and replay
  // it the moment the camera does attach.
  const pendingStopRef = useRef<Record<string, unknown> | null>(null);
  const mapReadyRef = useRef(mapReady);
  mapReadyRef.current = mapReady;

  const applyStop = useCallback((stop: Record<string, unknown>) => {
    if (!mapReadyRef.current) {
      pendingStopRef.current = stop;
      return;
    }
    pushStop(nativeRef, stop);
  }, []);

  useImperativeHandle(ref, () => ({
    setCamera: ({ centerCoordinate: coord, zoomLevel: zoom, heading: bearing, pitch: p, animationDuration: duration, padding }) => {
      if (coord !== undefined && !isFiniteLngLat(coord)) return;
      applyStop({
        center: coord,
        zoom,
        bearing,
        pitch: p,
        duration,
        padding: padding
          ? {
              top: padding.paddingTop ?? 0,
              right: padding.paddingRight ?? 0,
              bottom: padding.paddingBottom ?? 0,
              left: padding.paddingLeft ?? 0,
            }
          : undefined,
      });
    },
    // CRASH FIX (EyeGo-2026-07-28-111815.ips and the identical earlier reports):
    // SIGABRT via __cxa_throw inside
    //   -[CameraUpdateItem _moveCamera:animated:ease:] ← -[MLRNCamera _setInitialCamera]
    //   ← -[MLRNCamera initialLayout] ← -[MLRNMapView layoutSubviews]
    //
    // Two ways this call produced a camera MapLibre refuses, both of which
    // abort in C++ with no JS-catchable error:
    //
    //  1. DEGENERATE BOUNDS. Screens frame origin→destination with fitBounds.
    //     For a driver-created ad-hoc trip whose origin and destination
    //     coincide (or nearly do — a map-pin trip where the destination was
    //     never separately geocoded), min==max on both axes. mbgl's
    //     cameraForLatLngBounds then solves for a zoom of +Infinity and throws.
    //     That is the "tap a suggested trip → instant crash" path.
    //  2. PADDING ≥ VIEWPORT. Callers pass generous insets (e.g. bottom 380 to
    //     clear a sheet). Once top+bottom exceeds the map's height the usable
    //     viewport goes to zero/negative and mbgl throws the same way.
    //
    // The reason the stack points at _setInitialCamera rather than at this
    // call is that screens invoke fitBounds from a mount effect — before the
    // map's first layout — so MLRNCamera stashes it as the *initial* camera
    // update and replays it during layoutSubviews. Guarding here fixes every
    // screen at once, since they all go through this adapter.
    fitBounds: (coords, edgePadding, animated = true) => {
      if (!coords?.length) return;
      coords = coords.filter(isFiniteLngLat);
      if (!coords.length) return;

      const lngs = coords.map((c) => c[0]);
      const lats = coords.map((c) => c[1]);
      let minLng = Math.min(...lngs);
      let minLat = Math.min(...lats);
      let maxLng = Math.max(...lngs);
      let maxLat = Math.max(...lats);

      // Clamp padding to the viewport so the usable area can never collapse.
      // Cap each axis pair at 60% of that dimension, scaling both edges down
      // proportionally so the framing stays visually centred.
      const { width: winW, height: winH } = Dimensions.get('window');
      const clampAxis = (a: number, b: number, extent: number) => {
        const max = extent * 0.6;
        const total = a + b;
        if (total <= max || total <= 0) return [a, b] as const;
        const k = max / total;
        return [a * k, b * k] as const;
      };
      const [padTop, padBottom] = clampAxis(
        Math.max(0, edgePadding?.top ?? 0),
        Math.max(0, edgePadding?.bottom ?? 0),
        winH,
      );
      const [padLeft, padRight] = clampAxis(
        Math.max(0, edgePadding?.left ?? 0),
        Math.max(0, edgePadding?.right ?? 0),
        winW,
      );

      // A single point, or a box so thin it rounds to one, can't be framed —
      // MIN_BOUNDS_SPAN_DEG (~55 m) is the smallest box mbgl will solve a
      // finite zoom for at our max zoom levels. Inflate around the centre
      // instead of handing over a zero-area rect.
      const MIN_BOUNDS_SPAN_DEG = 0.0005;
      if (maxLng - minLng < MIN_BOUNDS_SPAN_DEG) {
        const cx = (minLng + maxLng) / 2;
        minLng = cx - MIN_BOUNDS_SPAN_DEG / 2;
        maxLng = cx + MIN_BOUNDS_SPAN_DEG / 2;
      }
      if (maxLat - minLat < MIN_BOUNDS_SPAN_DEG) {
        const cy = (minLat + maxLat) / 2;
        minLat = cy - MIN_BOUNDS_SPAN_DEG / 2;
        maxLat = cy + MIN_BOUNDS_SPAN_DEG / 2;
      }

      const bounds: [number, number, number, number] = [minLng, minLat, maxLng, maxLat];
      if (!bounds.every(Number.isFinite)) return;

      applyStop({
        bounds,
        padding: { top: padTop, right: padRight, bottom: padBottom, left: padLeft },
        duration: animated ? 500 : 0,
      });
    },
  }));

  // BUGFIX: real on-device crash (EyeGo-2026-07-27-*.ips, both identical) —
  // MLRNCamera's native `_setInitialCamera` throws an uncaught ObjC/C++
  // exception (SIGABRT) when handed a non-finite coordinate (NaN/Infinity —
  // e.g. from a haversine/geocode result computed before its inputs
  // resolved). The crash reports had no JS stack, so the exact caller
  // couldn't be pinned down — this is the single chokepoint every screen's
  // Camera funnels through, so guarding here protects all of them at once
  // rather than chasing one call site.
  const safeCenter = isFiniteLngLat(centerCoordinate) ? centerCoordinate : undefined;
  const safeZoom = Number.isFinite(zoomLevel) ? zoomLevel : undefined;
  const safeBearing = Number.isFinite(heading) ? heading : undefined;
  const safePitch = Number.isFinite(pitch) ? pitch : undefined;

  // BUGFIX ("the map shows the whole continent instead of the street"):
  // -[MLRNCamera setMap:] does NOT apply a camera — upstream has both the
  // `_setInitialCamera` and `updateCamera` calls in it commented out — and
  // MLRNCameraComponentView only calls `updateCamera` from `updateProps`,
  // where `_map` is still nil on the first pass because Fabric mounts the
  // child into the map AFTER its props land. So the declarative centre/zoom
  // was only ever applied by `initialLayout`, which we now deliberately miss
  // by mounting late. Push the first stop ourselves instead — this is also
  // what makes the very first frame land on the right street rather than
  // MapLibre's zoom-0 world view.
  const firstStop = useRef({ center: safeCenter, zoom: safeZoom, bearing: safeBearing, pitch: safePitch });
  firstStop.current = { center: safeCenter, zoom: safeZoom, bearing: safeBearing, pitch: safePitch };
  useEffect(() => {
    if (!mapReady) return;
    // A stop a screen asked for while we were still detached wins over the
    // declarative props — it is the newer intent (e.g. a fitBounds fired from
    // a data-load effect).
    const queued = pendingStopRef.current;
    pendingStopRef.current = null;
    if (queued) {
      pushStop(nativeRef, queued);
      return;
    }
    const { center, zoom, bearing, pitch: p } = firstStop.current;
    if (!center && zoom == null) return;
    pushStop(nativeRef, { center, zoom, bearing, pitch: p, duration: 0 });
  }, [mapReady]);

  // `trackUserLocation` has the same "applied only from updateCamera" problem,
  // and the native side only reacts when the prop CHANGES. Mount with it unset
  // and flip it on the next commit so there is always a real transition for
  // MLRNCameraComponentView to notice, by which time `_map` is attached.
  const [trackMode, setTrackMode] = useState<CameraProps['trackUserLocation']>(undefined);
  useEffect(() => {
    if (!mapReady) return;
    const t = setTimeout(() => setTrackMode(trackUserLocation), 0);
    return () => clearTimeout(t);
  }, [mapReady, trackUserLocation]);

  if (!mapReady) return null;

  return (
    <NativeCamera
      ref={nativeRef}
      center={safeCenter}
      zoom={safeZoom}
      bearing={safeBearing}
      pitch={safePitch}
      duration={animationDuration}
      easing={animationMode ? EASING_MAP[animationMode] : undefined}
      trackUserLocation={trackMode}
      // Country envelope — see GHANA_BOUNDS. `undefined` (not null) is what the
      // native side treats as "no cap".
      maxBounds={maxBounds ?? undefined}
      minZoom={minZoom ?? undefined}
    />
  );
});

// ── NavCamera — 3D active-trip follow camera (Uber/Bolt/Yango-style) ───────
// Tilts + tightens zoom while `active` (following the device's live GPS
// position), so the road ahead is visible during navigation. Falls back to a
// flat overview camera when inactive.
// HISTORY: an earlier fix for "the pin spins with the map" pinned this camera
// north-up (`bearing={0}`, `trackUserLocation="default"`) and turned off the
// rotate gesture on the trip screens. That removed the desync but also removed
// the 3D tilt/rotate the map is supposed to have. The real defect was that
// marker rotation was never compensated for map bearing — now fixed properly
// in MapBearingContext/useAppliedRotation above. So the camera no longer
// force-pins the bearing: gesture rotation persists, tilt is back, and a
// marker fed a true compass heading stays locked to the world either way.
export interface NavCameraProps {
  active: boolean;
  pitch?: number;
  zoom?: number;
  duration?: number;
  /** Fallback center/zoom used before the first GPS fix arrives, or when inactive and no user location is available yet. */
  fallbackCenter?: LngLat;
  fallbackZoom?: number;
}

export function NavCamera({ active, pitch = 55, zoom = 17.5, duration = 800, fallbackCenter, fallbackZoom = 14 }: NavCameraProps) {
  // Same non-finite-coordinate guard as Camera above — this uses NativeCamera
  // directly rather than the wrapped Camera component, so it needs its own.
  const safeFallback = isFiniteLngLat(fallbackCenter) ? fallbackCenter : undefined;
  // Same late-mount + explicit-transition handling as Camera above; see the
  // MapReadyContext note for why both are required.
  const mapReady = useMapReady();
  const [trackMode, setTrackMode] = useState<'default' | undefined>(undefined);
  useEffect(() => {
    if (!mapReady) return;
    const t = setTimeout(() => setTrackMode('default'), 0);
    return () => clearTimeout(t);
  }, [mapReady]);

  if (!mapReady) return null;

  return (
    <NativeCamera
      trackUserLocation={trackMode}
      pitch={active ? pitch : 0}
      zoom={active ? zoom : fallbackZoom}
      center={active ? undefined : safeFallback}
      duration={duration}
      easing="ease"
      // Same country envelope as <Camera> — see GHANA_BOUNDS.
      maxBounds={GHANA_BOUNDS}
      minZoom={GHANA_MIN_ZOOM}
    />
  );
}

// ── Device compass ───────────────────────────────────────────────────────
/**
 * Live TRUE heading from the device's magnetometer/compass, in degrees
 * clockwise from north.
 *
 * Marker heading used to come from `location.heading` — GPS *course over
 * ground*, which is only meaningful while actually moving and reads 0 (or
 * garbage) when stopped or crawling in traffic. That is why turning the phone
 * did nothing to the pin. The compass is tied to the physical orientation of
 * the handset, so rotating the phone rotates the pin immediately, standing
 * still or not.
 *
 * `expo-location` is imported lazily so this package stays dependency-free for
 * any consumer that doesn't need heading. Returns `fallback` until the first
 * compass reading lands (or forever, if permission is denied).
 */
export function useDeviceHeading(enabled = true, fallback = 0): number {
  const [heading, setHeading] = useState(fallback);

  useEffect(() => {
    if (!enabled) return;
    let sub: { remove: () => void } | null = null;
    let cancelled = false;

    (async () => {
      try {
        // Resolved from the host app (rider/driver both depend on it); this
        // package deliberately doesn't declare expo-location itself.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const Location: any = require('expo-location');
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) return;
        sub = await Location.watchHeadingAsync((h: any) => {
          // trueHeading is -1 until the compass calibrates; magHeading is the
          // usable fallback in that window.
          const deg = h?.trueHeading >= 0 ? h.trueHeading : h?.magHeading;
          if (!Number.isFinite(deg)) return;
          // Ignore sub-degree jitter so the marker doesn't re-render at sensor rate.
          setHeading((prev) => (Math.abs(prev - deg) > 1 ? deg : prev));
        });
        if (cancelled) { sub?.remove(); sub = null; }
      } catch {
        // No compass / permission denied — caller keeps the fallback heading.
      }
    })();

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [enabled]);

  return heading;
}

/** Shortest signed angular delta from `a` to `b`, in (-180, 180]. */
function angleDelta(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

export interface VehicleHeadingInput {
  latitude?: number | null;
  longitude?: number | null;
  /** Course over ground reported by GPS, degrees clockwise from north. */
  gpsCourse?: number | null;
  /** Ground speed in m/s (expo-location `coords.speed`). */
  speedMps?: number | null;
  /** Magnetometer heading — where the HANDSET points, not the vehicle. */
  compassHeading?: number | null;
}

/**
 * Vehicle heading for a map marker: accurate, and calm.
 *
 * Why this exists (reported as "it's now correctly moving as the phone moves but
 * the direction may not be accurate, and if I turn, it turns too much"):
 * both driver screens rotated the puck by `deviceHeading || location.heading`,
 * i.e. the COMPASS first. In a car the magnetometer is the worst available
 * source — the metal shell distorts it, a phone in a cradle reads the cradle's
 * orientation rather than the car's, and every hand movement is reported as a
 * turn. That is the over-rotation.
 *
 * The order of preference here is the one Google/Uber use:
 *   1. GPS course over ground, but only while genuinely moving (a course
 *      reading at walking pace is noise, and at 0 m/s it is meaningless).
 *   2. Bearing derived from consecutive fixes, when the device gives no course
 *      but has clearly moved (≥ ~8 m, i.e. beyond consumer-GPS scatter).
 *   3. The last known good heading — a stopped car still faces where it was
 *      going. Holding is always better than spinning.
 *   4. The compass, and ONLY before any travel heading has ever been observed,
 *      so the marker starts out roughly right instead of always facing north.
 *
 * The winning value is then low-passed along the shortest arc and rate-limited,
 * so a real turn sweeps smoothly instead of snapping, and a jittery fix cannot
 * throw the car sideways. Output changes are quantised to `deadbandDeg` to keep
 * marker re-renders rare.
 */
export function useVehicleHeading(
  input: VehicleHeadingInput | null | undefined,
  {
    /** Below this ground speed, GPS course is treated as noise. ~5 km/h. */
    movingMps = 1.4,
    /** Low-pass factor per update. Lower = smoother/slower. */
    smoothing = 0.35,
    /** Maximum degrees the marker may rotate per update. */
    maxStepDeg = 45,
    /** Suppress output changes smaller than this. */
    deadbandDeg = 2,
  }: { movingMps?: number; smoothing?: number; maxStepDeg?: number; deadbandDeg?: number } = {},
): number {
  const lastFixRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const smoothedRef = useRef<number | null>(null);
  const hasTravelHeadingRef = useRef(false);
  const [output, setOutput] = useState(0);

  const lat = input?.latitude ?? null;
  const lng = input?.longitude ?? null;
  const course = input?.gpsCourse ?? null;
  const speed = input?.speedMps ?? null;
  const compass = input?.compassHeading ?? null;

  useEffect(() => {
    let target: number | null = null;

    const moving = typeof speed === 'number' ? speed >= movingMps : null;
    const courseUsable =
      typeof course === 'number' && Number.isFinite(course) && course >= 0 && moving !== false;

    if (courseUsable) {
      target = course % 360;
      hasTravelHeadingRef.current = true;
    } else if (typeof lat === 'number' && typeof lng === 'number') {
      const last = lastFixRef.current;
      if (last) {
        // ~8 m in degrees: 1° latitude ≈ 111 km, so 8 m ≈ 0.00007°. Longitude
        // shrinks with latitude but Ghana is near the equator, so the same
        // threshold is safe on both axes.
        const dLat = Math.abs(lat - last.latitude);
        const dLng = Math.abs(lng - last.longitude);
        if (dLat + dLng > 0.00007) {
          const toRad = Math.PI / 180;
          const dLngRad = (lng - last.longitude) * toRad;
          const y = Math.sin(dLngRad) * Math.cos(lat * toRad);
          const x =
            Math.cos(last.latitude * toRad) * Math.sin(lat * toRad) -
            Math.sin(last.latitude * toRad) * Math.cos(lat * toRad) * Math.cos(dLngRad);
          target = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
          hasTravelHeadingRef.current = true;
        }
      }
    }

    if (target == null && !hasTravelHeadingRef.current && typeof compass === 'number' && Number.isFinite(compass)) {
      target = compass % 360;
    }

    if (typeof lat === 'number' && typeof lng === 'number') {
      lastFixRef.current = { latitude: lat, longitude: lng };
    }

    if (target == null) return; // hold the last heading

    if (smoothedRef.current == null) {
      smoothedRef.current = target;
    } else {
      const delta = angleDelta(smoothedRef.current, target);
      const step = Math.max(-maxStepDeg, Math.min(maxStepDeg, delta * smoothing));
      smoothedRef.current = (smoothedRef.current + step + 360) % 360;
    }

    const next = smoothedRef.current;
    setOutput((prev) => (Math.abs(angleDelta(prev, next)) >= deadbandDeg ? next : prev));
  }, [lat, lng, course, speed, compass, movingMps, smoothing, maxStepDeg, deadbandDeg]);

  return output;
}

// ── Markers ──────────────────────────────────────────────────────────────

export interface MarkerViewProps {
  /** Accepted for prop compat with the old Mapbox-style API — v11's ViewAnnotation is keyed by lngLat, not id. */
  id?: string;
  coordinate: LngLat;
  children?: React.ReactNode;
  /** TRUE compass bearing (deg clockwise from north). Rendered relative to the
   * map's live orientation, so the marker keeps pointing the same way in the
   * world when the map is rotated. */
  rotation?: number;
  /** Opt out of map-bearing compensation and rotate in raw screen space. */
  screenRotation?: boolean;
  flat?: boolean;
  /** v11's ViewAnnotation anchor is a string enum ('center'/'top'/'bottom-left'/etc), not an {x,y} fraction — passed through as-is. Omit to default to 'center'. */
  anchor?: string;
  /** Unused under MapLibre (view annotations always track content changes) — kept for prop compat with the old Mapbox-style API. */
  tracksViewChanges?: boolean;
}

/**
 * `rotation` is treated as a TRUE compass bearing (degrees clockwise from
 * north), so it is rendered relative to the map's current orientation rather
 * than to the screen. Pass `screenRotation` instead for a plain, uncompensated
 * screen-space rotation (decorative icons).
 */
function useAppliedRotation(rotation: number | undefined, compensate: boolean) {
  const mapBearing = useMapBearing();
  if (rotation == null) return undefined;
  return compensate ? rotation - mapBearing : rotation;
}

export const MarkerView = ({ coordinate, children, rotation, anchor, screenRotation }: MarkerViewProps) => {
  const applied = useAppliedRotation(rotation, !screenRotation);
  return (
    <NativeViewAnnotation lngLat={coordinate} anchor={anchor as any}>
      {applied != null ? <View style={{ transform: [{ rotate: `${applied}deg` }] }}>{children}</View> : children}
    </NativeViewAnnotation>
  );
};

export const PointAnnotation = MarkerView;

// AnimatedMarkerView — glides between coordinate updates over `duration`
// via a JS rAF loop driving `lngLat` (ViewAnnotation position isn't
// natively animatable in v11, unlike react-native-maps' AnimatedRegion).
// Re-renders per frame while animating — acceptable for the few markers
// (driver position) that use this, not meant for many simultaneous markers.
export function AnimatedMarkerView({ coordinate, duration = 3500, children, rotation, anchor, screenRotation }: MarkerViewProps & { duration?: number }) {
  const [pos, setPos] = useState<LngLat>(coordinate);
  const fromRef = useRef<LngLat>(coordinate);
  const seededRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!seededRef.current) {
      seededRef.current = true;
      fromRef.current = coordinate;
      return;
    }
    const from = fromRef.current;
    const to = coordinate;
    const start = Date.now();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setPos([from[0] + (to[0] - from[0]) * eased, from[1] + (to[1] - from[1]) * eased]);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordinate[0], coordinate[1], duration]);

  const applied = useAppliedRotation(rotation, !screenRotation);

  return (
    <NativeViewAnnotation lngLat={pos} anchor={anchor as any}>
      {applied != null ? <View style={{ transform: [{ rotate: `${applied}deg` }] }}>{children}</View> : children}
    </NativeViewAnnotation>
  );
}

// ── ShapeSource + LineLayer ──────────────────────────────────────────────
// Real vector rendering via native GeoJSONSource/Layer (no Polyline-emulation
// hack needed, unlike the react-native-maps-backed adapters this replaces).
// Kept the old `ShapeSource`/`shape` names for consumer JSX compatibility —
// internally this is v11's `GeoJSONSource` (`data` prop). GeoJSONSource
// auto-injects a `source` prop into its children, which LineLayer below
// forwards to the native Layer — no manual id-plumbing needed.

export interface ShapeSourceProps {
  id?: string;
  shape: any;
  children?: React.ReactNode;
}

export const ShapeSource = ({ id, shape, children }: ShapeSourceProps) => (
  <NativeGeoJSONSource id={id ?? 'shape-source'} data={shape}>
    {children}
  </NativeGeoJSONSource>
);

export interface LineLayerStyle {
  lineColor?: string;
  lineWidth?: number;
  lineOpacity?: number;
  lineCap?: 'butt' | 'round' | 'square';
  lineJoin?: 'bevel' | 'round' | 'miter';
  lineDasharray?: number[];
}

export interface LineLayerProps {
  id?: string;
  style?: LineLayerStyle;
  aboveLayerID?: string;
  belowLayerID?: string;
  /** Auto-injected by the parent ShapeSource — don't pass explicitly. */
  source?: string;
}

export const LineLayer = ({ id, style, aboveLayerID, belowLayerID, source }: LineLayerProps) => (
  <NativeLayer
    id={id ?? 'line-layer'}
    type="line"
    source={source}
    afterId={aboveLayerID}
    beforeId={belowLayerID}
    paint={{
      'line-color': style?.lineColor ?? '#3B82F6',
      'line-width': style?.lineWidth ?? 3,
      'line-opacity': style?.lineOpacity ?? 1,
      ...(style?.lineDasharray ? { 'line-dasharray': style.lineDasharray } : {}),
    }}
    layout={{
      'line-cap': style?.lineCap ?? 'round',
      'line-join': style?.lineJoin ?? 'round',
    }}
  />
);

// ── CircleLayer ──────────────────────────────────────────────────────────
// For data-driven point overlays (demand heatmaps, etc). Paint values accept
// either a static number/string or a MapLibre style-spec expression array
// (e.g. `['get', 'radiusPx']` to read a per-feature property).

export interface CircleLayerStyle {
  circleRadius?: number | any[];
  circleColor?: string | any[];
  circleOpacity?: number | any[];
}

export interface CircleLayerProps {
  id?: string;
  style?: CircleLayerStyle;
  /** Auto-injected by the parent ShapeSource — don't pass explicitly. */
  source?: string;
}

export const CircleLayer = ({ id, style, source }: CircleLayerProps) => (
  <NativeLayer
    id={id ?? 'circle-layer'}
    type="circle"
    source={source}
    paint={{
      'circle-radius': style?.circleRadius ?? 10,
      'circle-color': style?.circleColor ?? '#3B82F6',
      'circle-opacity': style?.circleOpacity ?? 0.5,
      'circle-stroke-width': 0,
    }}
  />
);

// ── UserLocation ─────────────────────────────────────────────────────────

export interface UserLocationProps {
  visible?: boolean;
  showsUserHeadingIndicator?: boolean;
}

export const UserLocation = ({ visible = true, showsUserHeadingIndicator }: UserLocationProps) =>
  visible ? <NativeUserLocation showsUserHeadingIndicator={showsUserHeadingIndicator} /> : null;

// ── Last-resort fallback (native module failed to load) ─────────────────

function buildFallback(bgColor: string, fgColor: string) {
  const FallbackMap = ({ children, style }: any) => (
    <View style={[{ backgroundColor: bgColor, alignItems: 'center', justifyContent: 'center' }, style]}>
      {children}
      <Text style={{ color: fgColor, position: 'absolute', bottom: 20 }}>Map unavailable</Text>
    </View>
  );
  const NoopCamera = React.forwardRef((_props: any, ref: any) => {
    useImperativeHandle(ref, () => ({ setCamera: () => {}, fitBounds: () => {} }));
    return null;
  });
  NoopCamera.displayName = 'NoopCamera';
  const NoopOverlay = ({ children, style }: any) => <View style={style}>{children}</View>;

  return {
    MapView: FallbackMap,
    Camera: NoopCamera,
    NavCamera: () => null,
    MarkerView: NoopOverlay,
    AnimatedMarkerView: NoopOverlay,
    PointAnnotation: NoopOverlay,
    ShapeSource: () => null,
    LineLayer: () => null,
    CircleLayer: () => null,
    UserLocation: () => null,
  };
}

// ── The shared map behaviour, above the MapLibre compat layer ───────────────
//
// Everything above this line adapts MapLibre v11 to the prop names the app
// uses. Everything below is the behaviour that used to be copy-pasted into
// five screens: how the camera decides where to point, and how a trickle of
// GPS fixes becomes a car that moves.
//
// Screens should import `useMapCamera` and declare a mode. No screen should
// call `setCamera` itself — that is what let five copies of the camera drift
// apart from each other, and let a driver ping fight a rider's pan.
export * from './camera';
export * from './puck';
export * from './useMapCamera';

export const MapAvailable = !!(NativeMap && NativeCamera && NativeViewAnnotation && NativeGeoJSONSource && NativeLayer);

const fallback = MapAvailable ? null : buildFallback('#0A0A0B', '#3B82F6');

export default MapAvailable
  ? { MapView, Camera, NavCamera, MarkerView, AnimatedMarkerView, PointAnnotation, ShapeSource, LineLayer, CircleLayer, UserLocation }
  : fallback!;
