import React from 'react';
import { View, StyleSheet } from 'react-native';
import { MotiView } from 'moti';
import { spacing, radii, type ColorTokens } from '@eyego/config';
import { Text } from './Text';
import { Pressable } from './Pressable';
import { Avatar } from './Avatar';
import { TierBadge } from './TierBadge';
import { SeatBar } from './SeatBar';
import { AnimatedFareText } from './AnimatedFareText';
import { formatTripDate } from '@eyego/utils';
import { useThemedColors } from './ColorsContext';

interface RideCardTrip {
  id: string;
  tier?: 'ECONOMY' | 'COMFORT' | 'PREMIUM';
  scheduledAt?: string;
  farePerSeat?: number;
  confirmedSeats?: number;
  maxCapacity?: number;
  pendingSeats?: number;
  route?: { name?: string; origin?: string; destination?: string };
  driver?: { name?: string; avatarUrl?: string | null; rating?: number };
}

interface RideCardProps {
  ride: RideCardTrip;
  onPress: () => void;
  index?: number;
}

function getTierColor(colors: ColorTokens): Record<string, string> {
  return {
    ECONOMY: colors.tierEconomy,
    COMFORT: colors.tierComfort,
    PREMIUM: colors.tierPremium,
  };
}

export function RideCard({ ride, onPress, index = 0 }: RideCardProps) {
  const colors = useThemedColors();
  const styles = getStyles(colors);
  const tier = ride.tier ?? 'ECONOMY';
  const tierColor = getTierColor(colors)[tier] ?? colors.tierEconomy;
  const confirmed = ride.confirmedSeats ?? 0;
  const pending = ride.pendingSeats ?? 0;
  const total = ride.maxCapacity ?? 12;
  const available = Math.max(0, total - confirmed - pending);

  return (
    <MotiView
      from={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20, delay: index * 60 }}
    >
      <Pressable onPress={onPress} style={styles.card}>
        {/* Tier accent stripe */}
        <View style={[styles.tierStripe, { backgroundColor: tierColor }]} />

        <View style={styles.content}>
          {/* Row 1: Route + Tier + Time */}
          <View style={styles.row}>
            <Text variant="titleSmall" style={{ flex: 1 }} numberOfLines={1}>
              {ride.route?.name ?? `${ride.route?.origin ?? '—'} → ${ride.route?.destination ?? '—'}`}
            </Text>
            <TierBadge tier={tier} />
            {ride.scheduledAt ? (
              <Text variant="caption" color={colors.onSurfaceVariant}>
                {formatTripDate(ride.scheduledAt)}
              </Text>
            ) : null}
          </View>

          {/* Row 2: Driver mini */}
          <View style={[styles.row, { marginTop: spacing.sm }]}>
            <Avatar uri={ride.driver?.avatarUrl} name={ride.driver?.name} size={28} />
            <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ marginLeft: spacing.xs }}>
              {ride.driver?.name ?? 'Driver'}
            </Text>
            {ride.driver?.rating ? (
              <Text variant="caption" color={colors.onSurfaceVariant}>
                {' '}★ {ride.driver.rating.toFixed(1)}
              </Text>
            ) : null}
          </View>

          {/* Row 3: Seat bar */}
          <View style={[styles.row, { marginTop: spacing.sm }]}>
            <SeatBar total={total} confirmed={confirmed} pending={pending} compact />
            <Text variant="caption" color={colors.onSurfaceVariant} style={{ marginLeft: spacing.xs }}>
              {available} left
            </Text>
          </View>

          {/* Row 4: Fare */}
          <View style={[styles.row, { marginTop: spacing.sm }]}>
            <AnimatedFareText value={ride.farePerSeat ?? 0} variant="fareMedium" color={colors.primary} />
            <Text variant="caption" color={colors.onSurfaceVariant} style={{ marginLeft: spacing.xs }}>
              per seat
            </Text>
          </View>
        </View>
      </Pressable>
    </MotiView>
  );
}

function getStyles(colors: ColorTokens) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surfaceCard,
      borderRadius: radii['2xl'],
      borderWidth: 1,
      borderColor: colors.rimLight,
      width: '100%',
      flexDirection: 'row',
      overflow: 'hidden',
    },
    tierStripe: {
      width: 3,
      alignSelf: 'stretch',
    },
    content: {
      flex: 1,
      padding: spacing.base,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
    },
  });
}
