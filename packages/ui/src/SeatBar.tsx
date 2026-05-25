import React from 'react';
import { View, StyleSheet } from 'react-native';
import { MotiView } from 'moti';
import { spacing } from '@eyego/config';
import { SeatBadge } from './SeatBadge';

interface SeatBarProps {
  total: number;
  confirmed: number;
  pending: number;
  compact?: boolean;
}

export function SeatBar({ total, confirmed, pending, compact = false }: SeatBarProps) {
  const gap = compact ? 4 : 6;

  return (
    <View style={[styles.row, { gap }]}>
      {Array.from({ length: total }).map((_, i) => {
        const isConfirmed = i < confirmed;
        const isPending = !isConfirmed && i < confirmed + pending;
        const status = isConfirmed ? 'confirmed' : isPending ? 'pending' : 'available';

        return (
          <MotiView
            key={i}
            from={isConfirmed ? { scale: 0.5 } : { scale: 1 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20, delay: i * 30 }}
          >
            <SeatBadge status={status} compact={compact} />
          </MotiView>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
});
