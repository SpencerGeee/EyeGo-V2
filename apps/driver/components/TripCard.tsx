import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '../utils/useColors';
import type { DriverTrip } from '@eyego/api';

const STATUS_COLORS: Record<string, string> = {
  SCHEDULED:       '#94A3B8',
  FILLING:         '#3B82F6',
  DRIVER_EN_ROUTE: '#F59E0B',
  IN_PROGRESS:     '#22C55E',
  COMPLETED:       '#60A5FA',
  CANCELLED:       '#F87171',
};

const STATUS_LABELS: Record<string, string> = {
  SCHEDULED:       'Scheduled',
  FILLING:         'Boarding',
  DRIVER_EN_ROUTE: 'En Route',
  IN_PROGRESS:     'In Progress',
  COMPLETED:       'Completed',
  CANCELLED:       'Cancelled',
};

interface Props {
  trip: DriverTrip;
  onPress: () => void;
}

export function TripCard({ trip, onPress }: Props) {
  const colors = useColors();
  const statusColor = STATUS_COLORS[trip.status] ?? colors.onSurfaceVariant;
  const statusLabel = STATUS_LABELS[trip.status] ?? trip.status;
  const boarded = trip.bookings?.filter((b) => b.status === 'BOARDED').length
    ?? trip.confirmedSeats
    ?? 0;
  const total = trip.maxSeats;
  const fare = trip.farePerSeat ?? trip.baseFare ?? 0;

  return (
    <Pressable onPress={onPress}style={styles.wrapper}>
      <View style={[styles.card, { backgroundColor: colors.surfaceContainer, borderColor: colors.outline }]}>
        {/* Status strip */}
        <View style={[styles.statusStrip, { backgroundColor: statusColor }]} />

        <View style={styles.content}>
          {/* Route */}
          <View style={styles.routeRow}>
            <View style={styles.routePoints}>
              <View style={[styles.originDot, { backgroundColor: colors.onSurfaceVariant }]} />
              <View style={[styles.routeLineDot, { backgroundColor: colors.outline }]} />
              <View style={[styles.originDot, { backgroundColor: colors.primary }]} />
            </View>
            <View style={styles.routeText}>
              <Text style={[styles.origin, { color: colors.onSurface }]}>
                {trip.route?.originName ?? '—'}
              </Text>
              <Text style={[styles.dest, { color: colors.primary }]}>
                {trip.route?.destinationName ?? '—'}
              </Text>
            </View>
          </View>

          {/* Meta row */}
          <View style={styles.metaRow}>
            <MetaItem
              icon="time-outline"
              value={new Date(trip.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              color={colors.onSurfaceVariant}
            />
            <MetaItem
              icon="people-outline"
              value={`${boarded}/${total}`}
              color={colors.onSurfaceVariant}
            />
            <MetaItem
              icon="cash-outline"
              value={`GHS ${fare.toFixed(0)}`}
              color={colors.onSurfaceVariant}
            />
            <View style={styles.statusBadge}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
            </View>
          </View>
        </View>

        <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} style={styles.arrow} />
      </View>
    </Pressable>
  );
}

function MetaItem({ icon, value, color }: { icon: keyof typeof Ionicons.glyphMap; value: string; color: string }) {
  return (
    <View style={styles.metaItem}>
      <Ionicons name={icon} size={13} color={color} />
      <Text style={[styles.metaText, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: spacing.sm },
  card: {
    flexDirection: 'row',
    borderRadius: radii.xl,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
  },
  statusStrip: { width: 4, alignSelf: 'stretch' },
  content: { flex: 1, padding: spacing.base, gap: spacing.sm },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  routePoints: { alignItems: 'center', gap: 3, paddingVertical: 2 },
  originDot: { width: 8, height: 8, borderRadius: 4 },
  routeLineDot: { width: 2, height: 16, borderRadius: 1 },
  routeText: { flex: 1 },
  origin: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium },
  dest: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText: { fontFamily: fonts.regular, fontSize: 11 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto' },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontFamily: fonts.semiBold, fontSize: 11 },
  arrow: { paddingRight: spacing.base },
});
