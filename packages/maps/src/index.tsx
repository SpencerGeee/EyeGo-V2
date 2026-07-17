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
import { View, Text, Pressable } from 'react-native';

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

  const handleRetry = useCallback(() => {
    setLoadError(null);
    setLoaded(false);
    setRetryKey((k) => k + 1);
  }, []);

  return (
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
          if (e?.nativeEvent?.properties?.isUserInteraction) onUserPan?.();
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
    fitBounds: (coords, edgePadding, animated = true) => {
      if (!coords?.length) return;
      const lngs = coords.map((c) => c[0]);
      const lats = coords.map((c) => c[1]);
      const bounds: [number, number, number, number] = [
        Math.min(...lngs),
        Math.min(...lats),
        Math.max(...lngs),
        Math.max(...lats),
      ];
      nativeRef.current?.setStop?.({
        bounds,
        padding: edgePadding
          ? { top: edgePadding.top ?? 0, right: edgePadding.right ?? 0, bottom: edgePadding.bottom ?? 0, left: edgePadding.left ?? 0 }
          : undefined,
        duration: animated ? 500 : 0,
      });
    },
  }));

  return (
    <NativeCamera
      ref={nativeRef}
      center={centerCoordinate}
      zoom={zoomLevel}
      bearing={heading}
      pitch={pitch}
      duration={animationDuration}
      easing={animationMode ? EASING_MAP[animationMode] : undefined}
      trackUserLocation={trackUserLocation}
    />
  );
});

// ── NavCamera — 3D active-trip follow camera (Uber/Bolt/Yango-style) ───────
// Tilts + rotates to travel heading + tightens zoom while `active`, so the
// road ahead is visible during navigation. Falls back to a flat overview
// camera when inactive. `trackUserLocation="course"` derives heading from
// consecutive GPS fixes (not the compass) — no separate sensor needed.

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
  return (
    <NativeCamera
      trackUserLocation={active ? 'course' : 'default'}
      pitch={active ? pitch : 0}
      zoom={active ? zoom : fallbackZoom}
      center={active ? undefined : fallbackCenter}
      duration={duration}
      easing="ease"
    />
  );
}

// ── Markers ──────────────────────────────────────────────────────────────

export interface MarkerViewProps {
  /** Accepted for prop compat with the old Mapbox-style API — v11's ViewAnnotation is keyed by lngLat, not id. */
  id?: string;
  coordinate: LngLat;
  children?: React.ReactNode;
  rotation?: number;
  flat?: boolean;
  /** v11's ViewAnnotation anchor is a string enum ('center'/'top'/'bottom-left'/etc), not an {x,y} fraction — passed through as-is. Omit to default to 'center'. */
  anchor?: string;
  /** Unused under MapLibre (view annotations always track content changes) — kept for prop compat with the old Mapbox-style API. */
  tracksViewChanges?: boolean;
}

export const MarkerView = ({ coordinate, children, rotation, anchor }: MarkerViewProps) => (
  <NativeViewAnnotation lngLat={coordinate} anchor={anchor as any}>
    {rotation ? <View style={{ transform: [{ rotate: `${rotation}deg` }] }}>{children}</View> : children}
  </NativeViewAnnotation>
);

export const PointAnnotation = MarkerView;

// AnimatedMarkerView — glides between coordinate updates over `duration`
// via a JS rAF loop driving `lngLat` (ViewAnnotation position isn't
// natively animatable in v11, unlike react-native-maps' AnimatedRegion).
// Re-renders per frame while animating — acceptable for the few markers
// (driver position) that use this, not meant for many simultaneous markers.
export function AnimatedMarkerView({ coordinate, duration = 3500, children, rotation, anchor }: MarkerViewProps & { duration?: number }) {
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

  return (
    <NativeViewAnnotation lngLat={pos} anchor={anchor as any}>
      {rotation ? <View style={{ transform: [{ rotate: `${rotation}deg` }] }}>{children}</View> : children}
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
