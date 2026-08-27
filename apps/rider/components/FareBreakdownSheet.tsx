import React, { useMemo } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radii } from '@eyego/config';
import { Text, PanelSheet } from '@eyego/ui';
// The same formatter the Base fare / Total rows behind this sheet use, so the
// headline here cannot drift from them again.
import { formatGhs } from '@eyego/utils';
import { useColors, Colors } from '../utils/useColors';

/**
 * Per-trip fare breakdown bottom sheet.
 *
 * Motion comes from the shared `PanelSheet` engine (spring open, velocity
 * drag-to-dismiss, derived backdrop) — this component owns content only.
 *
 * ── EVERY LINE IN HERE IS A REAL NUMBER, OR IT IS NOT IN HERE ───────────────
 *
 * BUGFIX ("on the book-this-seat page it shows base fare as 55.19, but on the
 * price breakdown it shows promotion 10% and all — make sure the price
 * breakdown is very dynamic and accurate so it's correctly presented per ride").
 *
 * The sheet had two branches. The on-demand one itemises the server's own quote
 * and is correct. The other one — the branch a shared-route seat lands on,
 * because a group trip is priced on the trip card and never produces a
 * `POST /rides/quote` breakdown — rendered four CONSTANTS typed in from a
 * reference screenshot:
 *
 *     Wait time    GH₵0.98/MIN
 *     Booking Fee  6.1%
 *     Platform Fee GH₵1.00
 *     Promotion    10%
 *
 * None of them were computed from anything. The promotion was the worst of the
 * four because it is the only one that claims money back: a rider looking at a
 * GH₵55.19 seat was told they were getting 10% off a fare that had no discount
 * on it, in the one control whose entire job is to justify the number above it.
 * The others were quieter but no better — they would have kept quoting 6.1%
 * forever after an admin retuned the rate from the console.
 *
 * The rule now: a line appears when there is a value behind it. A shared-route
 * seat genuinely has fewer lines than a metered on-demand ride — it is a fixed
 * seat price, not a meter — so it shows the seat price, the journey it buys,
 * whatever surcharges are actually on this booking, and the total. Fewer honest
 * rows beat a full-looking table of invented ones.
 */
export interface FareBreakdownSheetProps {
  visible: boolean;
  onClose: () => void;
  /**
   * PESEWAS, like every other fare in the codebase.
   *
   * This was `fare: number` with no unit in the name, and the caller passed
   * pesewas — the same value it hands to `formatGhs()` for the Base fare and
   * Total rows right behind this sheet. Rendered raw it read "GH₵720" over a
   * page saying 7.20, so the one control whose entire job is to explain the
   * price was the only place that got it wrong by a factor of a hundred.
   * Named for its unit so a caller cannot make that mistake silently again.
   */
  farePesewas: number;
  seats: number;
  /** show the "prices temporarily higher" banner (surgeMultiplier > 1) */
  surge?: boolean;
  /**
   * ── THE SHARED-SEAT LINES ────────────────────────────────────────────────
   *
   * Everything below describes a fixed-price seat on a route trip, which is the
   * case that used to render invented constants. Each one is optional and each
   * one is omitted from the render when it is absent, so the sheet can only ever
   * say things the caller actually knows.
   */
  /** Price of ONE seat. `farePesewas × seats` is the total, by construction. */
  perSeatPesewas?: number | null;
  /** Road distance the seat buys, in km. */
  distanceKm?: number | null;
  /** Road duration, in minutes. */
  durationMin?: number | null;
  /** Charged when the rider moved their pickup off the trip's own stop. */
  deviationSurchargePesewas?: number | null;
  /** Charged when the rider declared heavy luggage. */
  cargoSurchargePesewas?: number | null;
  /**
   * A REAL promotion, in pesewas off the fare — never a percentage this
   * component made up. Absent or zero hides the row entirely.
   */
  promotionPesewas?: number | null;
  /**
   * The SERVER's own breakdown of this quote, straight off `POST /rides/quote`.
   *
   * Every line below used to be a hardcoded market default — a wait rate, a
   * booking percentage and a flat platform fee typed in from the reference
   * screenshots. They happened to match the operator's card, which is worse
   * than not matching it: the one control whose entire job is to explain the
   * price was explaining a price nobody computed, and it would have kept
   * showing 6.1% and GH₵1.00 for the rest of time after an admin retuned
   * either one from the console.
   *
   * Supplied, these win and the sheet shows what the rider is actually paying,
   * in pesewas like every other fare in the codebase. Absent (an older quote,
   * a shared-trip seat priced on the group card) the defaults above still
   * render, so nothing goes blank.
   */
  breakdown?: RideFareBreakdown | null;
  /**
   * What this rider's standing took off the fare, in pesewas.
   *
   * Straight off the quote (`fare-quote.service` applies it before signing, so
   * this is the real saving and not an estimate of one). Zero — the default —
   * hides the row entirely: a rider who has not earned a discount should not be
   * shown one worth nothing.
   */
  loyaltyDiscountPesewas?: number;
}

/** The on-demand fare lines `calculateRideFare` returns. All integer pesewas. */
export interface RideFareBreakdown {
  ridePesewas?: number;
  startFarePesewas?: number;
  distanceComponentPesewas?: number;
  timeComponentPesewas?: number;
  waitComponentPesewas?: number;
  bookingFeePesewas?: number;
  /** Ratio, not percent: 0.061 is 6.1%. */
  bookingFeeRate?: number;
  platformFeePesewas?: number;
  minFarePesewas?: number;
  floorApplied?: boolean;
  doorstepSurchargePesewas?: number;
  heavyLoadSurchargePesewas?: number;
  distanceKm?: number;
  durationMin?: number;
}

export function FareBreakdownSheet({
  visible,
  onClose,
  farePesewas,
  seats,
  surge = false,
  perSeatPesewas = null,
  distanceKm = null,
  durationMin = null,
  deviationSurchargePesewas = null,
  cargoSurchargePesewas = null,
  promotionPesewas = null,
  breakdown = null,
  loyaltyDiscountPesewas = 0,
}: FareBreakdownSheetProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const hasServerLines = !!breakdown && typeof breakdown.ridePesewas === 'number';
  const px = (n: number | undefined) => (typeof n === 'number' ? n : 0);

  /**
   * The shared-seat rows, built from what the caller could actually supply.
   *
   * `.filter(Boolean)` at the end is the whole design: a row that has no number
   * behind it does not exist, rather than falling back to a plausible constant.
   * If every optional field is missing this collapses to the seat price and the
   * total, which is exactly as much as we honestly know.
   */
  const seatRows = useMemo(() => {
    const unit = perSeatPesewas ?? (seats > 0 ? Math.round(farePesewas / seats) : farePesewas);
    const rows: { label: string; value: string; accent?: boolean }[] = [];

    rows.push({
      label: seats > 1 ? `Seat fare (× ${seats})` : 'Seat fare',
      value: formatGhs(unit),
    });

    if (typeof distanceKm === 'number' && distanceKm > 0) {
      rows.push({ label: 'Distance', value: `${distanceKm.toFixed(1)} km` });
    }
    if (typeof durationMin === 'number' && durationMin > 0) {
      rows.push({ label: 'Journey time', value: `${Math.round(durationMin)} min` });
    }
    if (px(deviationSurchargePesewas ?? undefined) > 0) {
      rows.push({ label: 'Pickup detour', value: formatGhs(deviationSurchargePesewas as number) });
    }
    if (px(cargoSurchargePesewas ?? undefined) > 0) {
      rows.push({ label: 'Heavy cargo', value: formatGhs(cargoSurchargePesewas as number) });
    }
    if (px(promotionPesewas ?? undefined) > 0) {
      rows.push({
        label: 'Promotion',
        value: `− ${formatGhs(promotionPesewas as number)}`,
        accent: true,
      });
    }
    if (loyaltyDiscountPesewas > 0) {
      rows.push({
        label: 'Good standing discount',
        value: `− ${formatGhs(loyaltyDiscountPesewas)}`,
        accent: true,
      });
    }
    return rows;
  }, [
    perSeatPesewas, seats, farePesewas, distanceKm, durationMin,
    deviationSurchargePesewas, cargoSurchargePesewas, promotionPesewas,
    loyaltyDiscountPesewas,
  ]);

  return (
    <PanelSheet visible={visible} onDismiss={onClose} maxHeightPct={0.8} sheetStyle={styles.sheet}>
      <View style={styles.headerRow}>
        <Text variant="titleMedium">Price details</Text>
        <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
          <Ionicons name="close" size={22} color={colors.onSurface} />
        </Pressable>
      </View>

      {/* Surge banner */}
      {surge && (
        <View style={styles.surgeBanner} accessibilityRole="alert">
          <Ionicons name="chevron-up" size={18} color={'#A66A00'} />
          <Text variant="bodySmall" style={{ flex: 1, color: '#7A4E00' }}>
            Prices are temporarily higher due to increased demand.
          </Text>
        </View>
      )}

      {/* Fare headline */}
      <View style={styles.fareHeader}>
        <Text variant="titleLarge">Fare</Text>
        <Text variant="fareMedium" color={colors.onSurface} style={{ fontWeight: '700' }}>
          {formatGhs(farePesewas)}
        </Text>
      </View>

      {hasServerLines ? (
        <>
          {/* The metered ride, itemised exactly as the server priced it. */}
          <DottedRow label="Start fare" value={formatGhs(px(breakdown!.startFarePesewas))} colors={colors} styles={styles} />
          <DottedRow
            label={breakdown!.distanceKm ? `Distance (${breakdown!.distanceKm} km)` : 'Distance'}
            value={formatGhs(px(breakdown!.distanceComponentPesewas))}
            colors={colors}
            styles={styles}
          />
          <DottedRow
            label={breakdown!.durationMin ? `Time (${Math.round(breakdown!.durationMin)} min)` : 'Time'}
            value={formatGhs(px(breakdown!.timeComponentPesewas))}
            colors={colors}
            styles={styles}
          />
          {px(breakdown!.waitComponentPesewas) > 0 && (
            <DottedRow label="Wait time" value={formatGhs(px(breakdown!.waitComponentPesewas))} colors={colors} styles={styles} />
          )}
          {px(breakdown!.doorstepSurchargePesewas) > 0 && (
            <DottedRow label="Door pickup" value={formatGhs(px(breakdown!.doorstepSurchargePesewas))} colors={colors} styles={styles} />
          )}
          {px(breakdown!.heavyLoadSurchargePesewas) > 0 && (
            <DottedRow label="Heavy cargo" value={formatGhs(px(breakdown!.heavyLoadSurchargePesewas))} colors={colors} styles={styles} />
          )}
          {/* Says WHY the price did not move with the distance, instead of
              leaving the rider to work out that two trips cost the same. */}
          {breakdown!.floorApplied && (
            <DottedRow
              label="Minimum fare applied"
              value={formatGhs(px(breakdown!.minFarePesewas))}
              colors={colors}
              styles={styles}
            />
          )}
          <DottedRow
            label={`Booking fee (${((breakdown!.bookingFeeRate ?? 0) * 100).toFixed(1)}%)`}
            value={formatGhs(px(breakdown!.bookingFeePesewas))}
            colors={colors}
            styles={styles}
          />
          <DottedRow label="Platform fee" value={formatGhs(px(breakdown!.platformFeePesewas))} colors={colors} styles={styles} />
          {/*
            THE LOYALTY DISCOUNT, SHOWN.

            "Riders with fewer cancellations should get better pricing" only
            changes anybody's behaviour if they can see that it did. The server
            returns the saving on every quote (`loyaltyDiscountPesewas`, see
            fare-quote.service); zero for a rider who has not earned one, in
            which case this row is simply absent rather than a distracting
            "— GH₵0.00".
          */}
          {loyaltyDiscountPesewas > 0 && (
            <DottedRow
              label="Good standing discount"
              value={`− ${formatGhs(loyaltyDiscountPesewas)}`}
              colors={colors}
              styles={styles}
              accent
            />
          )}
          <DottedRow label="Seats" value={String(seats)} colors={colors} styles={styles} />
        </>
      ) : (
        /* A fixed-price seat on a shared route. See the note at the top of this
           file for why this branch has no wait rate, no booking-fee percentage
           and no promotion unless one genuinely applies. */
        <>
          {seatRows.map((r) => (
            <DottedRow
              key={r.label}
              label={r.label}
              value={r.value}
              accent={r.accent}
              colors={colors}
              styles={styles}
            />
          ))}
          <DottedRow label="Total" value={formatGhs(farePesewas)} colors={colors} styles={styles} bold />
        </>
      )}

      <Text variant="caption" color={colors.onSurfaceVariant} style={styles.disclaimer}>
        The price estimation can change if actual tolls/surcharges differ from estimation (city based).
        If the journey changes, the price will be based on rates provided.
      </Text>
    </PanelSheet>
  );
}

function DottedRow({
  label,
  value,
  colors,
  styles,
  accent,
  bold,
}: {
  label: string;
  value: string;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
  accent?: boolean;
  /** The settled figure at the foot of the list — heavier, with a rule above. */
  bold?: boolean;
}) {
  return (
    <View style={[styles.row, bold && styles.totalRow]}>
      <Text variant={bold ? 'titleSmall' : 'bodyMedium'} color={colors.onSurface}>{label}</Text>
      <View style={styles.dottedLeader} />
      <Text
        variant={bold ? 'titleSmall' : 'bodyMedium'}
        color={accent ? colors.primary : colors.onSurface}
        // Money must not jitter as digits change width between renders.
        style={styles.rowValue}
      >
        {value}
      </Text>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    sheet: {
      backgroundColor: colors.surfaceCard,
      borderTopLeftRadius: radii['4xl'],
      borderTopRightRadius: radii['4xl'],
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.base,
    },
    surgeBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: '#FCEFC7',
      borderRadius: radii.lg,
      padding: spacing.base,
      marginBottom: spacing.lg,
    },
    fareHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingBottom: spacing.base,
      borderBottomWidth: 1,
      borderBottomColor: colors.outlineVariant,
      marginBottom: spacing.xs,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: spacing.sm,
      paddingVertical: spacing.md,
    },
    /** Tabular figures so the column does not shuffle as amounts change. */
    rowValue: { fontVariant: ['tabular-nums'] },
    totalRow: {
      marginTop: spacing.xs,
      paddingTop: spacing.base,
      borderTopWidth: 1,
      borderTopColor: colors.outlineVariant,
    },
    dottedLeader: {
      flex: 1,
      borderBottomWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.outlineVariant,
      marginBottom: 5,
    },
    disclaimer: {
      marginTop: spacing.lg,
      lineHeight: 18,
    },
  });
