import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { tripsApi, routesApi, queryKeys } from '@eyego/api';
import { useRideStore } from '../../stores/ride.store';
import { fonts, fontSizes, spacing, radii, withOpacity } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, Button, EmptyState, Avatar, AppBackground } from '@eyego/ui';
import { formatCurrency } from '@eyego/utils';
import type { TripTier, Trip } from '@eyego/types';
import { captureException } from '../../lib/sentry';

// R7: The Trip type from @eyego/types doesn't include all runtime API fields.
// This extended type covers the shape returned by tripsApi.search() so we can
// drop the `(trip as any)` casts in the results list.
type TripWithRoute = Trip & {
  origin?: { address?: string };
  destination?: { address?: string };
  departureTime?: string;
  availableSeats?: number;
  farePerSeat?: number;
  fare?: number;
  maxSeats?: number;
  route?: {
    id?: string;
    name?: string;
    originName?: string;
    destinationName?: string;
    originLat?: number;
    originLng?: number;
    destLat?: number;
    destLng?: number;
    distanceKm?: number;
    virtualStops?: Array<{ id: string; name: string; lat: number; lng: number; sequence: number; isActive: boolean }>;
  };
};

/** Haversine distance in km — mirrors server-side fare.calculator.js */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calcEnRouteFare(fullFare: number, stopLat: number, stopLng: number, destLat: number, destLng: number, totalKm: number): number {
  if (totalKm <= 0) return fullFare;
  const remaining = haversineKm(stopLat, stopLng, destLat, destLng);
  const ratio = Math.min(remaining / totalKm, 1.0);
  return Math.round(fullFare * ratio * 100) / 100;
}

// Tier marks use Ionicons (vector) names rather than emoji for crisp, themeable icons.
type TierInfoMap = Record<TripTier, { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; description: string; color: string; minFare: number }>;

function getTierInfo(colors: Colors): TierInfoMap {
  return {
    ECONOMY: { icon: 'car-outline', label: 'Economy', description: 'Shared, budget-friendly ride', color: colors.tierEconomy, minFare: 8 },
    COMFORT: { icon: 'bus-outline', label: 'Comfort', description: 'More space, AC, fewer stops', color: colors.tierComfort, minFare: 15 },
    PREMIUM: { icon: 'car-sport', label: 'Premium', description: 'Private-feel, premium vehicle', color: colors.tierPremium, minFare: 25 },
  };
}

export default function RideSelectScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const TIER_INFO = useMemo(() => getTierInfo(colors), [colors]);
  const router = useRouter();
  const { origin, destination, setOrigin, setDestination, guestInfo, scheduledTime } = useRideStore();
  const [originText, setOriginText] = useState(origin?.address ?? '');
  const [destText, setDestText] = useState(destination?.address ?? '');
  const [selectedTier, setSelectedTier] = useState<TripTier>('ECONOMY');
  const [trips, setTrips] = useState<Trip[]>([]);
  const [searched, setSearched] = useState(false);
  const [heavyLoad, setHeavyLoad] = useState(false);
  const [stops, setStops] = useState<{ id: string; text: string }[]>([]);
  const [enRoutePickerTripId, setEnRoutePickerTripId] = useState<string | null>(null);
  const [selectedStopByTrip, setSelectedStopByTrip] = useState<Record<string, { id: string; name: string; fare: number }>>({});
  const [fareModalTrip, setFareModalTrip] = useState<TripWithRoute | null>(null);

  const addStop = () => {
    setStops([...stops, { id: Math.random().toString(), text: '' }]);
  };

  const updateStop = (id: string, text: string) => {
    setStops(stops.map(s => s.id === id ? { ...s, text } : s));
  };

  const removeStop = (id: string) => {
    setStops(stops.filter(s => s.id !== id));
  };

  useQuery({
    queryKey: queryKeys.routes.all,
    queryFn: routesApi.getAll,
  });

  const swapRotation = useSharedValue(0);

  const swapStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${swapRotation.value}deg` }],
  }));

  const handleSwap = () => {
    swapRotation.value = withSequence(
      withSpring(180, { stiffness: 300, damping: 20 }),
      withTiming(360, { duration: 0 })
    );
    const tmpText = originText;
    const tmpLoc = origin;
    setOriginText(destText);
    setDestText(tmpText);
    setOrigin(destination);
    setDestination(tmpLoc ?? null);
  };

  const searchTrips = useMutation({
    mutationFn: () =>
      tripsApi.search({
        originLat: origin?.latitude ?? 5.6037,
        originLng: origin?.longitude ?? -0.187,
        destinationLat: destination?.latitude ?? 5.65,
        destinationLng: destination?.longitude ?? -0.19,
        tier: selectedTier,
      }),
    onSuccess: ({ data }) => {
      const realTrips = (data?.data as any)?.trips ?? data?.data ?? [];
      // No mock fallback: an empty result is a genuine "no rides found" state,
      // not an excuse to show fabricated trips a rider could try to book.
      setTrips(Array.isArray(realTrips) ? realTrips : []);
      setSearched(true);
    },
    onError: (err) => {
      captureException(err, { screen: 'ride-select', action: 'search', tier: selectedTier });
      setTrips([]);
      setSearched(true);
    },
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppBackground variant="static" />
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.headerBackBtn}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
        </Pressable>
        <View style={styles.headerTitleGroup}>
          <Text style={styles.headerTitle} numberOfLines={1}>Available Rides</Text>
          <View style={styles.headerSubtitleRow}>
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {originText ? originText.split(',')[0] : 'Pickup'}
            </Text>
            <Ionicons name="arrow-forward" size={12} color={colors.onSurfaceVariant} style={{ marginHorizontal: 5 }} />
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {destText ? destText.split(',')[0] : 'Destination'}
            </Text>
          </View>
        </View>
        <Pressable
          style={styles.headerBackBtn}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Filters"
        >
          <Ionicons name="options-outline" size={20} color={colors.onSurface} />
        </Pressable>
      </View>

      {/* Route preview hero */}
      <View style={styles.heroWrap}>
        <LinearGradient
          colors={[withOpacity(colors.tierEconomy, 0.14), 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={styles.heroRouteLine}>
          <View style={[styles.heroDot, { backgroundColor: colors.primary }]} />
          <View style={styles.heroDashLine} />
          <View style={[styles.heroDot, styles.heroDotDest, { backgroundColor: colors.secondary }]} />
        </View>
        <LinearGradient
          colors={['transparent', colors.backgroundDeep]}
          style={styles.heroFade}
          pointerEvents="none"
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.dockedContent}>
        {/* Search bar */}
        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 40 }}
        >
          <Pressable
            style={styles.searchBar}
            onPress={() => router.push('/where-to' as any)}
            accessibilityRole="button"
            accessibilityLabel="Change destination"
          >
            <Ionicons name="search-outline" size={18} color={colors.onSurfaceVariant} />
            <Text style={[styles.searchBarText, !destText && { color: colors.onSurfaceVariant }]} numberOfLines={1}>
              {destText || 'Where are you heading?'}
            </Text>
            {destText ? (
              <Pressable
                onPress={() => { setDestText(''); setOriginText(''); setTrips([]); setSearched(false); }}
                hitSlop={8}
              >
                <Ionicons name="close-circle" size={16} color={colors.onSurfaceVariant} />
              </Pressable>
            ) : (
              <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
            )}
          </Pressable>
        </MotiView>

        {/* Tier filter pills */}
        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 60 }}
        >
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tierPillsBleed} contentContainerStyle={styles.tierPillsRow}>
            <Pressable
              style={[styles.tierPill, !selectedTier && styles.tierPillAllActive]}
              onPress={() => { setSelectedTier('ECONOMY'); searchTrips.mutate(); }}
            >
              <Text style={[styles.tierPillText, !selectedTier && styles.tierPillTextActive]}>ALL TRIPS</Text>
            </Pressable>
            {(Object.keys(TIER_INFO) as TripTier[]).map((tier) => {
              const info = TIER_INFO[tier];
              const active = selectedTier === tier;
              return (
                <Pressable
                  key={tier}
                  style={[
                    styles.tierPill,
                    active && { borderColor: info.color, backgroundColor: info.color + '18' },
                  ]}
                  onPress={() => { setSelectedTier(tier); searchTrips.mutate(); }}
                >
                  <Ionicons name={info.icon} size={13} color={active ? info.color : colors.onSurfaceVariant} />
                  <Text style={[styles.tierPillText, active && { color: info.color }]}>{info.label.toUpperCase()}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </MotiView>

        {/* Auto-search on mount if destination is set */}
        {!searched && !searchTrips.isPending && (destText || destText) && (
          <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ type: 'timing', duration: 200 }}>
            <Pressable style={styles.searchCta} onPress={() => searchTrips.mutate()}>
              <Button variant="glow" label="Find Available Rides" onPress={() => searchTrips.mutate()} loading={searchTrips.isPending} />
            </Pressable>
          </MotiView>
        )}

        {/* Results */}
        {searched && trips.length === 0 && (
          <MotiView
            from={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ type: 'timing', duration: 300 }}
          >
            {searchTrips.isError ? (
              <EmptyState
                icon="⚠️"
                title="Search failed"
                subtitle="Something went wrong searching for rides. Please try again."
                action={{ label: 'Try again', onPress: () => searchTrips.mutate() }}
              />
            ) : (
              <View style={styles.noDriversCard}>
                <Ionicons name="bus-outline" size={48} color={colors.onSurfaceVariant} style={{ marginBottom: spacing.md }} />
                <Text variant="titleSmall" style={{ textAlign: 'center' }}>No rides available right now</Text>
                <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ textAlign: 'center', marginTop: spacing.xs }}>
                  No {selectedTier.toLowerCase()} trips match this route. Try a different tier or destination.
                </Text>
                <View style={styles.noDriversCtas}>
                  <Pressable
                    style={[styles.noDriversCtaBtn, { backgroundColor: colors.primary }]}
                    onPress={() => router.push('/ride/request' as any)}
                    accessibilityRole="button"
                    accessibilityLabel="Request a trip from a driver"
                  >
                    <Ionicons name="flash" size={18} color={colors.onPrimary} />
                    <View>
                      <Text variant="labelLarge" color={colors.onPrimary}>Request a Trip</Text>
                      <Text variant="caption" color={colors.onPrimary} style={{ opacity: 0.75 }}>A driver will accept when available</Text>
                    </View>
                  </Pressable>
                  <Pressable
                    style={[styles.noDriversCtaBtn, { backgroundColor: colors.surfaceContainer, borderWidth: 1, borderColor: colors.outlineVariant }]}
                    onPress={() => router.push('/ride/schedule' as any)}
                    accessibilityRole="button"
                    accessibilityLabel="Schedule a trip for later"
                  >
                    <Ionicons name="calendar-outline" size={18} color={colors.onSurface} />
                    <View>
                      <Text variant="labelLarge">Schedule for Later</Text>
                      <Text variant="caption" color={colors.onSurfaceVariant}>Pick a date and time that works</Text>
                    </View>
                  </Pressable>
                  <Pressable
                    style={styles.noDriversRetry}
                    onPress={() => searchTrips.mutate()}
                    accessibilityRole="button"
                    accessibilityLabel="Search again"
                  >
                    <Ionicons name="refresh-outline" size={16} color={colors.onSurfaceVariant} />
                    <Text variant="bodySmall" color={colors.onSurfaceVariant}>Search again</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </MotiView>
        )}

        {searched && trips.length > 0 && (
          <MotiView
            from={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ type: 'timing', duration: 300 }}
          >
            <Text style={styles.resultsCount}>
              {trips.length} ride{trips.length !== 1 ? 's' : ''} available
            </Text>
            <View style={styles.resultsList}>
              {(trips as TripWithRoute[]).map((trip, i) => {
                const tier = (trip.tier as TripTier) ?? 'ECONOMY';
                const info = TIER_INFO[tier];
                const fullFare = trip.farePerSeat ?? 0;
                const selectedStop = selectedStopByTrip[trip.id ?? ''];
                const displayFare = selectedStop ? selectedStop.fare : fullFare;
                const seatsLeft = trip.availableSeats ?? 3;
                const seatsLow = seatsLeft <= 2;
                const activeStops = trip.route?.virtualStops?.filter(s => s.isActive) ?? [];
                const hasEnRoute = activeStops.length > 0;
                const timeStr = trip.departureTime
                  ? new Date(trip.departureTime).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' })
                  : 'Departing soon';
                return (
                  <MotiView
                    key={trip.id ?? i}
                    from={{ opacity: 0, translateY: 10 }}
                    animate={{ opacity: 1, translateY: 0 }}
                    transition={{ type: 'spring', stiffness: 600, damping: 34, delay: i * 40 }}
                  >
                    <Pressable
                      style={({ pressed }) => [
                        styles.tripCard,
                        tier === 'PREMIUM' && { borderLeftWidth: 2, borderLeftColor: info.color },
                        pressed && { opacity: 0.88 },
                      ]}
                      onPress={() => {
                        if (!trip.id) return;
                        const params = selectedStop ? `?pickupStopId=${selectedStop.id}` : '';
                        router.push(`/ride/${trip.id}${params}` as any);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Book ${tier} ride`}
                    >
                      <View style={[styles.tripCardGlow, { backgroundColor: withOpacity(info.color, 0.08) }]} pointerEvents="none" />

                      {/* Driver + price */}
                      <View style={styles.tripCardTop}>
                        <Avatar uri={trip.driver?.avatarUrl} name={trip.driver?.name} size={48} borderColor={colors.rimLight} />
                        <View style={styles.tripCardDriverInfo}>
                          <Text style={styles.tripCardDriverName} numberOfLines={1}>{trip.driver?.name ?? 'Driver'}</Text>
                          <View style={styles.tripCardRatingRow}>
                            <Ionicons name="star" size={12} color={info.color} />
                            <Text style={[styles.tripCardRating, { color: info.color }]}>
                              {(trip.driver?.rating ?? 4.8).toFixed(2)}
                            </Text>
                            <Text style={styles.tripCardDot}>•</Text>
                            <Text style={styles.tripCardVehicle} numberOfLines={1}>
                              {[trip.vehicle?.make, trip.vehicle?.model].filter(Boolean).join(' ') || 'Vehicle'}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.tripCardPriceCol}>
                          <Text style={styles.tripCardPrice}>{formatCurrency(displayFare)}</Text>
                          {selectedStop && (
                            <Text style={styles.tripCardPriceStrike}>{formatCurrency(fullFare)}</Text>
                          )}
                        </View>
                      </View>

                      {/* Route + time */}
                      <View style={styles.tripCardRouteRow}>
                        <Ionicons name="time-outline" size={13} color={colors.onSurfaceVariant} />
                        <Text style={styles.tripCardMetaText} numberOfLines={1}>
                          {(trip.origin?.address ?? originText).split(',')[0]}
                          {' → '}
                          {(trip.destination?.address ?? destText).split(',')[0]}
                          {' · '}{timeStr}
                        </Text>
                      </View>

                      {/* Tier + en-route + seats chips */}
                      <View style={styles.tripCardBottom}>
                        <View style={styles.tripCardChipGroup}>
                          <View style={[styles.tierBadge, { backgroundColor: withOpacity(info.color, 0.1) }]}>
                            <Ionicons name={info.icon} size={11} color={info.color} />
                            <Text style={[styles.tierBadgeText, { color: info.color }]}>{info.label}</Text>
                          </View>
                          {hasEnRoute && (
                            <Pressable
                              onPress={(e) => { e.stopPropagation?.(); setEnRoutePickerTripId(trip.id ?? null); }}
                              style={[styles.enRouteChip, selectedStop && styles.enRouteChipActive]}
                            >
                              <Ionicons name="location" size={10} color={selectedStop ? colors.onPrimary : colors.primary} />
                              <Text style={[styles.enRouteChipText, selectedStop && { color: colors.onPrimary }]}>
                                {selectedStop ? selectedStop.name : 'En-route'}
                              </Text>
                            </Pressable>
                          )}
                        </View>
                        <View style={[styles.seatsChip, { backgroundColor: seatsLow ? withOpacity(colors.statusError, 0.1) : colors.surfaceContainerHigh }]}>
                          <Ionicons name="people-outline" size={12} color={seatsLow ? colors.statusError : colors.onSurfaceVariant} />
                          <Text style={[styles.seatsChipText, { color: seatsLow ? colors.statusError : colors.onSurfaceVariant }]}>
                            {seatsLeft} SEAT{seatsLeft !== 1 ? 'S' : ''} LEFT
                          </Text>
                        </View>
                      </View>

                      <Pressable
                        onPress={(e) => { e.stopPropagation?.(); setFareModalTrip(trip); }}
                        hitSlop={8}
                        style={styles.fareInfoBtn}
                      >
                        <Ionicons name="information-circle-outline" size={13} color={colors.onSurfaceVariant} />
                        <Text style={styles.fareInfoText}>Fare breakdown</Text>
                      </Pressable>
                    </Pressable>

                    {enRoutePickerTripId === trip.id && (
                      <MotiView
                        from={{ opacity: 0, translateY: -8 }}
                        animate={{ opacity: 1, translateY: 0 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        style={styles.stopPickerCard}
                      >
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
                          <Text variant="labelLarge">Board at a stop</Text>
                          <Pressable onPress={() => setEnRoutePickerTripId(null)} hitSlop={8}>
                            <Ionicons name="close" size={18} color={colors.onSurfaceVariant} />
                          </Pressable>
                        </View>
                        {selectedStop && (
                          <Pressable
                            style={[styles.stopRow, { borderColor: colors.outlineVariant }]}
                            onPress={() => {
                              const updated = { ...selectedStopByTrip };
                              delete updated[trip.id ?? ''];
                              setSelectedStopByTrip(updated);
                              setEnRoutePickerTripId(null);
                            }}
                          >
                            <Ionicons name="navigate-circle-outline" size={16} color={colors.onSurfaceVariant} />
                            <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ flex: 1 }}>Full route (from origin)</Text>
                            <Text variant="labelLarge">{formatCurrency(fullFare)}</Text>
                          </Pressable>
                        )}
                        {activeStops.map(stop => {
                          const stopFare = calcEnRouteFare(
                            fullFare,
                            stop.lat, stop.lng,
                            trip.route?.destLat ?? 0, trip.route?.destLng ?? 0,
                            trip.route?.distanceKm ?? 0,
                          );
                          const isSelected = selectedStop?.id === stop.id;
                          return (
                            <Pressable
                              key={stop.id}
                              style={[styles.stopRow, isSelected && { borderColor: colors.primary, backgroundColor: colors.primary + '12' }]}
                              onPress={() => {
                                setSelectedStopByTrip(prev => ({ ...prev, [trip.id ?? '']: { id: stop.id, name: stop.name, fare: stopFare } }));
                                setEnRoutePickerTripId(null);
                              }}
                            >
                              <Ionicons name="location-outline" size={16} color={isSelected ? colors.primary : colors.onSurfaceVariant} />
                              <Text variant="bodyMedium" style={{ flex: 1 }} color={isSelected ? colors.primary : colors.onSurface}>
                                {stop.name}
                              </Text>
                              <Text variant="labelLarge" color={isSelected ? colors.primary : colors.onSurface}>
                                {formatCurrency(stopFare)}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </MotiView>
                    )}
                  </MotiView>
                );
              })}
            </View>
          </MotiView>
        )}
        </View>
      </ScrollView>

      {/* Fare breakdown modal */}
      <Modal
        visible={!!fareModalTrip}
        transparent
        animationType="slide"
        onRequestClose={() => setFareModalTrip(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setFareModalTrip(null)}>
          <Pressable style={[styles.modalSheet, { backgroundColor: colors.surfaceContainer }]} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <Text variant="titleMedium" style={{ marginBottom: spacing.lg }}>Fare Breakdown</Text>
            {fareModalTrip && (() => {
              const fare = fareModalTrip.farePerSeat ?? 0;
              const platform = Math.round(fare * 0.05 * 100) / 100;
              const base = Math.round((fare - platform) * 100) / 100;
              const heavySurcharge = heavyLoad ? 10 : 0;
              const total = fare + heavySurcharge;
              const distKm = fareModalTrip.route?.distanceKm;
              return (
                <View style={{ gap: spacing.sm }}>
                  {distKm ? (
                    <View style={styles.breakdownRow}>
                      <Text variant="bodyMedium" color={colors.onSurfaceVariant}>Distance</Text>
                      <Text variant="bodyMedium">{distKm.toFixed(1)} km</Text>
                    </View>
                  ) : null}
                  <View style={styles.breakdownRow}>
                    <Text variant="bodyMedium" color={colors.onSurfaceVariant}>Base fare</Text>
                    <Text variant="bodyMedium">{formatCurrency(base)}</Text>
                  </View>
                  <View style={styles.breakdownRow}>
                    <Text variant="bodyMedium" color={colors.onSurfaceVariant}>Platform fee (5%)</Text>
                    <Text variant="bodyMedium">{formatCurrency(platform)}</Text>
                  </View>
                  {heavyLoad && (
                    <View style={styles.breakdownRow}>
                      <Text variant="bodyMedium" color={colors.onSurfaceVariant}>Heavy load surcharge</Text>
                      <Text variant="bodyMedium">{formatCurrency(heavySurcharge)}</Text>
                    </View>
                  )}
                  <View style={[styles.breakdownRow, styles.breakdownTotal]}>
                    <Text variant="titleSmall">Total per seat</Text>
                    <Text variant="titleSmall" color={colors.primary}>{formatCurrency(total)}</Text>
                  </View>
                  <Text variant="caption" color={colors.onSurfaceVariant} style={{ marginTop: spacing.xs, textAlign: 'center' }}>
                    Fares are per seat and may include a surge multiplier during peak hours.
                  </Text>
                </View>
              );
            })()}
            <Pressable
              style={[styles.modalClose, { backgroundColor: colors.primary }]}
              onPress={() => setFareModalTrip(null)}
              accessibilityRole="button"
              accessibilityLabel="Close fare breakdown"
            >
              <Text variant="labelLarge" color={colors.onPrimary}>Got it</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}


const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.base,
  },
  headerBackBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.rimLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleGroup: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 17,
    lineHeight: 22,
    color: colors.onSurface,
    letterSpacing: -0.3,
  },
  headerSubtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  headerSubtitle: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.onSurfaceVariant,
    maxWidth: 100,
  },
  heroWrap: {
    height: 140,
    marginTop: -32,
    zIndex: 0,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  heroRouteLine: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    width: '55%',
  },
  heroDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  heroDotDest: {
    borderRadius: 3,
  },
  heroDashLine: {
    flex: 1,
    height: 1,
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: colors.rimLight,
    marginHorizontal: 6,
  },
  heroFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 90,
  },
  dockedContent: {
    marginTop: -28,
    borderTopLeftRadius: radii['4xl'],
    borderTopRightRadius: radii['4xl'],
    backgroundColor: colors.backgroundDeep,
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing.xl,
    gap: spacing.xl,
    zIndex: 1,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceInput,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.rimLight,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  searchBarText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodyMedium,
    color: colors.onSurface,
  },
  tierPillsRow: {
    gap: 8,
    paddingVertical: 2,
    paddingHorizontal: spacing['2xl'],
  },
  tierPillsBleed: {
    marginHorizontal: -spacing['2xl'],
  },
  tierPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surfaceCard,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  tierPillAllActive: {
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}18`,
  },
  tierPillText: {
    fontFamily: fonts.labelCaps,
    fontSize: 11,
    lineHeight: 15,
    color: colors.onSurfaceVariant,
    letterSpacing: 0.4,
  },
  tierPillTextActive: {
    color: colors.primary,
  },
  resultsCount: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: colors.onSurfaceVariant,
    letterSpacing: 0.3,
    marginBottom: spacing.md,
  },
  tripCard: {
    backgroundColor: withOpacity(colors.surfaceCard, 0.7),
    borderRadius: radii['2xl'],
    borderWidth: 1,
    borderColor: colors.rimLight,
    padding: 16,
    gap: 12,
    overflow: 'hidden',
  },
  tripCardGlow: {
    position: 'absolute',
    top: -20,
    right: -20,
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  tripCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  tripCardDriverInfo: {
    flex: 1,
    gap: 3,
  },
  tripCardDriverName: {
    fontFamily: fonts.semiBold,
    fontSize: 16,
    lineHeight: 21,
    color: colors.onSurface,
    letterSpacing: -0.2,
  },
  tripCardRatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tripCardRating: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
  },
  tripCardDot: {
    color: colors.onSurfaceVariant,
    fontSize: 12,
    marginHorizontal: 1,
  },
  tripCardVehicle: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.onSurfaceVariant,
  },
  tripCardPriceCol: {
    alignItems: 'flex-end',
  },
  tripCardPrice: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.fareMedium,
    lineHeight: fontSizes.fareMedium * 1.25,
    color: colors.onSurface,
    letterSpacing: -0.5,
  },
  tripCardPriceStrike: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.onSurfaceVariant,
    textDecorationLine: 'line-through',
  },
  tripCardRouteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tierBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    flexShrink: 0,
  },
  tierBadgeText: {
    fontFamily: fonts.labelCaps,
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.5,
  },
  tripCardChipGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    flex: 1,
  },
  tripCardMetaText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.onSurfaceVariant,
  },
  seatsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexShrink: 0,
  },
  seatsChipText: {
    fontFamily: fonts.labelCaps,
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.4,
  },
  tripCardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.rimLightSubtle,
  },
  fareInfoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
  },
  fareInfoText: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.onSurfaceVariant,
    textDecorationLine: 'underline',
  },
  scroll: {
    paddingBottom: spacing['3xl'],
  },
  searchCta: {},
  enRouteChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.primary + '18',
    borderRadius: radii.full,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.primary + '40',
  },
  enRouteChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  enRouteChipText: {
    fontFamily: fonts.semiBold,
    fontSize: 9,
    color: colors.primary,
    letterSpacing: 0.2,
  },
  stopPickerCard: {
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.xl,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    marginTop: -spacing.sm,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: spacing.xs,
  },
  resultsList: { gap: spacing.md },
  tripResultCard: {
    backgroundColor: colors.surfaceCard,
    borderRadius: radii.xl,
    padding: spacing.base,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  tripResultLeft: { flex: 1, gap: spacing.xs },
  routeArrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingLeft: 2,
  },
  routeArrowLine: { width: 16, height: 1, backgroundColor: colors.outline },
  tripResultRight: {
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingLeft: spacing.base,
  },
  // No drivers state
  noDriversCard: {
    alignItems: 'center',
    paddingVertical: spacing['2xl'],
    paddingHorizontal: spacing.xl,
  },
  noDriversCtas: {
    width: '100%',
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  noDriversCtaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radii.xl,
    padding: spacing.base,
  },
  noDriversRetry: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  // Fare breakdown modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    padding: spacing['2xl'],
    paddingBottom: spacing['3xl'],
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.outline,
    alignSelf: 'center',
    marginBottom: spacing.xl,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  breakdownTotal: {
    borderTopWidth: 1,
    borderTopColor: colors.outline,
    marginTop: spacing.sm,
    paddingTop: spacing.md,
  },
  modalClose: {
    borderRadius: radii.full,
    paddingVertical: spacing.base,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
});
