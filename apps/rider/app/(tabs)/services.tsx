import React from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_BASE_HEIGHT } from './_layout';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii, withOpacity } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text } from '@eyego/ui';
import * as Haptics from 'expo-haptics';

interface TierCard {
  id: string;
  name: string;
  description: string;
  priceRange: string;
  eta: string;
  icon: keyof typeof Ionicons.glyphMap;
  tier: string;
}

interface SpecialService {
  id: string;
  name: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
}

const TIERS: TierCard[] = [
  {
    id: 'economy',
    name: 'Economy',
    description: 'Affordable everyday rides',
    priceRange: 'GH₵ 15 – 30',
    eta: '3–5 min',
    icon: 'car-outline',
    tier: 'economy',
  },
  {
    id: 'comfort',
    name: 'Comfort',
    description: 'More space and a smoother ride',
    priceRange: 'GH₵ 30 – 55',
    eta: '5–8 min',
    icon: 'car-sport-outline',
    tier: 'comfort',
  },
  {
    id: 'premium',
    name: 'Premium',
    description: 'Top-rated drivers, luxury vehicles',
    priceRange: 'GH₵ 55 – 100',
    eta: '8–12 min',
    icon: 'diamond-outline',
    tier: 'premium',
  },
];

function getTierAccent(colors: Colors, tier: string): string {
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
    description: 'Share costs with up to 4 people',
    icon: 'people-outline',
    route: '/where-to?type=group',
  },
];

function TierCard({ tier, colors, styles }: { tier: TierCard; colors: Colors; styles: ReturnType<typeof makeStyles> }) {
  const router = useRouter();
  const accent = getTierAccent(colors, tier.tier);

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
      <Pressable
        style={({ pressed }) => [styles.tierCard, pressed && styles.pressed]}
        onPress={handlePress}
      >
        <View style={[styles.tierAccent, { backgroundColor: accent }]} />
        <View style={styles.tierContent}>
          <View style={[styles.tierIconWrap, { backgroundColor: withOpacity(accent, 0.1) }]}>
            <Ionicons name={tier.icon} size={22} color={accent} />
          </View>
          <View style={styles.tierInfo}>
            <Text style={styles.tierName}>{tier.name}</Text>
            <Text style={styles.tierDesc}>{tier.description}</Text>
          </View>
          <View style={styles.tierRight}>
            <Text style={[styles.tierPrice, { color: accent }]}>{tier.priceRange}</Text>
            <Text style={styles.tierEta}>{tier.eta} away</Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} style={styles.chevron} />
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

  return (
    <Pressable
      style={({ pressed }) => [styles.specialCard, pressed && styles.pressed]}
      onPress={handlePress}
    >
      <View style={styles.specialIconWrap}>
        <Ionicons name={service.icon} size={22} color={colors.primary} />
      </View>
      <View style={styles.specialInfo}>
        <Text style={styles.specialName}>{service.name}</Text>
        <Text style={styles.specialDesc}>{service.description}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
    </Pressable>
  );
}

export default function ServicesScreen() {
  const colors = useColors();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Services</Text>
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
            <SpecialServiceCard key={service.id} service={service} colors={colors} styles={styles} />
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
    backgroundColor: colors.backgroundDeep,
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
    color: colors.onSurface,
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
    backgroundColor: colors.surfaceCard,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.rimLight,
    overflow: 'hidden',
  },
  tierAccent: {
    width: 4,
    alignSelf: 'stretch',
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
  tierInfo: { flex: 1 },
  tierName: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.titleSmall,
    lineHeight: fontSizes.titleSmall * 1.3,
    color: colors.onSurface,
  },
  tierDesc: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodySmall,
    lineHeight: fontSizes.bodySmall * 1.35,
    color: colors.onSurfaceVariant,
    marginTop: 2,
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
  specialContainer: {
    gap: 1,
    backgroundColor: colors.rimLightSubtle,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.rimLight,
    overflow: 'hidden',
  },
  specialCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.surfaceCard,
  },
  specialIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: withOpacity(colors.primary, 0.1),
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
