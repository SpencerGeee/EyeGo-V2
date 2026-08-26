import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, Pressable, TextInput, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { fonts, spacing, radii, withOpacity } from '@eyego/config';
import { Text, Button, Loader } from '@eyego/ui';
import { useColors, Colors } from '../../utils/useColors';
import { haptic } from '../../utils/haptics';
import MapboxGL, { type CameraRef } from '../../utils/mapbox';
import { eyegoDarkStyle, eyegoLightStyle } from '@eyego/map-styles';
import { useThemeStore } from '../../stores/theme.store';
import { reverseGeocode, searchPlaces, type GeocodeResult } from '../../utils/geocoding';
import { setPickedPlace } from '../../utils/placePickerResult';

const ACCRA: [number, number] = [-0.187, 5.6037];

/** Blue, so "you" can never be mistaken for the green pin being confirmed. */
const USER_DOT_BLUE = '#2F8CFF';

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
  // `focusSearch=1` opens straight into typing. The where-to rows send it,
  // because a rider tapping "Where are you going?" wants to type a place name,
  // not to hunt for a pin on a map — searching was previously a second,
  // undiscovered step behind the map view.
  /**
   * `initialLat/initialLng/initialLabel` — THE PICKER OPENS ON WHAT YOU ALREADY CHOSE.
   *
   * BUGFIX ("on the where-to page I select a destination, then tap the field
   * again to see what I put and it shows my current location — I have to enter
   * it again"). The picker only ever booted from GPS, so re-opening a field that
   * already held a place threw that place away and offered the rider their own
   * doorstep instead. Tapping a filled field to CHECK it is the commonest reason
   * to open this screen, and it was the one case it could not serve.
   *
   * Seeding all three means the map, the pin, the address card and the search
   * box all open showing the current answer, and Confirm is live immediately.
   */
  const { title, focusSearch, initialLat, initialLng, initialLabel, initialAddress } =
    useLocalSearchParams<{
      title?: string;
      focusSearch?: string;
      initialLat?: string;
      initialLng?: string;
      initialLabel?: string;
      initialAddress?: string;
    }>();
  const { isDark } = useThemeStore();

  const seeded = useMemo(() => {
    const lat = Number(initialLat);
    const lng = Number(initialLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat === 0 && lng === 0) return null;
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
  /** Where the rider actually is, for the recentre button and the "you" dot. */
  const [myCoords, setMyCoords] = useState<[number, number] | null>(null);

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  /** The last query a search actually completed for — null until one has. Drives
   *  the "no matches" row, which must never show while the rider is still typing. */
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
          // A seeded pin wins: the rider opened this to look at the place they
          // already chose, not to be moved back to where they are standing.
          if (!seeded) setInitialCoords(me);
          return;
        }
      } catch { /* non-fatal */ }
      if (!seeded) setInitialCoords(ACCRA);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * "IT DOESN'T SHOW YOU YOUR CURRENT LOCATION — IT'S A FULL MAP I HAVE TO TRACE."
   *
   * The old note here argued that the native blue dot sits under the fixed
   * centre pin and makes the confirmation ambiguous. True the instant the screen
   * opens, and false for the entire rest of the session: as soon as the rider
   * pans, the dot is the only thing on screen telling them which way they
   * moved. Without it the map is an unlabelled plane and "trace it to your
   * intended location" is genuinely hard.
   *
   * Both are satisfied by making the two markers unmistakably different — a
   * small flat puck for you, a tall teardrop for the pin — and by giving the
   * rider a way back to themselves in one tap.
   */
  const recentreOnMe = useCallback(() => {
    if (!myCoords) return;
    haptic.light();
    cameraRef.current?.setCamera({
      centerCoordinate: myCoords,
      zoomLevel: 16,
      animationDuration: 450,
    });
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
    if (text.trim().length < 2) {
      setSuggestions([]);
      setIsSearching(false);
      setSearchedFor(null);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      setIsSearching(true);
      const near = center ?? initialCoords;
      const results = await searchPlaces(
        text,
        8,
        near ? { longitude: near[0], latitude: near[1] } : null,
      );
      setSuggestions(results);
      // Remember what the (settled) query was, so an empty result set can be
      // reported as "no matches for X" rather than silently rendering nothing.
      setSearchedFor(text.trim());
      setIsSearching(false);
    }, 300);
  }, [center, initialCoords]);

  /**
   * PICKING A SUGGESTION IS THE ANSWER. THE MAP GOES AWAY.
   *
   * This used to fly the camera to the result and then sit there, so the rider
   * who had just named the place they wanted was left looking at a map with a
   * Confirm button on it — one more tap for a decision they had already made,
   * and (reported) "it shows even after the suggestion is clicked, which is not
   * aesthetic".
   *
   * Anyone who does want to nudge the pin still can: every caller that offers
   * that reopens this screen seeded on the chosen point (`initialLat/Lng`), so
   * "adjust" is a deliberate act rather than a step everybody pays for.
   */
  const handleSelectSuggestion = useCallback((s: GeocodeResult) => {
    haptic.medium();
    if (searchTimer.current) clearTimeout(searchTimer.current);
    // A pending debounced reverse-geocode from the last pan must not land after
    // this and overwrite the rider's explicit choice.
    if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
    setSuggestions([]);
    setSearchedFor(null);
    setPickedPlace(s);
    router.back();
  }, [router]);

  /**
   * "NOT SEEING YOUR PLACE?" — the road out of an empty result set.
   *
   * A search that matches nothing used to end in a dead sentence. In Ghana that
   * is not an edge case: whole neighbourhoods are unmapped, and the rider
   * usually knows exactly where the place is even though no provider does. They
   * are the best possible source, and the map-report flow already exists to
   * take what they know — it was simply never offered at the moment they had a
   * reason to use it.
   *
   * The query they typed becomes the place's name and the pin they are looking
   * at becomes its location, so the form opens most of the way filled in.
   */
  const reportMissingPlace = useCallback(() => {
    haptic.light();
    const at = center ?? myCoords;
    router.push({
      pathname: '/improve-map/[type]',
      params: {
        type: 'ADD_PLACE',
        prefillName: searchedFor ?? query,
        ...(at ? { prefillLat: String(at[1]), prefillLng: String(at[0]) } : {}),
      },
    } as never);
  }, [router, center, myCoords, searchedFor, query]);

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
          {/* You. A flat puck, deliberately nothing like the tall centre pin —
              see `recentreOnMe` for why this is here now. */}
          {myCoords && (
            <MapboxGL.MarkerView id="picker-me" coordinate={myCoords}>
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
              placeholder="Search a place, business or landmark…"
              placeholderTextColor={colors.onSurfaceVariant}
              returnKeyType="search"
              autoFocus={focusSearch === '1'}
            />
            {isSearching && <Loader size={20} color={colors.primary} />}
          </View>
          {/* A search that found nothing used to render NOTHING — reported as
              "I search for IPMC showroom and nothing happens". Say so, and say
              what to do instead. (`searchPlaces` also retries with the generic
              words stripped before we get here, so this row means every provider
              really has no such place.) */}
          {!isSearching && searchedFor !== null && suggestions.length === 0 && (
            <View style={styles.suggestionsBox}>
              <View style={styles.suggestionRow}>
                <Ionicons name="alert-circle-outline" size={16} color={colors.onSurfaceVariant} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.suggestionText} numberOfLines={2}>
                    No places match “{searchedFor}”
                  </Text>
                  <Text style={styles.suggestionSub} numberOfLines={2}>
                    Try just the name (e.g. “IPMC”), or drag the pin to the exact spot.
                  </Text>
                </View>
              </View>
              <Pressable
                style={[styles.suggestionRow, styles.helpRow]}
                onPress={reportMissingPlace}
                accessibilityRole="button"
                accessibilityLabel="Help us find this place"
              >
                <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.suggestionText, { color: colors.primary }]} numberOfLines={1}>
                    Not seeing where you mean? Help us add it
                  </Text>
                  <Text style={styles.suggestionSub} numberOfLines={2}>
                    Put it on the map for every EyeGo rider — takes about a minute.
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.primary} />
              </Pressable>
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

      {/* Back to me. Sits just above the confirm card so it never fights the pin. */}
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
    lineHeight: Math.round(15 * 1.3),
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
  /** The "help us add it" row. Tinted so it reads as an action, not another result. */
  helpRow: {
    backgroundColor: withOpacity(colors.primary, 0.1),
    borderBottomWidth: 0,
  },
  /**
   * You, on the map. Deliberately a flat puck: a second teardrop would be
   * indistinguishable from the pin being confirmed, which is the ambiguity the
   * old code avoided by drawing nothing at all.
   */
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
    backgroundColor: USER_DOT_BLUE,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  locateBtn: {
    position: 'absolute',
    right: 16,
    // Clear of the confirm card, which is ~150 tall plus its own bottom inset.
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
