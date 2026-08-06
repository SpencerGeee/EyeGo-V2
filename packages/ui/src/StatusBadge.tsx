import React from 'react';
import { View, StyleSheet } from 'react-native';
import { fonts, spacing, radii, letterSpacings, type ColorTokens } from '@eyego/config';
import { Text } from './Text';
import { useThemedColors } from './ColorsContext';

// Kept in step with `@eyego/types`' BookingStatus, which mirrors the Prisma
// enum. A status the server can send but this map omits falls through to
// "Pending", which is how an EXPIRED hold used to read as still pending.
type BookingStatus =
  | 'PENDING'
  | 'SEAT_HELD'
  | 'CONFIRMED'
  | 'PAID'
  | 'BOARDED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'EXPIRED'
  | 'NO_SHOW';

interface StatusBadgeProps {
  status: BookingStatus;
}

function getStatusConfig(colors: ColorTokens): Record<BookingStatus, { label: string; color: string }> {
  return {
    PENDING:   { label: 'Pending',   color: colors.statusWarning },
    // "Held", not "Booked": the seat is reserved while the rider pays and
    // releases itself if they don't.
    SEAT_HELD: { label: 'Seat Held', color: colors.statusWarning },
    CONFIRMED: { label: 'Confirmed', color: colors.statusSuccess },
    PAID:      { label: 'Paid',      color: colors.statusSuccess },
    BOARDED:   { label: 'Boarded',   color: colors.statusSuccess },
    COMPLETED: { label: 'Completed', color: colors.onSurfaceVariant },
    CANCELLED: { label: 'Cancelled', color: colors.statusError },
    REFUNDED:  { label: 'Refunded',  color: colors.statusError },
    EXPIRED:   { label: 'Expired',   color: colors.onSurfaceVariant },
    NO_SHOW:   { label: 'No Show',   color: colors.statusError },
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
