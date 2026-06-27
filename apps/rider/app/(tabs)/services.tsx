import React from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text } from '@eyego/ui';
import * as Haptics from 'expo-haptics';

interface TierCard {
  id: string;
  name: string;
  description: string;
  priceRange: string;
  eta: string;
  icon: keyof typeof Ionicons.glyphMap;
  accentColor: string;
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
    accentColor: '#4be277',
    tier: 'economy',
  },
  {
    id: 'comfort',
    name: 'Comfort',
    description: 'More space and a smoother ride',
    priceRange: 'GH₵ 30 – 55',
    eta: '5–8 min',
    icon: 'car-sport-outline',
    accentColor: '#60A5FA',
    tier: 'comfort',
  },
  {
    id: 'premium',
    name: 'Premium',
    description: 'Top-rated drivers, luxury vehicles',
    priceRange: 'GH₵ 55 – 100',
    eta: '8–12 min',
    icon: 'diamond-outline',
    accentColor: '#F59E0B',
    tier: 'premium',
  },
];

const SPECIAL_SERVICES: SpecialService[] = [
  {
    id: 'schedule',
    name: 'Schedule a Ride',
    description: 'Book up to 7 days in advance',
    icon: 'calendar-outline',
    route: '/ride/schedule',
  },
  {
    id: 'airport',
    name: 'Airport Transfer',
    description: 'Fixed rates, no surprises',
    icon: 'airplane-outline',
    route: '/where-to?type=airport',
  },
  {
    id: 'group',
    name: 'Group Ride',
    description: 'Share costs with up to 4 people',
    icon: 'people-outline',
    route: '/where-to?type=group',
  },
];

function TierCard({ tier }: { tier: TierCard }) {
  const router = useRouter();

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
        <View style={[styles.tierAccent, { backgroundColor: tier.accentColor }]} />
        <View style={styles.tierContent}>
          <View style={[styles.tierIconWrap, { backgroundColor: `${tier.accentColor}18` }]}>
            <Ionicons name={tier.icon} size={22} color={tier.accentColor} />
          </View>
          <View style={styles.tierInfo}>
            <Text style={styles.tierName}>{tier.name}</Text>
            <Text style={styles.tierDesc}>{tier.description}</Text>
          </View>
          <View style={styles.tierRight}>
            <Text style={[styles.tierPrice, { color: tier.accentColor }]}>{tier.priceRange}</Text>
            <Text style={styles.tierEta}>{tier.eta} away</Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.25)" style={styles.chevron} />
      </Pressable>
    </MotiView>
  );
}

function SpecialServiceCard({ service }: { service: SpecialService }) {
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
      <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.3)" />
    </Pressable>
  );
}

export default function ServicesScreen() {
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
            <TierCard key={tier.id} tier={tier} />
          ))}
        </View>

        <Text style={[styles.sectionHeader, { marginTop: spacing['2xl'] }]}>Special Services</Text>
        <View style={styles.specialContainer}>
          {SPECIAL_SERVICES.map((service) => (
            <SpecialServiceCard key={service.id} service={service} />
          ))}
        </View>

        <View style={styles.bottomPad} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
    color: '#fff',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodyMedium,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 4,
  },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg },
  sectionHeader: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: spacing.md,
  },
  tiersContainer: { gap: spacing.sm },
  tierCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
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
    color: '#fff',
  },
  tierDesc: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodySmall,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 2,
  },
  tierRight: { alignItems: 'flex-end' },
  tierPrice: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
  },
  tierEta: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.caption,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 2,
  },
  chevron: { marginRight: spacing.md },
  specialContainer: {
    gap: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    overflow: 'hidden',
  },
  specialCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  specialIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: `${colors.primary}18`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  specialInfo: { flex: 1 },
  specialName: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.titleSmall,
    color: '#fff',
  },
  specialDesc: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodySmall,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 2,
  },
  pressed: { opacity: 0.75 },
  bottomPad: { height: 120 },
});
