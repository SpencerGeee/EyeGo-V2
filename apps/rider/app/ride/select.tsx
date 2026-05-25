import React, { useState, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  FlatList,
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
import { Text, Button, Toggle, Skeleton } from '@eyego/ui';
import { formatCurrency, formatDuration } from '@eyego/utils';
import type { TripTier, Trip } from '@eyego/types';

const TIER_INFO: Record<TripTier, { icon: string; label: string; description: string; color: string }> = {
  ECONOMY: { icon: '🚐', label: 'Economy', description: 'Shared, budget-friendly ride', color: '#4BE277' },
  COMFORT: { icon: '🚌', label: 'Comfort', description: 'More space, AC, fewer stops', color: '#7DD8F5' },
  PREMIUM: { icon: '🚙', label: 'Premium', description: 'Private-feel, premium vehicle', color: '#ffb5ab' },
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
  const [detourWarning, setDetourWarning] = useState<string | null>(null);

  const validateStops = (currentStops: typeof stops) => {
    const oLat = origin?.latitude ?? 5.6037;
    const oLng = origin?.longitude ?? -0.187;
    const dLat = destination?.latitude ?? 5.65;
    const dLng = destination?.longitude ?? -0.19;

    let hasWarning = false;
    for (const stop of currentStops) {
      if (!stop.text.trim()) continue;
      
      // Mock coordinates based on text
      const coords = stop.text.toLowerCase().includes('far') 
        ? { lat: oLat + 0.05, lng: oLng + 0.05 } 
        : { lat: oLat + (dLat - oLat) * 0.5, lng: oLng + (dLng - oLng) * 0.5 + 0.001 };

      // Calculate distance to segment
      const l2 = (dLat - oLat) ** 2 + (dLng - oLng) ** 2;
      let dist = 0;
      if (l2 === 0) {
        dist = Math.sqrt((coords.lat - oLat) ** 2 + (coords.lng - oLng) ** 2);
      } else {
        let t = ((coords.lat - oLat) * (dLat - oLat) + (coords.lng - oLng) * (dLng - oLng)) / l2;
        t = Math.max(0, Math.min(1, t));
        const proj = { lat: oLat + t * (dLat - oLat), lng: oLng + t * (dLng - oLng) };
        dist = Math.sqrt((coords.lat - proj.lat) ** 2 + (coords.lng - proj.lng) ** 2);
      }

      // 1 degree is approx 111km. 1.5km is approx 0.0135 degrees.
      if (dist > 0.0135) {
        hasWarning = true;
        break;
      }
    }
    
    if (hasWarning) {
      setDetourWarning("One of your stops is too far from the main route (exceeds 1.5km detour). This may incur additional charges or be rejected by drivers.");
    } else {
      setDetourWarning(null);
    }
  };

  const addStop = () => {
    setStops([...stops, { id: Math.random().toString(), text: '' }]);
  };

  const updateStop = (id: string, text: string) => {
    const newStops = stops.map(s => s.id === id ? { ...s, text } : s);
    setStops(newStops);
    validateStops(newStops);
  };

  const removeStop = (id: string) => {
    const newStops = stops.filter(s => s.id !== id);
    setStops(newStops);
    validateStops(newStops);
  };

  const { data: routesData, isLoading: routesLoading } = useQuery({
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
      const realTrips = data?.data?.trips ?? data?.data ?? [];
      if (Array.isArray(realTrips) && realTrips.length > 0) {
        setTrips(realTrips);
      } else {
        // Local fallback: map mock trips with selected tier and premium styling
        const fallback = MOCK_TRIPS.map(t => ({
          ...t,
          tier: selectedTier,
          fare: selectedTier === 'COMFORT' ? 15.0 : 8.5
        }));
        setTrips(fallback as unknown as Trip[]);
      }
      setSearched(true);
    },
    onError: () => {
      // Show mock data in development
      const fallback = MOCK_TRIPS.map(t => ({
        ...t,
        tier: selectedTier,
        fare: selectedTier === 'COMFORT' ? 15.0 : 8.5
      }));
      setTrips(fallback as unknown as Trip[]);
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

        {/* Detour warning */}
        <AnimatePresence>
          {detourWarning && (
            <MotiView
              from={{ opacity: 0, translateY: -6, scale: 0.98 }}
              animate={{ opacity: 1, translateY: 0, scale: 1 }}
              exit={{ opacity: 0, translateY: -6, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 600, damping: 34 }}
              style={[styles.heavyLoadBanner, { backgroundColor: colors.error + '12', borderColor: colors.error + '30' }]}
            >
              <Ionicons name="warning-outline" size={16} color={colors.error} />
              <Text variant="caption" color={colors.error} style={{ flex: 1 }}>
                {detourWarning}
              </Text>
            </MotiView>
          )}
        </AnimatePresence>

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
        {searched && (
          <MotiView
            from={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ type: 'timing', duration: 300 }}
          >
            <Text variant="titleSmall" style={styles.sectionLabel}>
              {trips.length} ride{trips.length !== 1 ? 's' : ''} available
            </Text>
            <View style={styles.resultsList}>
              {trips.map((trip, i) => (
                <MotiView
                  key={(trip as any).id ?? i}
                  from={{ opacity: 0, translateY: 10 }}
                  animate={{ opacity: 1, translateY: 0 }}
                  transition={{ type: 'spring', stiffness: 600, damping: 34, delay: i * 40 }}
                >
                  <Pressable
                    style={styles.tripResultCard}
                    onPress={() => router.push(`/ride/${(trip as any).id}` as any)}
                  >
                    <View style={styles.tripResultLeft}>
                      <Text variant="titleSmall">
                        {(trip as any).origin?.address?.split(',')[0] ?? originText}
                      </Text>
                      <View style={styles.routeArrowRow}>
                        <View style={styles.routeArrowLine} />
                        <Ionicons name="arrow-forward" size={10} color={colors.onSurfaceVariant} />
                      </View>
                      <Text variant="titleSmall">
                        {(trip as any).destination?.address?.split(',')[0] ?? destText}
                      </Text>
                      <Text variant="caption" color={colors.onSurfaceVariant}>
                        {(trip as any).departureTime
                          ? new Date((trip as any).departureTime).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' })
                          : 'Departing soon'}{' '}
                        · {(trip as any).availableSeats ?? 3} seats left
                      </Text>
                    </View>
                    <View style={styles.tripResultRight}>
                      <Text variant="fareMedium">
                        {formatCurrency((trip as any).fare ?? 8.5)}
                      </Text>
                      <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceVariant} />
                    </View>
                  </Pressable>
                </MotiView>
              ))}
            </View>
          </MotiView>
        )}
      </ScrollView>
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
        <Text style={{ fontSize: 28 }}>{info.icon}</Text>
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

const MOCK_TRIPS = [
  { id: '1', origin: { address: 'Accra Mall, Spintex' }, destination: { address: 'University of Ghana, Legon' }, fare: 8.5, availableSeats: 3, departureTime: new Date(Date.now() + 10 * 60000).toISOString() },
  { id: '2', origin: { address: 'Accra Mall, Spintex' }, destination: { address: 'University of Ghana, Legon' }, fare: 7.0, availableSeats: 5, departureTime: new Date(Date.now() + 25 * 60000).toISOString() },
];

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
});
