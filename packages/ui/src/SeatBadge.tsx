import React from 'react';
import { View, StyleSheet } from 'react-native';
import { type ColorTokens } from '@eyego/config';
import { useThemedColors } from './ColorsContext';

type SeatStatus = 'available' | 'confirmed' | 'pending';

interface SeatBadgeProps {
  status: SeatStatus;
  compact?: boolean;
}

function getStatusColor(colors: ColorTokens): Record<SeatStatus, string> {
  return {
    confirmed: colors.primary,
    pending: '#FFB800',
    available: 'transparent',
  };
}

export function SeatBadge({ status, compact = false }: SeatBadgeProps) {
  const colors = useThemedColors();
  const statusColor = getStatusColor(colors);
  const size = compact ? 12 : 20;
  const borderColor = status === 'available' ? colors.outlineVariant : statusColor[status];

  return (
    <View
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: statusColor[status],
          borderWidth: status === 'available' ? 1 : 0,
          borderColor,
          borderStyle: status === 'available' ? 'dashed' : 'solid',
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  circle: {},
});
