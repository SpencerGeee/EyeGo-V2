import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  BackHandler,
  ScrollView,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useDerivedValue, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ridesApi } from '@eyego/api';
import { formatGhs } from '@eyego/utils';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button, Entrance, GradientGlowBorder, getTierTheme } from '@eyego/ui';
import { useColors, Colors } from '../../../utils/useColors';
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

/**
 * Where the content sheet's top edge sits, as a fraction of the screen.
 *
 * MUST STAY IN LOCKSTEP with `SHEET_FRACTION.configure` in TripMap.tsx (they
 * are the two halves of one number: 0.38 of the screen is map, 0.62 is sheet).
 * This stage draws no `InlayPanel`/`MorphSheet`, so nothing publishes a live
 * top edge into the sheet↔map channel and the camera uses that table instead.
 * If the strip and the padding disagree, the route is framed behind the sheet.
 */
const SHEET_TOP_FRACTION = 0.38;

const STEP_FIRST = 3;
const STEP_LAST = 5;
const TOTAL_STEPS = 5;

const MAX_SEATS = 6;

type Tier = 'ECO' | 'COMFORT' | 'PREMIUM';

/**
 * The wire values, in listing order. Everything the rider SEES about a tier —
 * its label, blurb, icon, colour and glow ring — comes from `getTierTheme` so
 * this screen cannot disagree with the tier badge on the tracking card or with
 * the driver's create-trip tier step. Previously all three rows were painted in
 * `colors.primary`, which is why Eco, Comfort and Premium were three identical
 * green cards.
 */
const TIER_ORDER: Tier[] = ['ECO', 'COMFORT', 'PREMIUM'];

function ConfigureStageImpl() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  /**
   * Height of the header + step rail, measured rather than assumed.
   *
   * The map strip has to end at a FRACTION of the screen (that is the number
   * the camera pads against), but it starts wherever the chrome above it
   * happens to end — which depends on the notch, the font scale and the rail's
   * own layout. Measuring is the only way those two edges meet on every phone.
   */
  const [chromeHeight, setChromeHeight] = useState(0);
  const onChromeLayout = useCallback(
    (e: LayoutChangeEvent) => setChromeHeight(e.nativeEvent.layout.height),
    [],
  );
  const mapWindow = Math.max(0, screenHeight * SHEET_TOP_FRACTION - insets.top - chromeHeight);

  const goStage = useTripFlow((s) => s.go);
  const setPreviewPath = useTripFlow((s) => s.setPreviewPath);
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
  /**
   * What this rider's standing took off the fare, in pesewas.
   *
   * Zero for most riders, and the card below simply does not render the line in
   * that case — a "you saved GH₵0.00" row is worse than none.
   */
  const [loyaltyDiscountPesewas, setLoyaltyDiscountPesewas] = useState(0);
  const [quoting, setQuoting] = useState(false);

  useEffect(() => {
    // No pair, no road. Clearing rather than leaving the last one up is what
    // stops the map drawing the previous destination's route behind this screen.
    if (!origin || !destination) {
      setPreviewPath(null);
      return;
    }
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
      TIER_ORDER.map((id) =>
        ridesApi
          .quote({ ...base, tier: id })
          .then((q) => {
            /**
             * THE MAP BEHIND THIS SCREEN GETS ITS ROUTE FROM HERE.
             *
             * The quote already measured the road between these two points to
             * price the trip, and now hands the line back with the number. So
             * the route the rider sees under the tier cards is, by construction,
             * the exact road the fare was computed along — not a second
             * Directions call that can answer differently, and not a straight
             * line through the buildings between the pins.
             *
             * Published from the first tier that returns one (all three quote
             * the same journey, so the geometry is identical) and only when
             * there is one — the router falling back to a straight-line estimate
             * returns null, and drawing nothing is the honest result there.
             */
            if (q?.geometry?.coordinates?.length) {
              setPreviewPath(q.geometry as { type: 'LineString'; coordinates: [number, number][] });
            }
            /**
             * What good standing took off this fare.
             *
             * Applied server-side before the quote is signed (see
             * `fare-quote.service`), so this is the real saving rather than an
             * estimate of one. Carried alongside the price so the rider can be
             * told WHY theirs is lower — a discount nobody can see changes
             * nobody's behaviour, which is the whole point of tying it to
             * cancellations.
             */
            return [id, q?.amountPesewas ?? null, q?.loyaltyDiscountPesewas ?? 0] as const;
          })
          // A failed preview must not block booking — the request path quotes
          // again for real and surfaces its own error.
          .catch(() => [id, null, 0] as const),
      ),
    )
      .then((triples) => {
        if (cancelled) return;
        const next: Partial<Record<Tier, number>> = {};
        let discount = 0;
        for (const [id, amount, saved] of triples) {
          if (amount != null) next[id] = amount;
          // Standing is a property of the rider, not of the tier, so every
          // quote returns the same figure — take the first real one.
          if (saved > discount) discount = saved;
        }
        setFares(next);
        setLoyaltyDiscountPesewas(discount);
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

  /** The selected tier's colours — used by the footer CTA and the review row. */
  const tierTheme = getTierTheme(colors, rideTier);

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
        NO FULL-SCREEN BACKGROUND OF ITS OWN.

        It used to paint an ANIMATED Skia shader here — a full-screen canvas spun
        up at the exact instant this stage mounts, which is the instant the stage
        crossfade spring starts, on top of the outgoing stage's own canvas. Three
        shaders and a map in one frame is the whole of "Order Ride is jumpy and
        laggy". Nothing on this stage may own a full-screen canvas again.

        WHAT IS BEHIND IT NOW IS THE MAP, ON PURPOSE. Step 3 is "Choose your
        ride": the rider is comparing three prices for one journey, and a price
        for a journey you cannot see is a number with nothing attached to it. So
        the trip surface mounts the map from this stage onward (MAP_STAGES in
        app/trip.tsx) and frames it on the SAME road the quote was measured
        along (`previewPath`), and this stage leaves a strip at the top for it
        rather than covering it.

        The chrome that floats on that strip gets a scrim, and everything else
        lives in an opaque sheet below it — map tiles are bright, arbitrarily
        coloured and moving, and body text does not survive being laid on them.
        Stepping BACK to `search` fades the map out again and returns that
        stage to the ambient Skia background, which is the background that
        belongs to it.
      */}
      <LinearGradient
        colors={[colors.backgroundDeep, `${colors.backgroundDeep}00`]}
        style={[styles.chromeScrim, { height: insets.top + chromeHeight + spacing.xl }]}
        pointerEvents="none"
      />
      {/*
        Insets applied by hand rather than by `SafeAreaView edges={['top','bottom']}`.

        This is the "the continue button has no padding down so it's literally
        below the screen" fix. A `SafeAreaView` only pads to the safe area when it
        is the one measuring against the window; this stage is rendered inside the
        trip surface's absolutely-positioned stage container, so its bottom edge
        resolved to nothing and the footer sat flush against — and on tall-gesture
        phones under — the home indicator.

        `insets.bottom || spacing.md` keeps a floor of breathing room on hardware
        with no inset at all, where a bare `insets.bottom` is zero.
      */}
      <View style={[styles.safe, { paddingTop: insets.top }]}>
        <View onLayout={onChromeLayout}>
        <View style={styles.header}>
          <Pressable
            onPress={back}
            hitSlop={10}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel={step > STEP_FIRST ? 'Previous step' : 'Back to destination'}
          >
            <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle}>Book a ride</Text>
          <View style={{ width: 44 }} />
        </View>

        <StepRail step={step} colors={colors} />
        </View>

        {/* The window onto the map. Not a spacer — this IS the route preview,
            and its height is what `SHEET_TOP_FRACTION` is naming. */}
        <View style={{ height: mapWindow }} pointerEvents="none" />

        <View style={styles.sheet}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Entrance key={`title-${step}`} animation="slideRight">
            <Text style={styles.title}>{stepTitle}</Text>
            <Text style={styles.blurb}>{stepBlurb}</Text>
          </Entrance>

          {/*
            EACH TIER WEARS ITS OWN COLOUR AND ITS OWN RING.

            Eco green, Comfort blue, Premium gold — the ring palette, the icon,
            the label, the price and the selected card's tint all come from the
            single `getTierTheme` entry, which is also what paints the tier badge
            on the tracking card. So there is no way for the card the rider taps
            and the badge they see afterwards to be different colours.

            The ring is always present (a tier without one looked unfinished next
            to the services page) but it only GLOWS on the selected card: three
            glowing rings stacked in a list is noise, and it is also three
            shadow passes per frame.
          */}
          {step === 3 && (
            <Entrance key="step3" animation="slideRight" style={styles.list}>
              {TIER_ORDER.map((id) => {
                const t = getTierTheme(colors, id);
                const active = rideTier === id;
                const price = fares[id];
                return (
                  <GradientGlowBorder
                    key={id}
                    palette={t.ringPalette}
                    borderRadius={radii.xl}
                    thickness={active ? 'regular' : 'thin'}
                    fillColor={colors.surfaceContainerHigh}
                    glow={active}
                    glowIntensity={0.75}
                    maxGlowRadius={16}
                    disabled={!active}
                  >
                    <Pressable
                      onPress={() => {
                        void Haptics.selectionAsync();
                        setRideOptions({ rideTier: id });
                      }}
                      style={[styles.option, active && { backgroundColor: t.softBg }]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`${t.label} — ${t.blurb}${price != null ? `, ${formatGhs(price)}` : ''}`}
                    >
                      <View style={[styles.optionIcon, { backgroundColor: t.iconBg }]}>
                        <Ionicons name={t.icon} size={22} color={t.accent} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.optionLabel, active && { color: t.accent }]}>
                          {t.label}
                        </Text>
                        <Text variant="caption" color={colors.onSurfaceVariant}>
                          {t.blurb}
                        </Text>
                      </View>
                      <View style={styles.optionTrailing}>
                        <Text style={[styles.optionPrice, active && { color: t.accent }]}>
                          {price != null ? formatGhs(price) : quoting ? '···' : '—'}
                        </Text>
                        {active && (
                          <Ionicons name="checkmark-circle" size={18} color={t.accent} />
                        )}
                      </View>
                    </Pressable>
                  </GradientGlowBorder>
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
                  value={getTierTheme(colors, rideTier).label}
                  valueColor={getTierTheme(colors, rideTier).accent}
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
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.fareValue}>
                      {fare != null ? formatGhs(fare) : quoting ? '···' : '—'}
                    </Text>
                    {/*
                      "Fewer cancellations should mean better pricing" — said out
                      loud. The server has already taken this off the number
                      above; the line exists so the rider knows their record is
                      doing something, which is the only way it changes anyone's
                      behaviour. Absent entirely at zero.
                    */}
                    {fare != null && loyaltyDiscountPesewas > 0 && (
                      <Text variant="caption" color={colors.primary}>
                        {formatGhs(loyaltyDiscountPesewas)} off · good standing
                      </Text>
                    )}
                  </View>
                </View>
              </GradientGlowBorder>
            </Entrance>
          )}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: (insets.bottom || spacing.md) + spacing.md }]}>
          {/* Shiny + tier-tinted: this is the one hero CTA on the screen, and
              the ring carries the tier the rider has selected so the button
              agrees with the card above it. */}
          <Button
            label={step === STEP_LAST ? 'Confirm ride' : 'Continue'}
            onPress={next}
            variant="glow"
            palette={tierTheme.ringPalette}
            shiny
            shinyBaseColor={tierTheme.accent}
            disabled={step === STEP_LAST && !destination}
          />
        </View>
        </View>
      </View>
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
  valueColor,
  styles,
  colors,
}: {
  label: string;
  value: string;
  /** Tints the value — the review step's "Ride" row uses the tier's colour so
   *  the tier is recognisable here too, not only on the picker. */
  valueColor?: string;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  return (
    <View style={styles.reviewRow}>
      <Text variant="caption" color={colors.onSurfaceVariant}>
        {label}
      </Text>
      <Text style={[styles.reviewValue, valueColor && { color: valueColor }]} numberOfLines={1}>
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
    // Transparent, so the app's ambient background reads through the whole
    // booking flow instead of stopping at this stage. See the render site.
    root: { flex: 1, backgroundColor: 'transparent' },
    safe: { flex: 1, backgroundColor: 'transparent' },
    /** Reading ground for the header and rail, which float on live map tiles. */
    chromeScrim: { position: 'absolute', top: 0, left: 0, right: 0 },
    /**
     * The opaque half of the screen.
     *
     * `backgroundDeep` and not glass: a translucent sheet over map tiles is a
     * different colour everywhere it moves, and the tier cards below it are
     * already `surfaceContainerHigh`, so their edges would vanish wherever a
     * park or a motorway happened to sit behind them.
     */
    sheet: {
      flex: 1,
      backgroundColor: colors.backgroundDeep,
      borderTopLeftRadius: radii['4xl'],
      borderTopRightRadius: radii['4xl'],
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.rimLight,
      overflow: 'hidden',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      paddingBottom: spacing.lg,
    },
    /**
     * "There's no way to go back" — there WAS a back button here, it just could
     * not be seen: a 36 pt circle with a hairline outline border and no fill,
     * sitting on the lit green Skia background. A hairline of `colors.outline`
     * over a moving green gradient is invisible on a real phone.
     *
     * Now the same 44 pt filled glass affordance SearchStage uses, so the back
     * control looks identical on both halves of the flow.
     */
    backBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: `${colors.surfaceCard}CC`,
      borderWidth: 1,
      borderColor: colors.rimLight,
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
      paddingTop: spacing.xl,
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
    /**
     * "The 'Every option is the same driver pool' text is too faint."
     *
     * It was `bodySmall` — 12px in `onSurfaceVariant` — sitting directly under
     * a 28px display title. That is a caption's weight doing a subtitle's job,
     * and at 12px the muted token has nothing left to give. One step up in size
     * and onto the full-contrast text colour, held back from the title by
     * weight rather than by being hard to read.
     */
    blurb: {
      marginTop: spacing.xs,
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.45),
      color: colors.onSurface,
      opacity: 0.86,
    },
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
