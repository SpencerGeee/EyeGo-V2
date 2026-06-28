import React, { useMemo } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { bookingsApi } from '@eyego/api';
import { useAuthStore } from '../../stores/auth.store';
import { spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, Button } from '@eyego/ui';
import { formatCurrency, formatTripDate } from '@eyego/utils';

export default function JoinScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const { isLoggedIn } = useAuthStore();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['join', token],
    queryFn: () => bookingsApi.joinGroup(token ?? ''),
    enabled: !!token && isLoggedIn,
  });

  const trip = data?.data?.data?.trip;

  if (!isLoggedIn) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Ionicons name="people-outline" size={48} color={colors.primary} />
          <Text variant="titleLarge" style={{ marginTop: spacing.xl, textAlign: 'center' }}>
            Join This Ride
          </Text>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ marginTop: spacing.sm, textAlign: 'center' }}>
            Sign in to book your seat on this group ride.
          </Text>
          <Button
            label="Sign In"
            onPress={() => router.push('/(auth)/phone')}
            style={{ marginTop: spacing['2xl'], width: 220 }}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ marginTop: spacing.base }}>
            Loading ride details...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isError || !trip) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Ionicons name="warning-outline" size={48} color={colors.error} />
          <Text variant="titleMedium" style={{ marginTop: spacing.xl }}>Invalid Link</Text>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ marginTop: spacing.sm, textAlign: 'center' }}>
            This invite link has expired or is no longer valid.
          </Text>
          <Button
            label="Back to Home"
            variant="secondary"
            onPress={() => router.replace('/(tabs)/home')}
            style={{ marginTop: spacing['2xl'], width: 220 }}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <MotiView
          from={{ opacity: 0, translateY: 20 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          style={styles.inviteHeader}
        >
          <View style={styles.inviteIcon}>
            <Ionicons name="people" size={32} color={colors.primary} />
          </View>
          <Text variant="headlineMedium" style={{ marginTop: spacing.base, textAlign: 'center' }}>
            You're invited!
          </Text>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ textAlign: 'center', marginTop: spacing.sm }}>
            Join this shared ride
          </Text>
        </MotiView>

        {/* Trip preview card */}
        <MotiView
          from={{ opacity: 0, translateY: 20 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 150 }}
          style={styles.tripCard}
        >
          <View style={styles.routeRow}>
            <View style={styles.originDot} />
            <Text variant="titleSmall" style={{ flex: 1 }}>
              {(trip as any).route?.originName ?? (trip as any).origin?.address?.split(',')[0] ?? 'Origin'}
            </Text>
          </View>
          <View style={styles.routeConnector} />
          <View style={styles.routeRow}>
            <View style={styles.destDot} />
            <Text variant="titleSmall" style={{ flex: 1 }}>
              {(trip as any).route?.destinationName ?? (trip as any).destination?.address?.split(',')[0] ?? 'Destination'}
            </Text>
          </View>

          <View style={styles.tripMeta}>
            <TripMetaItem icon="time-outline" label={formatTripDate(trip.departureTime)} />
            <TripMetaItem
              icon="person-outline"
              label={`${Math.max(0, ((trip as any).maxSeats ?? 0) - ((trip as any).confirmedSeats ?? 0))} seats left`}
            />
            <TripMetaItem icon="cash-outline" label={formatCurrency((trip as any).baseFare ?? (trip as any).fare ?? 0)} accent />
          </View>
        </MotiView>

        {/* CTA */}
        <MotiView
          from={{ opacity: 0, translateY: 20 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 250 }}
          style={styles.ctaSection}
        >
          <Button
            label="Book My Seat"
            onPress={() => router.push(`/ride/${(trip as any).id}/seat` as any)}
          />
          <Button
            label="Not now"
            variant="ghost"
            onPress={() => router.replace('/(tabs)/home')}
          />
        </MotiView>
      </View>
    </SafeAreaView>
  );
}

function TripMetaItem({ icon, label, accent }: { icon: any; label: string; accent?: boolean }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.metaItem}>
      <Ionicons name={icon} size={14} color={accent ? colors.primary : colors.onSurfaceVariant} />
      <Text variant="bodySmall" color={accent ? colors.primary : colors.onSurfaceVariant}>
        {label}
      </Text>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.backgroundDeep },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing['3xl'] },
  content: { flex: 1, paddingHorizontal: spacing['2xl'], paddingTop: spacing['3xl'], gap: spacing.xl },
  inviteHeader: { alignItems: 'center' },
  inviteIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary + '1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tripCard: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii['2xl'],
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    gap: spacing.sm,
  },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  routeConnector: { height: 16, width: 1, backgroundColor: colors.outline, marginLeft: 5 },
  originDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary },
  destDot: { width: 12, height: 12, borderRadius: 3, backgroundColor: colors.secondary },
  tripMeta: {
    marginTop: spacing.base,
    paddingTop: spacing.base,
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
    gap: spacing.sm,
  },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ctaSection: { gap: spacing.md },
});
