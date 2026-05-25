import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors, fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text } from './Text';
import { Pressable } from './Pressable';

type Tier = 'ECONOMY' | 'COMFORT';

interface TierOption {
  key: Tier;
  icon: string;
  label: string;
  caption?: string;
  activeColor: string;
}

const TIERS: TierOption[] = [
  {
    key: 'ECONOMY',
    icon: '🌿',
    label: 'Eco',
    caption: 'Shared · Affordable',
    activeColor: colors.primary,
  },
  {
    key: 'COMFORT',
    icon: '✨',
    label: 'Comfort',
    caption: 'Premium · Spacious',
    activeColor: colors.secondary,
  },
];

interface TierSelectorProps {
  value: Tier;
  onChange: (tier: Tier) => void;
}

export function TierSelector({ value, onChange }: TierSelectorProps) {
  return (
    <View style={styles.row}>
      {TIERS.map((tier) => {
        const isActive = value === tier.key;
        return (
          <Pressable
            key={tier.key}
            onPress={() => onChange(tier.key)}
            style={[
              styles.card,
              isActive && {
                borderColor: tier.activeColor,
                backgroundColor: tier.activeColor + '15',
              },
            ]}
          >
            <Text style={styles.icon}>{tier.icon}</Text>
            <Text
              style={[
                styles.label,
                { color: isActive ? tier.activeColor : colors.onSurface },
              ]}
            >
              {tier.label}
            </Text>
            {tier.caption ? (
              <Text style={styles.caption}>{tier.caption}</Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  card: {
    flex: 1,
    height: 80,
    borderRadius: radii.xl,
    backgroundColor: colors.surfaceContainer,
    borderWidth: 1.5,
    borderColor: colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  icon: {
    fontSize: 20,
  },
  label: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.label,
    color: colors.onSurface,
  },
  caption: {
    fontFamily: fonts.regular,
    fontSize: 10,
    color: colors.onSurfaceVariant,
  },
});
