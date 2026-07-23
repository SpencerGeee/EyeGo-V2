import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, Pressable, ActivityIndicator, TextInput, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { fonts, spacing, withOpacity } from '@eyego/config';
import { Text, Button } from '@eyego/ui';
import { useColors, type DriverColors } from '../../utils/useColors';
import * as Haptics from 'expo-haptics';
import MapboxGL, { type CameraRef } from '../../utils/mapbox';
import { eyegoDriverDarkStyle as eyegoDarkStyle, eyegoLightStyle } from '@eyego/map-styles';
import { useDriverStore } from '../../stores/driver.store';
import { reverseGeocode, type GeocodeResult } from '../../utils/geocoding';
import { setPickedPlace } from '../../utils/placePickerResult';

const ACCRA: [number, number] = [-0.187, 5.6037];

type NominatimResult = {
  display_name: string;
  lat: string;
  lon: string;
  address?: { road?: string; suburb?: string; town?: string; city?: string };
};

/**
 * Fullscreen map with a fixed center pin — used for both the driver's ad-hoc
 * "create trip from here" pickup point and its destination. Pan the map or
 * search a place; each settle reverse-geocodes the coordinate so the driver
 * confirms an exact location, not an estimate.
 */
export default function DriverLocationPickerScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { title } = useLocalSearchParams<{ title?: string }>();
  const { theme } = useDriverStore();
  const isDark = theme !== 'light';

  const [center, setCenter] = useState<[number, number] | null>(null);
  const [resolved, setResolved] = useState<GeocodeResult | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const geocodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [initialCoords, setInitialCoords] = useState<[number, number] | null>(null);
  const cameraRef = useRef<CameraRef>(null);

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const Location = await import('expo-location');
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setInitialCoords([loc.coords.longitude, loc.coords.latitude]);
          return;
        }
      } catch { /* non-fatal */ }
      setInitialCoords(ACCRA);
    })();
  }, []);

  const handleRegionChange = useCallback((feature: { geometry?: { coordinates?: [number, number] } } | null | undefined) => {
    const coords = feature?.geometry?.coordinates;
    if (!coords || coords.length !== 2) return;
    const [lng, lat] = coords;
    setCenter([lng, lat]);
    setResolved(null);
    if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
    geocodeTimer.current = setTimeout(async () => {
      setIsResolving(true);
      const place = await reverseGeocode(lat, lng);
      setResolved(place ?? {
        placeId: 0,
        name: 'Dropped pin',
        fullAddress: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        latitude: lat,
        longitude: lng,
      });
      setIsResolving(false);
    }, 500);
  }, []);

  const handleConfirm = useCallback(() => {
    if (!resolved) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPickedPlace(resolved);
    router.back();
  }, [resolved, router]);

  const handleSearch = useCallback((text: string) => {
    setQuery(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (text.length < 2) { setSuggestions([]); return; }
    searchTimer.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=json&countrycodes=gh&limit=6&addressdetails=1`,
          { headers: { 'User-Agent': 'EyeGo/2.0 (eyego.app)' } },
        );
        const data = await res.json();
        setSuggestions(Array.isArray(data) ? data : []);
      } catch {
        setSuggestions([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  }, []);

  const handleSelectSuggestion = useCallback((s: NominatimResult) => {
    const lat = parseFloat(s.lat);
    const lng = parseFloat(s.lon);
    const name = s.address?.road ?? s.address?.suburb ?? s.address?.town ?? s.address?.city ?? s.display_name.split(',')[0];
    Haptics.selectionAsync();
    setQuery(name);
    setSuggestions([]);
    setCenter([lng, lat]);
    setResolved({ placeId: 0, name, fullAddress: s.display_name, latitude: lat, longitude: lng });
    cameraRef.current?.setCamera({ centerCoordinate: [lng, lat], zoomLevel: 16, animationDuration: 500 });
  }, []);

  return (
    <View style={styles.root}>
      {initialCoords && (
        <MapboxGL.MapView
          style={StyleSheet.absoluteFill}
          styleURL={isDark ? eyegoDarkStyle : eyegoLightStyle}
          compassEnabled={false}
          onRegionDidChange={handleRegionChange}
        >
          <MapboxGL.Camera ref={cameraRef} centerCoordinate={initialCoords} zoomLevel={15} />
          <MapboxGL.UserLocation visible />
        </MapboxGL.MapView>
      )}

      {/* Fixed center pin — offset up so the pin TIP marks the map center */}
      <View style={styles.pinWrap} pointerEvents="none">
        <View style={styles.pinBubble}>
          <Ionicons name="location" size={22} color={colors.onPrimary} />
        </View>
        <View style={styles.pinTail} />
        <View style={styles.pinShadow} />
      </View>

      <SafeAreaView style={styles.overlay} edges={['top']} pointerEvents="box-none">
        <View style={styles.headerRow}>
          <Pressable
            style={styles.backBtn}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Ionicons name="close" size={22} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle}>{title ?? 'Pick Location'}</Text>
          <View style={{ width: 44, height: 44 }} />
        </View>

        <View style={styles.searchWrap} pointerEvents="box-none">
          <View style={styles.searchBar}>
            <Ionicons name="search" size={18} color={colors.onSurfaceVariant} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={handleSearch}
              placeholder="Search a place…"
              placeholderTextColor={colors.onSurfaceVariant}
              returnKeyType="search"
            />
            {isSearching && <ActivityIndicator size="small" color={colors.primary} />}
          </View>
          {suggestions.length > 0 && (
            <View style={styles.suggestionsBox}>
              <FlatList
                data={suggestions}
                keyExtractor={(item, i) => `${item.lat}-${item.lon}-${i}`}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <Pressable style={styles.suggestionRow} onPress={() => handleSelectSuggestion(item)}>
                    <Ionicons name="location-outline" size={16} color={colors.onSurfaceVariant} />
                    <Text style={styles.suggestionText} numberOfLines={1}>{item.display_name}</Text>
                  </Pressable>
                )}
              />
            </View>
          )}
        </View>
      </SafeAreaView>

      {/* Bottom confirm card */}
      <SafeAreaView style={styles.bottomWrap} edges={['bottom']} pointerEvents="box-none">
        <View style={styles.bottomCard}>
          <View style={styles.addressRow}>
            <View style={styles.addressIcon}>
              <Ionicons name="location-outline" size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              {isResolving || (!resolved && center) ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={styles.addressDim}>Locating…</Text>
                </View>
              ) : resolved ? (
                <>
                  <Text style={styles.addressName} numberOfLines={1}>{resolved.name}</Text>
                  <Text style={styles.addressFull} numberOfLines={2}>{resolved.fullAddress}</Text>
                </>
              ) : (
                <Text style={styles.addressDim}>Move the map to drop the pin</Text>
              )}
            </View>
          </View>
          <Button
            label="Confirm Location"
            onPress={handleConfirm}
            disabled={!resolved || isResolving}
          />
        </View>
      </SafeAreaView>
    </View>
  );
}

const makeStyles = (colors: DriverColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.backgroundDeep },
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: withOpacity(colors.surfaceCard, 0.9),
    borderWidth: 1,
    borderColor: colors.rimLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 18,
    lineHeight: 23,
    color: colors.onSurface,
    letterSpacing: -0.3,
  },
  searchWrap: {
    marginTop: 10,
    paddingHorizontal: 20,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: withOpacity(colors.surfaceCard, 0.96),
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.rimLight,
    paddingHorizontal: 14,
    height: 46,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 6,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.onSurface,
    padding: 0,
  },
  suggestionsBox: {
    marginTop: 8,
    maxHeight: 260,
    backgroundColor: withOpacity(colors.surfaceCard, 0.98),
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.rimLight,
    overflow: 'hidden',
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.rimLight,
  },
  suggestionText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.onSurface,
  },
  pinWrap: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinBubble: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: -2,
    transform: [{ translateY: -26 }],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  pinTail: {
    width: 0, height: 0,
    borderLeftWidth: 7, borderRightWidth: 7, borderTopWidth: 10,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
    borderTopColor: colors.primary,
    transform: [{ translateY: -26 }],
  },
  pinShadow: {
    width: 8,
    height: 4,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.35)',
    transform: [{ translateY: -24 }],
  },
  bottomWrap: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
  },
  bottomCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: withOpacity(colors.surfaceCard, 0.96),
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.rimLight,
    padding: spacing.xl,
    gap: spacing.base,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 12,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  addressIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: withOpacity(colors.primary, 0.12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  addressName: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    lineHeight: 21,
    color: colors.onSurface,
  },
  addressFull: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
  addressDim: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.onSurfaceVariant,
  },
});
