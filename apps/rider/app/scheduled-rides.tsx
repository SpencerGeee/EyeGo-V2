import React, { useMemo } from 'react';
import { View, StyleSheet, FlatList, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { tripsApi } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button } from '@eyego/ui';
import { useColors, Colors } from '../utils/useColors';

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Waiting for a match',
  DISPATCHED: 'Looking for a nearby driver',
  MATCHED: 'Confirmed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

export default function ScheduledRidesScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['trips', 'scheduled'],
    queryFn: () => tripsApi.getScheduledRides(),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => tripsApi.cancelScheduledRide(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trips', 'scheduled'] });
    },
    onError: () => Alert.alert('Error', 'Could not cancel this scheduled ride. Please try again.'),
  });

  const intents = data?.data?.data?.intents ?? [];

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
        ListEmptyComponent={
          !isLoading ? <Text style={styles.empty}>No scheduled rides yet.</Text> : null
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={{ flex: 1 }}>
              <Text style={styles.route}>
                {item.route?.originName} → {item.route?.destinationName}
              </Text>
              <Text style={styles.meta}>
                {new Date(item.scheduledAt).toLocaleString('en-GH', {
                  weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
                {'  ·  '}{item.seatCount} seat{item.seatCount > 1 ? 's' : ''}
              </Text>
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
  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing['3xl'], gap: spacing.md },
  empty: { textAlign: 'center', marginTop: spacing['3xl'], color: colors.onSurfaceVariant, fontFamily: fonts.regular },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surfaceContainer, borderRadius: radii.lg,
    padding: spacing.lg, borderWidth: 1, borderColor: colors.outlineVariant,
  },
  route: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyLarge, color: colors.onSurface, marginBottom: 4 },
  meta: { fontFamily: fonts.regular, fontSize: fontSizes.bodySmall, color: colors.onSurfaceVariant, marginBottom: 4 },
  status: { fontFamily: fonts.medium, fontSize: fontSizes.caption },
});
