import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from '@eyego/ui';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { driverColors } from '../utils/useColors';
import * as Haptics from 'expo-haptics';

/**
 * HELD is not a cosmetic variant of BOOKED. A held seat is one a rider has
 * reserved but not paid for; it releases itself when the hold expires. The map
 * used to collapse it into EMPTY, so a driver watching seats fill saw a seat go
 * from taken to free with no explanation, and the header count (which did
 * include holds) disagreed with the grid underneath it.
 */
export interface SeatData {
  seatNumber: number;
  status: 'EMPTY' | 'HELD' | 'BOOKED' | 'BOARDED';
  passengerName?: string;
  userId?: string;
  userName?: string;
  bookingId?: string;
}

interface Props {
  seats: SeatData[];
  totalSeats: number;
  onSeatPress?: (seat: SeatData) => void;
}

export function SeatMap({ seats, totalSeats, onSeatPress }: Props) {
  const seatMap = new Map(seats.map((s) => [s.seatNumber, s]));

  return (
    <View style={styles.grid}>
      {Array.from({ length: totalSeats }, (_, i) => {
        const num = i + 1;
        const seat = seatMap.get(num) ?? { seatNumber: num, status: 'EMPTY' as const };
        const status = seat.status;
        const isOccupied = status !== 'EMPTY';

        return (
          <Pressable
            key={num}
            onPress={() => {
              if (!isOccupied || !onSeatPress) return;
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onSeatPress(seat);
            }}
            style={({ pressed }) => [
              styles.seat,
              status === 'BOARDED' && styles.seatBoarded,
              status === 'BOOKED' && styles.seatBooked,
              status === 'HELD' && styles.seatHeld,
              status === 'EMPTY' && styles.seatEmpty,
              pressed && isOccupied && styles.seatPressed,
            ]}
            accessibilityRole={isOccupied ? 'button' : 'none'}
            accessibilityLabel={
              status === 'HELD'
                ? `Seat ${num}, held, awaiting payment`
                : status === 'EMPTY'
                  ? `Seat ${num}, free`
                  : `Seat ${num}, ${status.toLowerCase()}`
            }
          >
            <Text style={[
              styles.seatNum,
              {
                color:
                  status === 'BOARDED' || status === 'BOOKED'
                    ? driverColors.onPrimary
                    : status === 'HELD'
                      ? driverColors.warning
                      : driverColors.onSurfaceVariant,
              },
            ]}>
              {num}
            </Text>
            {status === 'HELD' && <View style={styles.heldPip} />}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-start',
  },
  seat: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  seatBoarded: {
    backgroundColor: driverColors.primary,
    borderColor: driverColors.primary,
  },
  seatBooked: {
    backgroundColor: `${driverColors.primary}30`,
    borderColor: driverColors.primary,
  },
  // Deliberately NOT a lighter shade of the booked colour — "reserved, may
  // vanish" has to be legible at a glance from the driver's seat, so it gets
  // its own hue and a dashed rim rather than a subtler tint of the same one.
  seatHeld: {
    backgroundColor: `${driverColors.warning}22`,
    borderColor: driverColors.warning,
    borderStyle: 'dashed',
  },
  heldPip: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: driverColors.warning,
  },
  seatEmpty: {
    backgroundColor: driverColors.surfaceContainerHighest,
    borderColor: driverColors.outline,
  },
  seatPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.93 }],
  },
  seatNum: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.caption,
    lineHeight: Math.round(fontSizes.caption * 1.3),
  },
});
