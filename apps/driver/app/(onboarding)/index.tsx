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
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button } from '@eyego/ui';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useDriverStore } from '../../stores/driver.store';
import { driverApi } from '@eyego/api';
import { useMutation } from '@tanstack/react-query';

const TOTAL_STEPS = 3;

const REQUIRED_DOCS = [
  "Driver's Licence",
  'Vehicle Registration',
  'Insurance Certificate',
  'Roadworthy Certificate',
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

  const { mutate: updateVehicle, isPending } = useMutation({
    mutationFn: () =>
      driverApi.updateMe({
        vehicleMake: make,
        vehicleModel: model,
        vehicleYear: parseInt(year, 10),
        vehicleColour: colour,
        vehiclePlate: plate,
      } as any),
    onSuccess: () => setStep(2),
    onError: (err: any) => Alert.alert('Error', err?.message ?? 'Failed to save vehicle info.'),
  });

  const handleStep1Next = () => {
    if (!make || !model || !year || !colour || !plate) {
      Alert.alert('Missing fields', 'Please fill in all vehicle details.');
      return;
    }
    updateVehicle();
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <MotiView
            from={{ opacity: 0, translateY: -6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34 }}
          >
            <ProgressDots step={step} colors={colors} />
          </MotiView>

          {/* STEP 1: Vehicle Info */}
          {step === 1 && (
            <MotiView
              key="step1"
              from={{ opacity: 0, translateY: 12 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 40 }}
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

              <Button label={isPending ? 'Saving…' : 'Next'} onPress={handleStep1Next} disabled={isPending} />
            </MotiView>
          )}

          {/* STEP 2: Documents */}
          {step === 2 && (
            <MotiView
              key="step2"
              from={{ opacity: 0, translateY: 12 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 40 }}
            >
              <Text variant="headlineLarge" style={styles.headline}>Documents</Text>
              <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ marginBottom: spacing.xl }}>
                Upload the required documents to verify your account.
              </Text>

              <View style={styles.card}>
                {REQUIRED_DOCS.map((doc, idx) => (
                  <Pressable
                    key={doc}
                    style={[styles.docRow, idx === REQUIRED_DOCS.length - 1 && { borderBottomWidth: 0 }]}
                    onPress={() => router.push('/(profile)/documents' as any)}
                  >
                    <View style={styles.iconBg}>
                      <Ionicons name="document-attach-outline" size={18} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyMedium" color={colors.onSurface} style={{ fontFamily: fonts.medium }}>{doc}</Text>
                      <Text variant="labelSmall" color={colors.onSurfaceVariant}>Tap to upload</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
                  </Pressable>
                ))}
              </View>

              <Button label="Continue" onPress={() => setStep(3)} />
            </MotiView>
          )}

          {/* STEP 3: Under Review */}
          {step === 3 && (
            <MotiView
              key="step3"
              from={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 40 }}
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
    color: colors.onSurface,
    paddingVertical: spacing.xs,
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
  rowLabel: { flex: 1, fontFamily: fonts.medium, fontSize: fontSizes.bodyMedium, color: colors.onSurface },
});
