import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts, radii, spacing, withOpacity } from '@eyego/config';
import { Text, Button, Pressable } from '@eyego/ui';
import { formatGhs } from '@eyego/utils';
import { useColors, type Colors } from '../../utils/useColors';

/** The steps the server accepts — see `boostFare` in rides.service. */
const STEPS = [10, 20, 30] as const;
export type BoostStep = (typeof STEPS)[number];
/** Cumulative ceiling, as % of the requested fare. Mirrors BOOST_CAP_PCT. */
const CAP_PCT = 50;

export interface FareBoostRowProps {
  /** What the rider is offering right now, boosts included. */
  farePesewas: number;
  /** The fare the ride was requested at — the base every step is a % of. */
  requestedPesewas: number;
  /** Everything added so far. */
  boostPesewas: number;
  busy: boolean;
  onBoost: (pct: BoostStep) => void;
}

/**
 * RAISE THE FARE TO FIND A DRIVER FASTER.
 *
 * Chips carry the NEW TOTAL, not just a percentage — "+10% · GH₵46" answers the
 * only question the rider has. A tap opens an inline confirm (no modal: this
 * sits inside the trip surface, where a native modal would land above the root
 * overlays), showing the old fare struck through and, said plainly, that every
 * pesewa of the raise goes to the driver. That is the difference from Bolt's
 * version, which takes commission on the extra, so it is on the button.
 *
 * Steps are a % of the REQUESTED fare and never compound; any step that would
 * pass +50 % in total is hidden rather than offered and refused.
 */
export function FareBoostRow({ farePesewas, requestedPesewas, boostPesewas, busy, onBoost }: FareBoostRowProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [picked, setPicked] = useState<BoostStep | null>(null);

  const capPesewas = Math.round((requestedPesewas * CAP_PCT) / 100);
  const steps = STEPS.map((pct) => ({ pct, add: Math.round((requestedPesewas * pct) / 100) })).filter(
    (s) => s.add > 0 && boostPesewas + s.add <= capPesewas,
  );
  const choice = picked != null ? steps.find((s) => s.pct === picked) ?? null : null;

  return (
    <View style={styles.root}>
      <View style={styles.headRow}>
        <Ionicons name="flash" size={14} color={colors.primary} />
        <Text style={styles.title}>
          {boostPesewas > 0 ? `You added ${formatGhs(boostPesewas)} to find a driver faster` : 'Raise your fare to find a driver faster'}
        </Text>
      </View>
      <Text style={styles.caption}>All of it goes to your driver — EyeGo takes nothing from a raise.</Text>

      {steps.length === 0 ? (
        <Text style={styles.capNote}>Maximum boost reached.</Text>
      ) : choice ? (
        // ── the inline confirm ──
        <View style={[styles.confirm, { borderColor: withOpacity(colors.primary, 0.45) }]}>
          <View style={styles.confirmFare}>
            <Text style={styles.was}>{formatGhs(farePesewas)}</Text>
            <Ionicons name="arrow-forward" size={14} color={colors.onSurfaceVariant} />
            <Text style={styles.now}>{formatGhs(farePesewas + choice.add)}</Text>
          </View>
          <Text style={styles.caption}>All {formatGhs(choice.add)} goes to your driver.</Text>
          <View style={styles.confirmActions}>
            <Button
              label="Not now"
              variant="ghost"
              onPress={() => setPicked(null)}
              disabled={busy}
              style={{ flex: 1 }}
            />
            <Button
              label={`Offer ${formatGhs(farePesewas + choice.add)}`}
              onPress={() => {
                onBoost(choice.pct);
                setPicked(null);
              }}
              loading={busy}
              style={{ flex: 1.4 }}
            />
          </View>
        </View>
      ) : (
        <View style={styles.chips}>
          {steps.map((s) => (
            <Pressable
              key={s.pct}
              onPress={() => setPicked(s.pct)}
              disabled={busy}
              haptic="light"
              style={[styles.chip, { borderColor: withOpacity(colors.primary, 0.35) }]}
              accessibilityRole="button"
              accessibilityLabel={`Raise by ${s.pct} percent to ${formatGhs(farePesewas + s.add)}`}
            >
              <Text style={styles.chipPct}>+{s.pct}%</Text>
              <Text style={styles.chipFare}>{formatGhs(farePesewas + s.add)}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    root: {
      gap: spacing.sm,
      padding: spacing.md,
      borderRadius: radii.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.outline,
      backgroundColor: colors.surfaceContainer,
    },
    headRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    title: { flex: 1, fontFamily: fonts.semiBold, fontSize: 14, color: colors.onSurface },
    caption: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.onSurfaceVariant },
    capNote: { fontFamily: fonts.medium, fontSize: 12, color: colors.onSurfaceVariant },
    chips: { flexDirection: 'row', gap: spacing.sm },
    chip: {
      flex: 1,
      minHeight: 52,
      borderRadius: radii.md,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withOpacity(colors.primary, 0.08),
    },
    chipPct: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.primary },
    chipFare: { fontFamily: fonts.medium, fontSize: 12, color: colors.onSurface, fontVariant: ['tabular-nums'] },
    confirm: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, borderWidth: 1 },
    confirmFare: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    was: {
      fontFamily: fonts.medium,
      fontSize: 15,
      color: colors.onSurfaceVariant,
      textDecorationLine: 'line-through',
      fontVariant: ['tabular-nums'],
    },
    now: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.onSurface, fontVariant: ['tabular-nums'] },
    confirmActions: { flexDirection: 'row', gap: spacing.sm },
  });

export default FareBoostRow;
