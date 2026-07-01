import React from 'react';
import { View, StyleSheet } from 'react-native';
import { fonts, spacing, radii, letterSpacings, type ColorTokens } from '@eyego/config';
import { Text } from './Text';
import { useThemedColors } from './ColorsContext';

type BookingStatus = 'PENDING' | 'CONFIRMED' | 'BOARDED' | 'COMPLETED' | 'CANCELLED' | 'REFUNDED' | 'SEAT_HELD';

interface StatusBadgeProps {
  status: BookingStatus;
}

function getStatusConfig(colors: ColorTokens): Record<BookingStatus, { label: string; color: string }> {
  return {
    PENDING:   { label: 'Pending',   color: colors.statusWarning },
    SEAT_HELD: { label: 'Seat Held', color: colors.statusWarning },
    CONFIRMED: { label: 'Confirmed', color: colors.statusSuccess },
    BOARDED:   { label: 'Boarded',   color: colors.statusSuccess },
    COMPLETED: { label: 'Completed', color: colors.onSurfaceVariant },
    CANCELLED: { label: 'Cancelled', color: colors.statusError },
    REFUNDED:  { label: 'Refunded',  color: colors.statusError },
  };
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const colors = useThemedColors();
  const statusConfig = getStatusConfig(colors);
  const config = statusConfig[status] ?? statusConfig.PENDING;

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
          fontFamily: fonts.labelCaps,
          fontSize: 10,
          lineHeight: 14,
          color: config.color,
          letterSpacing: letterSpacings.label,
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
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.full,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
});
