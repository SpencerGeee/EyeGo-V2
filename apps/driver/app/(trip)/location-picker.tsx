import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, Pressable, TextInput, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { fonts, spacing, withOpacity } from '@eyego/config';
import { Text, Button, Loader } from '@eyego/ui';
import { useColors, type DriverColors } from '../../utils/useColors';
import * as Haptics from 'expo-haptics';
import MapboxGL, { type CameraRef } from '../../utils/mapbox';
import { eyegoDriverDarkStyle as eyegoDarkStyle, eyegoLightStyle } from '@eyego/map-styles';
import { useDriverStore } from '../../stores/driver.store';
import { reverseGeocode, searchPlaces, type GeocodeResult } from '../../utils/geocoding';
import { setPickedPlace } from '../../utils/placePickerResult';

const ACCRA: [number, number] = [-0.187, 5.6037];


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
  /**
   * SEEDED — the picker opens on the point this field already holds.
   *
   * BUGFIX ("on the driver create-trip page, when I select a place and click on
   * it to view where I clicked, it resets and makes me select the place again").
   * The picker always booted from GPS, so re-opening a filled field discarded
   * the driver's choice and offered their own kerb instead. Checking what you
   * entered is the normal reason to reopen it, and it was destructive.
   */
  const { title, initialLat, initialLng, initialLabel, initialAddress } = useLocalSearchParams<{
    title?: string;
    initialLat?: string;
    initialLng?: string;
    initialLabel?: string;
    initialAddress?: string;
  }>();
  const { theme } = useDriverStore();
  const isDark = theme !== 'light';

  const seeded = useMemo(() => {
    const lat = Number(initialLat);
    const lng = Number(initialLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
    return {
      coords: [lng, lat] as [number, number],
      place: {
        placeId: 0,
        name: initialLabel || initialAddress || 'Chosen location',
        fullAddress: initialAddress || initialLabel || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        latitude: lat,
        longitude: lng,
      } as GeocodeResult,
    };
  }, [initialLat, initialLng, initialLabel, initialAddress]);

  const [center, setCenter] = useState<[number, number] | null>(seeded?.coords ?? null);
  const [resolved, setResolved] = useState<GeocodeResult | null>(seeded?.place ?? null);
  const [isResolving, setIsResolving] = useState(false);
  const geocodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [initialCoords, setInitialCoords] = useState<[number, number] | null>(seeded?.coords ?? null);
  const cameraRef = useRef<CameraRef>(null);
  /** Where the driver is, for the "you" puck and the recentre button. */
  const [myCoords, setMyCoords] = useState<[number, number] | null>(null);

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  /** The last settled query, so an empty list can say so rather than render nothing. */
  const [searchedFor, setSearchedFor] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const Location = await import('expo-location');
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          const me: [number, number] = [loc.coords.longitude, loc.coords.latitude];
          setMyCoords(me);
          if (!seeded) setInitialCoords(me);
          return;
        }
      } catch { /* non-fatal */ }
      if (!seeded) setInitialCoords(ACCRA);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recentreOnMe = useCallback(() => {
    if (!myCoords) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    cameraRef.current?.setCamera({ centerCoordinate: myCoords, zoomLevel: 16, animationDuration: 450 });
  }, [myCoords]);

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

  /**
   * SEARCH GOES THROUGH OUR OWN GEO PROXY, NOT STRAIGHT TO NOMINATIM.
   *
   * This screen called `nominatim.openstreetmap.org/search` directly, which
   * means it saw OSM data ONLY — no commercial POIs, no Mapbox Search Box
   * typeahead, none of the tiering and fallback that `/geo/search` performs, and
   * a raw `display_name` running all the way up to "Ghana" that then became the
   * Route's stored address. The rider app has used the proxy for months; the
   * driver's create-trip flow was still on the old path, which is a large part
   * of why the two apps disagreed about what a place is called.
   *
   * It also hard-coded the OSM User-Agent and no proximity, so a driver in Accra
   * searching "station" got a national alphabetical list.
   */
  const handleSearch = useCallback((text: string) => {
    setQuery(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (text.trim().length < 2) {
      setSuggestions([]);
      setSearchedFor(null);
      setIsSearching(false);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await searchPlaces(text, 8);
        setSuggestions(results);
        setSearchedFor(text.trim());
      } catch {
        setSuggestions([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  }, []);

  /**
   * PICKING A SUGGESTION IS THE ANSWER — the map closes.
   *
   * It used to fly the camera there and stay, leaving the driver to tap Confirm
   * for a decision already made. Reopening the field now re-seeds the pin (see
   * `seeded`), so adjusting is still one tap away when it is actually wanted.
   */
  const handleSelectSuggestion = useCallback((s: GeocodeResult) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    // A debounced reverse-geocode still in flight must not overwrite this.
    if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
    setSuggestions([]);
    setSearchedFor(null);
    setPickedPlace(s);
    router.back();
  }, [router]);

  return (
    <View style={styles.root}>
      {initialCoords && (
        <MapboxGL.MapView
          style={StyleSheet.absoluteFill}
          styleURL={isDark ? eyegoDarkStyle : eyegoLightStyle}
          compassEnabled={false}
          onRegionDidChange={handleRegionChange}
        >
          <MapboxGL.Camera ref={cameraRef} centerCoordinate={initialCoords} zoomLevel={seeded ? 16 : 15} />
          {/**
           * You. Drawn as a small blue puck rather than the native
           * `<UserLocation>` — the old note here was right that the native dot
           * plus its accuracy circle sat under the centre pin and made the two
           * indistinguishable. But drawing NOTHING leaves the driver panning an
           * unlabelled map with no idea which way they have moved, and this
           * screen no longer always opens on them (a seeded pin can start it
           * somewhere else entirely). A flat blue disc next to a tall green
           * teardrop is unambiguous.
           */}
          {myCoords && (
            <MapboxGL.MarkerView id="driver-picker-me" coordinate={myCoords}>
              <View style={styles.meHalo} pointerEvents="none">
                <View style={styles.meDot} />
              </View>
            </MapboxGL.MarkerView>
          )}
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
              placeholder="Search for a place"
              placeholderTextColor={colors.onSurfaceVariant}
              returnKeyType="search"
            />
            {isSearching && <Loader size={20} color={colors.primary} />}
          </View>
          {!isSearching && searchedFor !== null && suggestions.length === 0 && (
            <View style={styles.suggestionsBox}>
              <View style={styles.suggestionRow}>
                <Ionicons name="alert-circle-outline" size={16} color={colors.onSurfaceVariant} />
                <Text style={styles.suggestionText} numberOfLines={2}>
                  No places match “{searchedFor}” — try just the name, or drag the pin to the spot.
                </Text>
              </View>
            </View>
          )}
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

      {myCoords && (
        <Pressable
          style={styles.locateBtn}
          onPress={recentreOnMe}
          accessibilityRole="button"
          accessibilityLabel="Centre the map on my location"
          hitSlop={8}
        >
          <Ionicons name="locate" size={20} color={colors.primary} />
        </Pressable>
      )}

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
                  <Loader size={20} color={colors.primary} />
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
  /**
   * THE PLACEHOLDER WAS COMING OUT SPACED-OUT.
   *
   * BUGFIX ("the placeholder in the search field is showing 'search a place'
   * all having space in between").
   *
   * `lineHeight` on a `TextInput` is the cause. React Native applies it by
   * wrapping the text in a paragraph style, and for the PLACEHOLDER — which is
   * measured before any text exists — that produces the wrong advance width per
   * glyph on both platforms; on Android it additionally fights
   * `includeFontPadding`. A `TextInput` needs a `height` (46 pt, set on the bar
   * above) and NOT a line height; the value here was a copy-paste from the
   * `Text` styles elsewhere in this file, where it is correct.
   *
   * `letterSpacing: 0` is stated rather than left to default so nothing
   * inherited from a parent text style can reintroduce the gap, and the
   * ellipsis is gone: '…' is one glyph in Geist but renders from a fallback
   * face at some sizes, which widens the run it sits in.
   */
  searchInput: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 15,
    letterSpacing: 0,
    color: colors.onSurface,
    padding: 0,
    includeFontPadding: false,
    textAlignVertical: 'center',
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
    lineHeight: Math.round(13 * 1.3),
    color: colors.onSurface,
  },
  suggestionSub: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: Math.round(11 * 1.3),
    color: colors.onSurfaceVariant,
    marginTop: 1,
  },
  /** You. Blue on purpose — the pin is the app's green. */
  meHalo: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(47,140,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  meDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#2F8CFF',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  locateBtn: {
    position: 'absolute',
    right: 16,
    bottom: 196,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withOpacity(colors.surfaceCard, 0.96),
    borderWidth: 1,
    borderColor: colors.rimLight,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
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
