import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii, letterSpacings } from '@eyego/config';
import { Text } from './Text';
import { ShinyText } from './ShinyText';
import { useThemedColors } from './ColorsContext';
import { getTierTheme } from './tierTheme';

type BadgeSize = 'sm' | 'md';

interface TierBadgeProps {
  /**
   * Any spelling the wire might carry. Deliberately a plain `string`: the server
   * sends `ECO` for the economy tier and this component's old union only listed
   * `ECONOMY`, so callers passing the real value hit the undefined branch and the
   * badge rendered greyed-out — "I can't tell if the ride is economy or comfort".
   * `getTierTheme` normalizes instead of the type pretending the problem away.
   */
  tier: string | null | undefined;
  size?: BadgeSize;
}

export function TierBadge({ tier, size = 'sm' }: TierBadgeProps) {
  const colors = useThemedColors();
  const config = getTierTheme(colors, tier);
  const isSmall = size === 'sm';
  const iconSize = isSmall ? 10 : 12;
  const fontSize = isSmall ? 10 : fontSizes.bodySmall;

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: config.accent + '26',
          borderColor: config.accent + '4D',
          paddingHorizontal: isSmall ? spacing.xs : spacing.sm,
          paddingVertical: isSmall ? 2 : spacing.xs,
        },
      ]}
    >
      <Ionicons name={config.icon} size={iconSize} color={config.accent} />
      {config.shiny ? (
        <ShinyText
          style={{ marginLeft: 3 }}
          baseColor={config.accent}
          textStyle={{
            fontFamily: fonts.labelCaps,
            fontSize,
            lineHeight: Math.round(fontSize * 1.4),
            letterSpacing: letterSpacings.label,
            textTransform: 'uppercase',
          }}
        >
          {config.label}
        </ShinyText>
      ) : (
        <Text
          style={{
            fontFamily: fonts.labelCaps,
            fontSize,
            lineHeight: Math.round(fontSize * 1.4),
            color: config.accent,
            letterSpacing: letterSpacings.label,
            marginLeft: 3,
            textTransform: 'uppercase',
          }}
        >
          {config.label}
        </Text>
      )}
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
