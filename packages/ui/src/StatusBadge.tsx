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

/**
 * The ONE place a booking status becomes words a rider reads.
 *
 * Exported because it used to live only inside this component, so any screen
 * that drew its own chip — the Activity tab did — printed the raw Prisma enum
 * instead: a rider with a held seat saw the literal string `SEAT_HELD`. Worse
 * than ugly, it lost the distinction the enum exists to carry: a hold is not a
 * booking, and `bookingStatusLabel` is what keeps every surface saying so.
 */
export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING:   'Pending',
  // "Held", not "Booked": the seat is reserved while the rider pays and
  // releases itself if they don't.
  SEAT_HELD: 'Seat Held',
  CONFIRMED: 'Confirmed',
  PAID:      'Paid',
  BOARDED:   'Boarded',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  REFUNDED:  'Refunded',
  EXPIRED:   'Expired',
  NO_SHOW:   'No Show',
};

/** Never render a booking status without going through this. */
export function bookingStatusLabel(status: string | null | undefined): string {
  return BOOKING_STATUS_LABELS[status as BookingStatus] ?? BOOKING_STATUS_LABELS.PENDING;
}

function getStatusConfig(colors: ColorTokens): Record<BookingStatus, { label: string; color: string }> {
  const label = (s: BookingStatus) => BOOKING_STATUS_LABELS[s];
  return {
    PENDING:   { label: label('PENDING'),   color: colors.statusWarning },
    SEAT_HELD: { label: label('SEAT_HELD'), color: colors.statusWarning },
    CONFIRMED: { label: label('CONFIRMED'), color: colors.statusSuccess },
    PAID:      { label: label('PAID'),      color: colors.statusSuccess },
    BOARDED:   { label: label('BOARDED'),   color: colors.statusSuccess },
    COMPLETED: { label: label('COMPLETED'), color: colors.onSurfaceVariant },
    CANCELLED: { label: label('CANCELLED'), color: colors.statusError },
    REFUNDED:  { label: label('REFUNDED'),  color: colors.statusError },
    EXPIRED:   { label: label('EXPIRED'),   color: colors.onSurfaceVariant },
    NO_SHOW:   { label: label('NO_SHOW'),   color: colors.statusError },
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
