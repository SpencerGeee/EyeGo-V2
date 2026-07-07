import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Keyboard,
  BackHandler,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated, { FadeIn } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii, withOpacity } from '@eyego/config';
import { Text, GradientGlowBorder, MorphTarget, useMorph, MorphBackSwipeDetector, type GradientGlowBorderHandle } from '@eyego/ui';
import { useColors, Colors } from '../utils/useColors';
import { useThemeStore } from '../stores/theme.store';
import { useRideStore } from '../stores/ride.store';
import { haptic } from '../utils/haptics';
import MapboxGL from '../utils/mapbox';

const STADIA_DARK  = 'https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json';
const STADIA_LIGHT = 'https://tiles.stadiamaps.com/styles/alidade_smooth.json';

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

function getQuickChips(colors: Colors) {
  return [
    { id: 'home', label: 'Home', icon: 'home-outline' as const, tint: colors.tierComfort },
    { id: 'work', label: 'Work', icon: 'briefcase-outline' as const, tint: colors.tierComfort },
    { id: 'mall', label: 'Accra Mall', icon: 'storefront-outline' as const, tint: colors.tierPremium },
  ];
}

const QUICK_DESTINATIONS = [
  { id: 'kotoka', name: 'Kotoka Airport',       address: 'Airport Bypass Rd, Accra',        dist: '4.2 km', icon: 'airplane-outline'   as const, lat: 5.6052, lon: -0.1668 },
  { id: 'mall',   name: 'Accra Mall',           address: 'Tetteh Quarshie Interchange, Accra', dist: '3.8 km', icon: 'storefront-outline' as const, lat: 5.6167, lon: -0.1769 },
  { id: 'circle', name: 'Kwame Nkrumah Circle', address: 'Ring Road Central, Accra',        dist: '6.1 km', icon: 'navigate-outline'   as const, lat: 5.5502, lon: -0.2174 },
  { id: 'legon',  name: 'University of Ghana',  address: 'Legon, Accra',                    dist: '8.3 km', icon: 'school-outline'     as const, lat: 5.6502, lon: -0.1869 },
];

export default function WhereToScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const quickChips = useMemo(() => getQuickChips(colors), [colors]);
  const router = useRouter();
  const { tier, type, morphId } = useLocalSearchParams<{ tier?: string; type?: string; morphId?: string }>();
  // The container-transform source that opened this screen. Home's search pill
  // uses 'where-to-pill'; services cards pass their own id so each morphs from
  // its own card. Falls back to the pill id for deep links / direct opens.
  const activeMorphId = morphId ?? 'where-to-pill';
  const insets = useSafeAreaInsets();
  const { isDark } = useThemeStore();
  const { setDestination } = useRideStore();

  const MAP_STYLE = isDark ? STADIA_DARK : STADIA_LIGHT;

  const [destQuery, setDestQuery] = useState('');
  const [originText, setOriginText] = useState('Current Location');
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<SelectedPlace | null>(null);
  const [userCoords, setUserCoords] = useState<[number, number] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [activeField, setActiveField] = useState<'origin' | 'dest'>('dest');

  const destRef = useRef<TextInput>(null);
  const originRef = useRef<TextInput>(null);
  const originRingRef = useRef<GradientGlowBorderHandle>(null);
  const destRingRef = useRef<GradientGlowBorderHandle>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTimeout(() => destRef.current?.focus(), 300);
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
    setDestQuery(text);
    setSelectedPlace(null);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (text.length < 2) { setSuggestions([]); return; }
    searchTimerRef.current = setTimeout(async () => {
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

  const commitPlace = useCallback((place: SelectedPlace) => {
    setSelectedPlace(place);
    setDestQuery(place.name);
    setSuggestions([]);
    setDestination({ address: place.fullAddress, latitude: place.latitude, longitude: place.longitude });
    haptic.select();
    Keyboard.dismiss();
  }, [setDestination]);

  const handleSelectSuggestion = useCallback((s: NominatimResult) => {
    const addr = s.address;
    const name = addr?.road ?? addr?.suburb ?? addr?.town ?? addr?.city ?? s.display_name.split(',')[0];
    commitPlace({ name, fullAddress: s.display_name, latitude: parseFloat(s.lat), longitude: parseFloat(s.lon) });
  }, [commitPlace]);

  const handleQuickDest = useCallback((dest: typeof QUICK_DESTINATIONS[0]) => {
    haptic.light();
    commitPlace({ name: dest.name, fullAddress: dest.address, latitude: dest.lat, longitude: dest.lon });
  }, [commitPlace]);

  const handleClearDest = useCallback(() => {
    setDestQuery('');
    setSuggestions([]);
    setSelectedPlace(null);
    destRef.current?.focus();
  }, []);

  const handleSwap = useCallback(() => {
    haptic.light();
    const prev = originText;
    if (selectedPlace) {
      setOriginText(selectedPlace.name);
      setDestQuery('');
      setSelectedPlace(null);
    } else {
      setOriginText(destQuery || prev);
      setDestQuery('');
    }
  }, [originText, destQuery, selectedPlace]);

  const handleFindRides = useCallback(() => {
    haptic.medium();
    router.push({
      pathname: '/ride/select',
      params: { tier: tier ?? 'economy', ...(type ? { type } : {}) },
    } as any);
  }, [router, tier, type]);

  // Quick destinations show only while the search is idle (empty query);
  // any typed query switches the panel to search results so the two lists
  // never mix.
  const searchActive = destQuery.length > 0;
  const hasDestination = !!selectedPlace || destQuery.length > 0;

  // Reverse the container-transform back into the home pill. The route uses
  // animation 'none', so morphBack owns the entire exit choreography.
  const { morphBack } = useMorph();
  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    morphBack(() => router.back());
  }, [morphBack, router]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleClose();
      return true;
    });
    return () => sub.remove();
  }, [handleClose]);

  return (
    <Animated.View style={styles.root} entering={FadeIn.duration(250)}>
      {/* ── Fullscreen map ─────────────────────────────── */}
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
              selectedPlace ? [selectedPlace.longitude, selectedPlace.latitude] : userCoords!
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
                <Ionicons name="location" size={22} color={colors.onPrimary} />
              </View>
              <View style={styles.destPinTail} />
            </View>
          </MapboxGL.PointAnnotation>
        )}
      </MapboxGL.MapView>

      {/* ── Map gradient overlay ─────────────────────── */}
      <View style={styles.mapGradient} pointerEvents="none" />

      {/* ── Overlay layout ───────────────────────────── */}
      <View style={styles.overlay} pointerEvents="box-none">
        {/* Header */}
        <View style={[styles.headerRow, { paddingTop: insets.top + 12 }]}>
          <Pressable
            style={styles.backBtn}
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
          </Pressable>

          <Text style={styles.headerTitle}>Where To</Text>

          <View style={styles.headerSpacer} />
        </View>

        {/* ── Floating glass card ─────────────────────── */}
        <KeyboardAwareScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bottomOffset={24}
        >
            <MorphTarget id={activeMorphId} borderRadius={24}>
            <MorphBackSwipeDetector>
            <View style={styles.floatingCard}>

              {/* ── Dual input + timeline ─────────────── */}
              <View style={styles.inputsSection}>
                {/* Timeline indicator */}
                <View style={styles.timeline}>
                  <View style={[styles.timelineDot, styles.timelineDotOrigin]} />
                  <View style={styles.timelineLine} />
                  <View style={[styles.timelineDot, styles.timelineDotDest]} />
                </View>

                {/* Input columns */}
                <View style={styles.inputsCol}>
                  {/* Origin */}
                  <GradientGlowBorder
                    ref={originRingRef}
                    colors={[colors.primary, colors.secondary]}
                    fillColor={colors.surfaceInput}
                    borderRadius={radii.lg}
                    thickness="thin"
                  >
                    <Pressable
                      style={styles.inputBoxInner}
                      onPress={() => {
                        setActiveField('origin');
                        originRef.current?.focus();
                      }}
                    >
                      <Ionicons name="locate-outline" size={16} color={colors.outline} style={styles.inputIcon} />
                      <TextInput
                        ref={originRef}
                        style={styles.inputText}
                        value={originText}
                        onChangeText={setOriginText}
                        placeholder="Pickup location"
                        placeholderTextColor={withOpacity(colors.onSurfaceVariant, 0.45)}
                        onFocus={() => { setActiveField('origin'); originRingRef.current?.burst(); }}
                        returnKeyType="next"
                        onSubmitEditing={() => {
                          setActiveField('dest');
                          destRef.current?.focus();
                        }}
                      />
                    </Pressable>
                  </GradientGlowBorder>

                  {/* Destination */}
                  <GradientGlowBorder
                    ref={destRingRef}
                    colors={[colors.primary, colors.secondary]}
                    fillColor={colors.surfaceInput}
                    borderRadius={radii.lg}
                    thickness="thin"
                    glow
                  >
                    <View style={styles.inputBoxInner}>
                      <Ionicons name="search-outline" size={16} color={colors.primary} style={styles.inputIcon} />
                      <TextInput
                        ref={destRef}
                        style={styles.inputText}
                        value={destQuery}
                        onChangeText={handleSearch}
                        placeholder="Where are you going?"
                        placeholderTextColor={withOpacity(colors.onSurfaceVariant, 0.45)}
                        onFocus={() => { setActiveField('dest'); destRingRef.current?.burst(); }}
                        returnKeyType="search"
                        autoCorrect={false}
                        autoCapitalize="words"
                      />
                      {isSearching && <ActivityIndicator size="small" color={colors.primary} />}
                      {destQuery.length > 0 && !isSearching && (
                        <Pressable onPress={handleClearDest} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear">
                          <Ionicons name="close-circle" size={16} color={colors.outline} />
                        </Pressable>
                      )}
                    </View>
                  </GradientGlowBorder>
                </View>

                {/* Swap button */}
                <Pressable
                  style={styles.swapBtn}
                  onPress={handleSwap}
                  accessibilityRole="button"
                  accessibilityLabel="Swap origin and destination"
                >
                  <Ionicons name="swap-vertical-outline" size={18} color={colors.onSurfaceVariant} />
                </Pressable>
              </View>

              {/* Autocomplete results (replaces sections below while typing) */}
              {searchActive ? (
                <View style={styles.suggestList}>
                  <View style={styles.divider} />
                  {isSearching && suggestions.length === 0 ? (
                    <View style={styles.suggestLoadingRow}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={styles.suggestDim}>Searching…</Text>
                    </View>
                  ) : suggestions.length === 0 ? (
                    !selectedPlace && destQuery.length >= 2 ? (
                      <View style={styles.suggestLoadingRow}>
                        <Ionicons name="search-outline" size={16} color={colors.onSurfaceVariant} />
                        <Text style={styles.suggestDim}>No places found — keep typing</Text>
                      </View>
                    ) : null
                  ) : (
                    suggestions.map((s, i) => {
                      const addr = s.address;
                      const primary = addr?.road ?? addr?.suburb ?? addr?.town ?? addr?.city ?? s.display_name.split(',')[0];
                      const rest = s.display_name.split(',').slice(1, 3).join(',').trim();
                      return (
                        <Pressable
                          key={s.place_id}
                          style={({ pressed }) => [
                            styles.suggestRow,
                            i > 0 && styles.suggestRowBorder,
                            pressed && { opacity: 0.72 },
                          ]}
                          onPress={() => handleSelectSuggestion(s)}
                          accessibilityRole="button"
                          accessibilityLabel={`Select ${primary}`}
                        >
                          <View style={styles.suggestIcon}>
                            <Ionicons name="location-outline" size={16} color={colors.primary} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.suggestPrimary} numberOfLines={1}>{primary}</Text>
                            {rest.length > 0 && (
                              <Text style={styles.suggestSecondary} numberOfLines={1}>{rest}</Text>
                            )}
                          </View>
                        </Pressable>
                      );
                    })
                  )}
                </View>
              ) : (
                <>
                  {/* Quick Destinations chips */}
                  <View style={styles.divider} />
                  <Text style={styles.sectionLabel}>QUICK DESTINATIONS</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.chipsRow}
                  >
                    {quickChips.map((chip) => (
                      <Pressable
                        key={chip.id}
                        style={({ pressed }) => [styles.chip, pressed && { opacity: 0.75 }]}
                        accessibilityRole="button"
                        accessibilityLabel={chip.label}
                      >
                        <Ionicons name={chip.icon} size={14} color={chip.tint} />
                        <Text style={styles.chipLabel}>{chip.label}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>

                  {/* Recent / popular places */}
                  <View style={styles.divider} />
                  {QUICK_DESTINATIONS.map((dest, i) => (
                    <Pressable
                      key={dest.id}
                      style={({ pressed }) => [
                        styles.placeRow,
                        i > 0 && styles.placeRowBorder,
                        pressed && { opacity: 0.75 },
                      ]}
                      onPress={() => handleQuickDest(dest)}
                      accessibilityRole="button"
                      accessibilityLabel={`Navigate to ${dest.name}`}
                    >
                      <View style={styles.placeIconWrap}>
                        <Ionicons name={dest.icon} size={20} color={colors.onSurfaceVariant} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.placeName} numberOfLines={1}>{dest.name}</Text>
                        <Text style={styles.placeAddr} numberOfLines={1}>{dest.address}</Text>
                      </View>
                      <Text style={styles.placeDist}>{dest.dist}</Text>
                    </Pressable>
                  ))}
                </>
              )}

              {/* CTA buttons (when destination is confirmed) */}
              {hasDestination && selectedPlace && (
                <>
                  <View style={[styles.divider, { marginTop: 12 }]} />
                  <View style={styles.ctaRow}>
                    <Pressable
                      style={styles.ctaPrimary}
                      onPress={handleFindRides}
                      accessibilityRole="button"
                      accessibilityLabel="Find rides"
                    >
                      <Ionicons name="car-outline" size={18} color={colors.onPrimary} />
                      <Text style={styles.ctaPrimaryText}>Find Rides</Text>
                    </Pressable>
                    <Pressable
                      style={styles.ctaSecondary}
                      onPress={() => router.push('/ride/schedule' as any)}
                      accessibilityRole="button"
                      accessibilityLabel="Schedule"
                    >
                      <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                      <Text style={styles.ctaSecondaryText}>Schedule</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
            </MorphBackSwipeDetector>
            </MorphTarget>
        </KeyboardAwareScrollView>
      </View>
    </Animated.View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },

  mapGradient: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 220,
    backgroundColor: withOpacity(colors.backgroundDeep, 0.55),
  },

  overlay: {
    flex: 1,
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 10,
  },

  // ─── Header ──────────────────────────────────────────
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: withOpacity(colors.surfaceCard, 0.8),
    borderWidth: 1,
    borderColor: colors.rimLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 20,
    lineHeight: 26,
    color: colors.onSurface,
    letterSpacing: -0.3,
  },
  headerSpacer: { width: 44, height: 44 },

  // ─── Scroll ───────────────────────────────────────────
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 40,
  },

  // ─── Floating Card (glass panel) ─────────────────────
  floatingCard: {
    backgroundColor: withOpacity(colors.surfaceCard, 0.92),
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.rimLight,
    padding: spacing.xl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.5,
    shadowRadius: 32,
    elevation: 14,
  },

  // ─── Dual Input + Timeline ────────────────────────────
  inputsSection: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 12,
  },
  timeline: {
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 16,
    gap: 0,
    width: 12,
    flexShrink: 0,
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    flexShrink: 0,
  },
  timelineDotOrigin: {
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.surfaceVariant,
  },
  timelineDotDest: {
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOpacity: 0.5,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  timelineLine: {
    width: 1.5,
    flex: 1,
    backgroundColor: colors.outlineVariant,
    marginVertical: 4,
  },
  inputsCol: {
    flex: 1,
    gap: 8,
  },
  // Background, ring, and glow are now drawn by GradientGlowBorder — this
  // only supplies the row's internal layout.
  inputBoxInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    minHeight: 48,
  },
  inputIcon: { flexShrink: 0 },
  inputText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodyMedium,
    color: colors.onSurface,
    padding: 0,
  },
  swapBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surfaceVariant,
    borderWidth: 1,
    borderColor: colors.rimLight,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    flexShrink: 0,
  },

  // ─── Divider ──────────────────────────────────────────
  divider: {
    height: 1,
    backgroundColor: colors.rimLightSubtle,
    marginVertical: 14,
  },

  // ─── Quick Destination Chips ──────────────────────────
  sectionLabel: {
    fontFamily: fonts.labelCaps,
    fontSize: 10,
    color: colors.onSurfaceVariant,
    letterSpacing: 0.9,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  chipsRow: {
    gap: 8,
    paddingBottom: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surfaceInput,
    borderWidth: 1,
    borderColor: colors.rimLight,
  },
  chipLabel: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.onSurface,
  },

  // ─── Recent/Popular Places ────────────────────────────
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 10,
    paddingHorizontal: 2,
  },
  placeRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.rimLightSubtle,
  },
  placeIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  placeName: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    lineHeight: 19,
    color: colors.onSurface,
  },
  placeAddr: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 15,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
  placeDist: {
    fontFamily: fonts.labelCaps,
    fontSize: 10,
    lineHeight: 14,
    color: colors.onSurfaceVariant,
    letterSpacing: 0.5,
    flexShrink: 0,
  },

  // ─── Autocomplete ─────────────────────────────────────
  suggestList: { marginTop: 0 },
  suggestLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 2,
  },
  suggestDim: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.onSurfaceVariant,
  },
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 2,
  },
  suggestRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.rimLightSubtle,
  },
  suggestIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: withOpacity(colors.primary, 0.1),
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  suggestPrimary: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    lineHeight: 19,
    color: colors.onSurface,
  },
  suggestSecondary: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 15,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },

  // ─── Destination Pin on map ───────────────────────────
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

  // ─── CTAs ─────────────────────────────────────────────
  ctaRow: {
    flexDirection: 'row',
    gap: 10,
  },
  ctaPrimary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderRadius: 28, paddingVertical: 14, backgroundColor: colors.primary,
  },
  ctaPrimaryText: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    color: colors.onPrimary,
  },
  ctaSecondary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderRadius: 28, paddingVertical: 14, borderWidth: 1.5, borderColor: colors.primary,
  },
  ctaSecondaryText: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    color: colors.primary,
  },
});
