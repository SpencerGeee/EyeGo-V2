import React, { useState, useContext, useEffect, useImperativeHandle } from 'react';

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

  // Context lets Camera/UserLocation (children) push state up into MapView
  const MapRegionContext = React.createContext<{
    setRegion: (r: any) => void;
    setShowsUserLocation: (v: boolean) => void;
  } | null>(null);

  // MapView ─────────────────────────────────────────────────────────────────
  const ExpoMapView = ({
    children,
    style,
    compassEnabled,
    rotateEnabled,
  }: any) => {
    const [region, setRegion] = useState<any>(null);
    const [showsUserLocation, setShowsUserLocation] = useState(false);

    return React.createElement(
      MapRegionContext.Provider,
      { value: { setRegion, setShowsUserLocation } },
      React.createElement(
        RNMapView,
        {
          style,
          region: region ?? undefined,
          showsCompass: compassEnabled ?? false,
          rotateEnabled: rotateEnabled ?? true,
          showsScale: false,
          showsUserLocation,
          showsMyLocationButton: false,
          toolbarEnabled: false,
        },
        children
      )
    );
  };

  // Camera ──────────────────────────────────────────────────────────────────
  const ExpoCamera = React.forwardRef(
    ({ centerCoordinate, zoomLevel }: any, ref: any) => {
      const ctx = useContext(MapRegionContext);

      useEffect(() => {
        if (!ctx || !centerCoordinate) return;
        const lat = centerCoordinate[1];
        const lng = centerCoordinate[0];
        if (isNaN(lat) || isNaN(lng)) return;
        const delta = zoomToDelta(zoomLevel ?? 12);
        ctx.setRegion({
          latitude: lat,
          longitude: lng,
          latitudeDelta: delta,
          longitudeDelta: delta,
        });
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [centerCoordinate?.[0], centerCoordinate?.[1], zoomLevel]);

      useImperativeHandle(ref, () => ({
        setCamera: ({ centerCoordinate: coord, zoomLevel: zoom }: any) => {
          if (!ctx || !coord) return;
          const delta = zoomToDelta(zoom ?? 13);
          ctx.setRegion({
            latitude: coord[1],
            longitude: coord[0],
            latitudeDelta: delta,
            longitudeDelta: delta,
          });
        },
      }));

      return null;
    }
  );
  ExpoCamera.displayName = 'ExpoCamera';

  // MarkerView ──────────────────────────────────────────────────────────────
  const ExpoMarkerView = ({ coordinate, children }: any) =>
    React.createElement(
      Marker,
      { coordinate: toLatLng(coordinate), tracksViewChanges: false },
      children
    );

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
    useImperativeHandle(ref, () => ({ setCamera: () => {} }));
    return null;
  });
  NoopCamera.displayName = 'NoopCamera';

  const NoopOverlay = ({ children, style }: any) =>
    React.createElement(View, { style }, children);

  return {
    MapView: FallbackMap,
    Camera: NoopCamera,
    MarkerView: NoopOverlay,
    PointAnnotation: NoopOverlay,
    ShapeSource: () => null,
    LineLayer: () => null,
    UserLocation: () => null,
  };
}
