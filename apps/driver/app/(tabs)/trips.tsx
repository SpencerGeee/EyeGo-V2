import React, { useState, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { useQuery } from '@tanstack/react-query';
import { driverApi } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, EmptyState } from '@eyego/ui';
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

  const { data: allTrips, isLoading } = useQuery({
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
      return activeTrip ? [activeTrip] : [];
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

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <MotiView
        from={{ opacity: 0, translateY: -8 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 50 }}
        style={styles.header}
      >
        <Text variant="headlineMedium" style={styles.title}>My Trips</Text>
      </MotiView>

      {/* Segmented control */}
      <MotiView
        from={{ opacity: 0, translateY: 8 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 100 }}
        style={styles.segmentWrapper}
      >
        <View style={styles.segmentContainer}>
          {SEGMENTS.map((s) => (
            <TouchableOpacity
              key={s.key}
              style={[styles.segmentBtn, segment === s.key && styles.segmentActive]}
              onPress={() => setSegment(s.key)}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.segmentText,
                  { color: segment === s.key ? colors.onPrimary : colors.onSurfaceVariant },
                ]}
              >
                {s.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </MotiView>

      {/* List */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          {[0, 1, 2].map((i) => (
            <MotiView
              key={i}
              from={{ opacity: 0.3 }}
              animate={{ opacity: 0.7 }}
              transition={{ type: 'timing', duration: 800, loop: true, delay: i * 150 }}
              style={styles.skeleton}
            />
          ))}
        </View>
      ) : filteredTrips.length === 0 ? (
        <MotiView
          from={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25, delay: 150 }}
          style={styles.emptyWrapper}
        >
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
        </MotiView>
      ) : (
        <FlashList
          data={filteredTrips}
          keyExtractor={(item: any) => item.id}
          estimatedItemSize={100}
          contentContainerStyle={styles.listContent}
          renderItem={({ item, index }: { item: any; index: number }) => (
            <MotiView
              from={{ opacity: 0, translateY: 16 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30, delay: index * 60 }}
            >
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
                <TouchableOpacity
                  style={styles.reportBtn}
                  onPress={() => router.push(`/(trip)/report/${item.id}` as any)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="flag-outline" size={13} color={colors.onSurfaceVariant} />
                  <Text variant="caption" color={colors.onSurfaceVariant}>Report passenger</Text>
                </TouchableOpacity>
              )}
            </MotiView>
          )}
        />
      )}
    </SafeAreaView>
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
