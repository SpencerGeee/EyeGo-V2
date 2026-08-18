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
 * Per-trip fare breakdown bottom sheet (matches the client's reference design).
 *
 * Motion comes from the shared `PanelSheet` engine (spring open, velocity
 * drag-to-dismiss, derived backdrop) — this component owns content only.
 *
 * The exact line-item rates (wait-time, booking fee, fixed platform fee) are
 * presentational config — Ghana-market defaults that mirror the reference
 * screenshots and can be wired to backend config later. Fare, seats, promotion
 * and surge come from the live trip so the headline numbers are always real.
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
  promotionPct?: number;
  /** presentational config — override per market/tier when backend exposes them */
  waitTimeRate?: number; // GH₵ per minute
  bookingFeePct?: number;
  /** Cedis, not pesewas — this was misnamed and read as a fixed GH₵ amount. */
  platformFeeCedis?: number;
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

const gh = (n: number, dp = 2) => `GH₵${n.toFixed(dp)}`;

export function FareBreakdownSheet({
  visible,
  onClose,
  farePesewas,
  seats,
  surge = false,
  promotionPct = 10,
  waitTimeRate = 0.98,
  bookingFeePct = 6.1,
  platformFeeCedis = 1.0,
  breakdown = null,
}: FareBreakdownSheetProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const hasServerLines = !!breakdown && typeof breakdown.ridePesewas === 'number';
  const px = (n: number | undefined) => (typeof n === 'number' ? n : 0);

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
          <DottedRow label="Seats" value={String(seats)} colors={colors} styles={styles} />
        </>
      ) : (
        <>
          <DottedRow label="Wait time" value={`${gh(waitTimeRate)}/MIN`} colors={colors} styles={styles} />
          <DottedRow label="Booking Fee" value={`${bookingFeePct}%`} colors={colors} styles={styles} />
          <DottedRow label="Platform Fee" value={gh(platformFeeCedis)} colors={colors} styles={styles} />
          <DottedRow label="Promotion" value={`${promotionPct}%`} colors={colors} styles={styles} accent />
          <DottedRow label="Seats" value={String(seats)} colors={colors} styles={styles} />
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
}: {
  label: string;
  value: string;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
  accent?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text variant="bodyMedium" color={colors.onSurface}>{label}</Text>
      <View style={styles.dottedLeader} />
      <Text variant="bodyMedium" color={accent ? colors.primary : colors.onSurface}>{value}</Text>
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
