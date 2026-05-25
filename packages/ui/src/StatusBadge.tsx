import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors, fonts, spacing, radii } from '@eyego/config';
import { Text } from './Text';

type BookingStatus = 'PENDING' | 'CONFIRMED' | 'BOARDED' | 'COMPLETED' | 'CANCELLED' | 'REFUNDED';

interface StatusBadgeProps {
  status: BookingStatus;
}

const STATUS_CONFIG: Record<BookingStatus, { label: string; color: string }> = {
  PENDING:   { label: 'Pending',   color: '#FFB800' },
  CONFIRMED: { label: 'Confirmed', color: colors.primary },
  BOARDED:   { label: 'Boarded',   color: '#30D158' },
  COMPLETED: { label: 'Completed', color: colors.onSurfaceVariant },
  CANCELLED: { label: 'Cancelled', color: colors.error },
  REFUNDED:  { label: 'Refunded',  color: colors.error },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.PENDING;

  return (
    <View style={[styles.badge, { backgroundColor: config.color + '20' }]}>
      <Text style={{ fontFamily: fonts.semiBold, fontSize: 10, color: config.color }}>
        {config.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.full,
    alignSelf: 'flex-start',
  },
});
