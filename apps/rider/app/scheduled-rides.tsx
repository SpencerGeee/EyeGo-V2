import React, { useMemo } from 'react';
import { formatGhs } from '@eyego/utils';
import { View, StyleSheet, FlatList, Alert, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { tripsApi } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button, GradientGlowBorder } from '@eyego/ui';
import { useColors, Colors } from '../utils/useColors';

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Waiting for a match',
  DISPATCHED: 'Looking for a nearby driver',
  MATCHED: 'Confirmed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

const LIVE_STATUSES = ['PENDING', 'DISPATCHED', 'MATCHED'];

export default function ScheduledRidesScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['trips', 'scheduled'],
    queryFn: () => tripsApi.getScheduledRides(),
    refetchInterval: 20000, // pending/dispatched rides can flip to MATCHED between visits
  });

  const cancel = useMutation({
    mutationFn: (id: string) => tripsApi.cancelScheduledRide(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trips', 'scheduled'] });
    },
    onError: () => Alert.alert('Error', 'Could not cancel this scheduled ride. Please try again.'),
  });

  const allIntents: any[] = data?.data?.data?.intents ?? [];
  const byTime = (a: any, b: any) =>
    new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();

  // Nearest upcoming ride still in play gets the live hero card. It is then
  // EXCLUDED from the list below — repeating it as a plain dark row with a
  // lone Cancel button just made it look like a second, broken ride. Expired
  // and cancelled history sorts last so it can't crowd out upcoming rides.
  const liveIntents = allIntents.filter((i) => LIVE_STATUSES.includes(i.status)).sort(byTime);
  const pastIntents = allIntents.filter((i) => !LIVE_STATUSES.includes(i.status)).sort(byTime).reverse();
  const liveIntent = liveIntents[0] ?? null;
  const intents = [...liveIntents.filter((i) => i.id !== liveIntent?.id), ...pastIntents];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Ionicons name="arrow-back" size={22} color={colors.onSurface} onPress={() => router.back()} />
        <Text style={styles.title}>Scheduled Rides</Text>
        <View style={{ width: 22 }} />
      </View>

      <FlatList
        data={intents}
        keyExtractor={(item) => item.id}
        refreshing={isLoading}
        onRefresh={refetch}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          liveIntent ? (
            <GradientGlowBorder
              palette="green"
              fillColor={colors.surfaceCard}
              borderRadius={radii.xl}
              glow
              style={styles.liveCard}
            >
              {/* BUGFIX (item 7 — "you tap the live scheduled card and nothing
                  happens"): the fallback branch was literally `: null`, so before
                  a driver is matched (status PENDING/DISPATCHED — i.e. most of the
                  time this card is on screen) tapping did nothing at all. The home
                  screen's copy of this card already pushed `/scheduled/[id]`;
                  matching that here means the card always leads somewhere, and
                  goes to live tracking only once there is a trip to track. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  liveIntent.matchedTripId ? 'Track your scheduled ride' : 'View scheduled ride details'
                }
                onPress={() =>
                  router.push(
                    (liveIntent.matchedTripId
                      ? `/ride/${liveIntent.matchedTripId}/tracking`
                      : `/scheduled/${liveIntent.id}`) as any,
                  )
                }
              >
                <View style={styles.liveCardTopRow}>
                  <View style={styles.liveDotWrap}>
                    <View style={[styles.liveDot, { backgroundColor: liveIntent.status === 'MATCHED' ? colors.statusSuccess : colors.primary }]} />
                    <Text style={styles.liveLabel}>
                      {liveIntent.status === 'MATCHED' ? 'DRIVER CONFIRMED' : 'NEXT SCHEDULED RIDE'}
                    </Text>
                  </View>
                  <Text style={styles.liveTime}>
                    {new Date(liveIntent.scheduledAt).toLocaleString('en-GH', {
                      weekday: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </Text>
                </View>
                <View style={styles.liveDestRow}>
                  <Ionicons name="navigate-outline" size={16} color={colors.tierComfort} />
                  <Text style={styles.liveDestText} numberOfLines={1}>
                    {liveIntent.route?.destinationName ?? 'Your destination'}
                  </Text>
                </View>
                <Text style={styles.liveStatus}>
                  {liveIntent.matchedTrip
                    ? `${liveIntent.matchedTrip.driverName ?? 'Driver'}${liveIntent.matchedTrip.vehicleLabel ? ` · ${liveIntent.matchedTrip.vehicleLabel}` : ''}`
                    : STATUS_LABEL[liveIntent.status]}
                </Text>
              </Pressable>
            </GradientGlowBorder>
          ) : null
        }
        ListEmptyComponent={
          !isLoading ? <Text style={styles.empty}>No scheduled rides yet.</Text> : null
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={{ flex: 1 }}>
              <View style={styles.destRow}>
                <Ionicons name="navigate-outline" size={13} color={colors.onSurfaceVariant} />
                <Text style={styles.route} numberOfLines={1}>
                  {item.route?.destinationName ?? 'Destination'}
                </Text>
              </View>
              <Text style={styles.meta}>
                {new Date(item.scheduledAt).toLocaleString('en-GH', {
                  weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
                {'  ·  '}{item.seatCount} seat{item.seatCount > 1 ? 's' : ''}
                {item.route?.distanceKm != null ? `  ·  ${item.route.distanceKm.toFixed(1)} km` : ''}
              </Text>
              {item.matchedTrip ? (
                <Text style={styles.meta}>
                  {item.matchedTrip.driverName ?? 'Driver'}
                  {item.matchedTrip.vehicleLabel ? ` · ${item.matchedTrip.vehicleLabel}` : ''}
                  {'  ·  '}{formatGhs(item.matchedTrip.farePerSeatPesewas)}/seat
                </Text>
              ) : null}
              <Text style={[styles.status, { color: item.status === 'MATCHED' ? colors.statusSuccess : colors.onSurfaceVariant }]}>
                {STATUS_LABEL[item.status] ?? item.status}
              </Text>
            </View>
            {(item.status === 'PENDING' || item.status === 'DISPATCHED') && (
              <Button
                label="Cancel"
                variant="ghost"
                onPress={() =>
                  Alert.alert(
                    'Cancel scheduled ride?',
                    'This cannot be undone.',
                    [
                      { text: 'Keep it', style: 'cancel' },
                      { text: 'Cancel ride', style: 'destructive', onPress: () => cancel.mutate(item.id) },
                    ]
                  )
                }
                disabled={cancel.isPending}
                style={{ paddingHorizontal: spacing.md }}
              />
            )}
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
  },
  title: { fontFamily: fonts.displayBold, fontSize: fontSizes.titleLarge, color: colors.onSurface },
  // paddingTop reserves room for the live card's glow bloom (a shadowRadius-36
  // iOS shadow). Without it the scroll container clipped the top of the halo
  // and the card read as cut off — same fix as the Activity tab's lists.
  list: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing['3xl'],
    gap: spacing.md,
  },
  empty: { textAlign: 'center', marginTop: spacing['3xl'], color: colors.onSurfaceVariant, fontFamily: fonts.regular },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surfaceContainer, borderRadius: radii.lg,
    padding: spacing.lg, borderWidth: 1, borderColor: colors.outlineVariant,
  },
  destRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  route: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyLarge, color: colors.onSurface },
  meta: { fontFamily: fonts.regular, fontSize: fontSizes.bodySmall, color: colors.onSurfaceVariant, marginBottom: 4 },
  status: { fontFamily: fonts.medium, fontSize: fontSizes.caption },
  liveCard: {
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  liveCardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  liveDotWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  liveLabel: { fontFamily: fonts.semiBold, fontSize: 10, letterSpacing: 0.8, color: colors.onSurfaceVariant },
  liveTime: { fontFamily: fonts.medium, fontSize: fontSizes.bodySmall, color: colors.onSurfaceVariant },
  liveDestRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  liveDestText: { flex: 1, fontFamily: fonts.semiBold, fontSize: fontSizes.bodyLarge, color: colors.onSurface },
  liveStatus: { fontFamily: fonts.medium, fontSize: fontSizes.bodySmall, color: colors.onSurfaceVariant },
});
