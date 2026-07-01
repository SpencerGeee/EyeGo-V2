import React from 'react';
import { View, ViewStyle, StyleSheet } from 'react-native';
import { radii, spacing, withOpacity, type ColorTokens } from '@eyego/config';
import { useThemedColors } from './ColorsContext';

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  elevated?: boolean;
  glow?: boolean;
  selected?: boolean;
  padding?: number;
}

export function Card({
  children,
  style,
  elevated = false,
  glow = false,
  selected = false,
  padding = spacing.base,
}: CardProps) {
  const colors = useThemedColors();
  const styles = getStyles(colors);
  return (
    <View
      style={[
        styles.base,
        elevated && styles.elevated,
        glow && styles.glow,
        selected && styles.selected,
        { padding },
        style,
      ]}
    >
      {children}
    </View>
  );
}

function getStyles(colors: ColorTokens) {
  return StyleSheet.create({
    base: {
      backgroundColor: colors.surfaceCard,
      borderRadius: radii['2xl'],
      borderWidth: 1,
      borderColor: colors.rimLight,
    },
    elevated: {
      backgroundColor: colors.surfaceContainerHigh,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 8,
      elevation: 4,
    },
    glow: {
      borderColor: colors.primary,
      borderWidth: 1.5,
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.3,
      shadowRadius: 12,
      elevation: 6,
    },
    selected: {
      borderColor: colors.primary,
      borderWidth: 1.5,
      backgroundColor: withOpacity(colors.primary, 0.05),
    },
  });
}
