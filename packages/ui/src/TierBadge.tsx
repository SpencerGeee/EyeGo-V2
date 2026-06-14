import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors, fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text } from './Text';

type Tier = 'ECONOMY' | 'COMFORT' | 'PREMIUM';
type BadgeSize = 'sm' | 'md';

interface TierBadgeProps {
  tier: Tier;
  size?: BadgeSize;
}

const TIER_CONFIG: Record<Tier, { label: string; icon: string; color: string }> = {
  ECONOMY: { label: 'Eco', icon: '🌿', color: colors.primary },
  COMFORT: { label: 'Comfort', icon: '✨', color: colors.secondary },
  PREMIUM: { label: 'Premium', icon: '💎', color: '#7C3AED' },
};

export function TierBadge({ tier, size = 'sm' }: TierBadgeProps) {
  const config = TIER_CONFIG[tier] ?? TIER_CONFIG.ECONOMY;
  const isSmall = size === 'sm';

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: config.color + '20',
          paddingHorizontal: isSmall ? spacing.xs : spacing.sm,
          paddingVertical: isSmall ? 2 : spacing.xs,
        },
      ]}
    >
      <Text
        style={{
          fontFamily: fonts.semiBold,
          fontSize: isSmall ? 10 : fontSizes.bodySmall,
          color: config.color,
        }}
      >
        {config.icon} {config.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radii.full,
    alignSelf: 'flex-start',
  },
});
