import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, Pressable, BackHandler, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useDerivedValue, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ridesApi } from '@eyego/api';
import { formatGhs } from '@eyego/utils';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button, Entrance, AppBackground, GradientGlowBorder } from '@eyego/ui';
import { useColors, Colors } from '../../../utils/useColors';
import { useThemeStore } from '../../../stores/theme.store';
import { useRideStore } from '../../../stores/ride.store';
import { useTripFlow } from '../../../stores/tripFlow.store';

/**
 * WHERE-TO, PAGED — steps 3 to 5 of 5.
 *
 * SearchStage owns steps 1 and 2 (pickup, then destination); this owns the
 * three decisions that come after, one screen at a time.
 *
 * WHY THIS IS A SCREEN AND NOT A SHEET. It used to be an `InlayPanel` floating
 * over the live map at a fixed 62 % snap point. Two things followed from that,
 * and both were reported:
 *
 *   - "the choose your ride page has the text and section cut off like it's
 *     bigger than the screen". A panel pinned to a percentage of the viewport
 *     has a fixed height, and the content of step 3 is taller than 62 % of a
 *     small phone. There was no scroll view, so the overflow was simply
 *     clipped — the third tier and the footer button fell off the bottom.
 *   - The map was the backdrop for a form that has nothing to do with a map.
 *     The driver's create-trip flow puts the same kind of decisions on the
 *     brand's Skia background, full-bleed, and reads far better for it.
 *
 * So this is now a full-bleed stage with the app background behind it, a
 * header, a step rail, a SCROLLING body and a pinned footer — the driver's
 * `(trip)/create.tsx` shape, in the rider's palette. Content can now be any
 * height it likes and nothing can be clipped again.
 *
 * It also closes a real gap rather than only rearranging one. Tier, doorstep
 * pickup and heavy load are all parameters of `POST /rides/quote`, and the
 * rider had no way to set any of them — every quote went out on the server
 * defaults, so "ECO" was not a choice the rider had made, it was the only
 * thing that could happen.
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
  const isDark = useThemeStore((s) => s.isDark);
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
   * THE PRICE OF EVERY TIER, FROM THE SERVER, FOR THE OPTIONS ACTUALLY CHOSEN.
   *
   * Quoted for all three tiers at once rather than only the selected one, so
   * the ride picker can put a price against each row — choosing between Eco,
   * Comfort and Premium with no numbers on screen is not a choice, it is a
   * guess. `quote` is cheap and idempotent; the request that actually books
   * carries its own quoteId, so nothing here is binding.
   *
   * BUGFIX ("the estimated fare is shown as -"): this read
   * `farePesewas ?? fareAmountPesewas ?? totalPesewas` off the response. The
   * quote endpoint returns `amountPesewas` and has never returned any of those
   * three, so the coalescing chain fell through to `null` every single time and
   * the review step rendered its em-dash placeholder for a fare the server had
   * correctly computed and sent.
   */
  const [fares, setFares] = useState<Partial<Record<Tier, number>>>({});
  const [quoting, setQuoting] = useState(false);

  useEffect(() => {
    if (!origin || !destination) return;
    let cancelled = false;
    setQuoting(true);
    const base = {
      pickupLat: origin.latitude,
      pickupLng: origin.longitude,
      dropoffLat: destination.latitude,
      dropoffLng: destination.longitude,
      doorstepPickup,
      heavyLoad,
    };
    Promise.all(
      TIERS.map((t) =>
        ridesApi
          .quote({ ...base, tier: t.id })
          .then((q) => [t.id, q?.amountPesewas ?? null] as const)
          // A failed preview must not block booking — the request path quotes
          // again for real and surfaces its own error.
          .catch(() => [t.id, null] as const),
      ),
    )
      .then((pairs) => {
        if (cancelled) return;
        const next: Partial<Record<Tier, number>> = {};
        for (const [id, amount] of pairs) if (amount != null) next[id] = amount;
        setFares(next);
      })
      .finally(() => !cancelled && setQuoting(false));
    return () => {
      cancelled = true;
    };
  }, [origin, destination, doorstepPickup, heavyLoad]);

  const fare = fares[rideTier] ?? null;

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
    <View style={styles.root}>
      {/*
        The brand background, opaque, over the persistent map.
        The map stays MOUNTED underneath — this is a stage of the trip surface,
        and tearing the map down here would mean rebuilding it on the way back
        out. An idle occluded map redraws nothing, so covering it costs less
        than the panel-over-map arrangement it replaces.
      */}
      <AppBackground isDark={isDark} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
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
          <Text style={styles.headerTitle}>Book a ride</Text>
          <View style={{ width: 36 }} />
        </View>

        <StepRail step={step} colors={colors} />

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
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
                const price = fares[t.id];
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      setRideOptions({ rideTier: t.id });
                    }}
                    style={[
                      styles.option,
                      active && { borderColor: colors.primary, backgroundColor: `${colors.primary}12` },
                    ]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`${t.label} — ${t.blurb}${price != null ? `, ${formatGhs(price)}` : ''}`}
                  >
                    <View style={[styles.optionIcon, { backgroundColor: `${colors.primary}1A` }]}>
                      <Ionicons
                        name={t.icon}
                        size={22}
                        color={active ? colors.primary : colors.onSurfaceVariant}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.optionLabel}>{t.label}</Text>
                      <Text variant="caption" color={colors.onSurfaceVariant}>
                        {t.blurb}
                      </Text>
                    </View>
                    <View style={styles.optionTrailing}>
                      <Text style={[styles.optionPrice, active && { color: colors.primary }]}>
                        {price != null ? formatGhs(price) : quoting ? '···' : '—'}
                      </Text>
                      {active && (
                        <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                      )}
                    </View>
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

              {/* The fee is the diversion this causes, not a flat charge — see
                  DOORSTEP_PER_KM in the fare calculator. The blurb does not name
                  an amount because the amount depends on how far off-route the
                  rider is, and the quote on the review step already shows the
                  real number before they confirm. */}
              <Toggle
                label="Doorstep pickup"
                blurb="The driver comes to your door rather than the nearest road — costs extra based on the detour"
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
              <GradientGlowBorder
                palette="brandGreen"
                fillColor={colors.surfaceContainerHigh}
                borderRadius={radii['2xl']}
                glow
                style={styles.review}
              >
                <View style={styles.routeBlock}>
                  <View style={styles.routeRow}>
                    <View style={[styles.routeDot, { backgroundColor: colors.onSurfaceVariant }]} />
                    <View style={{ flex: 1 }}>
                      <Text variant="caption" color={colors.onSurfaceVariant}>
                        Pickup
                      </Text>
                      <Text style={styles.routeValue} numberOfLines={2}>
                        {origin?.address ?? 'Current location'}
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.routeConnector, { backgroundColor: colors.outline }]} />
                  <View style={styles.routeRow}>
                    <View style={[styles.routeDot, { backgroundColor: colors.primary }]} />
                    <View style={{ flex: 1 }}>
                      <Text variant="caption" color={colors.onSurfaceVariant}>
                        Destination
                      </Text>
                      <Text style={styles.routeValue} numberOfLines={2}>
                        {destination?.address ?? '—'}
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={styles.reviewDivider} />

                <Row
                  label="Ride"
                  value={TIERS.find((t) => t.id === rideTier)?.label ?? rideTier}
                  styles={styles}
                  colors={colors}
                />
                <Row label="Seats" value={String(seats)} styles={styles} colors={colors} />
                {(doorstepPickup || heavyLoad) && (
                  <Row
                    label="Extras"
                    value={[doorstepPickup && 'Doorstep pickup', heavyLoad && 'Heavy load']
                      .filter(Boolean)
                      .join(' · ')}
                    styles={styles}
                    colors={colors}
                  />
                )}

                <View style={styles.reviewDivider} />

                <View style={styles.fareRow}>
                  <View style={{ flex: 1 }}>
                    <Text variant="bodySmall" color={colors.onSurfaceVariant}>
                      Estimated fare
                    </Text>
                    <Text variant="caption" color={colors.onSurfaceVariant}>
                      Final price confirmed when a driver accepts
                    </Text>
                  </View>
                  <Text style={styles.fareValue}>
                    {fare != null ? formatGhs(fare) : quoting ? '···' : '—'}
                  </Text>
                </View>
              </GradientGlowBorder>
            </Entrance>
          )}
        </ScrollView>

        <View style={styles.footer}>
          <Button
            label={step === STEP_LAST ? 'Confirm ride' : 'Continue'}
            onPress={next}
            disabled={step === STEP_LAST && !destination}
          />
        </View>
      </SafeAreaView>
    </View>
  );
}

/**
 * The progress rail — the driver app's `StepIndicator`, in the rider's palette.
 *
 * Filled dots and filled connectors up to the current step, so at a glance the
 * rider can see they are three of five in rather than only that "some" progress
 * has been made. Steps 1 and 2 belong to SearchStage, which is why this always
 * opens showing two already complete.
 */
function StepRail({ step, colors }: { step: number; colors: Colors }) {
  return (
    <View style={railStyles.container}>
      {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((n) => (
        <React.Fragment key={n}>
          <RailDot filled={n <= step} active={n === step} colors={colors} />
          {n < TOTAL_STEPS && <RailConnector filled={n < step} colors={colors} />}
        </React.Fragment>
      ))}
    </View>
  );
}

function RailDot({ filled, active, colors }: { filled: boolean; active: boolean; colors: Colors }) {
  const p = useDerivedValue(() => withTiming(filled ? 1 : 0, { duration: 260 }), [filled]);
  const s = useDerivedValue(() => withTiming(active ? 1.25 : 1, { duration: 260 }), [active]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.35 + p.value * 0.65,
    transform: [{ scale: s.value }],
  }));
  return (
    <Animated.View
      style={[
        railStyles.dot,
        { backgroundColor: filled ? colors.primary : colors.surfaceContainerHighest },
        style,
      ]}
    />
  );
}

function RailConnector({ filled, colors }: { filled: boolean; colors: Colors }) {
  const p = useDerivedValue(() => withTiming(filled ? 1 : 0, { duration: 260 }), [filled]);
  const style = useAnimatedStyle(() => ({ opacity: 0.3 + p.value * 0.7 }));
  return (
    <Animated.View
      style={[
        railStyles.connector,
        { backgroundColor: filled ? colors.primary : colors.outline },
        style,
      ]}
    />
  );
}

function Row({
  label,
  value,
  styles,
  colors,
}: {
  label: string;
  value: string;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  return (
    <View style={styles.reviewRow}>
      <Text variant="caption" color={colors.onSurfaceVariant}>
        {label}
      </Text>
      <Text style={styles.reviewValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Toggle({
  label,
  blurb,
  value,
  onChange,
  colors,
  styles,
}: {
  label: string;
  blurb: string;
  value: boolean;
  onChange: (v: boolean) => void;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync();
        onChange(!value);
      }}
      style={[styles.option, value && { borderColor: colors.primary, backgroundColor: `${colors.primary}12` }]}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={`${label}. ${blurb}`}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.optionLabel}>{label}</Text>
        <Text variant="caption" color={colors.onSurfaceVariant}>
          {blurb}
        </Text>
      </View>
      <View style={[styles.check, value && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
        {value && <Ionicons name="checkmark" size={13} color={colors.onPrimary} />}
      </View>
    </Pressable>
  );
}

export const ConfigureStage = React.memo(ConfigureStageImpl);
export default ConfigureStage;

const railStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing['2xl'],
    paddingBottom: spacing.lg,
  },
  dot: { width: 9, height: 9, borderRadius: 4.5 },
  connector: { flex: 1, height: 2, maxWidth: 44, borderRadius: 1, marginHorizontal: 5 },
});

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.backgroundDeep },
    safe: { flex: 1, backgroundColor: 'transparent' },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      paddingBottom: spacing.lg,
    },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.outline,
    },
    headerTitle: {
      fontFamily: fonts.displaySemiBold,
      fontSize: fontSizes.titleSmall,
      lineHeight: Math.round(fontSizes.titleSmall * 1.3),
      color: colors.onSurface,
    },
    /** The reason nothing can be clipped any more: the body scrolls, and the
     *  footer button lives outside it so it is always reachable. */
    scroll: {
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing['3xl'],
      gap: spacing.lg,
    },
    title: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.headlineMedium,
      lineHeight: Math.round(fontSizes.headlineMedium * 1.25),
      color: colors.onSurface,
      letterSpacing: -0.5,
    },
    blurb: { marginTop: spacing.xs, lineHeight: 20 },
    list: { gap: spacing.sm },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.md,
      borderRadius: radii.xl,
      borderWidth: 1.5,
      borderColor: colors.outline,
      backgroundColor: colors.surfaceContainerHigh,
    },
    optionIcon: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
    },
    optionLabel: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.35),
      color: colors.onSurface,
    },
    optionTrailing: { alignItems: 'flex-end', gap: 3 },
    optionPrice: {
      fontFamily: fonts.displaySemiBold,
      fontSize: fontSizes.bodyLarge,
      lineHeight: Math.round(fontSizes.bodyLarge * 1.3),
      color: colors.onSurface,
    },
    stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    stepperBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.outline,
    },
    stepperValue: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.titleSmall,
      lineHeight: Math.round(fontSizes.titleSmall * 1.3),
      color: colors.onSurface,
      minWidth: 20,
      textAlign: 'center',
    },
    check: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      borderColor: colors.outline,
    },
    review: { paddingHorizontal: spacing.base, paddingVertical: spacing.base, gap: spacing.sm },
    routeBlock: { gap: 0 },
    routeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
    routeDot: { width: 10, height: 10, borderRadius: 5, marginTop: 6, marginLeft: 3 },
    routeConnector: { width: 2, height: 18, marginLeft: 7 },
    routeValue: {
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodySmall,
      lineHeight: Math.round(fontSizes.bodySmall * 1.4),
      color: colors.onSurface,
      marginTop: 1,
    },
    reviewRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    reviewValue: {
      flex: 1,
      textAlign: 'right',
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodySmall,
      lineHeight: Math.round(fontSizes.bodySmall * 1.35),
      color: colors.onSurface,
    },
    reviewDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.outline },
    fareRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    fareValue: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.titleLarge,
      lineHeight: Math.round(fontSizes.titleLarge * 1.25),
      color: colors.onSurface,
      letterSpacing: -0.5,
    },
    footer: {
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      paddingBottom: spacing.md,
    },
  });
