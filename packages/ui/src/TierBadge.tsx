import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii, letterSpacings, type ColorTokens } from '@eyego/config';
import { Text } from './Text';
import { useThemedColors } from './ColorsContext';

type Tier = 'ECONOMY' | 'COMFORT' | 'PREMIUM' | 'ROYAL';
type BadgeSize = 'sm' | 'md';

interface TierBadgeProps {
  tier: Tier;
  size?: BadgeSize;
}

function getTierConfig(colors: ColorTokens): Record<Tier, { label: string; icon: React.ComponentProps<typeof Ionicons>['name']; color: string }> {
  return {
    ECONOMY:  { label: 'Economy',  icon: 'leaf-outline',    color: colors.tierEconomy },
    COMFORT:  { label: 'Comfort',  icon: 'star-outline',    color: colors.tierComfort },
    PREMIUM:  { label: 'Premium',  icon: 'diamond-outline', color: colors.tierPremium },
    ROYAL:    { label: 'Royal',    icon: 'ribbon-outline',  color: colors.tierRoyal  },
  };
}

export function TierBadge({ tier, size = 'sm' }: TierBadgeProps) {
  const colors = useThemedColors();
  const config = getTierConfig(colors)[tier] ?? getTierConfig(colors).ECONOMY;
  const isSmall = size === 'sm';
  const iconSize = isSmall ? 10 : 12;
  const fontSize = isSmall ? 10 : fontSizes.bodySmall;

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: config.color + '26',
          borderColor: config.color + '4D',
          paddingHorizontal: isSmall ? spacing.xs : spacing.sm,
          paddingVertical: isSmall ? 2 : spacing.xs,
        },
      ]}
    >
      <Ionicons name={config.icon} size={iconSize} color={config.color} />
      <Text
        style={{
          fontFamily: fonts.labelCaps,
          fontSize,
          lineHeight: Math.round(fontSize * 1.4),
          color: config.color,
          letterSpacing: letterSpacings.label,
          marginLeft: 3,
          textTransform: 'uppercase',
        }}
      >
        {config.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radii.full,
    borderWidth: 1,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
  },
});
