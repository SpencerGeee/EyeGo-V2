import React, { useState, useMemo, useCallback } from 'react';
import { View, StyleSheet, Pressable, RefreshControl, Alert } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { driverApi } from '@eyego/api';
import { describeError } from '@eyego/utils';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button, EmptyState, Entrance, AnimatedList, Skeleton, LargeTitle, usePressScale, goDeeper, notify } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useDriverStore } from '../../stores/driver.store';
import { TripCard } from '../../components/TripCard';

// "Assigned" is gone: it filtered on status 'ASSIGNED', which no trip ever has
// (the state machine says DRIVER_ASSIGNED, and that trip is the active one),
// so the tab could only ever say "No assigned trips".
type Segment = 'active' | 'upcoming' | 'history';

const SEGMENTS: { key: Segment; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'history', label: 'History' },
];

/** Under way or boarding — what "Active" means. SCHEDULED is "Upcoming". */
const ACTIVE_STATUSES = ['FILLING', 'CONFIRMED', 'DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'IN_PROGRESS'];
/** Every way a trip ends. History listed only two, so expired trips vanished. */
const ENDED_STATUSES = ['COMPLETED', 'CANCELLED', 'EXPIRED', 'NO_SHOW', 'NO_DRIVERS_FOUND'];
const departMs = (t: any) => new Date(t?.departureTime ?? 0).getTime() || 0;

export default function TripsScreen() {
  const colors = useColors();
  const setActiveTripId = useDriverStore(s => s.setActiveTripId);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const qc = useQueryClient();
  const [segment, setSegment] = useState<Segment>('active');

  const { data: allTrips, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['driver', 'trips', 'all'],
    queryFn: () => driverApi.getAllTrips(),
    select: (r) => (r.data as any)?.data?.trips ?? [],
  });

  const { data: activeTrip } = useQuery({
    queryKey: ['driver', 'activeTrip'],
    queryFn: () => driverApi.getActiveTrip(),
    select: (r) => (r.data as any)?.data?.trip ?? null,
  });

  // Quick-cancel from the list — reuses the same driverApi.cancelTrip call
  // and query invalidations as the dedicated cancel/[id].tsx screen, just
  // gated behind a lightweight confirm instead of the full reason-picker
  // flow, so drivers don't have to leave the My Trips page.
  const cancelMutation = useMutation({
    mutationFn: (tripId: string) => driverApi.cancelTrip(tripId, 'Cancelled from trips list'),
    onSuccess: () => {
      setActiveTripId(null);
      qc.invalidateQueries({ queryKey: ['driver', 'trips', 'all'] });
      qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
    },
    onError: (err: unknown) => notify('Could not cancel that trip', describeError(err, 'Failed to cancel trip.').message),
  });

  const confirmCancel = useCallback((tripId: string) => {
    Alert.alert(
      'Cancel Trip',
      'Cancelling will affect your cancellation rate in performance stats, and passengers who already paid will be refunded. Continue?',
      [
        { text: 'Keep Trip', style: 'cancel' },
        { text: 'Cancel Trip', style: 'destructive', onPress: () => cancelMutation.mutate(tripId) },
      ],
    );
  }, [cancelMutation]);

  const filteredTrips = useMemo(() => {
    const all: any[] = allTrips ?? [];
    if (segment === 'active') {
      const live = all.filter((t: any) => ACTIVE_STATUSES.includes(t.status));
      // The server's active trip first (it may be a SCHEDULED one about to
      // start), then anything else under way.
      if (activeTrip && !live.some((t) => t.id === activeTrip.id)) live.unshift(activeTrip);
      return live;
    }
    if (segment === 'upcoming') {
      return all
        .filter((t: any) => t.status === 'SCHEDULED' && t.id !== activeTrip?.id)
        .sort((a, b) => departMs(a) - departMs(b));
    }
    // Newest first — the list arrives oldest first, which buried today's trip
    // under every trip ever driven.
    return all.filter((t: any) => ENDED_STATUSES.includes(t.status)).sort((a, b) => departMs(b) - departMs(a));
  }, [allTrips, activeTrip, segment]);

  const renderTripItem = useCallback(({ item }: { item: any }) => (
    <>
      <TripCard
        trip={item}
        onPress={() =>
          segment === 'history'
            ? goDeeper(`/(trip)/detail/${item.id}` as any)
            : goDeeper(`/(trip)/active/${item.id}`)
        }
      />
      {segment === 'history' && item.status === 'COMPLETED' && (
        <Pressable
          style={styles.reportBtn}
          onPress={() => goDeeper(`/(trip)/report/${item.id}` as any)}
         accessibilityRole="button">
          <Ionicons name="flag-outline" size={13} color={colors.onSurfaceVariant} />
          <Text variant="caption" color={colors.onSurfaceVariant}>Report passenger</Text>
        </Pressable>
      )}
      {/* Quick-cancel — any trip that hasn't already ended. */}
      {segment !== 'history' && !ENDED_STATUSES.includes(item.status) && (
        <Pressable
          style={styles.reportBtn}
          onPress={() => confirmCancel(item.id)}
          disabled={cancelMutation.isPending}
          accessibilityRole="button"
          accessibilityLabel="Cancel this trip"
        >
          <Ionicons name="close-circle-outline" size={13} color={colors.error} />
          <Text variant="caption" color={colors.error}>Cancel trip</Text>
        </Pressable>
      )}
    </>
  ), [segment, styles, colors, confirmCancel, cancelMutation.isPending]);

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <Entrance animation="slideUp" delay={50} style={styles.header}>
        <LargeTitle title="Trips" />
      </Entrance>

      {/* Segmented control */}
      <Entrance animation="slideDown" delay={100} style={styles.segmentWrapper}>
        <View style={styles.segmentContainer}>
          {SEGMENTS.map((s) => (
            <AnimatedSegBtn
              key={s.key}
              label={s.label}
              isActive={segment === s.key}
              onPress={() => setSegment(s.key)}
              colors={colors}
              styles={styles}
            />
          ))}
        </View>
      </Entrance>

      {/* D10: error state with retry */}
      {isError && !allTrips ? (
        <View style={styles.emptyWrapper}>
          <Ionicons name="cloud-offline-outline" size={28} color={colors.onSurfaceVariant} />
          <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ marginTop: 10, marginBottom: 16 }}>
            Couldn’t load your trips.
          </Text>
          <Button label="Try again" variant="secondary" size="md" onPress={() => void refetch()} />
        </View>
      ) : isLoading ? (
        <View style={styles.loadingContainer}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={100} borderRadius={radii.xl} />
          ))}
        </View>
      ) : filteredTrips.length === 0 ? (
        <Entrance animation="scaleIn" delay={150} style={styles.emptyWrapper}>
          <EmptyState
            icon={segment === 'history' ? 'receipt-outline' : 'time-outline'}
            title={
              segment === 'active' ? 'No active trip' :
              segment === 'upcoming' ? 'Nothing scheduled' :
              'No trips yet'
            }
            subtitle={
              segment === 'active' ? 'Go online for ride requests, or publish a trip from Home.' :
              segment === 'upcoming' ? 'Trips you publish for later will show here.' :
              'Finished trips will appear here.'
            }
          />
        </Entrance>
      ) : (
        <AnimatedList
          style={{ flex: 1 }}
          data={filteredTrips}
          keyExtractor={(item: any) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
          }
          renderItem={renderTripItem}
        />
      )}
    </SafeAreaView>
  );
}

function AnimatedSegBtn({
  label,
  isActive,
  onPress,
  colors,
  styles,
}: {
  label: string;
  isActive: boolean;
  onPress: () => void;
  colors: DriverColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const press = usePressScale();
  const animStyle = press.style;
  return (
    <Pressable
      onPress={onPress}
      {...press.handlers}
      style={styles.segmentBtn}
      accessibilityRole="button"
      accessibilityState={{ selected: isActive }}
    >
      <Animated.View style={[isActive && styles.segmentActive, animStyle, { borderRadius: radii.lg, paddingVertical: spacing.sm, paddingHorizontal: 4, alignItems: 'center', width: '100%' }]}>
        <Text
          style={[
            styles.segmentText,
            { color: isActive ? colors.onPrimary : colors.onSurfaceVariant },
          ]}
        >
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    // LargeTitle carries the kit's 20pt gutter; everything below matches it.
    header: {
      paddingTop: spacing.xl,
      paddingBottom: spacing.xs,
    },
    title: {
      fontFamily: fonts.displayBold,
      letterSpacing: -0.5,
    },
    segmentWrapper: {
      paddingHorizontal: 20,
      marginBottom: spacing.lg,
    },
    segmentContainer: {
      flexDirection: 'row',
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outline,
      padding: 4,
    },
    segmentBtn: {
      flex: 1,
      paddingVertical: spacing.sm,
      borderRadius: radii.lg,
      alignItems: 'center',
    },
    segmentActive: {
      backgroundColor: colors.primary,
    },
    segmentText: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.3),
    },
    loadingContainer: {
      paddingHorizontal: 20,
      gap: spacing.md,
    },
    skeleton: {
      height: 100,
      borderRadius: radii.xl,
      backgroundColor: colors.surfaceContainerHigh,
    },
    emptyWrapper: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    reportBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.xs,
      paddingVertical: spacing.sm,
      marginTop: -spacing.sm,
      marginBottom: spacing.xs,
    },
    listContent: {
      paddingHorizontal: 20,
      paddingBottom: 120,
    },
  });
