import React, { useRef, useState, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, fontSizes, spacing } from '@eyego/config';
import { Text } from '@eyego/ui';
import { useQuery } from '@tanstack/react-query';
import { tripsApi, queryKeys } from '@eyego/api';
import { useThemeStore } from '../stores/theme.store';
import { haptic } from '../utils/haptics';
import MapboxGL from '../utils/mapbox';
import { BlurView } from 'expo-blur';

const STADIA_DARK  = 'https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json';
const STADIA_LIGHT = 'https://tiles.stadiamaps.com/styles/alidade_smooth.json';
const PRIMARY = '#4be277';

const QUICK_DESTINATIONS = [
  { id: 'home',   name: 'Home',                  address: 'Your home address',             icon: 'home-outline'       as const },
  { id: 'work',   name: 'Work',                  address: 'Your work address',             icon: 'briefcase-outline'  as const },
  { id: 'mall',   name: 'Accra Mall',             address: 'Tetteh Quarshie Interchange',  icon: 'storefront-outline' as const },
  { id: 'circle', name: 'Kwame Nkrumah Circle',  address: 'Ring Road Central, Accra',     icon: 'navigate-outline'   as const },
];

export default function WhereToScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tier } = useLocalSearchParams<{ tier?: string; type?: string }>();
  const { isDark } = useThemeStore();

  const MAP_STYLE = isDark ? STADIA_DARK : STADIA_LIGHT;

  // Theme-aware color tokens
  const th = useMemo(() => ({
    rootBg:      isDark ? '#091009'               : '#f5f7f5',
    sheetBg:     isDark ? 'rgba(10,14,10,0.97)'   : 'rgba(248,250,248,0.97)',
    sheetBorder: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
    searchBg:    isDark ? 'rgba(9,16,9,0.90)'     : 'rgba(255,255,255,0.92)',
    btnBg:       isDark ? 'rgba(9,16,9,0.85)'     : 'rgba(255,255,255,0.85)',
    borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
    text:        isDark ? '#fff'                   : '#111',
    textSub:     isDark ? 'rgba(255,255,255,0.5)'  : 'rgba(0,0,0,0.5)',
    textDim:     isDark ? 'rgba(255,255,255,0.4)'  : 'rgba(0,0,0,0.38)',
    rowBorder:   isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)',
    handle:      isDark ? 'rgba(255,255,255,0.2)'  : 'rgba(0,0,0,0.18)',
    iconBg:      isDark ? `${PRIMARY}15`           : `${PRIMARY}20`,
    noTripBg:    isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
    arrowColor:  isDark ? 'rgba(255,255,255,0.2)'  : 'rgba(0,0,0,0.2)',
  }), [isDark]);

  const [query, setQuery]           = useState('');
  const [userCoords, setUserCoords] = useState<[number, number] | null>(null);
  const inputRef = useRef<TextInput>(null);

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

  const { data: tripsData, isLoading: tripsLoading } = useQuery({
    queryKey: queryKeys.rides.list({ status: 'OPEN' }),
    queryFn:  () => tripsApi.search({ status: 'OPEN' } as any),
    staleTime: 15_000,
  });

  const rawTrips: any[] = Array.isArray(tripsData)
    ? tripsData
    : (tripsData as any)?.data ?? [];

  const filteredTrips = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    return rawTrips.filter((t: any) => {
      const dest   = (t.route?.destinationName ?? t.destination?.address ?? t.routeDestination ?? '').toLowerCase();
      const origin = (t.route?.originName      ?? t.origin?.address      ?? t.routeOrigin      ?? '').toLowerCase();
      return dest.includes(q) || origin.includes(q);
    });
  }, [rawTrips, query]);

  const handleClose = () => {
    haptic.light();
    router.back();
  };

  const handleSelectTrip = (trip: any) => {
    haptic.medium();
    router.push(`/ride/${trip.id}` as any);
  };

  const handleQuickDest = (dest: typeof QUICK_DESTINATIONS[0]) => {
    haptic.light();
    router.push({ pathname: '/ride/select', params: { destination: dest.name, tier: tier ?? 'economy' } } as any);
  };

  const handleSchedule = () => {
    haptic.light();
    router.push('/ride/schedule' as any);
  };

  const showSearch = query.trim().length > 0;

  return (
    <View style={[styles.root, { backgroundColor: th.rootBg }]}>
      {/* Full-screen map — style follows app theme */}
      <MapboxGL.MapView
        style={StyleSheet.absoluteFill}
        styleURL={MAP_STYLE}
        compassEnabled={false}
        rotateEnabled={false}
        attributionEnabled={false}
        logoEnabled={false}
      >
        {userCoords && (
          <MapboxGL.Camera
            centerCoordinate={userCoords}
            zoomLevel={13}
            animationMode="flyTo"
            animationDuration={800}
          />
        )}
        {userCoords && <MapboxGL.UserLocation visible />}
      </MapboxGL.MapView>

      {/* Search bar overlay */}
      <SafeAreaView style={styles.topOverlay} edges={['top']}>
        <View style={styles.searchBar}>
          <Pressable
            onPress={handleClose}
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
              onChangeText={setQuery}
              returnKeyType="search"
              autoCorrect={false}
            />
            {query.length > 0 && (
              <Pressable
                onPress={() => setQuery('')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Ionicons name="close-circle" size={16} color={th.textDim} />
              </Pressable>
            )}
          </View>
        </View>
      </SafeAreaView>

      {/* Bottom sheet */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[
          styles.bottomSheet,
          {
            backgroundColor: Platform.OS === 'ios' ? 'transparent' : th.sheetBg,
            borderTopColor: th.sheetBorder,
          },
        ]}
      >
        {Platform.OS === 'ios' && (
          <BlurView
            intensity={80}
            tint={isDark ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
        )}
        <View style={[styles.handle, { backgroundColor: th.handle }]} />

        {!showSearch ? (
          <>
            <Text style={[styles.sheetTitle, { color: th.textSub }]}>Quick destinations</Text>
            {QUICK_DESTINATIONS.map((dest) => (
              <Pressable
                key={dest.id}
                style={({ pressed }) => [styles.row, { borderTopColor: th.rowBorder }, pressed && { opacity: 0.7 }]}
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
                <Ionicons name="chevron-forward" size={16} color={th.arrowColor} />
              </Pressable>
            ))}
          </>
        ) : tripsLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={PRIMARY} size="small" />
            <Text style={[styles.centerText, { color: th.textDim }]}>Searching trips…</Text>
          </View>
        ) : filteredTrips.length > 0 ? (
          <>
            <Text style={[styles.sheetTitle, { color: th.textSub }]}>
              {filteredTrips.length} ride{filteredTrips.length !== 1 ? 's' : ''} heading there
            </Text>
            {filteredTrips.map((trip: any) => {
              const destLabel   = trip.route?.destinationName ?? trip.destination?.address?.split(',')[0] ?? 'Destination';
              const originLabel = trip.route?.originName      ?? trip.origin?.address?.split(',')[0]      ?? 'Origin';
              const time = trip.departureTime
                ? new Date(trip.departureTime).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' })
                : 'Departing soon';
              return (
                <Pressable
                  key={trip.id}
                  style={({ pressed }) => [styles.row, { borderTopColor: th.rowBorder }, pressed && { opacity: 0.7 }]}
                  onPress={() => handleSelectTrip(trip)}
                  accessibilityRole="button"
                  accessibilityLabel={`Trip from ${originLabel} to ${destLabel} at ${time}`}
                >
                  <View style={[styles.rowIcon, { backgroundColor: th.iconBg }]}>
                    <Ionicons name="car-outline" size={18} color={PRIMARY} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowName, { color: th.text }]} numberOfLines={1}>
                      {originLabel} → {destLabel}
                    </Text>
                    <Text style={[styles.rowSub, { color: th.textDim }]}>
                      {time} · {trip.availableSeats ?? '?'} seats · GH₵{trip.farePerSeat ?? '—'}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={th.arrowColor} />
                </Pressable>
              );
            })}
          </>
        ) : (
          <View style={styles.noTripsWrap}>
            <View style={[styles.noTripsIcon, { backgroundColor: th.noTripBg }]}>
              <Ionicons name="bus-outline" size={28} color={th.textDim} />
            </View>
            <Text style={[styles.noTripsTitle, { color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.65)' }]}>
              No rides to "{query}" right now
            </Text>
            <Text style={[styles.noTripsHint, { color: th.textDim }]}>
              Schedule one for later and we'll find a driver for you.
            </Text>
            <Pressable
              style={styles.scheduleBtn}
              onPress={handleSchedule}
              accessibilityRole="button"
              accessibilityLabel="Schedule a trip"
            >
              <Ionicons name="calendar-outline" size={16} color="#091009" />
              <Text style={styles.scheduleBtnText}>Schedule a trip</Text>
            </Pressable>
          </View>
        )}

        <View style={{ height: insets.bottom + 16 }} />
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    zIndex: 10,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  backBtn: {
    width: 40, height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    paddingHorizontal: spacing.md,
    height: 44,
    gap: 8,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodyMedium,
    height: '100%',
  },
  bottomSheet: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderTopWidth: 1,
    overflow: 'hidden',
  },
  handle: {
    width: 36, height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  sheetTitle: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodySmall,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.md,
    borderTopWidth: 1,
  },
  rowIcon: {
    width: 36, height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowName: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
  },
  rowSub: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.caption,
    marginTop: 2,
  },
  center: {
    alignItems: 'center',
    paddingVertical: spacing['2xl'],
    gap: spacing.sm,
  },
  centerText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodySmall,
  },
  noTripsWrap: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  noTripsIcon: {
    width: 56, height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  noTripsTitle: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    textAlign: 'center',
  },
  noTripsHint: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodySmall,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
  scheduleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: 20,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
  },
  scheduleBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    color: '#091009',
  },
});
