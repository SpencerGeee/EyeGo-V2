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

export interface CameraProps {
  centerCoordinate?: LngLat;
  zoomLevel?: number;
  heading?: number;
  pitch?: number;
  animationMode?: 'flyTo' | 'linearTo' | 'easeTo' | 'none';
  animationDuration?: number;
  /** v11 `trackUserLocation` passthrough — 'course' rotates to travel heading (nav-style). Prefer <NavCamera> for the active-trip camera instead of setting this directly. */
  trackUserLocation?: 'default' | 'heading' | 'course';
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
    <View style={style}>
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
        // onRegionDidChange/onUserPan: neither current screen consumer passes
        // these; the exact v11 viewport-change event name is unconfirmed
        // (Map.js doesn't destructure it explicitly — it's forwarded to the
        // native view manager as-is). Verify the real event name before any
        // future consumer relies on this.
        onRegionDidChange={(e: any) => {
          const props = e?.nativeEvent?.properties ?? e?.properties;
          if (props?.isUserInteraction) onUserPan?.();
          const b = props?.bearing ?? props?.heading;
          if (Number.isFinite(b)) {
            setMapBearing((prev) => (Math.abs(prev - b) > 1 ? b : prev));
          }
          onRegionDidChange?.(e?.nativeEvent ?? e);
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

export const Camera = React.forwardRef<CameraRef, CameraProps>(function Camera(
  { centerCoordinate, zoomLevel, heading, pitch, animationMode, animationDuration, trackUserLocation },
  ref,
) {
  const nativeRef = useRef<any>(null);

  useImperativeHandle(ref, () => ({
    setCamera: ({ centerCoordinate: coord, zoomLevel: zoom, heading: bearing, pitch: p, animationDuration: duration, padding }) => {
      if (coord !== undefined && !isFiniteLngLat(coord)) return;
      nativeRef.current?.setStop?.({
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

      nativeRef.current?.setStop?.({
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

  return (
    <NativeCamera
      ref={nativeRef}
      center={safeCenter}
      zoom={Number.isFinite(zoomLevel) ? zoomLevel : undefined}
      bearing={Number.isFinite(heading) ? heading : undefined}
      pitch={Number.isFinite(pitch) ? pitch : undefined}
      duration={animationDuration}
      easing={animationMode ? EASING_MAP[animationMode] : undefined}
      trackUserLocation={trackUserLocation}
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
  return (
    <NativeCamera
      trackUserLocation="default"
      pitch={active ? pitch : 0}
      zoom={active ? zoom : fallbackZoom}
      center={active ? undefined : safeFallback}
      duration={duration}
      easing="ease"
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

export const MapAvailable = !!(NativeMap && NativeCamera && NativeViewAnnotation && NativeGeoJSONSource && NativeLayer);

const fallback = MapAvailable ? null : buildFallback('#0A0A0B', '#3B82F6');

export default MapAvailable
  ? { MapView, Camera, NavCamera, MarkerView, AnimatedMarkerView, PointAnnotation, ShapeSource, LineLayer, CircleLayer, UserLocation }
  : fallback!;
