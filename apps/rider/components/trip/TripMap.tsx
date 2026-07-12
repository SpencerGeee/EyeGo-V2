import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MapboxGL from '../../utils/mapbox';
import mapStyles from '@eyego/map-styles';
import { useThemeStore } from '../../stores/theme.store';
import { useTripFlow } from '../../stores/tripFlow.store';
import { useColors, Colors } from '../../utils/useColors';

/**
 * The ONE persistent MapView for the whole trip surface. Mounted once by
 * app/trip.tsx and never unmounted while the flow runs — stages change what
 * is drawn on it (pins, routes, camera), not the map itself.
 *
 * Search stage: user location + picked-destination pin, camera flies to the
 * selection. Later stages (select/request/assigned/tracking) extend this
 * component rather than mounting their own MapView.
 */
function TripMapImpl() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { isDark } = useThemeStore();
  const searchPlace = useTripFlow((s) => s.searchPlace);

  const [userCoords, setUserCoords] = useState<[number, number] | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const Location = await import('expo-location');
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setUserCoords([loc.coords.longitude, loc.coords.latitude]);
        }
      } catch { /* non-fatal */ }
    })();
  }, []);

  return (
    <MapboxGL.MapView
      style={StyleSheet.absoluteFill}
      styleURL={isDark ? mapStyles.eyegoDarkStyle : mapStyles.eyegoLightStyle}
      compassEnabled={false}
      rotateEnabled={false}
      attributionEnabled={false}
      logoEnabled={false}
    >
      {(userCoords || searchPlace) && (
        <MapboxGL.Camera
          centerCoordinate={
            searchPlace ? [searchPlace.longitude, searchPlace.latitude] : userCoords!
          }
          zoomLevel={searchPlace ? 14 : 13}
          animationMode="flyTo"
          animationDuration={700}
        />
      )}
      {userCoords && <MapboxGL.UserLocation visible />}
      {searchPlace && (
        <MapboxGL.PointAnnotation
          id="destination-pin"
          coordinate={[searchPlace.longitude, searchPlace.latitude]}
        >
          <View style={styles.destPin}>
            <View style={styles.destPinBubble}>
              <Ionicons name="location" size={22} color={colors.onPrimary} />
            </View>
            <View style={styles.destPinTail} />
          </View>
        </MapboxGL.PointAnnotation>
      )}
    </MapboxGL.MapView>
  );
}

/**
 * Memoized so the persistent map skips re-render during stage crossfades in
 * trip.tsx — it takes no props and reads its own store slices, so parent
 * re-renders never need to touch it. The map is the heaviest node in the tree.
 */
export const TripMap = React.memo(TripMapImpl);

const makeStyles = (colors: Colors) => StyleSheet.create({
  destPin: { alignItems: 'center' },
  destPinBubble: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 6,
    elevation: 6,
  },
  destPinTail: {
    width: 0, height: 0,
    borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 8,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: colors.primary,
    marginTop: -1,
  },
});
