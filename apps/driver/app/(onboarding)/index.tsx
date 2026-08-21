import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii, springs } from '@eyego/config';
import { Text, Button } from '@eyego/ui';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useDriverStore } from '../../stores/driver.store';
import { driverApi, VEHICLE_TIERS, MIN_SEATER_COUNT, MAX_SEATER_COUNT } from '@eyego/api';
import type { DriverDocument, VehicleTier } from '@eyego/api';
import { useFocusEffect } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';

const TOTAL_STEPS = 3;

// Matches the document types the backend actually tracks/verifies
// (drivers.service.js getDocuments/uploadDocument) — vehicle registration,
// insurance and roadworthy certs are not modeled on the backend yet, so they
// aren't listed as gating requirements here.
const REQUIRED_DOCS: { label: string; type: DriverDocument['type'] }[] = [
  { label: "Driver's Licence", type: 'DRIVERS_LICENSE' },
  { label: 'Ghana Card / National ID', type: 'GHANA_CARD' },
];

function ProgressDots({ step, colors }: { step: number; colors: DriverColors }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center', marginBottom: spacing['2xl'] }}>
      {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
        <View
          key={i}
          style={{
            width: i === step - 1 ? 24 : 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: i < step ? colors.primary : colors.outlineVariant,
          }}
        />
      ))}
    </View>
  );
}

export default function OnboardingScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();

  const [step, setStep] = useState(1);

  // Step 1 fields
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [colour, setColour] = useState('');
  const [plate, setPlate] = useState('');
  const [seats, setSeats] = useState('');
  const [tier, setTier] = useState<VehicleTier | null>(null);

  /**
   * Registers the vehicle for real.
   *
   * This used to PATCH the vehicle fields onto `/driver/me`, where the server's
   * allow-list dropped every one of them and answered 200 anyway — so the driver
   * finished onboarding, got approved, went online, and then could not accept a
   * single trip because no `Vehicle` row had ever been created for them.
   * `submitVerification` is the endpoint that creates it, and it is re-runnable,
   * so backing out of this step and coming back is safe.
   */
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
    onSuccess: () => setStep(2),
    onError: (err: any) =>
      Alert.alert(
        'Could not save vehicle',
        err?.response?.data?.message ?? err?.message ?? 'Failed to save vehicle info. Please try again.',
      ),
  });

  const handleStep1Next = () => {
    if (!make || !model || !year || !colour || !plate || !seats || !tier) {
      Alert.alert('Missing fields', 'Please fill in all vehicle details, including seats and vehicle class.');
      return;
    }
    const parsedYear = parseInt(year, 10);
    const thisYear = new Date().getFullYear();
    if (!Number.isFinite(parsedYear) || parsedYear < 1980 || parsedYear > thisYear + 1) {
      Alert.alert('Check the year', `Enter a year between 1980 and ${thisYear + 1}.`);
      return;
    }
    const parsedSeats = parseInt(seats, 10);
    if (!Number.isFinite(parsedSeats) || parsedSeats < MIN_SEATER_COUNT || parsedSeats > MAX_SEATER_COUNT) {
      Alert.alert(
        'Check the seat count',
        `Enter how many passenger seats the vehicle has — between ${MIN_SEATER_COUNT} and ${MAX_SEATER_COUNT}.`,
      );
      return;
    }
    registerVehicle();
  };

  // Step 2: refetch on focus so returning from the upload screen reflects
  // what was just submitted.
  const { data: documents, refetch: refetchDocuments } = useQuery({
    queryKey: ['driver', 'documents'],
    queryFn: () => driverApi.getDocuments(),
    select: (r) => r.data.data ?? [],
    enabled: step === 2,
  });
  useFocusEffect(
    React.useCallback(() => {
      if (step === 2) refetchDocuments();
    }, [step, refetchDocuments])
  );

  const isDocUploaded = (type: DriverDocument['type']) =>
    documents?.some((d) => d.type === type && d.status !== 'MISSING') ?? false;
  const allRequiredDocsUploaded = REQUIRED_DOCS.every((doc) => isDocUploaded(doc.type));

  const handleStep2Continue = () => {
    if (!allRequiredDocsUploaded) {
      Alert.alert('Documents required', 'Please upload all required documents before continuing.');
      return;
    }
    setStep(3);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <MotiView
            from={{ opacity: 0, translateY: -6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', ...springs.standard }}
          >
            <ProgressDots step={step} colors={colors} />
          </MotiView>

          {/* STEP 1: Vehicle Info */}
          {step === 1 && (
            <MotiView
              key="step1"
              from={{ opacity: 0, translateY: 12 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'spring', ...springs.standard, delay: 40 }}
            >
              <Text variant="headlineLarge" style={styles.headline}>Vehicle Info</Text>
              <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ marginBottom: spacing.xl }}>
                Tell us about the vehicle you'll be driving.
              </Text>

              <View style={styles.card}>
                {[
                  { label: 'Make', placeholder: 'e.g. Toyota', value: make, setter: setMake, numeric: false },
                  { label: 'Model', placeholder: 'e.g. Corolla', value: model, setter: setModel, numeric: false },
                  { label: 'Year', placeholder: 'e.g. 2020', value: year, setter: setYear, numeric: true },
                  { label: 'Colour', placeholder: 'e.g. Silver', value: colour, setter: setColour, numeric: false },
                  { label: 'Plate Number', placeholder: 'e.g. GR-1234-20', value: plate, setter: setPlate, numeric: false },
                  { label: 'Passenger Seats', placeholder: `e.g. 4`, value: seats, setter: setSeats, numeric: true },
                ].map(({ label, placeholder, value, setter, numeric }, idx, arr) => (
                  <View key={label} style={[styles.fieldRow, idx === arr.length - 1 && { borderBottomWidth: 0 }]}>
                    <Text variant="labelMedium" color={colors.onSurfaceVariant} style={styles.fieldLabel}>{label}</Text>
                    <TextInput
                      style={styles.input}
                      value={value}
                      onChangeText={setter}
                      placeholder={placeholder}
                      placeholderTextColor={colors.onSurfaceVariant}
                      keyboardType={numeric ? 'numeric' : 'default'}
                      maxLength={numeric ? 4 : undefined}
                    />
                  </View>
                ))}
              </View>

              {/*
                THE TIER IS NOT COSMETIC. It is what the rider's fare is priced
                against and what dispatch tier-matches on, so it has to be
                collected here rather than assumed — a driver with no tier is
                filtered out of every tier-matched offer.
              */}
              <Text variant="labelMedium" color={colors.onSurfaceVariant} style={{ marginBottom: spacing.sm }}>
                Vehicle Class
              </Text>
              <View style={styles.tierRow}>
                {VEHICLE_TIERS.map((t) => {
                  const selected = tier === t;
                  return (
                    <Pressable
                      key={t}
                      onPress={() => setTier(t)}
                      style={[styles.tierChip, selected && { borderColor: colors.primary, backgroundColor: colors.primary + '1A' }]}
                    >
                      <Text
                        variant="labelMedium"
                        color={selected ? colors.primary : colors.onSurfaceVariant}
                        style={{ fontFamily: selected ? fonts.semiBold : fonts.medium }}
                      >
                        {t === 'ECO' ? 'Economy' : t === 'COMFORT' ? 'Comfort' : 'Premium'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Button label={isPending ? 'Saving…' : 'Next'} onPress={handleStep1Next} disabled={isPending} />
            </MotiView>
          )}

          {/* STEP 2: Documents */}
          {step === 2 && (
            <MotiView
              key="step2"
              from={{ opacity: 0, translateY: 12 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'spring', ...springs.standard, delay: 40 }}
            >
              <Text variant="headlineLarge" style={styles.headline}>Documents</Text>
              <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ marginBottom: spacing.xl }}>
                Upload the required documents to verify your account.
              </Text>

              <View style={styles.card}>
                {REQUIRED_DOCS.map((doc, idx) => {
                  const uploaded = isDocUploaded(doc.type);
                  return (
                    <Pressable
                      key={doc.type}
                      style={[styles.docRow, idx === REQUIRED_DOCS.length - 1 && { borderBottomWidth: 0 }]}
                      onPress={() => router.push('/(profile)/documents' as any)}
                    >
                      <View style={styles.iconBg}>
                        <Ionicons
                          name={uploaded ? 'checkmark-circle' : 'document-attach-outline'}
                          size={18}
                          color={uploaded ? '#22C55E' : colors.primary}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text variant="bodyMedium" color={colors.onSurface} style={{ fontFamily: fonts.medium }}>{doc.label}</Text>
                        <Text variant="labelSmall" color={colors.onSurfaceVariant}>{uploaded ? 'Uploaded' : 'Tap to upload'}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
                    </Pressable>
                  );
                })}
              </View>

              <Button
                label="Continue"
                onPress={handleStep2Continue}
                disabled={!allRequiredDocsUploaded}
              />
            </MotiView>
          )}

          {/* STEP 3: Under Review */}
          {step === 3 && (
            <MotiView
              key="step3"
              from={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', ...springs.standard, delay: 40 }}
              style={styles.reviewContainer}
            >
              <Ionicons name="time-outline" size={64} color={colors.primary} style={{ marginBottom: spacing.xl }} />
              <Text variant="headlineLarge" style={[styles.headline, { textAlign: 'center' }]}>Application Submitted!</Text>
              <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.reviewBody}>
                Your documents are under review. We'll notify you within 48 hours via SMS and push notification. You can check your document status in your profile.
              </Text>
              <Button label="Go to Dashboard" onPress={() => router.replace('/(tabs)/home' as any)} />
            </MotiView>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: DriverColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.backgroundDeep },
  scroll: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.xl, paddingBottom: spacing['3xl'] },
  headline: { letterSpacing: -1, marginBottom: spacing.md },
  card: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii['2xl'],
    borderWidth: 1,
    borderColor: colors.outline,
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.xl,
    overflow: 'hidden',
  },
  fieldRow: {
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
    gap: spacing.xs,
  },
  fieldLabel: { marginBottom: spacing.xs },
  input: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodyMedium,
    lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
    color: colors.onSurface,
    paddingVertical: spacing.xs,
  },
  tierRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  tierChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.base,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.outline,
    backgroundColor: colors.surfaceContainer,
  },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.base,
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
  },
  iconBg: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: `${colors.primary}18`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewContainer: { alignItems: 'center', paddingTop: spacing['3xl'] },
  reviewBody: { textAlign: 'center', marginBottom: spacing['2xl'], lineHeight: 22 },
  sectionLabel: { marginBottom: spacing.sm, marginLeft: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.base, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.outlineVariant },
  rowLabel: { flex: 1, fontFamily: fonts.medium, fontSize: fontSizes.bodyMedium, lineHeight: Math.round(fontSizes.bodyMedium * 1.3), color: colors.onSurface },
});
