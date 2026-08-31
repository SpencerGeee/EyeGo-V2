import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_BASE_HEIGHT } from './_layout';
import { useRouter } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii, withOpacity } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import {
  Text,
  Card,
  TierBadge,
  GlassSurface,
  ShinyText,
  GradientGlowBorder,
  PREMIUM_RING_COLORS,
  PREMIUM_RING_LOCATIONS,
  MorphSource,
  useMorph,
  backgroundScrollPauseProps,
  // `Pressable` from @eyego/ui, never react-native — NativeWind's interop
  // runtime drops the `({ pressed }) => style` function form on RN's Pressable,
  // silently deleting the whole style. See the note in trip/stages/SearchStage.
  Pressable,
} from '@eyego/ui';
import * as Haptics from 'expo-haptics';
import { goDeeper } from '@eyego/ui';

type TierKey = 'economy' | 'comfort' | 'premium';

interface TierCard {
  id: string;
  name: 'ECONOMY' | 'COMFORT' | 'PREMIUM';
  description: string;
  priceRange: string;
  eta: string;
  icon: keyof typeof Ionicons.glyphMap;
  tier: TierKey;
}

interface SpecialService {
  id: string;
  name: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  /** Flagship service — gets the animated premium glow ring, like the
   * PREMIUM tier card. Reserve for one card per screen (see
   * GradientGlowBorder perf notes on animated rings). */
  glow?: boolean;
}

const TIERS: TierCard[] = [
  {
    id: 'economy',
    name: 'ECONOMY',
    description: 'Affordable everyday rides',
    priceRange: 'GH₵ 15 – 30',
    eta: '3–5 min',
    icon: 'car-outline',
    tier: 'economy',
  },
  {
    id: 'comfort',
    name: 'COMFORT',
    description: 'More space and a smoother ride',
    priceRange: 'GH₵ 30 – 55',
    eta: '5–8 min',
    icon: 'car-sport-outline',
    tier: 'comfort',
  },
  {
    id: 'premium',
    name: 'PREMIUM',
    description: 'Top-rated drivers, luxury vehicles',
    priceRange: 'GH₵ 55 – 100',
    eta: '8–12 min',
    icon: 'diamond-outline',
    tier: 'premium',
  },
];

function getTierAccent(colors: Colors, tier: TierKey): string {
  if (tier === 'comfort') return colors.tierComfort;
  if (tier === 'premium') return colors.tierPremium;
  return colors.tierEconomy;
}

const SPECIAL_SERVICES: SpecialService[] = [
  {
    id: 'schedule',
    name: 'Schedule a Ride',
    description: 'Book up to 7 days in advance',
    icon: 'calendar-outline',
    route: '/ride/schedule',
  },
  {
    id: 'group',
    name: 'Group Ride',
    description: 'Book up to 8 seats in one go',
    icon: 'people-outline',
    route: '/trip?stage=search&type=group',
  },
];

function TierCard({ tier, colors, styles }: { tier: TierCard; colors: Colors; styles: ReturnType<typeof makeStyles> }) {
  const router = useRouter();
  const { morphTo } = useMorph();
  const accent = getTierAccent(colors, tier.tier);
  const isPremium = tier.tier === 'premium';
  const morphId = `service-tier-${tier.tier}`;

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Container-transform: the tier card grows into the trip surface's
    // search stage, which reads morphId to mount its MorphTarget.
    morphTo(morphId, () =>
      goDeeper(`/trip?stage=search&tier=${tier.tier}&morphId=${morphId}` as any)
    );
  };

  return (
    <Animated.View entering={FadeIn.duration(300)} style={styles.glowRoom}>
      <MorphSource id={morphId} borderRadius={radii.xl} backgroundColor={colors.surfaceCard}>
      <Pressable onPress={handlePress} accessibilityRole="button">
        {/**
         * ── THREE TIERS, THREE COLOURS, THREE INTENSITIES ────────────────────
         *
         * BUGFIX ("make the comfort card glow border blue — its green is
         * matching the economy, but they all have different tier colours. And
         * make it a bit intense, so you leave the most intense as the premium.
         * If you could make that particular one animated as well, but faintly").
         *
         * The palettes here were always right — `comfort` is the electric blue
         * sampled from `tierComfort`, `economy` is the tier green. They never
         * arrived: `Card` only forwarded `glowPalette` on its `glow && animated`
         * branch, and only PREMIUM was animated, so ECONOMY and COMFORT fell
         * through to a plain bordered surface painted in `colors.primary`. Two
         * cards rendering the same hard-coded green is why Comfort looked like
         * Economy. Fixed in `Card` — the palette now applies whether or not the
         * ring rotates.
         *
         * With colour restored, the three cards are RANKED by glow rather than
         * separated by presence-vs-absence:
         *
         *   ECONOMY   green,  static,   0.55  — present, clearly the quiet one
         *   COMFORT   blue,   rotating, 0.85  — alive, a step below the flagship
         *   PREMIUM   gold,   rotating, 1.25  — unmistakably the loudest
         *
         * Comfort's motion is the same shared ambient clock Premium rides (one
         * rotation value drives every ring in the tree), so the second animated
         * card costs one more gradient layer, not a second animation loop. The
         * "faintly" is carried by intensity, not by a slower sweep: two rings
         * turning at different speeds beside each other reads as a glitch.
         */}
        <Card
          padding={0}
          elevated={false}
          glow
          animated={isPremium || tier.tier === 'comfort'}
          glowIntensity={isPremium ? 1.25 : tier.tier === 'comfort' ? 0.85 : 0.55}
          glowPalette={tier.tier === 'premium' ? 'gold' : tier.tier === 'comfort' ? 'comfort' : 'economy'}
          style={styles.tierCard}
        >
          <View style={styles.tierContent}>
            <View style={[styles.tierIconWrap, { backgroundColor: withOpacity(accent, 0.12) }]}>
              <Ionicons name={tier.icon} size={22} color={accent} />
            </View>
            <View style={styles.tierInfo}>
              <TierBadge tier={tier.name} size="md" />
              <Text style={styles.tierDesc}>{tier.description}</Text>
            </View>
            <View style={styles.tierRight}>
              <Text style={[styles.tierPrice, { color: accent }]}>{tier.priceRange}</Text>
              <Text style={styles.tierEta}>{tier.eta} away</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} style={styles.chevron} />
        </Card>
      </Pressable>
      </MorphSource>
    </Animated.View>
  );
}

function SpecialServiceCard({ service, colors, styles }: { service: SpecialService; colors: Colors; styles: ReturnType<typeof makeStyles> }) {
  const router = useRouter();
  const { morphTo } = useMorph();
  // Cards that open the trip surface morph into it; modal routes
  // (e.g. /ride/schedule) keep their native rise-from-bottom presentation.
  const canMorph = service.route.startsWith('/trip');
  const morphId = `service-${service.id}`;

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (canMorph) {
      const sep = service.route.includes('?') ? '&' : '?';
      morphTo(morphId, () =>
        goDeeper(`${service.route}${sep}morphId=${morphId}` as any)
      );
    } else {
      goDeeper(service.route as any);
    }
  };

  const iconColor = service.glow ? colors.premiumBlue : colors.primary;

  const row = (
    <View style={styles.specialContent}>
      <View style={[styles.specialIconWrap, { backgroundColor: withOpacity(iconColor, 0.12) }]}>
        <Ionicons name={service.icon} size={22} color={iconColor} />
      </View>
      <View style={styles.specialInfo}>
        <Text style={styles.specialName}>{service.name}</Text>
        <Text style={styles.specialDesc}>{service.description}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
    </View>
  );

  const inner = (
    /* The card's own name — a screen reader reaching this needs to know WHICH
       service it is about to open, and the label is the only place that says so
       (the name lives inside a `row` variable this element never sees). */
    <Pressable
      style={({ pressed }) => pressed && styles.pressed}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={service.name}
    >
      {service.glow ? (
        <GradientGlowBorder
          colors={PREMIUM_RING_COLORS}
          locations={PREMIUM_RING_LOCATIONS}
          fillColor={colors.surfaceContainerHigh}
          borderRadius={radii.xl}
          glow
          glowColor={colors.premiumBlue}
          glowColorSecondary={colors.premiumOrange}
          /**
           * The two-colour ring's widest halo defaults to a 36 pt reach, which
           * is more than the 32 pt of clear space between two cards — so it
           * would still meet its neighbour's. Capped to fit the room the layout
           * actually gives it. See `tiersContainer` for the full note.
           */
          maxGlowRadius={20}
          style={styles.specialCard}
        >
          {/* Inset by the ring's stroke thickness (3, GradientGlowBorder's
              'regular' thickness) so the blur layer doesn't paint over the
              glow ring itself. */}
          <GlassSurface
            borderRadius={radii.xl - 3}
            intensity="high"
            dark
            style={styles.specialGlassInset}
          />
          {row}
        </GradientGlowBorder>
      ) : (
        /**
         * A QUIET RING, NOT NO RING.
         *
         * FEATURE ("you can even give the schedule a ride and the group ride
         * cards a faint glow border for them to also be alive"). These were bare
         * glass on a screen where everything else is ringed, so they read as
         * disabled rather than as secondary. Same primitive, its own colour, no
         * outer glow and no rotation — present, and clearly one step down from
         * the tier cards above rather than absent from the same system.
         */
        <GradientGlowBorder
          palette={service.id === 'group' ? 'comfort' : 'economy'}
          fillColor={colors.surfaceContainerHigh}
          borderRadius={radii.xl}
          thickness="thin"
          style={styles.specialCard}
        >
          <GlassSurface borderRadius={radii.xl - 1} intensity="low" dark style={styles.specialGlassInset} />
          {row}
        </GradientGlowBorder>
      )}
    </Pressable>
  );

  return (
    <Animated.View entering={FadeIn.duration(300)} style={styles.glowRoom}>
      {canMorph ? (
        <MorphSource id={morphId} borderRadius={radii.xl} backgroundColor={colors.surfaceContainerHigh}>
          {inner}
        </MorphSource>
      ) : (
        inner
      )}
    </Animated.View>
  );
}

export default function ServicesScreen() {
  const colors = useColors();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <ShinyText baseColor={colors.onSurface} textStyle={styles.title}>Services</ShinyText>
        <Text style={styles.subtitle}>Choose how you want to ride</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        {...backgroundScrollPauseProps}
      >
        <Text style={styles.sectionHeader}>Ride Options</Text>
        <View style={styles.tiersContainer}>
          {TIERS.map((tier) => (
            <TierCard key={tier.id} tier={tier} colors={colors} styles={styles} />
          ))}
        </View>

        {/* 24, not 32. A section break should be bigger than the gap between
           rows inside a section (12) and no bigger than it needs to be to say
           "new group" — 32 read as the end of the screen. */}
        <Text style={[styles.sectionHeader, { marginTop: spacing.xl }]}>Special Services</Text>
        <View style={styles.specialContainer}>
          {SPECIAL_SERVICES.map((service) => (
            <SpecialServiceCard
              key={service.id}
              service={service}
              colors={colors}
              styles={styles}
            />
          ))}
        </View>

        <View style={{ height: TAB_BAR_BASE_HEIGHT + insets.bottom + 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flex: 1,
    // AppBackground (mounted in the root layout) shows through here instead
    // of a flat fill.
    backgroundColor: 'transparent',
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.headlineLarge,
    lineHeight: fontSizes.headlineLarge * 1.25,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodyMedium,
    lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
    color: colors.onSurfaceVariant,
    marginTop: 4,
  },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg },
  sectionHeader: {
    fontFamily: fonts.labelCaps,
    fontSize: fontSizes.bodySmall,
    lineHeight: 16,
    color: colors.onSurfaceVariant,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: spacing.md,
  },
  /**
   * ROOM FOR THE GLOW TO BE A GLOW.
   *
   * BUGFIX ("on the services page, the way the glow borders are stacked on each
   * other, it's not nice — give each card padding up and down so they have room
   * to shine their glow borders, I don't need them overlapping each other").
   *
   * `GradientGlowBorder` paints its halo as iOS shadows with a radius of up to
   * 28 pt (36 for the two-colour premium ring), which means the light reaches
   * roughly 28 pt PAST the card on every side. These containers were on an 8 pt
   * gap, so each card's halo landed well inside its neighbour — and because the
   * halo layers carry an opaque `fillColor` silhouette to cast from, the
   * neighbour's card body then painted straight over the light. Three cards in a
   * row of that is the "stacked on each other" look.
   *
   * The gap has to clear the reach of the ring, and each card additionally
   * carries its own vertical padding (`glowRoom`) so the light belongs to the
   * card rather than to the space between two of them.
   *
   * ── AND THEN IT WAS TOO MUCH ─────────────────────────────────────────────
   * "On the services page the space in between is way too much. You need to
   * decrease the space so it's aesthetic and nice."
   *
   * Also true, and the first fix over-corrected because it budgeted for a halo
   * that is not there. It reasoned from `GradientGlowBorder`'s 28–36 pt default
   * reach — but these cards are `Card`, which pins `maxGlowRadius` to 20 (see
   * packages/ui/src/Card.tsx). So the layout was reserving up to 36 pt of clear
   * space per edge for a 20 pt halo, and 8 + 16 + 8 = 32 pt between two rows of
   * a LIST is a gap you read as a mistake before you read it as generosity.
   *
   * 4 + 12 + 4 = 20 pt: exactly the reach, so neighbouring halos meet only
   * where their alpha has already fallen to nothing, and the page reads as one
   * list instead of five posters.
   */
  tiersContainer: { gap: spacing.md },
  /** Breathing room for one card's halo. See `tiersContainer`. */
  glowRoom: { paddingVertical: spacing.xs },
  tierCard: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tierContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md,
  },
  tierIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tierInfo: { flex: 1, gap: 4 },
  tierDesc: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodySmall,
    lineHeight: fontSizes.bodySmall * 1.35,
    color: colors.onSurfaceVariant,
  },
  tierRight: { alignItems: 'flex-end', maxWidth: 120 },
  tierPrice: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    lineHeight: fontSizes.bodyMedium * 1.3,
  },
  tierEta: {
    fontFamily: fonts.monoRegular,
    fontSize: fontSizes.caption,
    lineHeight: 15,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
  chevron: { marginRight: spacing.md },
  /* Same reasoning as `tiersContainer`, and these carry no `glowRoom` padding
     of their own, so the gap alone has to clear the ring. */
  specialContainer: { gap: spacing.md },
  specialCard: {
    overflow: 'hidden',
  },
  specialGlassInset: {
    position: 'absolute',
    top: 3,
    left: 3,
    right: 3,
    bottom: 3,
  },
  specialContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md,
  },
  specialIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  specialInfo: { flex: 1 },
  specialName: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.titleSmall,
    lineHeight: fontSizes.titleSmall * 1.3,
    color: colors.onSurface,
  },
  specialDesc: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodySmall,
    lineHeight: fontSizes.bodySmall * 1.35,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
  pressed: { opacity: 0.75 },
});
