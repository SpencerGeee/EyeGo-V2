import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, Pressable } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import { driverApi } from '@eyego/api';
import { formatGhs } from '@eyego/utils';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, GlassSurface, SwipeToConfirm, GradientGlowBorder, getTierTheme } from '@eyego/ui';
import type { Coord } from '@eyego/maps';

import { useColors, type DriverColors } from '../../utils/useColors';
import { DispatchMiniMap } from './DispatchMiniMap';
import { CountdownRing } from './CountdownRing';

/**
 * ONE OFFER, ONE CARD â€” used by the takeover sheet AND the dispatch screen.
 *
 * There were two offer surfaces in this app with nothing in common but the verb:
 * `DispatchOfferSheet` (the modal that fires when the cascade reaches you) and
 * `(trip)/dispatch/[id]` (what the Alerts â†’ Dispatch list opens). They had
 * different countdowns, different copy, different accept buttons and different
 * ideas of what an offer even is â€” the screen read the ride out of NAVIGATION
 * PARAMS, which is why opening one from the list showed two blank lines where
 * the pickup and destination should be: the list passes no params.
 *
 * This is the single rendering of "here is a ride, take it or don't". Both
 * surfaces hand it the same shape and differ only in their chrome.
 *
 * â”€â”€ THE URGENCY LADDER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * Calm (accent) â†’ amber under ten seconds â†’ red under five, applied to the
 * ring, the digits and the swipe track together so the whole card shifts at
 * once. Haptics escalate on the same boundaries and are fired here rather than
 * by each caller, which is how the sheet ended up buzzing on a schedule the
 * screen did not.
 */

export interface DispatchOfferView {
  tripId: string;
  pickupAddress?: string | null;
  dropoffAddress?: string | null;
  pickup?: Coord | null;
  dropoff?: Coord | null;
  /** What the driver nets. The number the decision is actually made on. */
  driverEarningsPesewas?: number | null;
  farePesewas?: number | null;
  tier?: string | null;
  /** Road seconds from the driver to the pickup, when the server ranked it. */
  etaSeconds?: number | null;
  /** Server-time deadline. Null for an offer with no private hold (a reassignment). */
  expiresAtServerMs?: number | null;
  /** "3 of 8" â€” how deep into the cascade this offer is. */
  attempt?: number | null;
  totalCandidates?: number | null;
  /** DISPATCH Â· REQUEST Â· REASSIGNMENT â€” decides the headline and the rules line. */
  kind?: 'DISPATCH' | 'REQUEST' | 'REASSIGNMENT' | string | null;
  /**
   * WHAT THIS RIDE TAKES OUT OF THE WALLET BEFORE IT PAYS ANYTHING IN.
   *
   * A CASH seat's commission is debited at BOARDING, so a short driver used to
   * find out at the pickup with the passenger standing there ("I accepted a
   * trip and got to the pickup point, but when I tried to mark the passenger as
   * boarded, THAT is when I got insufficient funds"). Zero for card/MoMo.
   * Computed by the server in `dispatch-cascade.cashFloatPesewas`.
   */
  walletRequiredPesewas?: number | null;
}

export interface DispatchOfferCardProps {
  offer: DispatchOfferView;
  /** The driver's own position, for the approach line on the map. */
  driverAt?: Coord | null;
  /** Server-now, in ms. Pass the trip store's `now()`. */
  nowMs: number;
  /** The full offer window in ms, for the ring's starting fraction. */
  windowMs: number;
  secondsLeft: number | null;
  onAccept: () => void;
  onDecline: () => void;
  busy?: 'accept' | 'decline' | null;
  accepted?: boolean;
  /** Hides the map â€” used where a map cannot be afforded (never, currently). */
  showMap?: boolean;
  mapHeight?: number;
  /**
   * â”€â”€ WHERE THIS CARD IS STANDING â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   *
   * BUGFIX ("on the dispatch page, the way the glow borders and all is done,
   * it's not niceâ€¦ the page needs to show the map so the driver can pan it and
   * see how far out the pickup point is").
   *
   * `'card'` is the original: a self-contained object with its own glow ring and
   * a small inert map inside it. That is right for the TAKEOVER SHEET, which
   * floats over whatever the driver was doing and has to read as one thing that
   * arrived.
   *
   * `'sheet'` is for the dispatch SCREEN, where the map is the whole background
   * and this docks over it. There the ring was actively harmful: a glowing
   * rounded rectangle around a panel that itself contains a map with its own
   * vignette, sitting on a screen that is already a map, is three competing
   * edges stacked within about twenty points of each other â€” which is what "the
   * way the glow borders and all is done isn't nice" describes. In this variant
   * the ring is gone, the internal map is gone (the real one is behind it, and
   * it pans), and the panel gets a grabber and a flat bottom so it reads as an
   * edge of the screen rather than a floating card that has been cropped.
   */
  variant?: 'card' | 'sheet';
}

/** Approximate straight-line km, only to say "2.1 km away" beside an ETA. */
function kmBetween(a?: Coord | null, b?: Coord | null): number | null {
  if (!a || !b) return null;
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const l1 = (a[1] * Math.PI) / 180;
  const l2 = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(l1) * Math.cos(l2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function DispatchOfferCard({
  offer,
  driverAt,
  nowMs,
  windowMs,
  secondsLeft,
  onAccept,
  onDecline,
  busy = null,
  accepted = false,
  showMap = true,
  mapHeight = 208,
  variant = 'card',
}: DispatchOfferCardProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isSheet = variant === 'sheet';

  /**
   * ── THE WALLET, BEFORE THE DECISION ───────────────────────────────────────
   *
   * "I accepted a trip and got to the pickup point, but when I tried to mark
   * the passenger as boarded, THAT is when I got 'insufficient funds'. The
   * drivers need to know this BEFORE they can even accept the trip."
   *
   * The balance is polled cheaply and cached — it changes on top-ups and on
   * completed rides, neither of which happens while an offer is on screen — so
   * a stale-for-a-minute number is fine, and it means opening an offer does not
   * cost a round trip before the card can render.
   */
  const { data: walletBalancePesewas } = useQuery({
    // Same key the home screen already warms, so this is usually a cache read.
    queryKey: ['driver', 'me'],
    queryFn: () => driverApi.getMe(),
    select: (r: any) => {
      const d = r?.data?.data?.driver ?? r?.data?.data;
      return typeof d?.walletBalancePesewas === 'number' ? d.walletBalancePesewas : null;
    },
    staleTime: 30_000,
  });

  const walletRequired = offer.walletRequiredPesewas ?? 0;
  /**
   * Only warn when we actually KNOW the balance is short. A null balance (the
   * query has not answered, or the shape changed) must not put a red bar on an
   * offer that is perfectly takeable — the server's own guard at accept is the
   * backstop, and a false warning costs the driver a ride.
   */
  const walletShortfall =
    walletRequired > 0 && typeof walletBalancePesewas === 'number' && walletBalancePesewas < walletRequired
      ? walletRequired - walletBalancePesewas
      : 0;
  // In the sheet variant the screen behind it IS the map, so never draw a
  // second one inside the panel.
  const withMap = showMap && !isSheet;

  const reducedMotion = useReducedMotion();

  const urgent = secondsLeft != null && secondsLeft <= 5;
  const warning = secondsLeft != null && secondsLeft <= 10 && !urgent;

  /**
   * THE CARD WEARS THE RIDE TYPE (item 8), AND THE CLOCK OVERRIDES IT.
   *
   * The accent was the driver blue for every offer, so Economy and Premium
   * arrived looking identical and the tier was a grey chip the driver had to
   * read. `getTierTheme` is the same lookup the rider's ride picker and the
   * dispatch board rows use, so one ride has one colour across both apps.
   *
   * Urgency still wins, and only urgency: five seconds left is a fact about
   * THIS offer that outranks what kind of car it is.
   */
  const tier = getTierTheme(colors as any, offer.tier);
  const accent = urgent ? colors.error : warning ? colors.statusWarning : tier.accent;
  const ringPalette = urgent || warning ? 'gold' : tier.ringPalette;

  /**
   * A SLOW BREATH ON THE RIM WHILE THE CLOCK IS STILL CALM.
   *
   * The card is a thirty-second decision and it used to be completely static
   * until the ten-second mark, when everything changed at once. A 2.4 s pulse on
   * the glow says "this is live and it is counting" without adding a second
   * thing to read â€” Â§7 `motion-meaning`: the motion IS the passage of time.
   *
   * Stops at the warning threshold so the escalation still lands as a change,
   * and never starts under reduced motion (Â§1 `reduced-motion`), where the
   * colour ladder carries the whole signal on its own.
   */
  const breathe = useSharedValue(0);
  const calm = !urgent && !warning && !accepted;
  useEffect(() => {
    if (reducedMotion || !calm) {
      cancelAnimation(breathe);
      breathe.value = withTiming(0, { duration: 200 });
      return;
    }
    breathe.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 1200, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(breathe);
  }, [reducedMotion, calm, breathe]);
  const breathStyle = useAnimatedStyle(() => ({ opacity: 0.35 + breathe.value * 0.45 }));

  /**
   * THE WINDOW, DRAINING ACROSS THE TOP EDGE.
   *
   * The ring is the FOCAL countdown and it sits beside the fare, which means
   * the two most prominent things on the card were competing for the same
   * glance. This rail is the peripheral copy of the same fact: it runs the full
   * width of the card's top edge, so a driver reading the addresses still sees
   * the time going without moving their eyes to the ring.
   *
   * One linear timing to zero, exactly like `CountdownRing` â€” time is linear and
   * an eased bar lies about how much of it is left.
   */
  const rail = useSharedValue(1);
  useEffect(() => {
    const remaining = offer.expiresAtServerMs != null ? Math.max(0, offer.expiresAtServerMs - nowMs) : 0;
    cancelAnimation(rail);
    if (!offer.expiresAtServerMs || remaining <= 0 || windowMs <= 0) {
      rail.value = offer.expiresAtServerMs ? 0 : 1;
      return;
    }
    rail.value = Math.min(1, remaining / windowMs);
    rail.value = withTiming(0, { duration: remaining, easing: Easing.linear });
    return () => cancelAnimation(rail);
  }, [offer.expiresAtServerMs, windowMs, nowMs, rail]);
  const railStyle = useAnimatedStyle(() => ({ width: `${Math.max(0, rail.value) * 100}%` }));

  /**
   * Escalating haptics, on the same boundaries as the colour.
   *
   * Fired against the SECOND, not the render: React may render a component many
   * times within one second and a buzz is not idempotent â€” this is the bug that
   * made the old screen vibrate twice per tick at 500 ms.
   */
  const lastBuzz = useRef<number | null>(null);
  useEffect(() => {
    if (secondsLeft == null || secondsLeft <= 0 || accepted) return;
    if (secondsLeft > 10 || secondsLeft === lastBuzz.current) return;
    lastBuzz.current = secondsLeft;
    void Haptics.notificationAsync(
      secondsLeft <= 5
        ? Haptics.NotificationFeedbackType.Error
        : Haptics.NotificationFeedbackType.Warning,
    ).catch(() => {});
  }, [secondsLeft, accepted]);

  /**
   * PASS IS TWO TAPS, AND THE FIRST ONE HAS TO LOOK LIKE SOMETHING.
   *
   * BUGFIX (item 5: "if I click on the cancel button on the dispatch cards,
   * nothing happens").
   *
   * The arming tap only swapped a text label and a border tint on a button
   * sitting under a 34pt fare and a sweeping countdown ring â€” on a phone at
   * arm's length that is indistinguishable from a dead control. The two-tap
   * design is right (an Alert over a live countdown steals the seconds the
   * driver is being timed on, and on iOS it can land after the offer has moved
   * on) so the fix is to make the armed state unmissable rather than to remove
   * it: a haptic thump, a filled destructive button, and a countdown that shows
   * the window closing.
   */
  const [declineArmed, setDeclineArmed] = useState(false);
  const [armSeconds, setArmSeconds] = useState(0);
  useEffect(() => {
    if (!declineArmed) {
      setArmSeconds(0);
      return;
    }
    const ARM_WINDOW_S = 4;
    setArmSeconds(ARM_WINDOW_S);
    const tick = setInterval(() => setArmSeconds((n) => Math.max(0, n - 1)), 1000);
    const t = setTimeout(() => setDeclineArmed(false), ARM_WINDOW_S * 1000);
    return () => {
      clearInterval(tick);
      clearTimeout(t);
    };
  }, [declineArmed]);

  const isReassignment = offer.kind === 'REASSIGNMENT';
  const isRequest = offer.kind === 'REQUEST';

  const pickupKm = kmBetween(driverAt, offer.pickup);
  const rideKm = kmBetween(offer.pickup, offer.dropoff);
  const etaMin = offer.etaSeconds != null ? Math.max(1, Math.round(offer.etaSeconds / 60)) : null;

  const earnings = offer.driverEarningsPesewas ?? offer.farePesewas ?? null;

  /**
   * WHAT THE JOB IS WORTH PER KILOMETRE DRIVEN â€” including the dead leg.
   *
   * The single number an experienced driver actually decides on, and the card
   * did not have it. A â‚µ28 fare is a good job at 4 km and a poor one at 14, and
   * the pickup leg counts: those kilometres are driven for nothing, which is
   * precisely why a far pickup is worth refusing. Adding them to the
   * denominator is what makes two offers comparable at a glance.
   *
   * Hidden rather than approximated when either distance is unknown â€” a rate
   * computed from half the journey is worse than no rate at all.
   */
  const ratePerKm =
    earnings != null && rideKm != null && rideKm > 0
      ? earnings / (rideKm + (pickupKm ?? 0))
      : null;

  /**
   * The card's contents, identical in both variants. Only the SHELL differs â€”
   * see the note on `variant`. Extracted so the two branches cannot drift into
   * two different offer layouts, which is exactly how this app ended up with two
   * unrelated offer surfaces in the first place.
   */
  const inner = (
    <View style={isSheet ? styles.sheetCard : styles.card}>
      {/* The window, draining. Sits above everything so it is never covered by
          the map's own gradient. */}
      {offer.expiresAtServerMs ? (
        <View style={styles.railTrack} pointerEvents="none">
          <Animated.View style={[styles.rail, { backgroundColor: accent }, railStyle]} />
        </View>
      ) : null}

      {/* A grabber, so the panel reads as an edge of the screen the driver can
          push against rather than a card that has been cropped by it. */}
      {isSheet ? (
        <View style={styles.grabberWrap} pointerEvents="none">
          <View style={[styles.grabber, { backgroundColor: colors.outline }]} />
        </View>
      ) : null}

      {withMap ? (
        <View>
          <DispatchMiniMap
            pickup={offer.pickup}
            dropoff={offer.dropoff}
            driver={driverAt}
            height={mapHeight}
            accent={accent}
          />
          {/* Carries the map into the panel. Without it the glass panel's top
              edge was a hard horizontal seam across the card. */}
          <LinearGradient
            pointerEvents="none"
            colors={['transparent', colors.surfaceCard + 'AA', colors.surfaceCard]}
            locations={[0, 0.62, 1]}
            style={styles.mapFade}
          />
          {/* The breathing rim â€” see `breathe`. A hairline, not a shape: it
              reads as the card being alive rather than as another element. */}
          <Animated.View
            pointerEvents="none"
            style={[styles.liveRim, { backgroundColor: accent }, breathStyle]}
          />
        </View>
      ) : null}

      {/* The badge floats ON the map in the card variant; in the sheet it sits
          at the head of the panel, where the map is behind rather than above. */}
      <View style={withMap ? styles.mapBadges : styles.sheetBadges} pointerEvents="none">
        <View style={[styles.kindBadge, { borderColor: accent + '66', backgroundColor: colors.background + 'CC' }]}>
          <View style={[styles.kindDot, { backgroundColor: accent }]} />
          <Text style={[styles.kindLabel, { color: accent }]}>
            {isReassignment ? 'UP FOR GRABS' : isRequest ? 'RIDE REQUEST' : 'NEW OFFER'}
          </Text>
        </View>
        {offer.attempt != null && offer.totalCandidates ? (
          <View style={[styles.kindBadge, { borderColor: colors.rimLight, backgroundColor: colors.background + 'CC' }]}>
            <Text style={[styles.kindLabel, { color: colors.onSurfaceVariant }]}>
              {offer.attempt} OF {offer.totalCandidates}
            </Text>
          </View>
        ) : null}
      </View>

      {/* â”€â”€ The glass panel â”€â”€ */}
      <View style={[styles.panel, isSheet && styles.sheetPanel]}>
        <GlassSurface style={StyleSheet.absoluteFill} borderRadius={0} intensity="high" />

        {/*
          MONEY IS THE HERO. The clock is beside it, deliberately smaller.

          These used to be the same visual weight, which left the eye with no
          first stop on a card that has about two seconds of attention. The fare
          now owns the row: bigger, with the per-km rate and the tier under it,
          while the ring drops to 84pt and hands most of its urgency job to the
          rail on the top edge.
        */}
        <View style={styles.headRow}>
          <View style={styles.money}>
            <Text style={styles.moneyLabel}>YOU EARN</Text>
            <Text
              style={[styles.earnings, { color: colors.onSurface }]}
              accessibilityLabel={earnings != null ? `You earn ${formatGhs(earnings)}` : 'Earnings unknown'}
            >
              {earnings != null ? formatGhs(earnings) : 'â€”'}
            </Text>
            <View style={styles.chipRow}>
              {/* The tier, in the tier's own colour and its human label â€”
                  "Economy", never the wire's "ECO". */}
              {offer.tier ? (
                <View style={[styles.chip, { backgroundColor: tier.accent + '1A' }]}>
                  <Ionicons name={tier.icon} size={10} color={tier.accent} />
                  <Text style={[styles.chipText, { color: tier.accent }]}>
                    {tier.label.toUpperCase()}
                  </Text>
                </View>
              ) : null}
              {/* Earnings per kilometre DRIVEN, dead leg included â€” the number
                  the decision is actually made on. See `ratePerKm`. */}
              {ratePerKm != null ? (
                <View style={[styles.chip, { backgroundColor: colors.surfaceContainerHigh }]}>
                  <Text style={[styles.chipText, { color: colors.onSurface }]}>
                    {formatGhs(Math.round(ratePerKm))}/KM
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {secondsLeft != null && offer.expiresAtServerMs ? (
            <CountdownRing
              expiresAtMs={offer.expiresAtServerMs}
              windowMs={windowMs}
              nowMs={nowMs}
              // Was 96, matching the fare's weight. The rail on the top edge now
              // carries the peripheral half of this job, so the ring can step
              // back and let the money lead.
              size={84}
              stroke={4.5}
              color={accent}
              trackColor={colors.outline}
            >
              <Text style={[styles.timerDigits, { color: accent }]}>
                {String(Math.max(0, secondsLeft)).padStart(2, '0')}
              </Text>
              <Text variant="caption" color={colors.onSurfaceVariant} style={{ marginTop: -2 }}>
                sec
              </Text>
            </CountdownRing>
          ) : (
            <View style={[styles.openBadge, { borderColor: accent + '55' }]}>
              <Ionicons name="flash" size={18} color={accent} />
              <Text style={[styles.chipText, { color: accent, marginTop: 2 }]}>OPEN</Text>
            </View>
          )}
        </View>

        {/*
          THE THREE NUMBERS THAT SIZE THE JOB.

          They existed before, scattered: the pickup ETA was a caption beside
          the word PICKUP, the ride distance was a grey chip under the fare, and
          the dead-leg distance was in the same caption as the ETA. A driver
          comparing two offers had to hunt for each one in a different place.

          One strip, three cells, tabular figures so the digits do not shift
          between renders (Â§6 `number-tabular`) â€” and dividers rather than boxes,
          because three more bordered rectangles on a card this dense is noise.
        */}
        {(etaMin != null || pickupKm != null || rideKm != null) && (
          <View style={styles.stats}>
            <Stat
              colors={colors}
              icon="navigate-outline"
              label="TO PICKUP"
              value={etaMin != null ? `${etaMin} min` : pickupKm != null ? `${pickupKm.toFixed(1)} km` : 'â€”'}
              sub={etaMin != null && pickupKm != null ? `${pickupKm.toFixed(1)} km` : null}
              accent={accent}
            />
            <View style={[styles.statDivider, { backgroundColor: colors.outline }]} />
            <Stat
              colors={colors}
              icon="git-commit-outline"
              label="RIDE"
              value={rideKm != null ? `${rideKm.toFixed(1)} km` : 'â€”'}
              sub={null}
            />
            <View style={[styles.statDivider, { backgroundColor: colors.outline }]} />
            <Stat
              colors={colors}
              icon="wallet-outline"
              label="FARE"
              value={offer.farePesewas != null ? formatGhs(offer.farePesewas) : 'â€”'}
              sub={
                earnings != null && offer.farePesewas != null && offer.farePesewas > earnings
                  ? `you keep ${Math.round((earnings / offer.farePesewas) * 100)}%`
                  : null
              }
            />
          </View>
        )}

        {/* â”€â”€ The ride, as a spine â”€â”€ */}
        <View style={styles.spine}>
          <View style={styles.spineRail}>
            <View style={[styles.spineDot, { backgroundColor: accent }]} />
            <View style={[styles.spineLine, { backgroundColor: colors.outline }]} />
            <Ionicons name="location" size={13} color={colors.error} />
          </View>

          <View style={styles.spineBody}>
            <View>
              <View style={styles.legHead}>
                <Text variant="caption" color={colors.onSurfaceVariant}>PICKUP</Text>
                {pickupKm != null || etaMin != null ? (
                  <Text variant="caption" color={accent}>
                    {[etaMin != null ? `${etaMin} min` : null, pickupKm != null ? `${pickupKm.toFixed(1)} km` : null]
                      .filter(Boolean)
                      .join(' Â· ')}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.legText} numberOfLines={2}>
                {offer.pickupAddress ?? 'Pickup point on the map'}
              </Text>
            </View>

            <View style={{ marginTop: spacing.md }}>
              <Text variant="caption" color={colors.onSurfaceVariant}>DROP-OFF</Text>
              <Text style={styles.legText} numberOfLines={2}>
                {offer.dropoffAddress ?? 'Destination on the map'}
              </Text>
            </View>
          </View>
        </View>

        {isReassignment || isRequest ? (
          <Text variant="caption" color={colors.onSurfaceVariant} style={styles.rule}>
            First driver to accept gets it â€” this one is not being held for you.
          </Text>
        ) : null}

        {/*
          THE WALLET NOTICE — the thing the driver used to find out at the kerb.

          Sits directly ON the swipe control, not up in the fare block, because
          it is a fact about the decision the driver is about to make with their
          thumb. The swipe stays ENABLED: the server is the authority on whether
          a claim is allowed, and a client that grays out the control on a stale
          balance would cost a driver a ride they could have taken. This warns;
          `assertCanAffordTrip` decides.
        */}
        {walletShortfall > 0 ? (
          <View style={[styles.walletNote, { borderColor: colors.statusWarning + '55', backgroundColor: colors.statusWarning + '14' }]}>
            <Ionicons name="wallet-outline" size={15} color={colors.statusWarning} />
            <Text variant="bodySmall" color={colors.onSurface} style={{ flex: 1, lineHeight: 17 }}>
              Cash ride — {formatGhs(walletRequired)} commission comes out of your wallet when you
              board. You are {formatGhs(walletShortfall)} short.
            </Text>
          </View>
        ) : walletRequired > 0 ? (
          <View style={styles.walletHint}>
            <Ionicons name="cash-outline" size={13} color={colors.onSurfaceVariant} />
            <Text variant="caption" color={colors.onSurfaceVariant}>
              Cash ride — {formatGhs(walletRequired)} commission is taken from your wallet at boarding
            </Text>
          </View>
        ) : null}

        {/* â”€â”€ Actions â”€â”€ */}
        <View style={styles.actions}>
          <SwipeToConfirm
            label={accepted ? 'Accepted' : 'Swipe to accept'}
            loadingLabel="Claimingâ€¦"
            confirmedLabel="Yours"
            onConfirm={onAccept}
            loading={busy === 'accept'}
            confirmed={accepted}
            disabled={!!busy || accepted || (secondsLeft != null && secondsLeft <= 0)}
            color={accent}
            onColor={colors.background}
            trackColor={colors.surfaceContainerHigh}
            borderColor={colors.outline}
            height={58}
          />

          <Pressable
            onPress={() => {
              if (busy || accepted) return;
              if (!declineArmed) {
                // A WARNING notification, not a selection tick. The first tap
                // changes what the second tap will do, and the driver has to
                // feel that through a phone mount without looking.
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
                setDeclineArmed(true);
                return;
              }
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
              onDecline();
            }}
            disabled={!!busy || accepted}
            accessibilityRole="button"
            accessibilityLabel={declineArmed ? 'Confirm pass on this trip' : 'Pass on this trip'}
            style={({ pressed }) => [
              styles.decline,
              declineArmed && {
                borderColor: colors.error,
                backgroundColor: colors.error,
              },
              pressed && { opacity: 0.7 },
              busy === 'decline' && { opacity: 0.6 },
            ]}
          >
            <View style={styles.declineInner}>
              {declineArmed ? (
                <Ionicons name="close-circle" size={16} color={colors.background} />
              ) : null}
              <Text
                style={[
                  styles.declineText,
                  { color: declineArmed ? colors.background : colors.onSurfaceVariant },
                ]}
              >
                {busy === 'decline'
                  ? 'Passingâ€¦'
                  : declineArmed
                    ? `Tap again to pass Â· ${armSeconds}`
                    : 'Pass'}
              </Text>
            </View>
          </Pressable>

          {/* Says out loud what passing now costs, because it is no longer
              permanent â€” see `declineCooldownSeconds` on the server. The old
              copy said nothing, and a driver who had passed once believed the
              ride was gone for good. */}
          {declineArmed ? (
            <Text variant="caption" color={colors.onSurfaceVariant} style={styles.declineNote}>
              It goes to the next driver. If nobody takes it, it comes back to your board.
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );

  /**
   * The sheet variant is its own shell: no ring, flat bottom, top corners only.
   * See the note on `variant` for why a ring here made the screen worse.
   */
  if (isSheet) return inner;

  return (
    /**
     * â”€â”€ THE OFFER CARD, REBUILT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     *
     * "Make the page more aesthetic and premium. Think about it in a new light."
     *
     * What was wrong with it, specifically:
     *
     *  1. NO IDENTITY. Every offer was the same driver blue. A Premium fare and
     *     an Economy one were distinguishable only by a grey text chip.
     *  2. TWO FOCAL POINTS. A 34pt fare and a 96pt countdown ring sat side by
     *     side at the same weight, so the eye had nowhere to land first on a
     *     surface that exists to be read in about two seconds.
     *  3. A VISIBLE SEAM. `GlassSurface` with `borderRadius: 0` butted straight
     *     against the map, so the card read as two stacked rectangles rather
     *     than one object.
     *  4. NO ANSWER TO THE REAL QUESTION. "Is this job worth taking" is
     *     earnings Ã· total kilometres, and the card made the driver do that
     *     arithmetic from two numbers in two different places.
     *
     * The rebuild: a tier-coloured glow ring around the whole card (the same
     * family as every other lit surface in this app), a draining rail on the
     * top edge so urgency is peripheral, one hero money block with the per-km
     * rate under it, a three-cell tabular stat strip, and a gradient that
     * carries the map down into the panel so the two are one surface.
     */
    <GradientGlowBorder
      palette={ringPalette}
      fillColor={colors.surfaceCard}
      borderRadius={radii['3xl']}
      thickness={urgent ? 'regular' : 'thin'}
      glow
      glowIntensity={urgent ? 1 : 0.7}
      maxGlowRadius={urgent ? 26 : 18}
    >
      {inner}
    </GradientGlowBorder>
  );
}

/**
 * One cell of the stat strip.
 *
 * Deliberately dumb and local: three cells with identical structure, so they
 * line up on the baseline and the strip cannot drift out of alignment the way
 * three hand-written blocks did.
 */
function Stat({
  colors,
  icon,
  label,
  value,
  sub,
  accent,
}: {
  colors: DriverColors;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  sub?: string | null;
  accent?: string;
}) {
  return (
    <View style={statStyles.cell} accessibilityLabel={`${label}: ${value}${sub ? `, ${sub}` : ''}`}>
      <View style={statStyles.head}>
        <Ionicons name={icon} size={11} color={accent ?? colors.onSurfaceVariant} />
        <Text style={[statStyles.label, { color: colors.onSurfaceVariant }]}>{label}</Text>
      </View>
      <Text style={[statStyles.value, { color: accent ?? colors.onSurface }]} numberOfLines={1}>
        {value}
      </Text>
      {sub ? (
        <Text style={[statStyles.sub, { color: colors.onSurfaceVariant }]} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

const statStyles = StyleSheet.create({
  cell: { flex: 1, gap: 3 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  label: { fontFamily: fonts.bold, fontSize: 9, letterSpacing: 0.9 },
  value: {
    fontFamily: fonts.displayBold,
    fontSize: 17,
    lineHeight: 21,
    letterSpacing: -0.3,
    // Digits must not shift width between renders while a countdown is running
    // next to them â€” Â§6 `number-tabular`.
    fontVariant: ['tabular-nums'],
  },
  sub: { fontFamily: fonts.regular, fontSize: 10.5, lineHeight: 14 },
});

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    card: {
      // The ring outside now owns the border, so a hairline here would draw a
      // second rim a pixel inside the first.
      borderRadius: radii['3xl'] - 2,
      overflow: 'hidden',
      backgroundColor: colors.surfaceCard,
    },
    /**
     * ── THE SHEET VARIANT ────────────────────────────────────────────────────
     *
     * Top corners only, flat bottom, no ring — it is docked to the bottom of a
     * full-bleed map and reads as an edge of the screen. A hairline top rim
     * rather than a glow: over a moving map a glow smears, and the map behind
     * already provides all the separation this needs.
     */
    sheetCard: {
      borderTopLeftRadius: radii['3xl'],
      borderTopRightRadius: radii['3xl'],
      overflow: 'hidden',
      backgroundColor: colors.surfaceCard,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.rimLight,
    },
    grabberWrap: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: 2 },
    grabber: { width: 38, height: 4, borderRadius: 2, opacity: 0.7 },
    /** In the sheet the badges are content, not an overlay on a map. */
    sheetBadges: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: spacing.sm,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.sm,
    },
    /** The head padding is carried by `sheetBadges`, so the panel starts tighter. */
    sheetPanel: { paddingTop: spacing.base },

    /** The offer window, draining left to right along the card's top edge. */
    railTrack: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 3,
      zIndex: 3,
      backgroundColor: colors.rimLightSubtle,
    },
    rail: { height: '100%', borderTopLeftRadius: 3, borderBottomRightRadius: 3 },
    /** Carries the map down into the glass panel so the card is one surface. */
    mapFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 88 },
    /** A breathing hairline where the map meets the panel. */
    liveRim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 1 },
    mapBadges: {
      position: 'absolute',
      top: spacing.base,
      left: spacing.base,
      right: spacing.base,
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    kindBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: spacing.md,
      paddingVertical: 5,
      borderRadius: radii.full,
      borderWidth: 1,
    },
    kindDot: { width: 6, height: 6, borderRadius: 3 },
    kindLabel: { fontFamily: fonts.bold, fontSize: 9.5, letterSpacing: 0.9 },

    panel: { padding: spacing.xl, gap: spacing.lg, overflow: 'hidden' },

    headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.base },
    money: { flex: 1, gap: 2 },
    moneyLabel: {
      fontFamily: fonts.bold,
      fontSize: 9.5,
      letterSpacing: 1.2,
      color: colors.onSurfaceVariant,
    },
    earnings: {
      fontFamily: fonts.displayBold,
      // Up from 34: this is the hero and the ring stepped back to make room.
      fontSize: 40,
      lineHeight: Math.round(40 * 1.12),
      letterSpacing: -1.6,
      fontVariant: ['tabular-nums'],
    },
    chipRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs, flexWrap: 'wrap' },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: radii.sm,
    },
    chipText: { fontFamily: fonts.bold, fontSize: 9.5, letterSpacing: 0.7 },

    /** The three-number strip. Dividers, not boxes â€” see its render comment. */
    stats: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.base,
      borderRadius: radii.lg,
      backgroundColor: colors.surfaceContainerHigh + '99',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.rimLightSubtle,
    },
    statDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', opacity: 0.6 },
    timerDigits: {
      fontFamily: fonts.displayBold,
      fontSize: 30,
      lineHeight: Math.round(30 * 1.15),
      letterSpacing: -1.5,
    },
    openBadge: {
      width: 96, height: 96, borderRadius: 48, borderWidth: 1,
      alignItems: 'center', justifyContent: 'center',
    },

    spine: { flexDirection: 'row', gap: spacing.md },
    spineRail: { width: 16, alignItems: 'center', paddingTop: 16 },
    spineDot: { width: 9, height: 9, borderRadius: 5 },
    spineLine: { width: 1.5, flex: 1, minHeight: 26, marginVertical: 5, borderRadius: 1 },
    spineBody: { flex: 1 },
    legHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    legText: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyLarge,
      lineHeight: Math.round(fontSizes.bodyLarge * 1.35),
      color: colors.onSurface,
      marginTop: 1,
    },
    rule: { lineHeight: 16 },

    /** The "you are short" bar — see the note where it renders. */
    walletNote: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      marginTop: spacing.base,
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderRadius: radii.lg,
      borderWidth: 1,
    },
    /** The quieter version, for a driver who can afford it. */
    walletHint: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.base,
      marginBottom: spacing.xs,
      paddingHorizontal: spacing.xs,
    },
    actions: { gap: spacing.md },
    decline: {
      alignSelf: 'center',
      paddingHorizontal: spacing.xl,
      // 44pt minimum touch target (Â§2 `touch-target-size`). The old
      // `spacing.md` padding put this at roughly 40 and it is the one control
      // on the card a driver reaches for without looking.
      minHeight: 46,
      justifyContent: 'center',
      borderRadius: radii.full,
      borderWidth: 1,
      borderColor: 'transparent',
      minWidth: 176,
      alignItems: 'center',
    },
    declineInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    declineText: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, letterSpacing: 0.2 },
    declineNote: { textAlign: 'center', lineHeight: 16, marginTop: -spacing.xs },
  });

export default DispatchOfferCard;
