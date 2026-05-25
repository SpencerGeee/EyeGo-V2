import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from '@eyego/ui';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { driverColors } from '../utils/useColors';

interface Seat {
  seatNumber: number;
  status: 'EMPTY' | 'BOOKED' | 'BOARDED';
  passengerName?: string;
}

interface Props {
  seats: Seat[];
  totalSeats: number;
}

export function SeatMap({ seats, totalSeats }: Props) {
  const seatMap = new Map(seats.map((s) => [s.seatNumber, s]));

  return (
    <View style={styles.grid}>
      {Array.from({ length: totalSeats }, (_, i) => {
        const num = i + 1;
        const seat = seatMap.get(num);
        const status = seat?.status ?? 'EMPTY';

        return (
          <View
            key={num}
            style={[
              styles.seat,
              status === 'BOARDED' && styles.seatBoarded,
              status === 'BOOKED' && styles.seatBooked,
              status === 'EMPTY' && styles.seatEmpty,
            ]}
          >
            <Text style={[
              styles.seatNum,
              { color: status !== 'EMPTY' ? driverColors.onPrimary : driverColors.onSurfaceVariant },
            ]}>
              {num}
            </Text>
          </View>
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
  seatEmpty: {
    backgroundColor: driverColors.surfaceContainerHighest,
    borderColor: driverColors.outline,
  },
  seatNum: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.caption,
  },
});
