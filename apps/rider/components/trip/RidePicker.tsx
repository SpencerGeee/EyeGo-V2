import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeOut, ReduceMotion } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { minibus, HeroBusSlot } from '@eyego/maps';
import { fonts, fontSizes, spacing } from '@eyego/config';
// Pressable from @eyego/ui: NativeWind drops a FUNCTION style on RN's own (the tile drew unstyled).
import { Text, getTierTheme, Pressable } from '@eyego/ui';
import { formatGhs } from '@eyego/utils';
import { useColors, type Colors } from '../../utils/useColors';

/**
 * CHOOSE YOUR RIDE — THE UBER / BOLT PRODUCT LIST (G3, spec v2 §7).
 *
 * ("the new card system is nowhere near what Uber and Bolt have — make a direct
 * replica"). Both apps answer this question the same way, and it is not a
 * showcase card: a fixed list of flat 76 dp rows — vehicle, name, when it
 * comes, price on the right — where the chosen row carries a 2 dp brand
 * outline and a tinted fill that fades in, and the others a 1 dp hairline. The
 * order never changes, so a rider's thumb learns where each class lives.
 *
 * Every row's bus is a HeroBusSlot keyed on being chosen: picking a class
 * turns that bus once in place (G2); the others stay still.
 */

export type RideTierId = 'ECO' | 'COMFORT' | 'PREMIUM';

export interface RideOption {
  id: RideTierId;
  /** Pesewas, or null while quoting / if the quote failed. */
  price: number | null;
  /** Minutes until the nearest car of this class could reach the pickup. */
  etaMin: number | null;
  /** Clock time the rider would arrive, if known. */
  dropoff: string | null;
}

/** The fleet is one minibus; the class is its paint. */
export const LIVERY: Record<RideTierId, { body: string }> = {
  ECO: { body: '#F3F4F6' },
  COMFORT: { body: '#DCE6F2' },
  PREMIUM: { body: '#1B1D22' },
};

const ROW_H = 76;
const BUS = 60;

export function RidePicker({
  options,
  selected,
  onSelect,
  quoting,
  nearbyKnown,
}: {
  options: RideOption[];
  selected: RideTierId;
  onSelect: (id: RideTierId) => void;
  quoting: boolean;
  nearbyKnown: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Honest superlatives, computed from what is on screen, never asserted.
  const priced = options.filter((o) => o.price != null);
  const cheapest = priced.length > 1 ? priced.reduce((a, b) => ((b.price as number) < (a.price as number) ? b : a)).id : null;
  const timed = options.filter((o) => o.etaMin != null);
  const closest = timed.length > 1 ? timed.reduce((a, b) => ((b.etaMin as number) < (a.etaMin as number) ? b : a)).id : null;
  const badgeOf = (id: RideTierId) => (id === cheapest ? 'Best price' : id === closest ? 'Closest' : null);

  const pick = (id: RideTierId) => {
    if (id === selected) return;
    void Haptics.selectionAsync();
    onSelect(id);
  };

  return (
    <View style={styles.list} accessibilityRole="radiogroup">
      {options.map((o) => (
        <Row
          key={o.id}
          option={o}
          on={o.id === selected}
          badge={badgeOf(o.id)}
          quoting={quoting}
          nearbyKnown={nearbyKnown}
          onPress={() => pick(o.id)}
          colors={colors}
          styles={styles}
        />
      ))}
    </View>
  );
}

function Row({
  option,
  on,
  badge,
  quoting,
  nearbyKnown,
  onPress,
  colors,
  styles,
}: {
  option: RideOption;
  on: boolean;
  badge: string | null;
  quoting: boolean;
  nearbyKnown: boolean;
  onPress: () => void;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const t = getTierTheme(colors, option.id);
  const model = useMemo(() => minibus({ accent: t.accent, body: LIVERY[option.id].body }), [t.accent, option.id]);
  const when =
    option.etaMin != null ? `${option.etaMin} min away` : nearbyKnown ? 'None nearby' : 'Finding buses';
  return (
    <Pressable
      onPress={onPress}
      haptic="none" // `pick` already ticks; two buzzes per tap felt broken
      style={({ pressed }) => [
        styles.row,
        on ? { borderWidth: 2, borderColor: colors.primary } : { borderWidth: 1, borderColor: colors.outlineVariant },
        pressed && !on && { opacity: 0.85 },
      ]}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${t.label}. ${when}${option.price != null ? `. ${formatGhs(option.price)}` : ''}`}
    >
      {on ? (
        <Animated.View
          entering={FadeIn.duration(200).reduceMotion(ReduceMotion.System)}
          exiting={FadeOut.duration(150)}
          style={[StyleSheet.absoluteFill, { backgroundColor: `${colors.primary}14` }]}
          pointerEvents="none"
        />
      ) : null}
      <View style={styles.bus}>
        {/* Always mounted, so becoming the chosen row is a CHANGE it can turn on. */}
        <HeroBusSlot id={`ride-row-${option.id}`} size={BUS} model={model} turnKey={on ? 'on' : ''} />
      </View>
      <View style={styles.middle}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{t.label}</Text>
          {badge ? (
            <View style={[styles.badge, { backgroundColor: `${t.accent}22` }]}>
              <Text style={[styles.badgeText, { color: t.accent }]}>{badge}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {when}
          {option.dropoff ? ` · Arrive ${option.dropoff}` : ''}
        </Text>
      </View>
      <Text style={[styles.price, option.price == null && { color: colors.onSurfaceVariant }]} numberOfLines={1}>
        {option.price != null ? formatGhs(option.price) : quoting ? '···' : '—'}
      </Text>
    </Pressable>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    list: { gap: spacing.sm },
    row: {
      minHeight: ROW_H,
      borderRadius: 16,
      overflow: 'hidden',
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingLeft: spacing.sm,
      paddingRight: spacing.base,
      backgroundColor: colors.surfaceCard,
    },
    bus: { width: BUS, height: BUS, alignItems: 'center', justifyContent: 'center' },
    middle: { flex: 1, minWidth: 0, gap: 2 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    name: { flexShrink: 1, fontFamily: fonts.semiBold, fontSize: fontSizes.bodyLarge ?? 16, color: colors.onSurface },
    badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
    badgeText: { fontFamily: fonts.semiBold, fontSize: 10.5, letterSpacing: 0.2 },
    meta: { fontFamily: fonts.medium, fontSize: 13, color: colors.onSurfaceVariant, fontVariant: ['tabular-nums'] },
    price: {
      fontFamily: fonts.displayBold,
      fontSize: 18,
      letterSpacing: -0.3,
      color: colors.onSurface,
      fontVariant: ['tabular-nums'],
    },
  });
