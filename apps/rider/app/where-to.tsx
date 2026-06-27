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
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useQuery } from '@tanstack/react-query';
import { tripsApi, queryKeys } from '@eyego/api';
import MapboxGL from '../utils/mapbox';

// Stadia Maps Alidade Smooth Dark — premium, distinct, no API key needed on free tier
const MAP_STYLE = 'https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json';
const PRIMARY = '#4be277';

const QUICK_DESTINATIONS = [
  { id: 'home', name: 'Home', address: 'Your home address', icon: 'home-outline' as const },
  { id: 'work', name: 'Work', address: 'Your work address', icon: 'briefcase-outline' as const },
  { id: 'mall', name: 'Accra Mall', address: 'Tetteh Quarshie Interchange, Accra', icon: 'storefront-outline' as const },
  { id: 'circle', name: 'Kwame Nkrumah Circle', address: 'Ring Road Central, Accra', icon: 'navigate-outline' as const },
];

export default function WhereToScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tier } = useLocalSearchParams<{ tier?: string; type?: string }>();

  const [query, setQuery] = useState('');
  const [userCoords, setUserCoords] = useState<[number, number] | null>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    inputRef.current?.focus();
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setUserCoords([loc.coords.longitude, loc.coords.latitude]);
        }
      } catch { /* non-fatal */ }
    })();
  }, []);

  // Reuse cached trips from home screen (same queryKey + staleTime)
  const { data: tripsData, isLoading: tripsLoading } = useQuery({
    queryKey: queryKeys.rides.list({ status: 'OPEN' }),
    queryFn: () => tripsApi.search({ status: 'OPEN' } as any),
    staleTime: 15_000,
  });

  const rawTrips: any[] = Array.isArray(tripsData)
    ? tripsData
    : (tripsData as any)?.data ?? [];

  const filteredTrips = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    return rawTrips.filter((t: any) => {
      const dest = (
        t.route?.destinationName ??
        t.destination?.address ??
        t.routeDestination ??
        ''
      ).toLowerCase();
      const origin = (
        t.route?.originName ??
        t.origin?.address ??
        t.routeOrigin ??
        ''
      ).toLowerCase();
      return dest.includes(q) || origin.includes(q);
    });
  }, [rawTrips, query]);

  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  const handleSelectTrip = (trip: any) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(`/ride/${trip.id}` as any);
  };

  const handleQuickDest = (dest: typeof QUICK_DESTINATIONS[0]) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: '/ride/select',
      params: { destination: dest.name, tier: tier ?? 'economy' },
    } as any);
  };

  const handleSchedule = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/ride/schedule' as any);
  };

  const showSearch = query.trim().length > 0;

  return (
    <View style={styles.root}>
      {/* Full-screen Stadia Alidade Smooth Dark map */}
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
          <Pressable onPress={handleClose} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </Pressable>
          <View style={styles.inputWrap}>
            <Ionicons name="search-outline" size={16} color="rgba(255,255,255,0.5)" style={{ flexShrink: 0 }} />
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder="Where to?"
              placeholderTextColor="rgba(255,255,255,0.4)"
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
              autoCorrect={false}
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color="rgba(255,255,255,0.4)" />
              </Pressable>
            )}
          </View>
        </View>
      </SafeAreaView>

      {/* Bottom sheet */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.bottomSheet}
      >
        <View style={styles.handle} />

        {!showSearch ? (
          /* — Quick destinations — */
          <>
            <Text style={styles.sheetTitle}>Quick destinations</Text>
            {QUICK_DESTINATIONS.map((dest) => (
              <Pressable
                key={dest.id}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                onPress={() => handleQuickDest(dest)}
              >
                <View style={styles.rowIcon}>
                  <Ionicons name={dest.icon} size={18} color={PRIMARY} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName}>{dest.name}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>{dest.address}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.2)" />
              </Pressable>
            ))}
          </>
        ) : tripsLoading ? (
          /* — Loading — */
          <View style={styles.center}>
            <ActivityIndicator color={PRIMARY} size="small" />
            <Text style={styles.centerText}>Searching trips…</Text>
          </View>
        ) : filteredTrips.length > 0 ? (
          /* — Matching trips — */
          <>
            <Text style={styles.sheetTitle}>
              {filteredTrips.length} ride{filteredTrips.length !== 1 ? 's' : ''} heading there
            </Text>
            {filteredTrips.map((trip: any) => {
              const destLabel =
                trip.route?.destinationName ??
                trip.destination?.address?.split(',')[0] ??
                'Destination';
              const originLabel =
                trip.route?.originName ??
                trip.origin?.address?.split(',')[0] ??
                'Origin';
              const time = trip.departureTime
                ? new Date(trip.departureTime).toLocaleTimeString('en-GH', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : 'Departing soon';
              return (
                <Pressable
                  key={trip.id}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                  onPress={() => handleSelectTrip(trip)}
                >
                  <View style={styles.rowIcon}>
                    <Ionicons name="car-outline" size={18} color={PRIMARY} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {originLabel} → {destLabel}
                    </Text>
                    <Text style={styles.rowSub}>
                      {time} · {trip.availableSeats ?? '?'} seats · GH₵{trip.farePerSeat ?? '—'}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.2)" />
                </Pressable>
              );
            })}
          </>
        ) : (
          /* — No trips found → Schedule CTA — */
          <View style={styles.noTripsWrap}>
            <View style={styles.noTripsIcon}>
              <Ionicons name="bus-outline" size={28} color="rgba(255,255,255,0.25)" />
            </View>
            <Text style={styles.noTripsTitle}>No rides to "{query}" right now</Text>
            <Text style={styles.noTripsHint}>
              Schedule one for later and we'll find a driver for you.
            </Text>
            <Pressable style={styles.scheduleBtn} onPress={handleSchedule}>
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
  root: {
    flex: 1,
    backgroundColor: '#091009',
  },
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
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
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(9,16,9,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(9,16,9,0.90)',
    borderRadius: 20,
    paddingHorizontal: spacing.md,
    height: 44,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  input: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodyMedium,
    color: '#fff',
    height: '100%',
  },
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(10,14,10,0.97)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  sheetTitle: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodySmall,
    color: 'rgba(255,255,255,0.4)',
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
    borderColor: 'rgba(255,255,255,0.05)',
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: `${colors.primary}15`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowName: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    color: '#fff',
  },
  rowSub: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.caption,
    color: 'rgba(255,255,255,0.4)',
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
    color: 'rgba(255,255,255,0.4)',
  },
  noTripsWrap: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  noTripsIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  noTripsTitle: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
  },
  noTripsHint: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodySmall,
    color: 'rgba(255,255,255,0.35)',
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
