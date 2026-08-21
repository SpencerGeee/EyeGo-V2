import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { formatGhs } from '@eyego/utils';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, GlassSurface, SwipeToConfirm } from '@eyego/ui';
import type { Coord } from '@eyego/maps';

import { useColors, type DriverColors } from '../../utils/useColors';
import { DispatchMiniMap } from './DispatchMiniMap';
import { CountdownRing } from './CountdownRing';

/**
 * ONE OFFER, ONE CARD — used by the takeover sheet AND the dispatch screen.
 *
 * There were two offer surfaces in this app with nothing in common but the verb:
 * `DispatchOfferSheet` (the modal that fires when the cascade reaches you) and
 * `(trip)/dispatch/[id]` (what the Alerts → Dispatch list opens). They had
 * different countdowns, different copy, different accept buttons and different
 * ideas of what an offer even is — the screen read the ride out of NAVIGATION
 * PARAMS, which is why opening one from the list showed two blank lines where
 * the pickup and destination should be: the list passes no params.
 *
 * This is the single rendering of "here is a ride, take it or don't". Both
 * surfaces hand it the same shape and differ only in their chrome.
 *
 * ── THE URGENCY LADDER ─────────────────────────────────────────────────────
 * Calm (accent) → amber under ten seconds → red under five, applied to the
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
  /** "3 of 8" — how deep into the cascade this offer is. */
  attempt?: number | null;
  totalCandidates?: number | null;
  /** DISPATCH · REQUEST · REASSIGNMENT — decides the headline and the rules line. */
  kind?: 'DISPATCH' | 'REQUEST' | 'REASSIGNMENT' | string | null;
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
  /** Hides the map — used where a map cannot be afforded (never, currently). */
  showMap?: boolean;
  mapHeight?: number;
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
}: DispatchOfferCardProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const urgent = secondsLeft != null && secondsLeft <= 5;
  const warning = secondsLeft != null && secondsLeft <= 10 && !urgent;
  const accent = urgent ? colors.error : warning ? colors.statusWarning : colors.accent;

  /**
   * Escalating haptics, on the same boundaries as the colour.
   *
   * Fired against the SECOND, not the render: React may render a component many
   * times within one second and a buzz is not idempotent — this is the bug that
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

  const [declineArmed, setDeclineArmed] = useState(false);
  useEffect(() => {
    if (!declineArmed) return;
    const t = setTimeout(() => setDeclineArmed(false), 3500);
    return () => clearTimeout(t);
  }, [declineArmed]);

  const isReassignment = offer.kind === 'REASSIGNMENT';
  const isRequest = offer.kind === 'REQUEST';

  const pickupKm = kmBetween(driverAt, offer.pickup);
  const rideKm = kmBetween(offer.pickup, offer.dropoff);
  const etaMin = offer.etaSeconds != null ? Math.max(1, Math.round(offer.etaSeconds / 60)) : null;

  const earnings = offer.driverEarningsPesewas ?? offer.farePesewas ?? null;

  return (
    <View style={styles.card}>
      {showMap ? (
        <DispatchMiniMap
          pickup={offer.pickup}
          dropoff={offer.dropoff}
          driver={driverAt}
          height={mapHeight}
          accent={accent}
        />
      ) : null}

      {/* The badge floats ON the map, so the panel below can be pure content. */}
      <View style={styles.mapBadges} pointerEvents="none">
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

      {/* ── The glass panel ── */}
      <View style={styles.panel}>
        <GlassSurface style={StyleSheet.absoluteFill} borderRadius={0} intensity="high" />

        {/* Money and clock, side by side. The two facts that decide it. */}
        <View style={styles.headRow}>
          <View style={styles.money}>
            <Text variant="caption" color={colors.onSurfaceVariant}>You earn</Text>
            <Text style={[styles.earnings, { color: colors.onSurface }]}>
              {earnings != null ? formatGhs(earnings) : '—'}
            </Text>
            <View style={styles.chipRow}>
              {offer.tier ? (
                <View style={[styles.chip, { backgroundColor: colors.surfaceContainerHigh }]}>
                  <Text style={[styles.chipText, { color: colors.onSurfaceVariant }]}>{offer.tier}</Text>
                </View>
              ) : null}
              {rideKm != null ? (
                <View style={[styles.chip, { backgroundColor: colors.surfaceContainerHigh }]}>
                  <Text style={[styles.chipText, { color: colors.onSurfaceVariant }]}>
                    {rideKm.toFixed(1)} KM RIDE
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
              size={96}
              stroke={5}
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

        {/* ── The ride, as a spine ── */}
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
                      .join(' · ')}
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
            First driver to accept gets it — this one is not being held for you.
          </Text>
        ) : null}

        {/* ── Actions ── */}
        <View style={styles.actions}>
          <SwipeToConfirm
            label={accepted ? 'Accepted' : 'Swipe to accept'}
            loadingLabel="Claiming…"
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
              void Haptics.selectionAsync().catch(() => {});
              if (!declineArmed) {
                setDeclineArmed(true);
                return;
              }
              onDecline();
            }}
            disabled={!!busy || accepted}
            accessibilityRole="button"
            accessibilityLabel={declineArmed ? 'Confirm pass on this trip' : 'Pass on this trip'}
            style={({ pressed }) => [
              styles.decline,
              declineArmed && { borderColor: colors.error + '88', backgroundColor: colors.error + '14' },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text
              style={[
                styles.declineText,
                { color: declineArmed ? colors.error : colors.onSurfaceVariant },
              ]}
            >
              {/* Two taps, not a modal. An Alert over a live countdown steals the
                  seconds the driver is being timed on — and on iOS it can land
                  after the offer has already moved on. */}
              {declineArmed ? 'Tap again to pass' : 'Pass'}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    card: {
      borderRadius: radii['3xl'],
      overflow: 'hidden',
      backgroundColor: colors.surfaceCard,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.rimLight,
    },
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
    earnings: {
      fontFamily: fonts.displayBold,
      fontSize: 34,
      lineHeight: Math.round(34 * 1.2),
      letterSpacing: -1.2,
    },
    chipRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs, flexWrap: 'wrap' },
    chip: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radii.sm },
    chipText: { fontFamily: fonts.bold, fontSize: 9.5, letterSpacing: 0.7 },
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

    actions: { gap: spacing.md },
    decline: {
      alignSelf: 'center',
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.md,
      borderRadius: radii.full,
      borderWidth: 1,
      borderColor: 'transparent',
      minWidth: 160,
      alignItems: 'center',
    },
    declineText: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, letterSpacing: 0.2 },
  });

export default DispatchOfferCard;
