import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView, AnimatePresence } from 'moti';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { tripsApi, routesApi, queryKeys } from '@eyego/api';
import { useRideStore } from '../../stores/ride.store';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, Button, Toggle, EmptyState } from '@eyego/ui';
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
const TIER_INFO: Record<TripTier, { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; description: string; color: string; minFare: number }> = {
  ECONOMY: { icon: 'car-outline', label: 'Economy', description: 'Shared, budget-friendly ride', color: '#4BE277', minFare: 8 },
  COMFORT: { icon: 'bus-outline', label: 'Comfort', description: 'More space, AC, fewer stops', color: '#7DD8F5', minFare: 15 },
  PREMIUM: { icon: 'car-sport', label: 'Premium', description: 'Private-feel, premium vehicle', color: '#ffb5ab', minFare: 25 },
};

export default function RideSelectScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text variant="titleMedium">Plan Your Ride</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Route inputs */}
        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 50 }}
          style={styles.routeCard}
        >
          {/* Origin */}
          <View style={styles.routeRow}>
            <View style={styles.dotOrigin} />
            <TextInput
              style={styles.routeInput}
              value={originText}
              onChangeText={setOriginText}
              placeholder="From where?"
              placeholderTextColor={colors.onSurfaceVariant}
              returnKeyType="next"
            />
          </View>

          {/* Connecting line */}
          <View style={styles.routeConnector}>
            <View style={styles.routeConnectorLine} />
            {stops.length === 0 && (
              <Animated.View style={[styles.swapButton, swapStyle]}>
                <Pressable onPress={handleSwap} style={styles.swapInner} hitSlop={8}>
                  <Ionicons name="swap-vertical" size={16} color={colors.onSurface} />
                </Pressable>
              </Animated.View>
            )}
          </View>

          {/* Stops */}
          <AnimatePresence>
            {stops.map((stop) => (
              <MotiView
                key={stop.id}
                from={{ opacity: 0, height: 0, translateY: -10 }}
                animate={{ opacity: 1, height: 48, translateY: 0 }}
                exit={{ opacity: 0, height: 0, translateY: -10 }}
                style={{ overflow: 'hidden' }}
              >
                <View style={styles.routeRow}>
                  <View style={styles.dotStop} />
                  <TextInput
                    style={styles.routeInput}
                    value={stop.text}
                    onChangeText={(text) => updateStop(stop.id, text)}
                    placeholder="Add a stop"
                    placeholderTextColor={colors.onSurfaceVariant}
                    returnKeyType="next"
                  />
                  <Pressable onPress={() => removeStop(stop.id)} hitSlop={8}>
                    <Ionicons name="close-circle" size={20} color={colors.onSurfaceVariant} />
                  </Pressable>
                </View>
                <View style={styles.routeConnector}>
                  <View style={styles.routeConnectorLine} />
                </View>
              </MotiView>
            ))}
          </AnimatePresence>

          {/* Destination */}
          <View style={styles.routeRow}>
            <View style={styles.dotDestination} />
            <TextInput
              style={styles.routeInput}
              value={destText}
              onChangeText={setDestText}
              placeholder="Where to?"
              placeholderTextColor={colors.onSurfaceVariant}
              returnKeyType="done"
            />
          </View>

          {/* Add Stop Button */}
          {stops.length < 3 && (
            <Pressable style={styles.addStopButton} onPress={addStop}>
              <Ionicons name="add" size={16} color={colors.primary} />
              <Text variant="labelLarge" color={colors.primary}>Add Stop</Text>
            </Pressable>
          )}
          {stops.some((s) => s.text.trim()) && (
            <Text variant="caption" color={colors.onSurfaceVariant} style={{ marginTop: spacing.xs, marginLeft: spacing.lg }}>
              Stops help your driver plan the route. Share them in the chat once matched.
            </Text>
          )}
        </MotiView>

        {/* Ride Options */}
        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 60 }}
          style={styles.rideOptionsRow}
        >
          <Pressable style={styles.rideOptionBtn} onPress={() => router.push('/ride/guest-selection')}>
            <Ionicons name={guestInfo ? "people" : "person"} size={18} color={colors.primary} />
            <Text variant="labelMedium" color={colors.primary}>
              {guestInfo ? 'For Guest' : 'For Me'}
            </Text>
          </Pressable>
          
          <Pressable style={styles.rideOptionBtn} onPress={() => router.push('/ride/reserve')}>
            <Ionicons name="calendar" size={18} color={colors.primary} />
            <Text variant="labelMedium" color={colors.primary}>
              {scheduledTime ? new Date(scheduledTime).toLocaleDateString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'Schedule'}
            </Text>
          </Pressable>
        </MotiView>

        {/* Tier selector */}
        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 80 }}
        >
          <Text variant="titleSmall" style={styles.sectionLabel}>Select tier</Text>
          <View style={styles.tierGrid}>
            {(Object.keys(TIER_INFO) as TripTier[]).map((tier) => (
              <TierCard
                key={tier}
                tier={tier}
                isSelected={selectedTier === tier}
                onPress={() => setSelectedTier(tier)}
              />
            ))}
          </View>
        </MotiView>

        {/* Heavy Load toggle */}
        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 100 }}
          style={styles.heavyLoadRow}
        >
          <View style={styles.heavyLoadLeft}>
            <Ionicons name="briefcase-outline" size={20} color={colors.onSurfaceVariant} />
            <View>
              <Text variant="bodyMedium">Heavy Load</Text>
              <Text variant="caption" color={colors.onSurfaceVariant}>Large bags or cargo (+GHS 10.00)</Text>
            </View>
          </View>
          <Toggle value={heavyLoad} onValueChange={setHeavyLoad} />
        </MotiView>

        {/* Heavy load warning */}
        {heavyLoad && (
          <MotiView
            from={{ opacity: 0, translateY: -6, scale: 0.98 }}
            animate={{ opacity: 1, translateY: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34 }}
            style={styles.heavyLoadBanner}
          >
            <Ionicons name="information-circle-outline" size={16} color={colors.secondary} />
            <Text variant="caption" color={colors.secondary} style={{ flex: 1 }}>
              A GHS 10.00 surcharge will be added to your fare for heavy or oversized loads.
            </Text>
          </MotiView>
        )}

        {/* Search button */}
        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 110 }}
          style={styles.searchCta}
        >
          <Button
            label="Search Rides"
            onPress={() => searchTrips.mutate()}
            loading={searchTrips.isPending}
            disabled={!originText.trim() && !destText.trim()}
          />
        </MotiView>

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
            <Text variant="titleSmall" style={styles.sectionLabel}>
              {trips.length} ride{trips.length !== 1 ? 's' : ''} available
            </Text>
            <View style={styles.resultsList}>
              {(trips as TripWithRoute[]).map((trip, i) => (
                <MotiView
                  key={trip.id ?? i}
                  from={{ opacity: 0, translateY: 10 }}
                  animate={{ opacity: 1, translateY: 0 }}
                  transition={{ type: 'spring', stiffness: 600, damping: 34, delay: i * 40 }}
                >
                  {(() => {
                    const fullFare = trip.farePerSeat ?? 0;
                    const selectedStop = selectedStopByTrip[trip.id ?? ''];
                    const displayFare = selectedStop ? selectedStop.fare : fullFare;
                    const activeStops = trip.route?.virtualStops?.filter(s => s.isActive) ?? [];
                    const hasEnRoute = activeStops.length > 0;
                    return (
                      <>
                        <Pressable
                          style={styles.tripResultCard}
                          onPress={() => {
                            if (!trip.id) return;
                            const params = selectedStop
                              ? `?pickupStopId=${selectedStop.id}`
                              : '';
                            router.push(`/ride/${trip.id}${params}` as any);
                          }}
                        >
                          <View style={styles.tripResultLeft}>
                            <Text variant="titleSmall">
                              {trip.origin?.address?.split(',')[0] ?? originText}
                            </Text>
                            <View style={styles.routeArrowRow}>
                              <View style={styles.routeArrowLine} />
                              <Ionicons name="arrow-forward" size={10} color={colors.onSurfaceVariant} />
                            </View>
                            <Text variant="titleSmall">
                              {trip.destination?.address?.split(',')[0] ?? destText}
                            </Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
                              <Text variant="caption" color={colors.onSurfaceVariant}>
                                {trip.departureTime
                                  ? new Date(trip.departureTime).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' })
                                  : 'Departing soon'}{' '}
                                · {trip.availableSeats ?? 3} seats left
                              </Text>
                              {hasEnRoute && (
                                <Pressable
                                  onPress={(e) => {
                                    e.stopPropagation?.();
                                    setEnRoutePickerTripId(trip.id ?? null);
                                  }}
                                  style={[styles.enRouteChip, selectedStop && styles.enRouteChipActive]}
                                >
                                  <Ionicons name="location" size={10} color={selectedStop ? colors.onPrimary : colors.primary} />
                                  <Text style={[styles.enRouteChipText, selectedStop && { color: colors.onPrimary }]}>
                                    {selectedStop ? selectedStop.name : 'En-route'}
                                  </Text>
                                </Pressable>
                              )}
                            </View>
                          </View>
                          <View style={styles.tripResultRight}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                              <Text variant="fareMedium" accessibilityLabel={`Fare ${formatCurrency(displayFare)}`}>
                                {formatCurrency(displayFare)}
                              </Text>
                              <Pressable
                                onPress={(e) => { e.stopPropagation?.(); setFareModalTrip(trip); }}
                                hitSlop={8}
                                accessibilityRole="button"
                                accessibilityLabel="View fare breakdown"
                              >
                                <Ionicons name="information-circle-outline" size={16} color={colors.onSurfaceVariant} />
                              </Pressable>
                            </View>
                            {selectedStop && (
                              <Text variant="caption" color={colors.onSurfaceVariant} style={{ textDecorationLine: 'line-through' }}>
                                {formatCurrency(fullFare)}
                              </Text>
                            )}
                            <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceVariant} />
                          </View>
                        </Pressable>

                        {/* En-route stop picker */}
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
                                  <Text variant="caption" color={colors.onSurfaceVariant}>
                                    {' '}vs {formatCurrency(fullFare)}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </MotiView>
                        )}
                      </>
                    );
                  })()}
                </MotiView>
              ))}
            </View>
          </MotiView>
        )}
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

function TierCard({
  tier,
  isSelected,
  onPress,
}: {
  tier: TripTier;
  isSelected: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const info = TIER_INFO[tier];
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={[styles.tierCard, animStyle]}>
      <Pressable
        onPress={() => {
          scale.value = withSequence(
            withSpring(0.95, { stiffness: 400, damping: 20 }),
            withSpring(1, { stiffness: 400, damping: 20 })
          );
          onPress();
        }}
        style={[
          styles.tierCardInner,
          isSelected && {
            borderColor: info.color,
            backgroundColor: info.color + '18',
            shadowColor: info.color,
            shadowOpacity: 0.25,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 4 },
            elevation: 4,
          },
        ]}
      >
        <Ionicons name={info.icon} size={26} color={info.color} />
        <Text variant="titleSmall" style={{ marginTop: spacing.sm }}>
          {info.label}
        </Text>
        <Text variant="caption" color={colors.onSurfaceVariant} style={{ textAlign: 'center', marginTop: 2 }}>
          {info.description}
        </Text>
        {isSelected && (
          <View style={[styles.tierCheckmark, { backgroundColor: info.color }]}>
            <Ionicons name="checkmark" size={10} color={colors.onPrimary} />
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.backgroundDeep },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.base,
  },
  scroll: {
    paddingHorizontal: spacing['2xl'],
    paddingBottom: spacing['3xl'],
    gap: spacing.xl,
  },
  routeCard: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.xl,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  routeConnector: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 5,
    height: 24,
  },
  routeConnectorLine: {
    width: 1,
    height: 24,
    backgroundColor: colors.outline,
    marginLeft: 1,
  },
  swapButton: {
    position: 'absolute',
    right: 0,
  },
  swapInner: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.outline,
  },
  dotOrigin: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
    flexShrink: 0,
  },
  dotDestination: {
    width: 12,
    height: 12,
    borderRadius: 3,
    backgroundColor: colors.secondary,
    flexShrink: 0,
  },
  dotStop: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.tertiary || '#FF9800',
    flexShrink: 0,
    marginLeft: 1,
  },
  addStopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    alignSelf: 'flex-start',
    borderRadius: radii.md,
    backgroundColor: colors.primary + '15',
  },
  rideOptionsRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  rideOptionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary + '15',
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.primary + '30',
  },
  routeInput: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodyLarge,
    color: colors.onSurface,
    paddingVertical: 0,
  },
  sectionLabel: {
    marginBottom: spacing.md,
  },
  tierGrid: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  tierCard: { flex: 1 },
  tierCardInner: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.xl,
    padding: spacing.md,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.outlineVariant,
    position: 'relative',
  },
  tierCheckmark: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchCta: {},
  heavyLoadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.xl,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  heavyLoadLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  heavyLoadBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.secondary + '12',
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.secondary + '30',
  },
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
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.xl,
    padding: spacing.base,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
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
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
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
