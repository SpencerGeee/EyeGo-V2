import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MotiView } from '@eyego/ui';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { bookingsApi } from '@eyego/api';
import { useAuthStore } from '../../stores/auth.store';
import { spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, Button, Skeleton } from '@eyego/ui';
import { formatGhs, formatTripDate } from '@eyego/utils';

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

  // The wait before a group ride loads is not a mystery — the screen already
  // knows its own shape. So it draws that shape instead of a green spinner over
  // an empty screen: the card, the two route lines and the fare row settle into
  // place as the data arrives, rather than the layout snapping in from nothing.
  // ("the green loader thing. its not nice.")
  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.skeletonWrap}>
          <Skeleton width={140} height={22} borderRadius={11} />
          <View style={styles.skeletonCard}>
            <Skeleton width={56} height={56} borderRadius={28} />
            <View style={styles.skeletonLines}>
              <Skeleton width="70%" height={14} />
              <Skeleton width="45%" height={12} />
            </View>
          </View>
          <View style={styles.skeletonCard}>
            <View style={styles.skeletonLines}>
              <Skeleton width="85%" height={14} />
              <Skeleton width="60%" height={14} />
              <Skeleton width="35%" height={12} />
            </View>
          </View>
          <Skeleton width="100%" height={52} borderRadius={radii.lg} />
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
          transition={{ type: 'spring', stiffness: 300, damping: 35 }}
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
          transition={{ type: 'spring', stiffness: 300, damping: 35, delay: 150 }}
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
            <TripMetaItem icon="cash-outline" label={formatGhs((trip as any).baseFarePesewas ?? (trip as any).fare ?? 0)} accent />
          </View>
        </MotiView>

        {/* CTA */}
        <MotiView
          from={{ opacity: 0, translateY: 20 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 35, delay: 250 }}
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
  safe: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing['3xl'] },
  content: { flex: 1, paddingHorizontal: spacing['2xl'], paddingTop: spacing['3xl'], gap: spacing.xl },
  // Deliberately mirrors `content` below — the placeholder has to occupy the
  // same grid the real screen will, or the "load" is still a layout jump.
  skeletonWrap: {
    flex: 1,
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing['3xl'],
    gap: spacing.xl,
  },
  skeletonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
    padding: spacing.lg,
    borderRadius: radii.xl,
    backgroundColor: colors.surfaceVariant,
  },
  skeletonLines: { flex: 1, gap: spacing.sm },
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
