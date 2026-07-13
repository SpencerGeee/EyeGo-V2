import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Platform,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import DateTimePicker from '@react-native-community/datetimepicker';
import { driverApi, routesApi } from '@eyego/api';
import type { Route } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button, Entrance, GlassSurface, GradientGlowBorder, AppBackground } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useDriverStore } from '../../stores/driver.store';
import { StepIndicator } from '../../components/StepIndicator';

const MAX_STEPS = 4;

const TIER_OPTIONS: {
  value: 'ECONOMY' | 'COMFORT';
  name: string;
  desc: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { value: 'ECONOMY', name: 'Economy', desc: 'Shared · best value', icon: 'car-outline' },
  { value: 'COMFORT', name: 'Comfort', desc: 'Premium · higher fare', icon: 'car-sport-outline' },
];

function formatCurrency(amount: number): string {
  return `₵${amount.toFixed(2)}`;
}

export default function CreateTripScreen() {
  const colors = useColors();
  const theme = useDriverStore(s => s.theme);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { setActiveTripId } = useDriverStore();

  const [step, setStep] = useState(1);
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);
  const [departureTime, setDepartureTime] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 30);
    return d;
  });
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [seats, setSeats] = useState(14);
  const [tier, setTier] = useState<'ECONOMY' | 'COMFORT'>('ECONOMY');
  const [routeSearch, setRouteSearch] = useState('');

  const { data: fareEstimateData } = useQuery({
    queryKey: ['driver', 'fare-estimate', selectedRoute?.distanceKm, seats, tier],
    queryFn: () => driverApi.getFareEstimate({ distanceKm: selectedRoute!.distanceKm, tier, availableSeats: seats }),
    enabled: !!selectedRoute && step === 4,
    select: (r) => r.data?.data?.fareEstimate,
  });

  const { data: routes } = useQuery({
    queryKey: ['routes'],
    queryFn: () => routesApi.getAll(),
    select: (r) => {
      const data = (r.data as any)?.data;
      // Backend wraps routes in { routes: [...] }
      return data?.routes ?? data ?? [];
    },
  });

  const filteredRoutes = useMemo(() => {
    const all = Array.isArray(routes) ? routes : [];
    if (!routeSearch.trim()) return all;
    const q = routeSearch.toLowerCase();
    return all.filter(
      (r: Route) =>
        r.originName.toLowerCase().includes(q) || r.destinationName.toLowerCase().includes(q)
    );
  }, [routes, routeSearch]);

  const publishTrip = useMutation({
    mutationFn: () =>
      driverApi.createTrip({
        routeId: selectedRoute!.id,
        departureTime: departureTime.toISOString(),
        availableSeats: seats,
        tier,
      }),
    onSuccess: (res) => {
      const tripId = res.data.data.trip.id;
      setActiveTripId(tripId);
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
    if (step === 1) return !!selectedRoute;
    if (step === 2) return departureTime > new Date();
    if (step === 3) return seats >= 1 && seats <= 14;
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
        {/* STEP 1: Route */}
        {step === 1 && (
          <Entrance key="step1" animation="slideRight">
            <Text style={styles.stepTitle}>Choose a Route</Text>
            <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.stepDesc}>
              Select the route for this trip.
            </Text>
            {/* Simple search field */}
            <View style={styles.searchBox}>
              <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.lg} intensity="low" />
              <Ionicons name="search" size={16} color={colors.onSurfaceVariant} />
              <TextInput
                value={routeSearch}
                onChangeText={setRouteSearch}
                placeholder="Search routes…"
                placeholderTextColor={colors.onSurfaceVariant}
                style={{ flex: 1, fontFamily: fonts.regular, fontSize: fontSizes.bodyMedium, color: colors.onSurface, paddingVertical: 0 }}
              />
            </View>
            <View style={styles.routeList}>
              {(filteredRoutes as Route[]).map((route) => (
                <Pressable
                  key={route.id}
                  style={[
                    styles.routeCard,
                    selectedRoute?.id === route.id && styles.routeCardSelected,
                  ]}
                  onPress={() => setSelectedRoute(route)}

                >
                  <View style={styles.routeCardInner}>
                    <View style={styles.routeOriginDot} />
                    <View style={styles.routeLine} />
                    <View style={[styles.routeOriginDot, { backgroundColor: colors.primary }]} />
                  </View>
                  <View style={styles.routeInfo}>
                    <Text style={styles.routeOrigin}>{route.originName}</Text>
                    <Text variant="caption" color={colors.onSurfaceVariant}>
                      ~{Math.round(route.distanceKm / 40 * 60)} min · {route.distanceKm} km
                    </Text>
                    <Text style={styles.routeDest}>{route.destinationName}</Text>
                  </View>
                  {selectedRoute?.id === route.id && (
                    <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                  )}
                </Pressable>
              ))}
              {(filteredRoutes as Route[]).length === 0 && (
                <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ textAlign: 'center', padding: spacing.xl }}>
                  No routes found.
                </Text>
              )}
            </View>
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
              How many passenger seats are available?
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
                style={[styles.seatsBtn, seats >= 14 && styles.seatsBtnDisabled]}
                onPress={() => setSeats((s) => Math.min(14, s + 1))}
                disabled={seats >= 14}
              >
                <Ionicons name="add" size={24} color={seats >= 14 ? colors.onSurfaceVariant : colors.onSurface} />
              </Pressable>
            </View>
            {/* Mini seat grid preview */}
            <View style={styles.seatPreview}>
              {Array.from({ length: 14 }).map((_, i) => (
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
        {step === 4 && selectedRoute && (
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
              <SummaryRow icon="navigate" label="Route" value={`${selectedRoute.originName} → ${selectedRoute.destinationName}`} colors={colors} />
              <View style={styles.summaryDivider} />
              <SummaryRow icon="time" label="Departure" value={`${departureTime.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} at ${departureTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`} colors={colors} />
              <View style={styles.summaryDivider} />
              <SummaryRow icon="people" label="Seats" value={`${seats} available`} colors={colors} />
              <View style={styles.summaryDivider} />
              <SummaryRow icon="speedometer" label="Distance" value={`${selectedRoute.distanceKm} km · ~${Math.round(selectedRoute.distanceKm / 40 * 60)} min`} colors={colors} />
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
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      borderRadius: radii.lg,
      padding: spacing.base,
      marginBottom: spacing.md,
      overflow: 'hidden',
    },
    routeList: { gap: spacing.md },
    routeCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      borderWidth: 1.5,
      borderColor: colors.outline,
      padding: spacing.base,
      gap: spacing.md,
    },
    routeCardSelected: {
      borderColor: colors.primary,
      backgroundColor: `${colors.primary}12`,
    },
    routeCardInner: {
      alignItems: 'center',
      gap: 4,
      paddingVertical: 4,
    },
    routeOriginDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.onSurfaceVariant,
    },
    routeLine: {
      width: 2,
      height: 24,
      backgroundColor: colors.outline,
      borderRadius: 1,
    },
    routeInfo: { flex: 1 },
    routeOrigin: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
      color: colors.onSurface,
    },
    routeDest: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
      color: colors.primary,
      marginTop: 2,
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
