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
/** What the boost steps the server accepts are worth right now, within the cap. */
function boostSteps(requestedPesewas: number, boostPesewas: number) {
  const capPesewas = Math.round((requestedPesewas * CAP_PCT) / 100);
  return STEPS.map((pct) => ({ pct, add: Math.round((requestedPesewas * pct) / 100) })).filter(
    (s) => s.add > 0 && boostPesewas + s.add <= capPesewas,
  );
}

/**
 * THE BOOST IS A PILL, NOT A ROW ("the way the boost your ride thing is, it's
 * making the card way too busy and non aesthetic"). It sits under the fare —
 * the number it changes — and opens the tray only when asked.
 */
export function BoostPill({ boostPesewas, open, onPress }: { boostPesewas: number; open: boolean; onPress: () => void }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      onPress={onPress}
      haptic="light"
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={open ? 'Close boost' : 'Boost your fare to find a driver faster'}
      style={[styles.pill, { backgroundColor: withOpacity(colors.primary, open ? 0.24 : 0.14), borderColor: withOpacity(colors.primary, 0.4) }]}
    >
      <Ionicons name="flash" size={12} color={colors.primary} />
      <Text style={[styles.pillText, { color: colors.primary }]}>
        {boostPesewas > 0 ? `+${formatGhs(boostPesewas)}` : 'Boost'}
      </Text>
    </Pressable>
  );
}

/** The tray the pill opens: three steps, one line of policy, a confirm. */
export function BoostTray({ farePesewas, requestedPesewas, boostPesewas, busy, onBoost, onClose }: FareBoostRowProps & { onClose: () => void }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [picked, setPicked] = useState<BoostStep | null>(null);
  const steps = boostSteps(requestedPesewas, boostPesewas);
  const choice = picked != null ? steps.find((s) => s.pct === picked) ?? null : null;

  return (
    <View style={[styles.root, { borderColor: withOpacity(colors.primary, 0.3) }]}>
      <Text style={styles.caption}>100% goes to your driver.</Text>
      {steps.length === 0 ? (
        <Text style={styles.capNote}>Maximum boost reached.</Text>
      ) : choice ? (
        <View style={styles.confirmActions}>
          <Button label="Back" variant="ghost" onPress={() => setPicked(null)} disabled={busy} style={{ flex: 1 }} />
          <Button
            label={`Offer ${formatGhs(farePesewas + choice.add)}`}
            onPress={() => {
              onBoost(choice.pct);
              setPicked(null);
              onClose();
            }}
            loading={busy}
            style={{ flex: 1.6 }}
          />
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
              accessibilityLabel={`Raise by ${formatGhs(s.add)} to ${formatGhs(farePesewas + s.add)}`}
            >
              <Text style={styles.chipPct}>+{formatGhs(s.add)}</Text>
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
      borderWidth: 1,
      backgroundColor: withOpacity(colors.primary, 0.05),
    },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: radii.full,
      borderWidth: StyleSheet.hairlineWidth,
    },
    pillText: { fontFamily: fonts.semiBold, fontSize: 12, fontVariant: ['tabular-nums'] },
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
    confirmActions: { flexDirection: 'row', gap: spacing.sm },
  });

export default BoostTray;
