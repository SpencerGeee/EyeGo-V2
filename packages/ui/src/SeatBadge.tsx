import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors } from '@eyego/config';

type SeatStatus = 'available' | 'confirmed' | 'pending';

interface SeatBadgeProps {
  status: SeatStatus;
  compact?: boolean;
}

const STATUS_COLOR: Record<SeatStatus, string> = {
  confirmed: colors.primary,
  pending: '#FFB800',
  available: 'transparent',
};

export function SeatBadge({ status, compact = false }: SeatBadgeProps) {
  const size = compact ? 12 : 20;
  const borderColor = status === 'available' ? colors.outlineVariant : STATUS_COLOR[status];

  return (
    <View
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: STATUS_COLOR[status],
          borderWidth: status === 'available' ? 1 : 0,
          borderColor,
          borderStyle: status === 'available' ? 'dashed' : 'solid',
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  circle: {
    backgroundColor: colors.surfaceContainerHigh,
  },
});
