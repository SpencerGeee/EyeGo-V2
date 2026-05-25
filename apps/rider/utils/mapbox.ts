import React from 'react';
import Constants from 'expo-constants';

// Detect Expo Go at runtime — avoids crashing on missing native Mapbox module
// SDK 54: appOwnership === 'expo' is the reliable signal; executionEnvironment kept as fallback
const isExpoGo =
  Constants.appOwnership === 'expo' ||
  (Constants as any).executionEnvironment === 'storeClient';

let MapboxGL: any;

if (!isExpoGo) {
  // Custom dev/prod build — use the real Mapbox SDK
  try {
    const Maps = require('@rnmapbox/maps');
    MapboxGL = Maps.default || Maps;
  } catch (e) {
    // Shouldn't happen in a custom build, but guard just in case
    MapboxGL = buildFallback();
  }
} else {
  // Expo Go — use react-native-maps as a drop-in adapter
  try {
    MapboxGL = buildExpoGoAdapter();
  } catch (e) {
    console.warn('🚨 [MapboxGL Adapter] react-native-maps failed to load, falling back to placeholder map:', e);
    MapboxGL = buildFallback();
  }
}

export default MapboxGL;

// ---------------------------------------------------------------------------
// Expo Go adapter: wraps react-native-maps to match the Mapbox component API
// ---------------------------------------------------------------------------
function buildExpoGoAdapter() {
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

  // Context lets Camera (a child) push region updates up into MapView
  const MapRegionContext = React.createContext<{
    setRegion: (r: any) => void;
  } | null>(null);

  // MapView ─────────────────────────────────────────────────────────────────
  const ExpoMapView = ({
    children,
    style,
    compassEnabled,
    rotateEnabled,
  }: any) => {
    const [region, setRegion] = React.useState<any>(null);

    return React.createElement(
      MapRegionContext.Provider,
      { value: { setRegion } },
      React.createElement(
        RNMapView,
        {
          style,
          region: region ?? undefined,
          showsCompass: compassEnabled ?? false,
          rotateEnabled: rotateEnabled ?? true,
          showsScale: false,
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
      const ctx = React.useContext(MapRegionContext);

      React.useEffect(() => {
        if (!ctx || !centerCoordinate) return;
        const delta = zoomToDelta(zoomLevel ?? 12);
        ctx.setRegion({
          latitude: centerCoordinate[1],
          longitude: centerCoordinate[0],
          latitudeDelta: delta,
          longitudeDelta: delta,
        });
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [centerCoordinate?.[0], centerCoordinate?.[1], zoomLevel]);

      React.useImperativeHandle(ref, () => ({
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

  return {
    setAccessToken: () => {},
    MapView: ExpoMapView,
    Camera: ExpoCamera,
    MarkerView: ExpoMarkerView,
    ShapeSource: ExpoShapeSource,
    LineLayer: ExpoLineLayer,
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
    React.useImperativeHandle(ref, () => ({ setCamera: () => {} }));
    return null;
  });
  NoopCamera.displayName = 'NoopCamera';

  return {
    setAccessToken: () => {},
    MapView: FallbackMap,
    Camera: NoopCamera,
    MarkerView: ({ children, style }: any) =>
      React.createElement(View, { style }, children),
    ShapeSource: () => null,
    LineLayer: () => null,
  };
}
