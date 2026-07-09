import React, { useState, useMemo, useCallback } from 'react';
import { View, StyleSheet, Pressable, RefreshControl } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { driverApi } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, EmptyState, Entrance, AnimatedList, Skeleton } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../utils/useColors';
import { TripCard } from '../../components/TripCard';

type Segment = 'active' | 'upcoming' | 'history' | 'dispatch';

const SEGMENTS: { key: Segment; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'history', label: 'History' },
  { key: 'dispatch', label: 'Assigned' },
];

export default function TripsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
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

  const filteredTrips = useMemo(() => {
    const all: any[] = allTrips ?? [];
    if (segment === 'active') {
      // Prefer the dedicated activeTrip endpoint, but fall back to filtering the
      // allTrips list for any trip with active/in-progress status.
      if (activeTrip) return [activeTrip];
      return all.filter((t: any) =>
        ['SCHEDULED', 'FILLING', 'DRIVER_EN_ROUTE', 'IN_PROGRESS'].includes(t.status) &&
        new Date(t.departureTime) <= new Date(new Date().getTime() + 24 * 60 * 60 * 1000)
      );
    }
    if (segment === 'upcoming') {
      return all.filter((t: any) =>
        ['SCHEDULED', 'FILLING'].includes(t.status) &&
        new Date(t.departureTime) > new Date()
      );
    }
    if (segment === 'dispatch') {
      return all.filter((t: any) => t.status === 'ASSIGNED');
    }
    return all.filter((t: any) =>
      ['COMPLETED', 'CANCELLED'].includes(t.status)
    );
  }, [allTrips, activeTrip, segment]);

  const renderTripItem = useCallback(({ item }: { item: any }) => (
    <>
      <TripCard
        trip={item}
        onPress={() =>
          segment === 'dispatch'
            ? router.push({
                pathname: '/(trip)/dispatch/[id]',
                params: {
                  id: item.id,
                  origin: item.route?.originName ?? '',
                  destination: item.route?.destinationName ?? '',
                  departureTime: item.departureTime ?? '',
                },
              } as any)
            : segment === 'history'
            ? router.push(`/(trip)/detail/${item.id}` as any)
            : router.push(`/(trip)/active/${item.id}`)
        }
      />
      {segment === 'history' && item.status === 'COMPLETED' && (
        <Pressable
          style={styles.reportBtn}
          onPress={() => router.push(`/(trip)/report/${item.id}` as any)}
        >
          <Ionicons name="flag-outline" size={13} color={colors.onSurfaceVariant} />
          <Text variant="caption" color={colors.onSurfaceVariant}>Report passenger</Text>
        </Pressable>
      )}
    </>
  ), [segment, router, styles, colors]);

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <Entrance animation="slideUp" delay={50} style={styles.header}>
        <Text variant="headlineMedium" style={styles.title}>My Trips</Text>
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
      {isError ? (
        <View style={styles.emptyWrapper}>
          <Text variant="bodyMedium" color={colors.error} style={{ marginBottom: 12 }}>Failed to load trips.</Text>
          <Pressable onPress={() => refetch()} style={{ paddingHorizontal: 20, paddingVertical: 10, backgroundColor: colors.primary, borderRadius: 8 }}>
            <Text style={{ color: colors.onPrimary, fontFamily: fonts.semiBold }}>Retry</Text>
          </Pressable>
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
            icon={segment === 'dispatch' ? 'send-outline' : 'time-outline'}
            title={
              segment === 'active' ? 'No active trip' :
              segment === 'dispatch' ? 'No assigned trips' :
              'No trips yet'
            }
            subtitle={
              segment === 'active' ? 'Create a trip from the home screen to get started.' :
              segment === 'dispatch' ? 'Trips assigned by admin will appear here.' :
              'Completed trips will appear here.'
            }
          />
        </Entrance>
      ) : (
        <AnimatedList
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
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => { scale.value = withSpring(0.92, { stiffness: 700, damping: 15 }); }}
      onPressOut={() => { scale.value = withSpring(1, { stiffness: 700, damping: 15 }); }}
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
    safe: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing.xl,
      paddingBottom: spacing.md,
    },
    title: {
      fontFamily: fonts.displayBold,
      letterSpacing: -0.5,
    },
    segmentWrapper: {
      paddingHorizontal: spacing['2xl'],
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
      paddingHorizontal: spacing['2xl'],
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
      paddingHorizontal: spacing['2xl'],
      paddingVertical: spacing.sm,
      marginTop: -spacing.sm,
      marginBottom: spacing.xs,
    },
    listContent: {
      paddingHorizontal: spacing['2xl'],
      paddingBottom: 120,
    },
  });
