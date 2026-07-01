import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors, fonts, spacing, radii, letterSpacings } from '@eyego/config';
import { Text } from './Text';

type BookingStatus = 'PENDING' | 'CONFIRMED' | 'BOARDED' | 'COMPLETED' | 'CANCELLED' | 'REFUNDED' | 'SEAT_HELD';

interface StatusBadgeProps {
  status: BookingStatus;
}

const STATUS_CONFIG: Record<BookingStatus, { label: string; color: string }> = {
  PENDING:   { label: 'Pending',   color: colors.statusWarning },
  SEAT_HELD: { label: 'Seat Held', color: colors.statusWarning },
  CONFIRMED: { label: 'Confirmed', color: colors.statusSuccess },
  BOARDED:   { label: 'Boarded',   color: colors.statusSuccess },
  COMPLETED: { label: 'Completed', color: colors.onSurfaceVariant },
  CANCELLED: { label: 'Cancelled', color: colors.statusError },
  REFUNDED:  { label: 'Refunded',  color: colors.statusError },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.PENDING;

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: config.color + '26',
          borderColor: config.color + '4D',
        },
      ]}
    >
      <Text
        style={{
          fontFamily: fonts.semiBold,
          fontSize: 10,
          color: config.color,
          letterSpacing: letterSpacings.label,
        }}
      >
        {config.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.full,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
});
