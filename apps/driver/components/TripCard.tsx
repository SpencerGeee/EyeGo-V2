import React from 'react';
import { formatGhs, originLabel, destinationLabel, clockTime, dayMonth, seatsOf } from '@eyego/utils';
import { View, StyleSheet, Pressable } from 'react-native';
import Animated from 'react-native-reanimated';
import { fonts, fontSizes, spacing, radii, driverStatusLabel } from '@eyego/config';
import { Text, usePressScale } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../utils/useColors';
import type { DriverTrip } from '@eyego/api';

/** One tone per phase, from the theme — the old hex table missed half the statuses. */
function toneFor(status: string, colors: DriverColors): string {
  switch (status) {
    case 'IN_PROGRESS':
    case 'COMPLETED':
      return colors.statusSuccess ?? colors.online;
    case 'DRIVER_ASSIGNED':
    case 'DRIVER_EN_ROUTE':
    case 'ARRIVED_AT_PICKUP':
      return colors.statusWarning ?? colors.warning;
    case 'SCHEDULED':
    case 'FILLING':
    case 'CONFIRMED':
      return colors.primary;
    case 'CANCELLED':
    case 'EXPIRED':
    case 'NO_SHOW':
    case 'NO_DRIVERS_FOUND':
      return colors.error;
    default:
      return colors.onSurfaceVariant;
  }
}

interface Props {
  trip: DriverTrip;
  onPress: () => void;
}

/**
 * A trip in the driver's list: when, where, how full, and what it pays.
 *
 * BUGFIX (the numbers). Seats were `bookings.filter(BOARDED).length` — booking
 * ROWS that happened to be boarded at that instant — so a filling trip with
 * three seats sold read 0/14, and every finished trip read 0/14 too (a
 * completed booking is no longer BOARDED). Seats are now `Booking.seats`
 * summed over the seat-occupying rows the list already returns, and a
 * finished trip shows the fares it took instead of a per-seat list price.
 */
export function TripCard({ trip, onPress }: Props) {
  const colors = useColors();
  const press = usePressScale();
  const t = trip as any;
  const status = String(t.status ?? '');
  const tone = toneFor(status, colors);
  const bookings: any[] = Array.isArray(t.bookings) ? t.bookings : [];
  const seatsSold = bookings.reduce((n, b) => n + seatsOf(b), 0);
  const total = t.maxSeats ?? seatsSold;
  const ended = ['COMPLETED', 'CANCELLED', 'EXPIRED', 'NO_SHOW', 'NO_DRIVERS_FOUND'].includes(status);
  const settled = bookings.filter(
    (b) => b.paymentStatus === 'PAID' || ['CONFIRMED', 'BOARDED', 'COMPLETED'].includes(b.status),
  );
  const faresTaken = settled.reduce((n, b) => n + (Number(b.fareAmountPesewas) || 0), 0);
  const perSeat = t.farePerSeatPesewas ?? t.baseFarePesewas ?? null;
  const when = t.departureTime ? `${dayMonth(t.departureTime)} · ${clockTime(t.departureTime)}` : null;

  return (
    <Pressable onPress={onPress} {...press.handlers} style={styles.wrapper} accessibilityRole="button">
      <Animated.View
        style={[
          styles.card,
          { backgroundColor: colors.surfaceContainer, borderColor: colors.outlineVariant },
          press.style,
        ]}
      >
        <View style={styles.topRow}>
          <Text style={[styles.when, { color: colors.onSurfaceVariant }]} numberOfLines={1}>
            {when ?? 'Unscheduled'}
          </Text>
          <View style={[styles.statusChip, { backgroundColor: `${tone}1F` }]}>
            <View style={[styles.statusDot, { backgroundColor: tone }]} />
            <Text style={[styles.statusText, { color: tone }]}>{driverStatusLabel(status) || status}</Text>
          </View>
        </View>

        <View style={styles.route}>
          <View style={styles.spine}>
            <View style={[styles.dot, { borderColor: colors.onSurfaceVariant }]} />
            <View style={[styles.line, { backgroundColor: colors.outline }]} />
            <Ionicons name="location" size={12} color={colors.primary} />
          </View>
          <View style={styles.places}>
            <Text style={[styles.place, { color: colors.onSurface }]} numberOfLines={1}>
              {originLabel(trip) ?? 'Pickup'}
            </Text>
            <Text style={[styles.place, { color: colors.onSurface }]} numberOfLines={1}>
              {destinationLabel(trip) ?? 'Destination'}
            </Text>
          </View>
        </View>

        <View style={[styles.footer, { borderTopColor: colors.outlineVariant }]}>
          <View style={styles.metaItem}>
            <Ionicons name="people-outline" size={14} color={colors.onSurfaceVariant} />
            <Text style={[styles.metaText, { color: colors.onSurfaceVariant }]}>
              {seatsSold}/{total} seats
            </Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="cash-outline" size={14} color={colors.onSurfaceVariant} />
            <Text style={[styles.metaText, { color: ended && faresTaken > 0 ? colors.onSurface : colors.onSurfaceVariant }]}>
              {ended
                ? faresTaken > 0
                  ? `${formatGhs(faresTaken)} in fares`
                  : 'No fares'
                : perSeat != null
                  ? `${formatGhs(perSeat, { showDecimals: false })}/seat`
                  : '—'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} style={styles.arrow} />
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: spacing.md },
  card: {
    borderRadius: radii['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.base,
    paddingTop: spacing.md,
    gap: spacing.md,
    overflow: 'hidden',
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  when: { fontFamily: fonts.medium, fontSize: fontSizes.caption, flexShrink: 1 },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.full,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontFamily: fonts.semiBold, fontSize: 11 },
  route: { flexDirection: 'row', gap: spacing.md },
  spine: { alignItems: 'center', paddingTop: 5, width: 12 },
  dot: { width: 9, height: 9, borderRadius: 4.5, borderWidth: 2 },
  line: { width: 2, flex: 1, minHeight: 12, borderRadius: 1, marginVertical: 3 },
  places: { flex: 1, gap: spacing.md },
  place: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.md,
  },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { fontFamily: fonts.medium, fontSize: fontSizes.caption },
  arrow: { marginLeft: 'auto' },
});
