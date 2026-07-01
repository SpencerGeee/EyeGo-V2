import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, fontSizes, spacing, radii, letterSpacings } from '@eyego/config';
import { Text } from './Text';
import { Pressable } from './Pressable';

type Tier = 'ECONOMY' | 'COMFORT';

interface TierOption {
  key: Tier;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  caption?: string;
  activeColor: string;
}

const TIERS: TierOption[] = [
  {
    key: 'ECONOMY',
    icon: 'leaf-outline',
    label: 'Economy',
    caption: 'Shared · Affordable',
    activeColor: colors.tierEconomy,
  },
  {
    key: 'COMFORT',
    icon: 'star-outline',
    label: 'Comfort',
    caption: 'Premium · Spacious',
    activeColor: colors.tierComfort,
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
              ...(isActive
                ? [{
                    borderColor: tier.activeColor,
                    borderWidth: 1.5,
                    backgroundColor: tier.activeColor + '15',
                  }]
                : []),
            ]}
          >
            <Ionicons
              name={tier.icon}
              size={22}
              color={isActive ? tier.activeColor : colors.onSurfaceVariant}
            />
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
    height: 88,
    borderRadius: radii.xl,
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  label: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.label,
    color: colors.onSurface,
    letterSpacing: letterSpacings.label,
  },
  caption: {
    fontFamily: fonts.regular,
    fontSize: 10,
    color: colors.onSurfaceVariant,
    letterSpacing: letterSpacings.label,
  },
});
