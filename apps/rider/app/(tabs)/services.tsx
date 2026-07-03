import React from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_BASE_HEIGHT } from './_layout';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
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
} from '@eyego/ui';
import * as Haptics from 'expo-haptics';

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
    glow: true,
  },
  {
    id: 'group',
    name: 'Group Ride',
    description: 'Share costs with up to 4 people',
    icon: 'people-outline',
    route: '/where-to?type=group',
  },
];

function TierCard({ tier, colors, styles }: { tier: TierCard; colors: Colors; styles: ReturnType<typeof makeStyles> }) {
  const router = useRouter();
  const accent = getTierAccent(colors, tier.tier);
  const isPremium = tier.tier === 'premium';

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/where-to?tier=${tier.tier}` as any);
  };

  return (
    <MotiView
      from={{ opacity: 0, translateY: 12 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 300 }}
    >
      <Pressable onPress={handlePress}>
        <Card
          padding={0}
          elevated={!isPremium}
          glow={isPremium}
          animated={isPremium}
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
    </MotiView>
  );
}

function SpecialServiceCard({ service, colors, styles }: { service: SpecialService; colors: Colors; styles: ReturnType<typeof makeStyles> }) {
  const router = useRouter();

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(service.route as any);
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

  return (
    <MotiView
      from={{ opacity: 0, translateY: 12 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 300 }}
    >
      <Pressable style={({ pressed }) => pressed && styles.pressed} onPress={handlePress}>
        {service.glow ? (
          <GradientGlowBorder
            colors={PREMIUM_RING_COLORS}
            locations={PREMIUM_RING_LOCATIONS}
            fillColor={colors.surfaceContainerHigh}
            borderRadius={radii.xl}
            glow
            glowColor={colors.premiumBlue}
            glowColorSecondary={colors.premiumOrange}
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
          <GlassSurface borderRadius={radii.xl} intensity="low" dark style={styles.specialCard}>
            {row}
          </GlassSurface>
        )}
      </Pressable>
    </MotiView>
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
      >
        <Text style={styles.sectionHeader}>Ride Options</Text>
        <View style={styles.tiersContainer}>
          {TIERS.map((tier) => (
            <TierCard key={tier.id} tier={tier} colors={colors} styles={styles} />
          ))}
        </View>

        <Text style={[styles.sectionHeader, { marginTop: spacing['2xl'] }]}>Special Services</Text>
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
  tiersContainer: { gap: spacing.sm },
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
  specialContainer: { gap: spacing.sm },
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
