import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import DateTimePicker from '@react-native-community/datetimepicker';
import { driverApi } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button, Entrance, GlassSurface, GradientGlowBorder, AppBackground } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useDriverStore } from '../../stores/driver.store';
import { StepIndicator } from '../../components/StepIndicator';
import { haversineKm } from '../../utils/haversine';
import { consumePickedPlace } from '../../utils/placePickerResult';
import type { GeocodeResult } from '../../utils/geocoding';

const MAX_STEPS = 4;

const TIER_OPTIONS: {
  value: 'ECONOMY' | 'COMFORT' | 'PREMIUM';
  name: string;
  desc: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { value: 'ECONOMY', name: 'Economy', desc: 'Shared · best value', icon: 'car-outline' },
  { value: 'COMFORT', name: 'Comfort', desc: 'Higher fare', icon: 'car-sport-outline' },
  { value: 'PREMIUM', name: 'Premium', desc: 'Top fare · best vehicles', icon: 'diamond-outline' },
];

function formatCurrency(amount: number): string {
  return `₵${amount.toFixed(2)}`;
}

export default function CreateTripScreen() {
  const colors = useColors();
  const theme = useDriverStore(s => s.theme);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { setActiveTripId } = useDriverStore();

  const [step, setStep] = useState(1);
  // Ad-hoc pickup/destination — replaces the old fixed-route picker. The driver
  // sets an exact map location for each instead of choosing from a predefined route.
  const [origin, setOrigin] = useState<GeocodeResult | null>(null);
  const [destination, setDestination] = useState<GeocodeResult | null>(null);
  const [locatingOrigin, setLocatingOrigin] = useState(false);
  const pickingFieldRef = useRef<'origin' | 'destination' | null>(null);
  const [departureTime, setDepartureTime] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 30);
    return d;
  });
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [seats, setSeats] = useState(14);
  const [tier, setTier] = useState<'ECONOMY' | 'COMFORT' | 'PREMIUM'>('ECONOMY');

  // Default pickup to the driver's current GPS location — they're typically
  // standing right where they want to start the trip from. Still editable via
  // the map picker below for fine-tuning or a different spot.
  useEffect(() => {
    if (origin) return;
    let cancelled = false;
    (async () => {
      setLocatingOrigin(true);
      try {
        const Location = await import('expo-location');
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const { reverseGeocode } = await import('../../utils/geocoding');
        const place = await reverseGeocode(loc.coords.latitude, loc.coords.longitude);
        // BUGFIX: `if (origin) return;` above only guards the initial synchronous run —
        // this effect has a [] dep array so it never re-runs, meaning that guard can never
        // fire again. If the driver manually picked a pickup point (via the map picker)
        // while this GPS fix + reverse-geocode was still in flight (routinely 2-5s), this
        // unconditional setOrigin silently clobbered their manual choice. The functional
        // updater form reads the LATEST state at commit time, so a manual pick always wins.
        if (!cancelled) {
          setOrigin((prev) => prev ?? place ?? {
            placeId: 0,
            name: 'Current location',
            fullAddress: `${loc.coords.latitude.toFixed(5)}, ${loc.coords.longitude.toFixed(5)}`,
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          });
        }
      } catch { /* leave unset — driver picks manually */ }
      finally { if (!cancelled) setLocatingOrigin(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openLocationPicker = useCallback((field: 'origin' | 'destination') => {
    pickingFieldRef.current = field;
    router.push({
      pathname: '/(trip)/location-picker',
      params: { title: field === 'origin' ? 'Set Pickup Point' : 'Set Destination' },
    } as any);
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      const field = pickingFieldRef.current;
      if (!field) return;
      const picked = consumePickedPlace();
      if (!picked) return;
      pickingFieldRef.current = null;
      if (field === 'origin') setOrigin(picked);
      else setDestination(picked);
    }, [])
  );

  const distanceKm = useMemo(() => {
    if (!origin || !destination) return 0;
    return Math.max(haversineKm(origin.latitude, origin.longitude, destination.latitude, destination.longitude), 0.1);
  }, [origin, destination]);

  const { data: fareEstimateData } = useQuery({
    queryKey: ['driver', 'fare-estimate', distanceKm, seats, tier],
    queryFn: () => driverApi.getFareEstimate({ distanceKm, tier, availableSeats: seats }),
    enabled: distanceKm > 0 && step === 4,
    select: (r) => r.data?.data?.fareEstimate,
  });

  // The seats stepper was previously hardcoded to a 1-14 range regardless of the
  // driver's actual registered vehicle — a driver with e.g. an 8-seat vehicle could
  // select up to 10 seats, review a fare estimate computed for 10, publish, and have
  // the backend silently clamp maxSeats down to 8 with no error shown. Fetch the
  // vehicle's real capacity so the stepper can never suggest more than it can hold.
  const { data: maxVehicleSeats } = useQuery({
    queryKey: ['driver', 'me', 'seaterCount'],
    queryFn: () => driverApi.getMe(),
    select: (r) => {
      const d = (r.data as any).data?.driver ?? (r.data as any).data;
      const vehicle = d?.vehicles?.find((v: any) => v.isActive) ?? d?.vehicles?.[0];
      return vehicle?.seaterCount ?? 14;
    },
    staleTime: 60_000,
  });
  const seatCap = maxVehicleSeats ?? 14;

  useEffect(() => {
    if (seats > seatCap) setSeats(seatCap);
  }, [seatCap, seats]);

  const publishTrip = useMutation({
    mutationFn: () =>
      driverApi.createTrip({
        originLat: origin!.latitude,
        originLng: origin!.longitude,
        originName: origin!.name,
        destLat: destination!.latitude,
        destLng: destination!.longitude,
        destinationName: destination!.name,
        departureTime: departureTime.toISOString(),
        availableSeats: seats,
        tier,
      }),
    onSuccess: (res) => {
      const tripId = res.data.data.trip.id;
      setActiveTripId(tripId);
      // Without this, the Trips tab's ['driver','trips','all'] cache from
      // before publishing could still be showing when the driver navigates
      // there right after — the new trip wouldn't appear under Upcoming/Active.
      queryClient.invalidateQueries({ queryKey: ['driver', 'trips', 'all'] });
      queryClient.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
      router.replace(`/(trip)/active/${tripId}`);
    },
    onError: (err) => {
      const axiosErr = err as { response?: { data?: { code?: string; message?: string } } };
      const code = axiosErr.response?.data?.code;
      const message = axiosErr.response?.data?.message || (err as Error).message;
      if (code === 'NO_VEHICLE') {
        Alert.alert(
          'Vehicle Required',
          'You need to register a vehicle before publishing a trip.\n\nGo to Profile → Documents to add your vehicle details.',
          [
            { text: 'OK' },
            {
              text: 'Go to Profile',
              onPress: () => router.push('/(profile)/vehicle'),
            },
          ]
        );
      } else {
        Alert.alert('Error', message);
      }
    },
  });

  const canProceed = () => {
    if (step === 1) return !!origin && !!destination;
    if (step === 2) return departureTime > new Date();
    if (step === 3) return seats >= 1 && seats <= seatCap;
    return true;
  };

  const handleNext = () => {
    if (step < MAX_STEPS) setStep((s) => s + 1);
    else publishTrip.mutate();
  };

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground isDark={theme !== 'light'} />
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => (step > 1 ? setStep((s) => s - 1) : router.back())} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Create Trip</Text>
        <View style={{ width: 36 }} />
      </View>

      <StepIndicator currentStep={step} totalSteps={MAX_STEPS} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* STEP 1: Pickup + Destination — ad-hoc map locations, not a predefined route */}
        {step === 1 && (
          <Entrance key="step1" animation="slideRight">
            <Text style={styles.stepTitle}>Set Pickup & Destination</Text>
            <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.stepDesc}>
              Where are you starting from, and where's this trip headed?
            </Text>

            <Pressable style={styles.locationRow} onPress={() => openLocationPicker('origin')}>
              <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.xl} intensity="low" />
              <View style={[styles.locationDot, { backgroundColor: colors.onSurfaceVariant }]} />
              <View style={{ flex: 1 }}>
                <Text variant="caption" color={colors.onSurfaceVariant}>Pickup point</Text>
                <Text style={styles.locationValue} numberOfLines={1}>
                  {locatingOrigin && !origin ? 'Locating you…' : origin?.name ?? 'Set on map'}
                </Text>
              </View>
              <Ionicons name="map-outline" size={18} color={colors.primary} />
            </Pressable>

            <View style={styles.locationConnector} />

            <Pressable style={styles.locationRow} onPress={() => openLocationPicker('destination')}>
              <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.xl} intensity="low" />
              <View style={[styles.locationDot, { backgroundColor: colors.primary }]} />
              <View style={{ flex: 1 }}>
                <Text variant="caption" color={colors.onSurfaceVariant}>Destination</Text>
                <Text style={styles.locationValue} numberOfLines={1}>
                  {destination?.name ?? 'Search or pick on map'}
                </Text>
              </View>
              <Ionicons name="map-outline" size={18} color={colors.primary} />
            </Pressable>

            {origin && destination && (
              <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ marginTop: spacing.md, textAlign: 'center' }}>
                {distanceKm.toFixed(1)} km · ~{Math.round(distanceKm / 40 * 60)} min
              </Text>
            )}
          </Entrance>
        )}

        {/* STEP 2: Departure time */}
        {step === 2 && (
          <Entrance key="step2" animation="slideRight">
            <Text style={styles.stepTitle}>Departure Time</Text>
            <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.stepDesc}>
              When does this trip depart?
            </Text>
            <Pressable
              style={styles.timeCard}
              onPress={() => {
                if (Platform.OS === 'android') setShowTimePicker(true);
              }}
            >
              <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.xl} intensity="low" />
              <Ionicons name="time-outline" size={24} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text variant="caption" color={colors.onSurfaceVariant}>Departure time</Text>
                <Text style={styles.timeDisplay}>
                  {departureTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceVariant} />
            </Pressable>

            {/* Android: time-only spinner (inline — no modal dismiss race condition) */}
            {Platform.OS === 'android' && showTimePicker && (
              <DateTimePicker
                value={departureTime}
                mode="time"
                display="spinner"
                onChange={(event, date) => {
                  if (event.type === 'dismissed' || event.type === 'set') {
                    setShowTimePicker(false);
                  }
                  if (date) {
                    const updated = new Date(departureTime);
                    updated.setHours(date.getHours(), date.getMinutes(), 0, 0);
                    setDepartureTime(updated);
                  }
                }}
                style={{ backgroundColor: colors.surfaceContainer }}
              />
            )}

            {/* iOS: time-only spinner (renders inline) */}
            {Platform.OS === 'ios' && (
              <DateTimePicker
                value={departureTime}
                mode="time"
                minimumDate={new Date()}
                display="spinner"
                onChange={(_, date) => {
                  if (date) {
                    const updated = new Date(departureTime);
                    updated.setHours(date.getHours(), date.getMinutes(), 0, 0);
                    setDepartureTime(updated);
                  }
                }}
                style={{ backgroundColor: colors.surfaceContainer }}
              />
            )}
          </Entrance>
        )}

        {/* STEP 3: Seats */}
        {step === 3 && (
          <Entrance key="step3" animation="slideRight">
            <Text style={styles.stepTitle}>Available Seats</Text>
            <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.stepDesc}>
              How many passenger seats are available? (your vehicle seats {seatCap})
            </Text>
            <View style={styles.seatsCard}>
              <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii['2xl']} intensity="low" />
              <Pressable
                style={[styles.seatsBtn, seats <= 1 && styles.seatsBtnDisabled]}
                onPress={() => setSeats((s) => Math.max(1, s - 1))}
                disabled={seats <= 1}
              >
                <Ionicons name="remove" size={24} color={seats <= 1 ? colors.onSurfaceVariant : colors.onSurface} />
              </Pressable>
              <View style={styles.seatsValue}>
                <Text style={styles.seatsNumber}>{seats}</Text>
                <Text variant="caption" color={colors.onSurfaceVariant}>seats</Text>
              </View>
              <Pressable
                style={[styles.seatsBtn, seats >= seatCap && styles.seatsBtnDisabled]}
                onPress={() => setSeats((s) => Math.min(seatCap, s + 1))}
                disabled={seats >= seatCap}
              >
                <Ionicons name="add" size={24} color={seats >= seatCap ? colors.onSurfaceVariant : colors.onSurface} />
              </Pressable>
            </View>
            {/* Mini seat grid preview */}
            <View style={styles.seatPreview}>
              {Array.from({ length: seatCap }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.seatDot,
                    { backgroundColor: i < seats ? `${colors.primary}60` : colors.surfaceContainerHighest },
                  ]}
                />
              ))}
            </View>
          </Entrance>
        )}

        {/* STEP 4: Summary */}
        {step === 4 && origin && destination && (
          <Entrance key="step4" animation="slideRight">
            <Text style={styles.stepTitle}>Review & Publish</Text>
            <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.stepDesc}>
              Confirm your trip details before publishing.
            </Text>
            <GradientGlowBorder
              palette="driver"
              fillColor={colors.surfaceContainerHigh}
              borderRadius={radii['2xl']}
              glow
              style={styles.summaryCard}
            >
              <View style={styles.summaryGlow} />
              <SummaryRow icon="navigate" label="Route" value={`${origin.name} → ${destination.name}`} colors={colors} />
              <View style={styles.summaryDivider} />
              <SummaryRow icon="time" label="Departure" value={`${departureTime.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} at ${departureTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`} colors={colors} />
              <View style={styles.summaryDivider} />
              <SummaryRow icon="people" label="Seats" value={`${seats} available`} colors={colors} />
              <View style={styles.summaryDivider} />
              <SummaryRow icon="speedometer" label="Distance" value={`${distanceKm.toFixed(1)} km · ~${Math.round(distanceKm / 40 * 60)} min`} colors={colors} />
            </GradientGlowBorder>

            {/* Service tier — sets pricing band; ECONOMY is the shared/pooled
                default, COMFORT is the premium band riders pay a surcharge for. */}
            <Text style={styles.tierLabel}>Service Tier</Text>
            <View style={styles.tierRow}>
              {TIER_OPTIONS.map((opt) => {
                const active = tier === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    style={[styles.tierCard, active && styles.tierCardActive]}
                    onPress={() => setTier(opt.value)}
                  >
                    <View style={[styles.tierIconWrap, active && { backgroundColor: `${colors.primary}22` }]}>
                      <Ionicons
                        name={opt.icon}
                        size={20}
                        color={active ? colors.primary : colors.onSurfaceVariant}
                      />
                    </View>
                    <Text style={[styles.tierName, active && { color: colors.primary }]}>{opt.name}</Text>
                    <Text variant="caption" color={colors.onSurfaceVariant} style={styles.tierDesc}>
                      {opt.desc}
                    </Text>
                    {active && (
                      <View style={styles.tierCheck}>
                        <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>

            {/* Fare Estimate — fetched from backend so it matches what riders see */}
            {fareEstimateData ? (
              <View style={styles.fareCard}>
                <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii['2xl']} intensity="low" />
                <View style={styles.fareHeader}>
                  <Ionicons name="cash-outline" size={18} color={colors.primary} />
                  <Text style={styles.fareTitle}>Fare Estimate ({tier})</Text>
                </View>
                <View style={styles.fareDivider} />
                <FareRow
                  label="Per passenger"
                  value={formatCurrency(fareEstimateData.farePerPerson)}
                  sub={`at ~${seats} passengers`}
                  colors={colors}
                />
                <View style={styles.fareRowDivider} />
                <FareRow
                  label="Total trip cost"
                  value={formatCurrency(fareEstimateData.totalTripCost)}
                  colors={colors}
                />
                <View style={styles.fareRowDivider} />
                <FareRow
                  label="Your earnings per seat"
                  value={formatCurrency(fareEstimateData.driverEarningsPerSeat)}
                  sub="after 15% commission"
                  valueColor="#22C55E"
                  colors={colors}
                />
                <View style={styles.fareNote}>
                  <Ionicons name="information-circle-outline" size={12} color={colors.onSurfaceVariant} />
                  <Text variant="caption" color={colors.onSurfaceVariant}>
                    Actual fare varies by occupancy and surge pricing
                  </Text>
                </View>
              </View>
            ) : null}
          </Entrance>
        )}
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <Button
          label={step === MAX_STEPS ? 'Publish Trip' : 'Continue'}
          onPress={handleNext}
          disabled={!canProceed()}
          loading={publishTrip.isPending}
        />
      </View>
    </SafeAreaView>
  );
}

function FareRow({ label, value, sub, valueColor, colors }: {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
  colors: DriverColors;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: fonts.medium, fontSize: fontSizes.bodySmall, color: colors.onSurface }}>
          {label}
        </Text>
        {sub ? (
          <Text variant="caption" color={colors.onSurfaceVariant}>{sub}</Text>
        ) : null}
      </View>
      <Text style={{
        fontFamily: fonts.displaySemiBold,
        fontSize: fontSizes.titleSmall,
        color: valueColor ?? colors.primary,
      }}>
        {value}
      </Text>
    </View>
  );
}

function SummaryRow({ icon, label, value, colors }: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  colors: DriverColors;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.md }}>
      <View style={{
        width: 36, height: 36, borderRadius: 12,
        backgroundColor: `${colors.primary}22`,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Ionicons name={icon} size={16} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="caption" color={colors.onSurfaceVariant}>{label}</Text>
        <Text style={{ fontFamily: fonts.medium, fontSize: fontSizes.bodyMedium, color: colors.onSurface, marginTop: 2 }}>
          {value}
        </Text>
      </View>
    </View>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.xl,
      paddingBottom: spacing.md,
    },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 12,
      backgroundColor: colors.surfaceContainer,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      fontFamily: fonts.displaySemiBold,
      fontSize: fontSizes.titleSmall,
      lineHeight: Math.round(fontSizes.titleSmall * 1.3),
      color: colors.onSurface,
    },
    scroll: {
      paddingHorizontal: spacing['2xl'],
      paddingBottom: 100,
    },
    stepTitle: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.headlineMedium,
      lineHeight: Math.round(fontSizes.headlineMedium * 1.3),
      color: colors.onSurface,
      letterSpacing: -0.5,
      marginTop: spacing.xl,
      marginBottom: spacing.xs,
    },
    stepDesc: { marginBottom: spacing.xl, lineHeight: 22 },
    locationRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      borderRadius: radii.xl,
      padding: spacing.base,
      overflow: 'hidden',
    },
    locationDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
    },
    locationValue: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
      color: colors.onSurface,
      marginTop: 2,
    },
    locationConnector: {
      width: 2,
      height: 16,
      marginLeft: spacing.base + 5,
      backgroundColor: colors.outline,
    },
    timeCard: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: radii.xl,
      padding: spacing.xl,
      gap: spacing.md,
      overflow: 'hidden',
    },
    timeDisplay: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.display,
      lineHeight: Math.round(fontSizes.display * 1.3),
      color: colors.onSurface,
      letterSpacing: -1,
      marginVertical: 2,
    },
    seatsCard: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii['2xl'],
      padding: spacing.xl,
      gap: spacing['3xl'],
      marginBottom: spacing.xl,
      overflow: 'hidden',
    },
    seatsBtn: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: colors.surfaceContainerHighest,
      borderWidth: 1,
      borderColor: colors.outline,
      alignItems: 'center',
      justifyContent: 'center',
    },
    seatsBtnDisabled: { opacity: 0.4 },
    seatsValue: { alignItems: 'center', minWidth: 60 },
    seatsNumber: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.hero,
      color: colors.primary,
      lineHeight: fontSizes.hero * 1.1,
    },
    seatPreview: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      justifyContent: 'center',
    },
    seatDot: {
      width: 28,
      height: 28,
      borderRadius: 8,
    },
    summaryCard: {
      paddingHorizontal: spacing.xl,
    },
    summaryGlow: {
      position: 'absolute',
      width: 180,
      height: 180,
      borderRadius: 90,
      backgroundColor: colors.primary,
      opacity: 0.06,
      top: -40,
      right: -40,
    },
    summaryDivider: { height: 1, backgroundColor: colors.outlineVariant },
    tierLabel: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.3),
      color: colors.onSurface,
      marginTop: spacing.xl,
      marginBottom: spacing.md,
    },
    tierRow: { flexDirection: 'row', gap: spacing.md },
    tierCard: {
      flex: 1,
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      borderWidth: 1.5,
      borderColor: colors.outline,
      padding: spacing.base,
      gap: 6,
    },
    tierCardActive: {
      borderColor: colors.primary,
      backgroundColor: `${colors.primary}12`,
    },
    tierIconWrap: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: colors.surfaceContainerHighest,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 2,
    },
    tierName: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.3),
      color: colors.onSurface,
    },
    tierDesc: { lineHeight: 16 },
    tierCheck: { position: 'absolute', top: spacing.base, right: spacing.base },
    fareCard: {
      marginTop: spacing.xl,
      borderRadius: radii['2xl'],
      padding: spacing.base,
      overflow: 'hidden',
    },
    fareHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.xs,
    },
    fareTitle: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.3),
      color: colors.primary,
    },
    fareDivider: { height: 1, backgroundColor: `${colors.primary}22`, marginVertical: spacing.sm },
    fareRowDivider: { height: 1, backgroundColor: colors.outlineVariant },
    fareNote: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      marginTop: spacing.sm,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.outlineVariant,
    },
    footer: {
      paddingHorizontal: spacing['2xl'],
      paddingBottom: spacing['2xl'],
      paddingTop: spacing.md,
    },
  });
