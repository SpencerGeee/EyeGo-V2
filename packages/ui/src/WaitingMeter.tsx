import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing } from '@eyego/config';
import { formatGhs, waitingState } from '@eyego/utils';
import { Text } from './Text';
import { useThemedColors } from './ColorsContext';

export interface WaitingMeterProps {
  /** When the driver marked "arrived at pickup" (trip.arrivedAt). */
  arrivedAt: string | null | undefined;
  freeMinutes: number;
  perMinPesewas: number;
  capPesewas: number;
  /** Rider: "your driver is waiting"; driver: "you are waiting". */
  who: 'rider' | 'driver';
}

/**
 * The waiting meter at a hailed pickup — one line, ticking each second.
 *
 * "Free waiting · 2:31 left", then "Waiting fee · GH₵1.64". Both apps show it
 * so the rider learns there is a clock before it costs them and the driver can
 * see what the wait is earning. Renders nothing when waiting is free.
 */
export function WaitingMeter({ arrivedAt, freeMinutes, perMinPesewas, capPesewas, who }: WaitingMeterProps) {
  const colors = useThemedColors();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!arrivedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [arrivedAt]);

  const s = waitingState(arrivedAt, now, freeMinutes, perMinPesewas, capPesewas);
  if (!s) return null;

  const running = s.freeSecondsLeft === 0;
  const mm = Math.floor(s.freeSecondsLeft / 60);
  const ss = String(s.freeSecondsLeft % 60).padStart(2, '0');
  const text = running
    ? `Waiting fee · ${formatGhs(s.feePesewas)}${who === 'rider' ? ' added to your fare' : ''}`
    : `Free waiting · ${mm}:${ss} left`;

  return (
    <View
      style={styles.row}
      accessibilityRole="text"
      accessibilityLabel={running ? `Waiting fee ${formatGhs(s.feePesewas)}` : `Free waiting, ${mm} minutes ${ss} seconds left`}
    >
      <Ionicons name={running ? 'time' : 'time-outline'} size={14} color={running ? colors.statusWarning : colors.onSurfaceVariant} />
      <Text style={[styles.text, { color: running ? colors.statusWarning : colors.onSurfaceVariant }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  text: { fontFamily: fonts.medium, fontSize: fontSizes.bodySmall, fontVariant: ['tabular-nums'] },
});
