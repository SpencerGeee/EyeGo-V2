import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing } from '@eyego/config';
import { Text } from '@eyego/ui';
import { useThemeStore } from '../stores/theme.store';
import { useRideStore } from '../stores/ride.store';
import { haptic } from '../utils/haptics';
import MapboxGL from '../utils/mapbox';
import { BlurView } from 'expo-blur';

const STADIA_DARK  = 'https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json';
const STADIA_LIGHT = 'https://tiles.stadiamaps.com/styles/alidade_smooth.json';
const PRIMARY = '#4be277';

type NominatimResult = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  address?: { road?: string; suburb?: string; city?: string; town?: string; county?: string };
};

type SelectedPlace = {
  name: string;
  fullAddress: string;
  latitude: number;
  longitude: number;
};

// Pre-geocoded popular Accra landmarks — avoids an API call for common destinations
const QUICK_DESTINATIONS = [
  { id: 'mall',   name: 'Accra Mall',           address: 'Tetteh Quarshie Interchange, Accra', icon: 'storefront-outline' as const, lat: 5.6167, lon: -0.1769 },
  { id: 'kotoka', name: 'Kotoka Airport',        address: 'Airport Road, Accra',               icon: 'airplane-outline'   as const, lat: 5.6052, lon: -0.1668 },
  { id: 'circle', name: 'Kwame Nkrumah Circle', address: 'Ring Road Central, Accra',           icon: 'navigate-outline'   as const, lat: 5.5502, lon: -0.2174 },
  { id: 'legon',  name: 'University of Ghana',  address: 'Legon, Accra',                       icon: 'school-outline'     as const, lat: 5.6502, lon: -0.1869 },
];

export default function WhereToScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tier } = useLocalSearchParams<{ tier?: string }>();
  const { isDark } = useThemeStore();
  const { setDestination } = useRideStore();

  const MAP_STYLE = isDark ? STADIA_DARK : STADIA_LIGHT;

  const th = useMemo(() => ({
    rootBg:      isDark ? '#091009'                : '#f5f7f5',
    sheetBg:     isDark ? 'rgba(10,14,10,0.97)'    : 'rgba(248,250,248,0.97)',
    sheetBorder: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
    searchBg:    isDark ? 'rgba(9,16,9,0.92)'      : 'rgba(255,255,255,0.94)',
    btnBg:       isDark ? 'rgba(9,16,9,0.85)'      : 'rgba(255,255,255,0.85)',
    borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
    text:        isDark ? '#fff'                    : '#111',
    textSub:     isDark ? 'rgba(255,255,255,0.5)'  : 'rgba(0,0,0,0.5)',
    textDim:     isDark ? 'rgba(255,255,255,0.38)' : 'rgba(0,0,0,0.38)',
    rowBorder:   isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)',
    handle:      isDark ? 'rgba(255,255,255,0.2)'  : 'rgba(0,0,0,0.18)',
    iconBg:      isDark ? `${PRIMARY}18`            : `${PRIMARY}22`,
    suggestBg:   isDark ? '#0d1a0d'                : '#ffffff',
  }), [isDark]);

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<SelectedPlace | null>(null);
  const [userCoords, setUserCoords] = useState<[number, number] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
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

  const handleSearch = useCallback((text: string) => {
    setQuery(text);
    setSelectedPlace(null);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (text.length < 2) { setSuggestions([]); return; }
    searchTimerRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=json&countrycodes=gh&limit=6&addressdetails=1`,
          { headers: { 'User-Agent': 'EyeGo/2.0 (eyego.app)' } }
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

  const commitPlace = useCallback((place: SelectedPlace) => {
    setSelectedPlace(place);
    setQuery(place.name);
    setSuggestions([]);
    setDestination({ address: place.fullAddress, latitude: place.latitude, longitude: place.longitude });
    haptic.select();
    Keyboard.dismiss();
  }, [setDestination]);

  const handleSelectSuggestion = useCallback((s: NominatimResult) => {
    const addr = s.address;
    const name = addr?.road ?? addr?.suburb ?? addr?.town ?? addr?.city ?? s.display_name.split(',')[0];
    commitPlace({
      name,
      fullAddress: s.display_name,
      latitude: parseFloat(s.lat),
      longitude: parseFloat(s.lon),
    });
  }, [commitPlace]);

  const handleQuickDest = useCallback((dest: typeof QUICK_DESTINATIONS[0]) => {
    haptic.light();
    commitPlace({ name: dest.name, fullAddress: dest.address, latitude: dest.lat, longitude: dest.lon });
  }, [commitPlace]);

  const handleClear = useCallback(() => {
    setQuery('');
    setSuggestions([]);
    setSelectedPlace(null);
    inputRef.current?.focus();
  }, []);

  const handleFindRides = useCallback(() => {
    haptic.medium();
    router.push({ pathname: '/ride/select', params: { tier: tier ?? 'economy' } } as any);
  }, [router, tier]);

  const handleSchedule = useCallback(() => {
    haptic.light();
    router.push('/ride/schedule' as any);
  }, [router]);

  const handleRequestTrip = useCallback(() => {
    haptic.light();
    router.push('/ride/request' as any);
  }, [router]);

  const showSuggestions = suggestions.length > 0 || (isSearching && query.length >= 2);

  return (
    <View style={[styles.root, { backgroundColor: th.rootBg }]}>
      {/* Fullscreen map */}
      <MapboxGL.MapView
        style={StyleSheet.absoluteFill}
        styleURL={MAP_STYLE}
        compassEnabled={false}
        rotateEnabled={false}
        attributionEnabled={false}
        logoEnabled={false}
      >
        {(userCoords || selectedPlace) && (
          <MapboxGL.Camera
            centerCoordinate={
              selectedPlace
                ? [selectedPlace.longitude, selectedPlace.latitude]
                : userCoords!
            }
            zoomLevel={selectedPlace ? 14 : 13}
            animationMode="flyTo"
            animationDuration={700}
          />
        )}
        {userCoords && <MapboxGL.UserLocation visible />}
        {selectedPlace && (
          <MapboxGL.PointAnnotation
            id="destination-pin"
            coordinate={[selectedPlace.longitude, selectedPlace.latitude]}
          >
            <View style={styles.destPin}>
              <View style={styles.destPinBubble}>
                <Ionicons name="location" size={22} color="#fff" />
              </View>
              <View style={styles.destPinTail} />
            </View>
          </MapboxGL.PointAnnotation>
        )}
      </MapboxGL.MapView>

      {/* Top search bar + autocomplete dropdown */}
      <SafeAreaView style={styles.topOverlay} edges={['top']}>
        <View style={styles.searchBar}>
          <Pressable
            onPress={() => router.back()}
            style={[styles.backBtn, { backgroundColor: th.btnBg, borderColor: th.borderColor }]}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={22} color={th.text} />
          </Pressable>

          <View style={[styles.inputWrap, { backgroundColor: th.searchBg, borderColor: th.borderColor }]}>
            <Ionicons name="search-outline" size={16} color={th.textDim} style={{ flexShrink: 0 }} />
            <TextInput
              ref={inputRef}
              style={[styles.input, { color: th.text }]}
              placeholder="Where to?"
              placeholderTextColor={th.textDim}
              value={query}
              onChangeText={handleSearch}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="words"
            />
            {isSearching && <ActivityIndicator size="small" color={PRIMARY} />}
            {query.length > 0 && !isSearching && (
              <Pressable onPress={handleClear} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={16} color={th.textDim} />
              </Pressable>
            )}
          </View>
        </View>

        {/* Autocomplete suggestions */}
        {showSuggestions && (
          <View style={[styles.suggestBox, { backgroundColor: th.suggestBg, borderColor: th.borderColor }]}>
            {isSearching && suggestions.length === 0 ? (
              <View style={styles.suggestRow}>
                <ActivityIndicator size="small" color={PRIMARY} />
                <Text style={[styles.suggestDim, { color: th.textDim }]}>Searching…</Text>
              </View>
            ) : (
              suggestions.map((s, i) => {
                const addr = s.address;
                const primary = addr?.road ?? addr?.suburb ?? addr?.town ?? s.display_name.split(',')[0];
                const rest = s.display_name.split(',').slice(1, 3).join(',').trim();
                return (
                  <Pressable
                    key={s.place_id}
                    onPress={() => handleSelectSuggestion(s)}
                    style={({ pressed }) => [
                      styles.suggestRow,
                      i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: th.rowBorder },
                      pressed && { opacity: 0.7 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Select ${primary}`}
                  >
                    <View style={[styles.suggestIcon, { backgroundColor: th.iconBg }]}>
                      <Ionicons name="location-outline" size={14} color={PRIMARY} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.suggestPrimary, { color: th.text }]} numberOfLines={1}>{primary}</Text>
                      {rest.length > 0 && (
                        <Text style={[styles.suggestSecondary, { color: th.textDim }]} numberOfLines={1}>{rest}</Text>
                      )}
                    </View>
                  </Pressable>
                );
              })
            )}
          </View>
        )}
      </SafeAreaView>

      {/* Bottom sheet */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.bottomSheet, {
          backgroundColor: Platform.OS === 'ios' ? 'transparent' : th.sheetBg,
          borderTopColor: th.sheetBorder,
        }]}
      >
        {Platform.OS === 'ios' && (
          <BlurView intensity={80} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        )}
        <View style={[styles.handle, { backgroundColor: th.handle }]} />

        {selectedPlace ? (
          /* ── Destination confirmed ── */
          <View style={styles.selectedWrap}>
            <View style={styles.selectedHeader}>
              <View style={[styles.selectedIcon, { backgroundColor: th.iconBg }]}>
                <Ionicons name="location" size={20} color={PRIMARY} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.selectedName, { color: th.text }]} numberOfLines={1}>
                  {selectedPlace.name}
                </Text>
                <Text style={[styles.selectedAddr, { color: th.textDim }]} numberOfLines={2}>
                  {selectedPlace.fullAddress}
                </Text>
              </View>
              <Pressable
                onPress={handleClear}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Change destination"
              >
                <Ionicons name="pencil-outline" size={18} color={th.textDim} />
              </Pressable>
            </View>

            <View style={styles.ctaRow}>
              <Pressable
                style={styles.ctaPrimary}
                onPress={handleFindRides}
                accessibilityRole="button"
                accessibilityLabel="Find rides to this destination"
              >
                <Ionicons name="car-outline" size={18} color="#091009" />
                <Text style={styles.ctaPrimaryText}>Find Rides</Text>
              </Pressable>
              <Pressable
                style={[styles.ctaSecondary, { borderColor: PRIMARY }]}
                onPress={handleSchedule}
                accessibilityRole="button"
                accessibilityLabel="Schedule a trip to this destination"
              >
                <Ionicons name="calendar-outline" size={18} color={PRIMARY} />
                <Text style={[styles.ctaSecondaryText, { color: PRIMARY }]}>Schedule</Text>
              </Pressable>
            </View>

            <Pressable
              style={styles.requestRow}
              onPress={handleRequestTrip}
              accessibilityRole="button"
              accessibilityLabel="Request a trip directly from a driver"
            >
              <Ionicons name="flash-outline" size={14} color={th.textDim} />
              <Text style={[styles.requestText, { color: th.textDim }]}>Request from a driver directly</Text>
              <Ionicons name="chevron-forward" size={14} color={th.textDim} />
            </Pressable>
          </View>
        ) : (
          /* ── Popular destinations ── */
          <>
            <Text style={[styles.sheetTitle, { color: th.textSub }]}>Popular destinations</Text>
            {QUICK_DESTINATIONS.map((dest, i) => (
              <Pressable
                key={dest.id}
                style={({ pressed }) => [
                  styles.row,
                  { borderTopColor: th.rowBorder },
                  i === 0 && { borderTopWidth: 0 },
                  pressed && { opacity: 0.7 },
                ]}
                onPress={() => handleQuickDest(dest)}
                accessibilityRole="button"
                accessibilityLabel={`Go to ${dest.name}`}
              >
                <View style={[styles.rowIcon, { backgroundColor: th.iconBg }]}>
                  <Ionicons name={dest.icon} size={18} color={PRIMARY} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowName, { color: th.text }]}>{dest.name}</Text>
                  <Text style={[styles.rowSub, { color: th.textDim }]} numberOfLines={1}>{dest.address}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={th.textDim} />
              </Pressable>
            ))}
          </>
        )}
        <View style={{ height: insets.bottom + 16 }} />
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
  },
  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: spacing.lg, marginTop: spacing.sm, gap: spacing.sm,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },
  inputWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    borderRadius: 20, paddingHorizontal: spacing.md, height: 44, gap: 8, borderWidth: 1,
  },
  input: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodyMedium,
    height: '100%',
  },
  suggestBox: {
    marginHorizontal: spacing.lg, marginTop: 4,
    borderRadius: 16, borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18, shadowRadius: 14, elevation: 8,
    overflow: 'hidden',
  },
  suggestRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 10, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
  },
  suggestIcon: {
    width: 28, height: 28, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  suggestDim: { fontFamily: fonts.regular, fontSize: fontSizes.bodySmall },
  suggestPrimary: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium },
  suggestSecondary: { fontFamily: fonts.regular, fontSize: fontSizes.caption, marginTop: 1 },
  destPin: { alignItems: 'center' },
  destPinBubble: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: PRIMARY, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 6,
    elevation: 6,
  },
  destPinTail: {
    width: 0, height: 0,
    borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 8,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: PRIMARY,
    marginTop: -1,
  },
  bottomSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: spacing.sm, paddingHorizontal: spacing.lg,
    borderTopWidth: 1, overflow: 'hidden',
  },
  handle: {
    width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.md,
  },
  sheetTitle: {
    fontFamily: fonts.semiBold, fontSize: fontSizes.bodySmall,
    letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: spacing.xs ?? 4,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.md, gap: spacing.md, borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowIcon: {
    width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
  },
  rowName: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium },
  rowSub: { fontFamily: fonts.regular, fontSize: fontSizes.caption, marginTop: 2 },
  selectedWrap: { gap: spacing.md },
  selectedHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  selectedIcon: {
    width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  selectedName: { fontFamily: fonts.semiBold, fontSize: fontSizes.titleSmall ?? 16 },
  selectedAddr: { fontFamily: fonts.regular, fontSize: fontSizes.caption, marginTop: 2 },
  ctaRow: { flexDirection: 'row', gap: spacing.sm },
  ctaPrimary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderRadius: 14, paddingVertical: 13, backgroundColor: PRIMARY,
  },
  ctaPrimaryText: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, color: '#091009' },
  ctaSecondary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderRadius: 14, paddingVertical: 13, borderWidth: 1.5,
  },
  ctaSecondaryText: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium },
  requestRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: spacing.sm,
  },
  requestText: { fontFamily: fonts.regular, fontSize: fontSizes.bodySmall },
});
