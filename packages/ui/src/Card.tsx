import React from 'react';
import { View, ViewStyle, StyleSheet } from 'react-native';
import { colors, radii, spacing, shadows } from '@eyego/config';

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  elevated?: boolean;
  glow?: boolean;
  padding?: number;
}

export function Card({ children, style, elevated = false, glow = false, padding = spacing.base }: CardProps) {
  return (
    <View
      style={[
        styles.base,
        elevated && styles.elevated,
        glow && styles.glow,
        { padding },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii['2xl'],
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  elevated: {
    backgroundColor: colors.surfaceContainerHigh,
    ...shadows.card,
  },
  glow: {
    borderColor: colors.primary,
    borderWidth: 1,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
});
