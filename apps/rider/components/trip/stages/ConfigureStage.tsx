import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, Pressable, BackHandler } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ridesApi } from '@eyego/api';
import { formatGhs } from '@eyego/utils';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button, Entrance, GlassSurface, InlayPanel } from '@eyego/ui';
import { useColors, Colors } from '../../../utils/useColors';
import { useRideStore } from '../../../stores/ride.store';
import { useTripFlow } from '../../../stores/tripFlow.store';

/**
 * WHERE-TO, PAGED — steps 3 to 5 of 5.
 *
 * SearchStage owns steps 1 and 2 (pickup, then destination); this owns the
 * three decisions that come after, one screen at a time, the way the driver
 * app's create-trip flow already works. The two apps were asking for the same
 * kind of information in two different shapes: the driver got a paged form with
 * a progress indicator and a back arrow per step, the rider got everything
 * crammed into one card.
 *
 * It also closes a real gap rather than only rearranging one. Tier, doorstep
 * pickup and heavy load are all parameters of `POST /rides/quote`, and the
 * rider had no way to set any of them — every quote went out on the server
 * defaults, so "ECO" was not a choice the rider had made, it was the only
 * thing that could happen.
 *
 * The map behind stays mounted and framed; this is a stage of the persistent
 * trip surface, not a screen pushed over it.
 */

const STEP_FIRST = 3;
const STEP_LAST = 5;
const TOTAL_STEPS = 5;

const MAX_SEATS = 6;

type Tier = 'ECO' | 'COMFORT' | 'PREMIUM';

const TIERS: { id: Tier; label: string; blurb: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'ECO', label: 'Eco', blurb: 'Everyday, best price', icon: 'car-outline' },
  { id: 'COMFORT', label: 'Comfort', blurb: 'More room, AC', icon: 'car-sport-outline' },
  { id: 'PREMIUM', label: 'Premium', blurb: 'Top-rated drivers', icon: 'diamond-outline' },
];

function ConfigureStageImpl() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const goStage = useTripFlow((s) => s.go);
  const origin = useRideStore((s) => s.origin);
  const destination = useRideStore((s) => s.destination);
  const rideTier = useRideStore((s) => s.rideTier);
  const doorstepPickup = useRideStore((s) => s.doorstepPickup);
  const heavyLoad = useRideStore((s) => s.heavyLoad);
  const seats = useRideStore((s) => s.requestSeatCount);
  const setRideOptions = useRideStore((s) => s.setRideOptions);
  const setRequestSeats = useRideStore((s) => s.setRequestSeats);
  const coverAll = useRideStore((s) => s.requestCoverAll);

  const [step, setStep] = useState(STEP_FIRST);

  const back = useCallback(() => {
    void Haptics.selectionAsync();
    if (step > STEP_FIRST) setStep((n) => n - 1);
    else goStage('search');
  }, [step, goStage]);

  // Hardware back walks the steps rather than abandoning the whole flow — the
  // same rule the driver's create screen uses.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => sub.remove();
  }, [back]);

  /**
   * THE PRICE, FROM THE SERVER, FOR THE OPTIONS ACTUALLY CHOSEN.
   *
   * Re-quoted whenever an option changes, so the number on the review step is
   * the one the ride will be booked at rather than a client-side guess that
   * disagrees with the receipt. `quote` is cheap and idempotent; the request
   * that actually books carries its own quoteId.
   */
  const [fare, setFare] = useState<number | null>(null);
  const [quoting, setQuoting] = useState(false);

  useEffect(() => {
    if (!origin || !destination) return;
    let cancelled = false;
    setQuoting(true);
    ridesApi
      .quote({
        pickupLat: origin.latitude,
        pickupLng: origin.longitude,
        dropoffLat: destination.latitude,
        dropoffLng: destination.longitude,
        tier: rideTier,
        doorstepPickup,
        heavyLoad,
      })
      .then((q: any) => {
        if (cancelled) return;
        setFare(q?.farePesewas ?? q?.fareAmountPesewas ?? q?.totalPesewas ?? null);
      })
      .catch(() => {
        // A failed preview must not block booking — the request path quotes
        // again for real and surfaces its own error.
        if (!cancelled) setFare(null);
      })
      .finally(() => !cancelled && setQuoting(false));
    return () => { cancelled = true; };
  }, [origin, destination, rideTier, doorstepPickup, heavyLoad]);

  const next = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (step < STEP_LAST) setStep((n) => n + 1);
    else {
      // Commit the seat count the same way SearchStage's Order Ride did, then
      // hand off. RequestStage owns everything from here.
      setRequestSeats(seats, coverAll);
      goStage('request');
    }
  }, [step, seats, coverAll, setRequestSeats, goStage]);

  const stepTitle =
    step === 3 ? 'Choose your ride' : step === 4 ? 'Seats and extras' : 'Review and confirm';
  const stepBlurb =
    step === 3
      ? 'Every option is the same driver pool — the car and the price differ.'
      : step === 4
      ? 'Book more than one seat, or tell the driver what to expect.'
      : 'One last look before we start looking for a driver.';

  return (
    <View style={styles.root} pointerEvents="box-none">
      <InlayPanel
        snapPointsPct={[0.62, 0.86]}
        initialState="collapsed"
        sheetStyle={styles.sheet}
        grabberColor={colors.outline}
      >
        <View style={styles.body}>
          {/* Header: back arrow + the same progress dots the driver app uses. */}
          <View style={styles.header}>
            <Pressable
              onPress={back}
              hitSlop={10}
              style={styles.backBtn}
              accessibilityRole="button"
              accessibilityLabel={step > STEP_FIRST ? 'Previous step' : 'Back to destination'}
            >
              <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
            </Pressable>
            <View style={styles.dots}>
              {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((n) => (
                <View
                  key={n}
                  style={[
                    styles.dot,
                    n <= step && { backgroundColor: colors.primary, width: n === step ? 18 : 6 },
                  ]}
                />
              ))}
            </View>
            <View style={{ width: 36 }} />
          </View>

          <Entrance key={`title-${step}`} animation="slideRight">
            <Text style={styles.title}>{stepTitle}</Text>
            <Text variant="bodySmall" color={colors.onSurfaceVariant} style={styles.blurb}>
              {stepBlurb}
            </Text>
          </Entrance>

          {step === 3 && (
            <Entrance key="step3" animation="slideRight" style={styles.list}>
              {TIERS.map((t) => {
                const active = rideTier === t.id;
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      setRideOptions({ rideTier: t.id });
                    }}
                    style={[styles.option, active && { borderColor: colors.primary }]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`${t.label} — ${t.blurb}`}
                  >
                    <View style={[styles.optionIcon, { backgroundColor: `${colors.primary}1A` }]}>
                      <Ionicons name={t.icon} size={20} color={active ? colors.primary : colors.onSurfaceVariant} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.optionLabel}>{t.label}</Text>
                      <Text variant="caption" color={colors.onSurfaceVariant}>{t.blurb}</Text>
                    </View>
                    {active && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
                  </Pressable>
                );
              })}
            </Entrance>
          )}

          {step === 4 && (
            <Entrance key="step4" animation="slideRight" style={styles.list}>
              <View style={styles.option}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionLabel}>Seats</Text>
                  <Text variant="caption" color={colors.onSurfaceVariant}>
                    How many of you are travelling
                  </Text>
                </View>
                <View style={styles.stepper}>
                  <Pressable
                    onPress={() => setRequestSeats(Math.max(1, seats - 1), coverAll)}
                    disabled={seats <= 1}
                    hitSlop={8}
                    style={[styles.stepperBtn, seats <= 1 && { opacity: 0.4 }]}
                    accessibilityRole="button"
                    accessibilityLabel="Fewer seats"
                  >
                    <Ionicons name="remove" size={16} color={colors.onSurface} />
                  </Pressable>
                  <Text style={styles.stepperValue}>{seats}</Text>
                  <Pressable
                    onPress={() => setRequestSeats(Math.min(MAX_SEATS, seats + 1), coverAll)}
                    disabled={seats >= MAX_SEATS}
                    hitSlop={8}
                    style={[styles.stepperBtn, seats >= MAX_SEATS && { opacity: 0.4 }]}
                    accessibilityRole="button"
                    accessibilityLabel="More seats"
                  >
                    <Ionicons name="add" size={16} color={colors.onSurface} />
                  </Pressable>
                </View>
              </View>

              <Toggle
                label="Doorstep pickup"
                blurb="The driver comes to your door rather than the nearest road"
                value={doorstepPickup}
                onChange={(v) => setRideOptions({ doorstepPickup: v })}
                colors={colors}
                styles={styles}
              />
              <Toggle
                label="Heavy load"
                blurb="Large luggage or cargo — priced in, so the driver knows before they arrive"
                value={heavyLoad}
                onChange={(v) => setRideOptions({ heavyLoad: v })}
                colors={colors}
                styles={styles}
              />
            </Entrance>
          )}

          {step === 5 && (
            <Entrance key="step5" animation="slideRight" style={styles.list}>
              <View style={styles.review}>
                <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.xl} intensity="low" />
                <Row label="From" value={origin?.address ?? 'Current location'} styles={styles} colors={colors} />
                <Row label="To" value={destination?.address ?? '—'} styles={styles} colors={colors} />
                <View style={styles.reviewDivider} />
                <Row label="Ride" value={TIERS.find((t) => t.id === rideTier)?.label ?? rideTier} styles={styles} colors={colors} />
                <Row label="Seats" value={String(seats)} styles={styles} colors={colors} />
                {doorstepPickup && <Row label="Extras" value="Doorstep pickup" styles={styles} colors={colors} />}
                {heavyLoad && <Row label="Extras" value="Heavy load" styles={styles} colors={colors} />}
                <View style={styles.reviewDivider} />
                <View style={styles.fareRow}>
                  <Text variant="bodySmall" color={colors.onSurfaceVariant}>Estimated fare</Text>
                  <Text style={styles.fareValue}>
                    {quoting ? '…' : fare != null ? formatGhs(fare) : '—'}
                  </Text>
                </View>
              </View>
            </Entrance>
          )}

          <View style={styles.footer}>
            <Button
              label={step === STEP_LAST ? 'Confirm ride' : 'Continue'}
              onPress={next}
              disabled={step === STEP_LAST && !destination}
            />
          </View>
        </View>
      </InlayPanel>
    </View>
  );
}

function Row({ label, value, styles, colors }: {
  label: string; value: string;
  styles: ReturnType<typeof makeStyles>; colors: Colors;
}) {
  return (
    <View style={styles.reviewRow}>
      <Text variant="caption" color={colors.onSurfaceVariant}>{label}</Text>
      <Text style={styles.reviewValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function Toggle({ label, blurb, value, onChange, colors, styles }: {
  label: string; blurb: string; value: boolean; onChange: (v: boolean) => void;
  colors: Colors; styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <Pressable
      onPress={() => { void Haptics.selectionAsync(); onChange(!value); }}
      style={[styles.option, value && { borderColor: colors.primary }]}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={`${label}. ${blurb}`}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.optionLabel}>{label}</Text>
        <Text variant="caption" color={colors.onSurfaceVariant}>{blurb}</Text>
      </View>
      <View style={[styles.check, value && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
        {value && <Ionicons name="checkmark" size={13} color={colors.onPrimary} />}
      </View>
    </Pressable>
  );
}

export const ConfigureStage = React.memo(ConfigureStageImpl);
export default ConfigureStage;

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent' },
    sheet: { backgroundColor: colors.surfaceContainer },
    body: { gap: spacing.lg, paddingBottom: spacing.xl },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    backBtn: {
      width: 36, height: 36, borderRadius: 18,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth, borderColor: colors.outline,
    },
    dots: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.outline },
    title: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.headlineSmall,
      lineHeight: Math.round(fontSizes.headlineSmall * 1.25),
      color: colors.onSurface,
      letterSpacing: -0.4,
    },
    blurb: { marginTop: 2 },
    list: { gap: spacing.sm },
    option: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      paddingHorizontal: spacing.base, paddingVertical: spacing.md,
      borderRadius: radii.xl, borderWidth: 1.5, borderColor: colors.outline,
      backgroundColor: colors.surfaceContainerHigh,
    },
    optionIcon: {
      width: 38, height: 38, borderRadius: 19,
      alignItems: 'center', justifyContent: 'center',
    },
    optionLabel: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.35),
      color: colors.onSurface,
    },
    stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    stepperBtn: {
      width: 30, height: 30, borderRadius: 15,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: colors.outline,
    },
    stepperValue: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.titleSmall,
      lineHeight: Math.round(fontSizes.titleSmall * 1.3),
      color: colors.onSurface,
      minWidth: 20, textAlign: 'center',
    },
    check: {
      width: 22, height: 22, borderRadius: 11,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 1.5, borderColor: colors.outline,
    },
    review: {
      borderRadius: radii.xl, overflow: 'hidden',
      padding: spacing.base, gap: spacing.sm,
      borderWidth: StyleSheet.hairlineWidth, borderColor: colors.outline,
    },
    reviewRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
    reviewValue: {
      flex: 1, textAlign: 'right',
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodySmall,
      lineHeight: Math.round(fontSizes.bodySmall * 1.35),
      color: colors.onSurface,
    },
    reviewDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.outline },
    fareRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    fareValue: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.titleMedium,
      lineHeight: Math.round(fontSizes.titleMedium * 1.3),
      color: colors.onSurface,
    },
    footer: { marginTop: spacing.xs },
  });
