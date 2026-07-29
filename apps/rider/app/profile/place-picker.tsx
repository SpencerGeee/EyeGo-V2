import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, Pressable, ActivityIndicator, TextInput, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { fonts, spacing, radii, withOpacity } from '@eyego/config';
import { Text, Button } from '@eyego/ui';
import { useColors, Colors } from '../../utils/useColors';
import { haptic } from '../../utils/haptics';
import MapboxGL, { type CameraRef } from '../../utils/mapbox';
import { eyegoDarkStyle, eyegoLightStyle } from '@eyego/map-styles';
import { useThemeStore } from '../../stores/theme.store';
import { reverseGeocode, searchPlaces, type GeocodeResult } from '../../utils/geocoding';
import { setPickedPlace } from '../../utils/placePickerResult';

const ACCRA: [number, number] = [-0.187, 5.6037];

/**
 * Fullscreen map with a fixed center pin: pan the map, the pin stays centered,
 * and each settle reverse-geocodes the coordinate so the user confirms an
 * exact location — not just a typed address.
 */
export default function PlacePickerScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  // Callers pass a title so the same screen reads correctly for whichever
  // field opened it ("Set pickup" vs "Where to?") — the where-to page now
  // opens this directly from either field instead of behind a map button.
  const { title } = useLocalSearchParams<{ title?: string }>();
  const { isDark } = useThemeStore();

  const [center, setCenter] = useState<[number, number] | null>(null);
  const [resolved, setResolved] = useState<GeocodeResult | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const geocodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [initialCoords, setInitialCoords] = useState<[number, number] | null>(null);
  const cameraRef = useRef<CameraRef>(null);

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
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
        name: 'Pinned location',
        fullAddress: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        latitude: lat,
        longitude: lng,
      });
      setIsResolving(false);
    }, 500);
  }, []);

  // Resolve the opening position immediately instead of waiting for the first
  // pan. The pin is already sitting on a real place the moment the screen
  // opens, so Confirm should be usable straight away — previously the rider
  // had to nudge the map (or type) before the button came alive, which read as
  // "Confirm is greyed out until you type the location in the field".
  useEffect(() => {
    if (!initialCoords || center || resolved) return;
    handleRegionChange({ geometry: { coordinates: initialCoords } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCoords]);

  // The pin — not the geocoder — is what the rider is confirming. If the
  // reverse lookup hasn't landed (or failed), commit the coordinate under a
  // "Dropped pin" label rather than blocking on a label the trip doesn't need.
  const handleConfirm = useCallback(async () => {
    // BUGFIX ("picking a location on the map shows just coordinates on the trip
    // request page"): the reverse lookup is debounced 500 ms and then has a
    // network round trip to make, so confirming promptly — which riders do,
    // because the pin is already where they want it — committed the raw
    // lat/lng fallback and carried it all the way through to the request
    // screen. Resolve on demand here before committing, and only fall back to a
    // coordinate label if that genuinely comes back empty.
    let place = resolved;
    if (!place && center) {
      setIsResolving(true);
      place = await reverseGeocode(center[1], center[0]);
      setIsResolving(false);
    }
    place =
      place ??
      (center
        ? {
            placeId: 0,
            name: 'Pinned location',
            fullAddress: `${center[1].toFixed(5)}, ${center[0].toFixed(5)}`,
            latitude: center[1],
            longitude: center[0],
          }
        : null);
    if (!place) return;
    haptic.medium();
    setPickedPlace(place);
    router.back();
  }, [resolved, center, router]);

  // Search from within the picker so it's consistent with the where-to search —
  // selecting a result snaps the map straight to that exact place instead of
  // requiring the user to hand-drag the pin there.
  // Results are biased toward wherever the pin currently sits, so "station"
  // surfaces the nearby one rather than an alphabetical national list.
  const handleSearch = useCallback((text: string) => {
    setQuery(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (text.trim().length < 2) { setSuggestions([]); setIsSearching(false); return; }
    searchTimer.current = setTimeout(async () => {
      setIsSearching(true);
      const near = center ?? initialCoords;
      const results = await searchPlaces(
        text,
        8,
        near ? { longitude: near[0], latitude: near[1] } : null,
      );
      setSuggestions(results);
      setIsSearching(false);
    }, 300);
  }, [center, initialCoords]);

  const handleSelectSuggestion = useCallback((s: GeocodeResult) => {
    haptic.select();
    setQuery(s.name);
    setSuggestions([]);
    setCenter([s.longitude, s.latitude]);
    setResolved(s);
    cameraRef.current?.setCamera({
      centerCoordinate: [s.longitude, s.latitude],
      zoomLevel: 16,
      animationDuration: 500,
    });
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
          {/* No <UserLocation> — same reason as the driver app's
              (trip)/location-picker: the native blue dot lands underneath the
              fixed centre pin and makes it ambiguous which marker is the one
              being confirmed. */}
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
                keyExtractor={(item, i) => `${item.placeId}-${item.latitude}-${item.longitude}-${i}`}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <Pressable style={styles.suggestionRow} onPress={() => handleSelectSuggestion(item)}>
                    <Ionicons name="location-outline" size={16} color={colors.onSurfaceVariant} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.suggestionText} numberOfLines={1}>{item.name}</Text>
                      {item.fullAddress !== item.name && (
                        <Text style={styles.suggestionSub} numberOfLines={1}>{item.fullAddress}</Text>
                      )}
                    </View>
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
            disabled={!resolved && !center}
          />
        </View>
      </SafeAreaView>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
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
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.onSurface,
  },
  suggestionSub: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.onSurfaceVariant,
    marginTop: 1,
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
    // Lift bubble+tail so the tail tip sits at the exact map center
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
