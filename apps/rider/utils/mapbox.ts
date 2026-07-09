import React, { useState, useContext, useEffect, useImperativeHandle, useRef } from 'react';

// @maplibre/maplibre-react-native v9 predates Fabric support (MapLibre only
// added a New Architecture compat layer in v10, with full support in v11 —
// a breaking API rewrite). This app runs newArchEnabled:true (required by
// react-native-reanimated 4.x), so mounting the v9 native MapView crashes
// immediately under Fabric. react-native-maps already supports Fabric and
// is used successfully by the driver app, so we standardize on it here for
// both Expo Go and custom/production builds.
let MapboxGL: any;

try {
  MapboxGL = buildMapsAdapter();
} catch (e) {
  console.warn('🚨 [MapboxGL Adapter] react-native-maps failed to load, falling back to placeholder map:', e);
  MapboxGL = buildFallback();
}

export default MapboxGL;

// ---------------------------------------------------------------------------
// react-native-maps adapter: matches the Mapbox/MapLibre component API used
// throughout the app (MapView, Camera, MarkerView, PointAnnotation, etc.)
//
// Camera motion model: the map is UNCONTROLLED (initialRegion + imperative
// `animateToRegion`) so camera moves glide instead of teleporting through
// controlled-region re-renders, and a user pan never fights a render.
// `setCamera` accepts Mapbox-style `padding` — emulated by shifting the
// region center so the target sits centered in the UNOBSCURED part of the
// map (e.g. the area above a bottom sheet).
// ---------------------------------------------------------------------------
function buildMapsAdapter() {
  const RNMaps = require('react-native-maps');
  const RNMapView = RNMaps.default;
  const { Marker, Polyline } = RNMaps;

  // [lng, lat] → { latitude, longitude }
  const toLatLng = (coord: [number, number]) => ({
    latitude: coord[1],
    longitude: coord[0],
  });

  // Mapbox zoom → approximate latitudeDelta for react-native-maps
  const zoomToDelta = (zoom: number) => 360 / Math.pow(2, zoom);

  // Context lets Camera/UserLocation (children) drive the host MapView
  const MapRegionContext = React.createContext<{
    setInitialRegion: (r: any) => void;
    animateRegion: (r: any, durationMs: number) => void;
    fitCoordinates: (coords: { latitude: number; longitude: number }[], edgePadding: any, animated: boolean) => void;
    getMapHeight: () => number;
    setShowsUserLocation: (v: boolean) => void;
  } | null>(null);

  // MapView ─────────────────────────────────────────────────────────────────
  const ExpoMapView = ({
    children,
    style,
    compassEnabled,
    rotateEnabled,
    onRegionDidChange,
    onUserPan,
  }: any) => {
    const mapRef = useRef<any>(null);
    const mapHeightRef = useRef(0);
    const [initialRegion, setInitialRegion] = useState<any>(null);
    const [showsUserLocation, setShowsUserLocation] = useState(false);

    const ctxRef = useRef<any>(null);
    if (!ctxRef.current) {
      ctxRef.current = {
        setInitialRegion: (r: any) => setInitialRegion((prev: any) => prev ?? r),
        animateRegion: (r: any, durationMs: number) => {
          if (mapRef.current?.animateToRegion) mapRef.current.animateToRegion(r, Math.max(durationMs, 1));
          else setInitialRegion(r);
        },
        fitCoordinates: (coords: any[], edgePadding: any, animated: boolean) => {
          mapRef.current?.fitToCoordinates?.(coords, { edgePadding, animated });
        },
        getMapHeight: () => mapHeightRef.current,
        setShowsUserLocation: (v: boolean) => setShowsUserLocation(v),
      };
    }

    return React.createElement(
      MapRegionContext.Provider,
      { value: ctxRef.current },
      React.createElement(
        RNMapView,
        {
          ref: mapRef,
          style,
          initialRegion: initialRegion ?? undefined,
          showsCompass: compassEnabled ?? false,
          rotateEnabled: rotateEnabled ?? true,
          showsScale: false,
          showsUserLocation,
          showsMyLocationButton: false,
          toolbarEnabled: false,
          onLayout: (e: any) => {
            mapHeightRef.current = e.nativeEvent.layout.height;
          },
          onRegionChangeComplete: (r: any, details?: { isGesture?: boolean }) => {
            if (details?.isGesture) onUserPan?.();
            onRegionDidChange?.({
              geometry: { coordinates: [r.longitude, r.latitude] },
              properties: { zoomLevel: Math.log2(360 / r.latitudeDelta), isUserInteraction: !!details?.isGesture },
            });
          },
        },
        children
      )
    );
  };

  // Camera ──────────────────────────────────────────────────────────────────
  const ExpoCamera = React.forwardRef(
    ({ centerCoordinate, zoomLevel, animationDuration }: any, ref: any) => {
      const ctx = useContext(MapRegionContext);
      const seededRef = useRef(false);

      // Mapbox-style padding → shift region center so the target coordinate
      // lands centered in the unobscured window (e.g. above a bottom sheet).
      const regionFor = (coord: [number, number], zoom: number, padding?: any) => {
        const latDelta = zoomToDelta(zoom);
        let lat = coord[1];
        const mapH = ctx?.getMapHeight() ?? 0;
        if (padding && mapH > 0) {
          const pb = padding.paddingBottom ?? 0;
          const pt = padding.paddingTop ?? 0;
          // Target must appear (pb - pt)/2 px ABOVE screen center, so the
          // camera center sits that many px of latitude south of the target.
          lat = coord[1] - ((pb - pt) / 2 / mapH) * latDelta;
        }
        return { latitude: lat, longitude: coord[0], latitudeDelta: latDelta, longitudeDelta: latDelta };
      };

      // Declarative center: first value seeds the map, changes animate with
      // the declared duration (0 keeps legacy snap behavior).
      useEffect(() => {
        if (!ctx || !centerCoordinate) return;
        const lat = centerCoordinate[1];
        const lng = centerCoordinate[0];
        if (isNaN(lat) || isNaN(lng)) return;
        const region = regionFor([lng, lat], zoomLevel ?? 12);
        if (!seededRef.current) {
          seededRef.current = true;
          ctx.setInitialRegion(region);
          return;
        }
        ctx.animateRegion(region, animationDuration ?? 0);
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [centerCoordinate?.[0], centerCoordinate?.[1], zoomLevel]);

      useImperativeHandle(ref, () => ({
        setCamera: ({ centerCoordinate: coord, zoomLevel: zoom, animationDuration: dur, padding }: any) => {
          if (!ctx || !coord) return;
          ctx.animateRegion(regionFor(coord, zoom ?? 13, padding), dur ?? 350);
        },
        fitBounds: (coords: [number, number][], edgePadding?: any, animated = true) => {
          if (!ctx || !coords?.length) return;
          ctx.fitCoordinates(coords.map(toLatLng), edgePadding ?? { top: 80, bottom: 80, left: 60, right: 60 }, animated);
        },
      }));

      return null;
    }
  );
  ExpoCamera.displayName = 'ExpoCamera';

  // MarkerView ──────────────────────────────────────────────────────────────
  // `rotation`/`flat` map to native Marker props so car headings rotate
  // without bitmap recapture; `tracksViewChanges` opt-in for animated
  // marker content (pulse rings) — keep it false for static pins.
  const ExpoMarkerView = ({ coordinate, children, rotation, flat, anchor, tracksViewChanges }: any) =>
    React.createElement(
      Marker,
      {
        coordinate: toLatLng(coordinate),
        tracksViewChanges: tracksViewChanges ?? false,
        rotation: rotation ?? 0,
        flat: flat ?? false,
        anchor: anchor ?? { x: 0.5, y: 0.5 },
      },
      children
    );

  // AnimatedMarkerView ──────────────────────────────────────────────────────
  // Marker whose position glides natively between coordinate updates instead
  // of being re-rendered per frame from JS. Android animates fully natively
  // (animateMarkerToCoordinate); iOS drives the coordinate prop through an
  // AnimatedRegion (legacy Animated, but no React re-render per frame).
  // `rotation` updates as a plain native prop on each (discrete) update.
  const { Platform } = require('react-native');
  const ExpoAnimatedMarkerView = ({ coordinate, duration = 3500, children, rotation, flat, anchor, tracksViewChanges }: any) => {
    const lng = coordinate[0];
    const lat = coordinate[1];
    const markerRef = useRef<any>(null);
    const regionRef = useRef<any>(null); // iOS AnimatedRegion
    const seededRef = useRef(false);
    const seedCoordRef = useRef({ latitude: lat, longitude: lng });

    if (Platform.OS !== 'android' && !regionRef.current) {
      regionRef.current = new RNMaps.AnimatedRegion({
        latitude: lat,
        longitude: lng,
        latitudeDelta: 0,
        longitudeDelta: 0,
      });
    }

    useEffect(() => {
      if (!seededRef.current) {
        // First coordinate seeds the marker; nothing to animate yet.
        seededRef.current = true;
        return;
      }
      if (Platform.OS === 'android') {
        markerRef.current?.animateMarkerToCoordinate?.({ latitude: lat, longitude: lng }, duration);
      } else {
        regionRef.current
          .timing({ latitude: lat, longitude: lng, duration, useNativeDriver: false })
          .start();
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lat, lng]);

    const common = {
      tracksViewChanges: tracksViewChanges ?? false,
      rotation: rotation ?? 0,
      flat: flat ?? false,
      anchor: anchor ?? { x: 0.5, y: 0.5 },
    };

    if (Platform.OS === 'android') {
      // coordinate prop stays at the SEED position on purpose: the native
      // animation owns the marker position, and a changing prop would snap
      // it back on every React re-render mid-glide.
      return React.createElement(
        Marker,
        { ref: markerRef, coordinate: seedCoordRef.current, ...common },
        children
      );
    }
    return React.createElement(
      Marker.Animated,
      { coordinate: regionRef.current, ...common },
      children
    );
  };

  // ShapeSource + LineLayer ─────────────────────────────────────────────────
  // Reads the line style from its LineLayer child and renders a Polyline.
  const ExpoShapeSource = ({ shape, children }: any) => {
    let strokeColor = '#4be277';
    let strokeWidth = 3;

    React.Children.forEach(children, (child: any) => {
      const s = child?.props?.style;
      if (s?.lineColor) strokeColor = s.lineColor;
      if (s?.lineWidth) strokeWidth = s.lineWidth;
    });

    if (shape?.geometry?.type === 'LineString') {
      return React.createElement(Polyline, {
        coordinates: shape.geometry.coordinates.map(toLatLng),
        strokeColor,
        strokeWidth,
      });
    }
    return null;
  };

  const ExpoLineLayer = () => null;

  // UserLocation ────────────────────────────────────────────────────────────
  // react-native-maps shows the blue dot via a prop on MapView, not a child
  // component, so this just toggles that prop through context.
  const ExpoUserLocation = ({ visible }: any) => {
    const ctx = useContext(MapRegionContext);
    useEffect(() => {
      ctx?.setShowsUserLocation(visible ?? true);
      return () => ctx?.setShowsUserLocation(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible]);
    return null;
  };

  return {
    MapView: ExpoMapView,
    Camera: ExpoCamera,
    MarkerView: ExpoMarkerView,
    AnimatedMarkerView: ExpoAnimatedMarkerView,
    PointAnnotation: ExpoMarkerView,
    ShapeSource: ExpoShapeSource,
    LineLayer: ExpoLineLayer,
    UserLocation: ExpoUserLocation,
  };
}

// ---------------------------------------------------------------------------
// Last-resort plain-view fallback (custom build with broken native module)
// ---------------------------------------------------------------------------
function buildFallback() {
  const { View, Text } = require('react-native');

  const FallbackMap = ({ children, style }: any) =>
    React.createElement(
      View,
      { style: [{ backgroundColor: '#091009', alignItems: 'center', justifyContent: 'center' }, style] },
      children,
      React.createElement(
        Text,
        { style: { color: '#4be277', position: 'absolute', bottom: 20 } },
        '🗺️ Map unavailable'
      )
    );

  const NoopCamera = React.forwardRef((_props: any, ref: any) => {
    useImperativeHandle(ref, () => ({ setCamera: () => {}, fitBounds: () => {} }));
    return null;
  });
  NoopCamera.displayName = 'NoopCamera';

  const NoopOverlay = ({ children, style }: any) =>
    React.createElement(View, { style }, children);

  return {
    MapView: FallbackMap,
    Camera: NoopCamera,
    MarkerView: NoopOverlay,
    AnimatedMarkerView: NoopOverlay,
    PointAnnotation: NoopOverlay,
    ShapeSource: () => null,
    LineLayer: () => null,
    UserLocation: () => null,
  };
}
