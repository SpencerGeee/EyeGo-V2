import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { tripsApi } from '@eyego/api';
import { fonts, spacing } from '@eyego/config';
import { Text, Pressable } from '@eyego/ui';
import { formatGhs } from '@eyego/utils';
import type { Colors } from '../../utils/useColors';

/**
 * ── SHARED: A BUS IS ALREADY HEADING YOUR WAY (client 2026-10-29, item 2) ───
 *
 * Before a rider pays for a private bus, look for a bus already going their
 * way with a free seat on their stretch (Yango does the same: a ride ordered
 * along a shuttle corridor is offered the shuttle). The bus was coming anyway,
 * so it is the ordinary seat price — no premium. Tapping it moves the flow to
 * the bus list for the same two ends.
 */
type Coord = { latitude?: number; longitude?: number } | null | undefined;

export function SharedBusSuggestion({ origin, destination, colors, onTakeSeat }: {
  origin: Coord;
  destination: Coord;
  colors: Colors;
  onTakeSeat: () => void;
}) {
  const ready = origin?.latitude != null && origin?.longitude != null && destination?.latitude != null && destination?.longitude != null;
  const { data } = useQuery({
    queryKey: ['shared-bus', origin?.latitude, origin?.longitude, destination?.latitude, destination?.longitude],
    enabled: ready,
    staleTime: 30_000,
    queryFn: () => tripsApi.search({
      originLat: origin!.latitude!,
      originLng: origin!.longitude!,
      destinationLat: destination!.latitude!,
      destinationLng: destination!.longitude!,
    } as any),
  });
  const trips: any[] = (data as any)?.data?.data?.trips ?? (data as any)?.data?.trips ?? [];
  const best = trips.find((t) => (t.availableSeats ?? 0) > 0);
  if (!best) return null;

  const mins = best.etaToPickupSec != null ? Math.max(1, Math.round(best.etaToPickupSec / 60)) : null;
  const fare = best.riderFarePesewas ?? best.farePerSeatPesewas ?? null;
  const when = mins != null ? `passing you in ${mins} min` : best.isRunning ? 'on the road now' : 'leaving soon';

  return (
    <Pressable
      testID="shared-bus-suggestion"
      accessibilityRole="button"
      accessibilityLabel={`Shared bus ${when}. Take a seat${fare != null ? ` for ${formatGhs(fare)}` : ''}`}
      onPress={onTakeSeat}
      style={({ pressed }) => [styles.card, { backgroundColor: colors.surfaceCard, borderColor: colors.primary, opacity: pressed ? 0.88 : 1 }]}
    >
      <Ionicons name="people" size={22} color={colors.primary} />
      <View style={styles.text}>
        <Text style={[styles.title, { color: colors.onSurface }]}>Shared · a bus is heading your way</Text>
        <Text style={[styles.sub, { color: colors.onSurfaceVariant }]}>
          {when} · {best.availableSeats} seat{best.availableSeats === 1 ? '' : 's'} free
        </Text>
      </View>
      {fare != null && <Text style={[styles.price, { color: colors.onSurface }]}>{formatGhs(fare)}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: 16, borderWidth: 2, padding: spacing.md, marginBottom: spacing.sm },
  text: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.semiBold, fontSize: 14 },
  sub: { fontFamily: fonts.regular, fontSize: 12 },
  price: { fontFamily: fonts.semiBold, fontSize: 16 },
});
