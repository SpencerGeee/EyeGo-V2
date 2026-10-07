import React, { useState, useMemo, useEffect } from 'react';
import { View, StyleSheet, Pressable, TextInput } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { fonts, radii } from '@eyego/config';
import { Text, Button, ListSection, ListRow, goDeeper, notify } from '@eyego/ui';
import { describeError } from '@eyego/utils';
import { driverApi, VEHICLE_TIERS, MIN_SEATER_COUNT, MAX_SEATER_COUNT } from '@eyego/api';
import type { DriverDocument, VehicleTier } from '@eyego/api';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useDriverStore } from '../../stores/driver.store';

const TOTAL_STEPS = 3;

// The two documents the go-online gate checks (drivers.service getDocuments).
const REQUIRED_DOCS: { label: string; type: DriverDocument['type']; icon: 'card-outline' | 'id-card-outline' }[] = [
  { label: "Driver's licence", type: 'DRIVERS_LICENSE', icon: 'card-outline' },
  { label: 'Ghana Card', type: 'GHANA_CARD', icon: 'id-card-outline' },
];

const TIER_LABEL: Record<VehicleTier, { name: string; hint: string }> = {
  ECO: { name: 'Eco', hint: 'Everyday cars' },
  COMFORT: { name: 'Comfort', hint: 'Newer, roomier' },
  PREMIUM: { name: 'Premium', hint: 'Top-end' },
};

/**
 * DRIVER SETUP — vehicle, documents, done.
 *
 * This wizard existed but no screen ever opened it: register went straight to
 * Home, and a new driver had no way to register a vehicle (submitVerification
 * creates the Vehicle row) or find where documents go. Register opens it now,
 * and Home's "Finish setting up" banner reopens it. It can be left and resumed:
 * a driver who already has a vehicle starts at documents.
 */
export default function OnboardingScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const qc = useQueryClient();
  const updateDriver = useDriverStore((s) => s.updateDriver);

  const me = useQuery({
    queryKey: ['driver', 'me'],
    queryFn: () => driverApi.getMe(),
    select: (r) => (r.data as any).data?.driver ?? (r.data as any).data,
  });
  const existing = me.data?.vehicles?.[0];

  const [step, setStep] = useState(1);
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [colour, setColour] = useState('');
  const [plate, setPlate] = useState('');
  const [seats, setSeats] = useState('');
  const [tier, setTier] = useState<VehicleTier | null>(null);
  const [prefilled, setPrefilled] = useState(false);

  // Resume: a driver with a vehicle on file starts at documents, fields filled.
  useEffect(() => {
    if (prefilled || !me.isSuccess) return;
    setPrefilled(true);
    if (!existing) return;
    setMake(existing.make ?? '');
    setModel(existing.model ?? '');
    setYear(existing.year ? String(existing.year) : '');
    setColour(existing.colour ?? '');
    setPlate(existing.plateNumber ?? '');
    setSeats(existing.seaterCount ? String(existing.seaterCount) : '');
    setTier((VEHICLE_TIERS as readonly string[]).includes(existing.tier) ? (existing.tier as VehicleTier) : null);
    setStep(2);
  }, [me.isSuccess, existing, prefilled]);

  const { mutate: registerVehicle, isPending } = useMutation({
    mutationFn: () =>
      driverApi.submitVerification({
        vehicle: {
          plateNumber: plate.trim(),
          make: make.trim(),
          model: model.trim(),
          year: parseInt(year, 10),
          seaterCount: parseInt(seats, 10),
          tier: tier as VehicleTier,
          colour: colour.trim(),
        },
      }),
    onSuccess: (res) => {
      const d = (res.data as any)?.data;
      const driver = d?.driver ?? d;
      if (driver?.vehicles) updateDriver({ vehicles: driver.vehicles } as any);
      qc.invalidateQueries({ queryKey: ['driver', 'me'] });
      setStep(2);
    },
    onError: (err) => {
      const { title, message } = describeError(err, 'Failed to save your vehicle. Please try again.');
      notify(title, message);
    },
  });

  const thisYear = new Date().getFullYear();
  const parsedYear = parseInt(year, 10);
  const parsedSeats = parseInt(seats, 10);
  const vehicleOk =
    !!make.trim() && !!model.trim() && !!colour.trim() && plate.trim().length >= 4 && !!tier &&
    parsedYear >= 1980 && parsedYear <= thisYear + 1 &&
    parsedSeats >= MIN_SEATER_COUNT && parsedSeats <= MAX_SEATER_COUNT;

  const docsQ = useQuery({
    queryKey: ['driver', 'documents'],
    queryFn: () => driverApi.getDocuments(),
    select: (r) => r.data.data ?? [],
    enabled: step >= 2,
  });
  // Back from the upload screen: show what was just sent.
  useFocusEffect(
    React.useCallback(() => {
      if (step === 2) docsQ.refetch();
    }, [step]), // eslint-disable-line react-hooks/exhaustive-deps
  );
  const docStatus = (type: DriverDocument['type']) => docsQ.data?.find((d) => d.type === type)?.status ?? 'MISSING';
  const allUploaded = REQUIRED_DOCS.every((d) => docStatus(d.type) !== 'MISSING' && docStatus(d.type) !== 'REJECTED');

  const leave = () => router.replace('/(tabs)/home');
  const back = () => (step > 1 ? setStep(step - 1) : router.canGoBack() ? router.back() : leave());

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.bar}>
        <Pressable onPress={back} hitSlop={8} style={styles.barBtn} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={styles.dots} accessibilityLabel={`Step ${step} of ${TOTAL_STEPS}`}>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <View key={i} style={[styles.dot, i < step && styles.dotOn, i === step - 1 && styles.dotNow]} />
          ))}
        </View>
        {step < 3 ? (
          <Pressable onPress={leave} hitSlop={8} style={styles.barBtn} accessibilityRole="button">
            <Text style={styles.skip}>Later</Text>
          </Pressable>
        ) : (
          <View style={styles.barBtn} />
        )}
      </View>

      <KeyboardAwareScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" bottomOffset={24} showsVerticalScrollIndicator={false}>
        {step === 1 && (
          <>
            <Text style={styles.title}>Your vehicle</Text>
            <Text style={styles.sub}>Riders find you at the kerb by these details.</Text>

            {[
              { label: 'Make', placeholder: 'Toyota', value: make, set: setMake, kb: 'default' as const, cap: 'words' as const },
              { label: 'Model', placeholder: 'Corolla', value: model, set: setModel, kb: 'default' as const, cap: 'words' as const },
              { label: 'Colour', placeholder: 'Silver', value: colour, set: setColour, kb: 'default' as const, cap: 'words' as const },
              { label: 'Plate number', placeholder: 'GR 1234-20', value: plate, set: (t: string) => setPlate(t.toUpperCase()), kb: 'default' as const, cap: 'characters' as const },
              { label: 'Year', placeholder: '2019', value: year, set: (t: string) => setYear(t.replace(/\D/g, '').slice(0, 4)), kb: 'number-pad' as const, cap: 'none' as const },
              { label: 'Passenger seats', placeholder: `${MIN_SEATER_COUNT}–${MAX_SEATER_COUNT}`, value: seats, set: (t: string) => setSeats(t.replace(/\D/g, '').slice(0, 2)), kb: 'number-pad' as const, cap: 'none' as const },
            ].map((f) => (
              <View key={f.label} style={styles.field}>
                <Text variant="labelCaps" style={styles.fieldLabel}>{f.label}</Text>
                <TextInput
                  maxFontSizeMultiplier={1.4}
                  style={styles.input}
                  value={f.value}
                  onChangeText={f.set}
                  placeholder={f.placeholder}
                  placeholderTextColor={colors.onSurfaceVariant}
                  keyboardType={f.kb}
                  autoCapitalize={f.cap}
                  autoCorrect={false}
                  accessibilityLabel={f.label}
                />
              </View>
            ))}

            {/* The tier prices the rider's fare and is what dispatch matches on. */}
            <Text variant="labelCaps" style={[styles.fieldLabel, { marginTop: 24 }]}>Vehicle class</Text>
            <View style={styles.tiers}>
              {VEHICLE_TIERS.map((t) => {
                const on = tier === t;
                return (
                  <Pressable
                    key={t}
                    onPress={() => setTier(t)}
                    style={[styles.tier, on && styles.tierOn]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.tierName, on && { color: colors.primary }]}>{TIER_LABEL[t].name}</Text>
                    <Text style={styles.tierHint}>{TIER_LABEL[t].hint}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Button label="Next" onPress={() => registerVehicle()} loading={isPending} disabled={!vehicleOk || isPending} style={{ marginTop: 28 }} />
            {year.length === 4 && !(parsedYear >= 1980 && parsedYear <= thisYear + 1) ? (
              <Text style={styles.err}>Enter a year between 1980 and {thisYear + 1}.</Text>
            ) : seats.length > 0 && !(parsedSeats >= MIN_SEATER_COUNT && parsedSeats <= MAX_SEATER_COUNT) ? (
              <Text style={styles.err}>Passenger seats must be {MIN_SEATER_COUNT}–{MAX_SEATER_COUNT}.</Text>
            ) : null}
          </>
        )}

        {step === 2 && (
          <>
            <Text style={styles.title}>Your documents</Text>
            <Text style={styles.sub}>Photograph each one clearly. We check them within 1–2 business days.</Text>
            <ListSection style={{ marginHorizontal: -20 }}>
              {REQUIRED_DOCS.map((d) => {
                const s = docStatus(d.type);
                const label = s === 'MISSING' ? 'Upload' : s === 'REJECTED' ? 'Re-upload' : s === 'VERIFIED' ? 'Verified' : 'In review';
                const tone = s === 'MISSING' || s === 'REJECTED' ? colors.error : s === 'VERIFIED' ? colors.statusSuccess : colors.statusWarning;
                return (
                  <ListRow
                    key={d.type}
                    icon={d.icon}
                    title={d.label}
                    value={label}
                    valueColor={tone}
                    onPress={() => goDeeper('/(profile)/documents')}
                  />
                );
              })}
            </ListSection>
            <Button label="Continue" onPress={() => setStep(3)} disabled={!allUploaded} style={{ marginTop: 28 }} />
          </>
        )}

        {step === 3 && (
          <View style={styles.done}>
            <View style={styles.doneIcon}>
              <Ionicons name="checkmark" size={40} color={colors.onPrimary} />
            </View>
            <Text style={[styles.title, { textAlign: 'center' }]}>You’re all set</Text>
            <Text style={[styles.sub, { textAlign: 'center' }]}>
              We’re reviewing your documents — usually 1–2 business days. We’ll send a notification the moment you can go online.
            </Text>
            <Button label="Go to Home" onPress={leave} style={{ alignSelf: 'stretch', marginTop: 12 }} />
          </View>
        )}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: DriverColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.background },
    bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, height: 52 },
    barBtn: { minWidth: 64, height: 44, alignItems: 'center', justifyContent: 'center' },
    skip: { fontFamily: fonts.semiBold, fontSize: 15, lineHeight: 20, color: c.onSurfaceVariant },
    dots: { flexDirection: 'row', gap: 6 },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.outlineVariant },
    dotOn: { backgroundColor: c.primary },
    dotNow: { width: 22 },
    scroll: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 48 },
    title: { fontFamily: fonts.displayBold, fontSize: 30, lineHeight: 36, letterSpacing: -0.6, color: c.onSurface },
    sub: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, color: c.onSurfaceVariant, marginTop: 6 },
    field: { marginTop: 18 },
    fieldLabel: { marginBottom: 8 },
    input: { fontFamily: fonts.medium, fontSize: 16, color: c.onSurface, backgroundColor: c.surfaceContainer, borderRadius: radii.lg, paddingHorizontal: 16, height: 52 },
    tiers: { flexDirection: 'row', gap: 8 },
    tier: { flex: 1, paddingVertical: 14, paddingHorizontal: 10, borderRadius: radii.lg, borderWidth: 1.5, borderColor: c.outlineVariant, backgroundColor: c.surfaceContainer },
    tierOn: { borderColor: c.primary },
    tierName: { fontFamily: fonts.semiBold, fontSize: 15, lineHeight: 20, color: c.onSurface },
    tierHint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: c.onSurfaceVariant, marginTop: 2 },
    err: { marginTop: 10, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: c.error, textAlign: 'center' },
    done: { alignItems: 'center', paddingTop: 48, gap: 8 },
    doneIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  });
