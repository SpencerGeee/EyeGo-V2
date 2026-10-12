import React, { useMemo } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition, ReduceMotion } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Model3D, minibus, HeroBusSlot, SHOWROOM_YAW, SHOWROOM_PITCH } from '@eyego/maps';
import { fonts, fontSizes, spacing, springs } from '@eyego/config';
import { Text, RollingDigits, getTierTheme } from '@eyego/ui';
import { formatGhs } from '@eyego/utils';
import { useColors, type Colors } from '../../utils/useColors';

/**
 * CHOOSE YOUR RIDE — THE SPOTLIGHT.
 *
 * ("redesign the cards … more aesthetic, premium and smooth … a bold change").
 * It was three identical rows in a list, each ringed, so the eye had nothing to
 * land on and the choice read like a settings screen. Now the ride you have
 * chosen IS the screen: one large card with the actual minibus in that class's
 * livery (it turns once when you pick it), the price set big and rolling, and
 * when the car comes and when you arrive. The other two sit as tiles beneath,
 * still priced and timed, and swap up into the spotlight with one spring.
 * Everything a rider compares is visible at once; the one they chose is
 * unmistakable.
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

const layout = LinearTransition.springify()
  .stiffness(springs.emphasized.stiffness)
  .damping(springs.emphasized.damping)
  .mass(springs.emphasized.mass);

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

  const hero = options.find((o) => o.id === selected) ?? options[0];
  const rest = options.filter((o) => o.id !== hero.id);

  const pick = (id: RideTierId) => {
    if (id === selected) return;
    void Haptics.selectionAsync();
    onSelect(id);
  };

  return (
    <View style={styles.wrap}>
      {/* Not keyed by tier: the card (and the bus in it) stays mounted, so a
          new choice turns the same bus once instead of swapping it out. */}
      <Animated.View layout={layout}>
        <Spotlight option={hero} badge={badgeOf(hero.id)} quoting={quoting} nearbyKnown={nearbyKnown} colors={colors} styles={styles} />
      </Animated.View>
      <Animated.View layout={layout} style={styles.tiles}>
        {rest.map((o) => (
          <Animated.View key={`tile-${o.id}`} layout={layout} entering={FadeIn.duration(240).reduceMotion(ReduceMotion.System)} style={styles.tileSlot}>
            <Tile option={o} badge={badgeOf(o.id)} quoting={quoting} onPress={() => pick(o.id)} colors={colors} styles={styles} />
          </Animated.View>
        ))}
      </Animated.View>
    </View>
  );
}

function Spotlight({
  option,
  badge,
  quoting,
  nearbyKnown,
  colors,
  styles,
}: {
  option: RideOption;
  badge: string | null;
  quoting: boolean;
  nearbyKnown: boolean;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const t = getTierTheme(colors, option.id);
  const model = minibus({ accent: t.accent, body: LIVERY[option.id].body });
  return (
    // The double bezel: a tinted tray, then the card set into it.
    <View
      style={[styles.heroShell, { backgroundColor: `${t.accent}14`, borderColor: `${t.accent}40` }]}
      accessible
      accessibilityRole="radio"
      accessibilityState={{ selected: true }}
      accessibilityLabel={`${t.label}, selected. ${t.blurb}${option.price != null ? `. ${formatGhs(option.price)}` : ''}`}
    >
      <View style={styles.heroCore}>
        <LinearGradient
          colors={[`${t.accent}2E`, `${t.accent}00`]}
          start={{ x: 1, y: 0 }}
          end={{ x: 0.2, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={styles.heroTop}>
          <Animated.View key={`copy-${option.id}`} entering={FadeIn.duration(260).reduceMotion(ReduceMotion.System)} exiting={FadeOut.duration(120)} style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.eyebrowRow}>
              <View style={[styles.eyebrowDot, { backgroundColor: t.accent }]} />
              <Text style={[styles.eyebrow, { color: t.accent }]}>{badge ? badge.toUpperCase() : 'YOUR RIDE'}</Text>
            </View>
            <Text style={styles.heroTitle} numberOfLines={1}>{t.label}</Text>
            <Text style={styles.heroBlurb} numberOfLines={2}>{t.blurb}</Text>
          </Animated.View>
          {/* The hero bus rests here on this stage — see HeroBus. */}
          <HeroBusSlot id="ride-spotlight" size={124} model={model} />
        </View>

        <View style={styles.heroBottom}>
          <View style={{ flexShrink: 0 }}>
            {option.price != null ? (
              <RollingDigits
                text={formatGhs(option.price)}
                value={option.price}
                fontSize={34}
                fontFamily={fonts.displayBold}
                color={colors.onSurface}
              />
            ) : (
              <Text style={styles.heroPricePending}>{quoting ? 'Pricing…' : '—'}</Text>
            )}
          </View>
          <View style={styles.heroFacts}>
            <Fact
              icon="navigate"
              text={option.etaMin != null ? `${option.etaMin} min away` : nearbyKnown ? 'None nearby' : 'Finding cars'}
              strong={option.etaMin != null}
              colors={colors}
              styles={styles}
            />
            {option.dropoff ? <Fact icon="flag" text={`Arrive ${option.dropoff}`} strong colors={colors} styles={styles} /> : null}
          </View>
        </View>
      </View>
    </View>
  );
}

function Tile({
  option,
  badge,
  quoting,
  onPress,
  colors,
  styles,
}: {
  option: RideOption;
  badge: string | null;
  quoting: boolean;
  onPress: () => void;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const t = getTierTheme(colors, option.id);
  const model = minibus({ accent: t.accent, body: LIVERY[option.id].body });
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && { transform: [{ scale: 0.97 }] }]}
      accessibilityRole="radio"
      accessibilityState={{ selected: false }}
      accessibilityLabel={`${t.label}. ${t.blurb}${option.price != null ? `. ${formatGhs(option.price)}` : ''}`}
    >
      <View style={styles.tileTop}>
        <Model3D model={model} heading={SHOWROOM_YAW} pitch={SHOWROOM_PITCH} size={58} />
        {badge ? (
          <View style={[styles.tileBadge, { backgroundColor: `${t.accent}22` }]}>
            <Text style={[styles.tileBadgeText, { color: t.accent }]}>{badge}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.tileNameRow}>
        <View style={[styles.eyebrowDot, { backgroundColor: t.accent }]} />
        <Text style={styles.tileName} numberOfLines={1}>{t.label}</Text>
      </View>
      <Text style={styles.tilePrice} numberOfLines={1}>
        {option.price != null ? formatGhs(option.price) : quoting ? '···' : '—'}
      </Text>
      <Text style={styles.tileMeta} numberOfLines={1}>
        {option.etaMin != null ? `${option.etaMin} min away` : 'No cars nearby'}
      </Text>
    </Pressable>
  );
}

function Fact({
  icon,
  text,
  strong,
  colors,
  styles,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  text: string;
  strong?: boolean;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={12} color={strong ? colors.onSurface : colors.onSurfaceVariant} />
      <Text style={[styles.factText, { color: strong ? colors.onSurface : colors.onSurfaceVariant }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    wrap: { gap: spacing.md },

    heroShell: { borderRadius: 30, borderWidth: StyleSheet.hairlineWidth, padding: 5 },
    heroCore: {
      borderRadius: 25,
      overflow: 'hidden',
      backgroundColor: colors.surfaceContainerHigh,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: 'rgba(255,255,255,0.10)',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.lg,
      gap: spacing.md,
    },
    heroTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 112 },
    eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    eyebrowDot: { width: 6, height: 6, borderRadius: 3 },
    eyebrow: { fontFamily: fonts.semiBold, fontSize: 10.5, letterSpacing: 1.6 },
    heroTitle: {
      marginTop: 6,
      fontFamily: fonts.displayBold,
      fontSize: 30,
      lineHeight: 34,
      letterSpacing: -0.9,
      color: colors.onSurface,
    },
    heroBlurb: {
      marginTop: 4,
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodySmall,
      lineHeight: Math.round(fontSizes.bodySmall * 1.4),
      color: colors.onSurfaceVariant,
    },
    heroBottom: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.md },
    heroPricePending: { fontFamily: fonts.displayBold, fontSize: 26, color: colors.onSurfaceVariant },
    heroFacts: { flexShrink: 1, alignItems: 'flex-end', gap: 6 },
    fact: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: `${colors.onSurface}0D`,
    },
    factText: { fontFamily: fonts.semiBold, fontSize: 12, fontVariant: ['tabular-nums'] },

    tiles: { flexDirection: 'row', gap: spacing.md },
    tileSlot: { flex: 1 },
    tile: {
      borderRadius: 24,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
      backgroundColor: colors.surfaceContainerHigh,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.outlineVariant,
    },
    tileTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginLeft: -6 },
    tileBadge: { marginTop: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
    tileBadgeText: { fontFamily: fonts.semiBold, fontSize: 10, letterSpacing: 0.3 },
    tileNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
    tileName: { flexShrink: 1, fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, color: colors.onSurface },
    tilePrice: {
      marginTop: 4,
      fontFamily: fonts.displayBold,
      fontSize: 19,
      letterSpacing: -0.4,
      color: colors.onSurface,
      fontVariant: ['tabular-nums'],
    },
    tileMeta: { marginTop: 2, fontFamily: fonts.medium, fontSize: 12, color: colors.onSurfaceVariant },
  });
