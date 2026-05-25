import React, { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import * as Location from 'expo-location';
import {
  View,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import MapboxGL from '../../utils/mapbox';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { tripsApi, notificationsApi, bookingsApi, queryKeys } from '@eyego/api';
import { useAuthStore } from '../../stores/auth.store';
import { fonts, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, RideCard, Skeleton } from '@eyego/ui';

const TIERS = ['All', 'Economy', 'Comfort', 'Premium'];

export default function HomeScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['42%', '72%'], []);
  const [activeTier, setActiveTier] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  const DEFAULT_COORDINATE: [number, number] = [-0.187, 5.6037];
  const [location, setLocation] = useState<[number, number]>(DEFAULT_COORDINATE);

  useEffect(() => {
    let subscription: Location.LocationSubscription | null = null;

    async function startTracking() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          console.log('Permission to access location was denied');
          return;
        }

        // Get initial location
        const initialLocation = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        setLocation([initialLocation.coords.longitude, initialLocation.coords.latitude]);

        // Watch for updates
        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 5000,
            distanceInterval: 10,
          },
          (newLocation) => {
            setLocation([newLocation.coords.longitude, newLocation.coords.latitude]);
          }
        );
      } catch (error) {
        console.error('Error tracking location:', error);
      }
    }

    startTracking();

    return () => {
      if (subscription) {
        subscription.remove();
      }
    };
  }, []);

  const [refreshing, setRefreshing] = useState(false);

  const { data: ridesData, isLoading: ridesLoading, refetch: refetchRides } = useQuery({
    queryKey: queryKeys.rides.list({ tier: activeTier }),
    queryFn: () => tripsApi.search({ tier: activeTier === 'All' ? undefined : activeTier.toUpperCase() } as any),
    refetchInterval: 15_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetchRides();
    setRefreshing(false);
  }, [refetchRides]);

  const { data: unreadData } = useQuery({
    queryKey: queryKeys.notifications.unreadCount(),
    queryFn: () => notificationsApi.getUnreadCount(),
    refetchInterval: 30_000,
  });

  // Fetch the user's active/confirmed bookings to detect already-booked trips
  const { data: upcomingBookingsData } = useQuery({
    queryKey: ['bookings', 'upcoming-trip-ids'],
    queryFn: () => bookingsApi.getHistory({ status: 'CONFIRMED,SEAT_HELD,BOARDED,PAID' }),
    staleTime: 30_000,
    refetchOnMount: true,
  });
  const bookedTripIds = useMemo(() => {
    const bookings = (upcomingBookingsData?.data?.data?.bookings ?? []) as any[];
    return new Set(bookings.map((b: any) => b.tripId).filter(Boolean));
  }, [upcomingBookingsData]);

  const rides = (ridesData?.data?.data?.trips ?? []) as any[];
  const unreadCount: number = (unreadData as any)?.data?.data?.count ?? 0;

  const filteredRides = useMemo(() => {
    if (!searchQuery.trim()) return rides;
    const query = searchQuery.toLowerCase();
    return rides.filter((ride: any) => 
      ride.destination?.address?.toLowerCase().includes(query) ||
      ride.route?.name?.toLowerCase().includes(query)
    );
  }, [rides, searchQuery]);

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const firstName = user?.name?.split(' ')[0] ?? 'there';

  return (
    <View style={styles.container}>
      {/* Map layer */}
      <MapboxGL.MapView
        style={[StyleSheet.absoluteFillObject, { backgroundColor: '#050508' }]}
        styleURL="mapbox://styles/mapbox/dark-v11"
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        rotateEnabled={false}
        scaleBarEnabled={false}
      >
        <MapboxGL.Camera
          centerCoordinate={location}
          zoomLevel={12}
          animationMode="none"
          animationDuration={0}
        />
        {/* User location with pulse */}
        <MapboxGL.MarkerView coordinate={location}>
          <PulseMarker />
        </MapboxGL.MarkerView>
      </MapboxGL.MapView>

      {/* Gradient overlay at top */}
      <View
        style={[styles.topGradient, { height: 140 + insets.top }]}
        pointerEvents="none"
      />

      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.md }]}>
        <MotiView
          from={{ opacity: 0, translateY: -6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        >
          <Text style={styles.logoText}>EyeGo</Text>
          <Text variant="bodySmall" color={colors.onSurfaceVariant}>
            {greeting()}, {firstName}
          </Text>
        </MotiView>

        <MotiView
          from={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 65 }}
        >
          <Pressable
            style={styles.bellButton}
            onPress={() => router.push('/(tabs)/notifications')}
          >
            <Ionicons name="notifications-outline" size={20} color={colors.onSurface} />
            {unreadCount > 0 && (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
              </View>
            )}
          </Pressable>
        </MotiView>
      </View>

      {/* Bottom Sheet */}
      <BottomSheet
        ref={bottomSheetRef}
        index={0}
        snapPoints={snapPoints}
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.sheetHandle}
        enablePanDownToClose={false}
      >
        <BottomSheetScrollView
          contentContainerStyle={styles.sheetContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        >
          {/* Search bar */}
          <MotiView
            from={{ opacity: 0, translateY: 6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 80 }}
          >
            <View style={styles.searchBar}>
              <View style={styles.searchLeft}>
                <View style={styles.greenDot} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Where are you going?"
                  placeholderTextColor={colors.onSurfaceVariant}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  returnKeyType="search"
                />
              </View>
              {searchQuery.length > 0 ? (
                <Pressable onPress={() => setSearchQuery('')} hitSlop={10}>
                  <Ionicons name="close-circle" size={24} color={colors.onSurfaceVariant} />
                </Pressable>
              ) : (
                <Ionicons name="search" size={24} color={colors.primary} />
              )}
            </View>
          </MotiView>

          {/* Tier filter chips */}
          <MotiView
            from={{ opacity: 0, translateY: 6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 110 }}
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tierRow}
              style={styles.tierScroll}
            >
              {TIERS.map((tier) => (
                <Pressable
                  key={tier}
                  style={[
                    styles.tierChip,
                    activeTier === tier && styles.tierChipActive,
                  ]}
                  onPress={() => setActiveTier(tier)}
                >
                  <Text
                    variant="label"
                    color={activeTier === tier ? colors.onPrimary : colors.onSurfaceVariant}
                  >
                    {tier}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </MotiView>

          {/* Available now header */}
          <MotiView
            from={{ opacity: 0, translateY: 6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 140 }}
            style={styles.sectionHeader}
          >
            <Text variant="titleSmall">Available Now</Text>
            <View style={styles.liveBadge}>
              <MotiView
                from={{ opacity: 0.5 }}
                animate={{ opacity: 1 }}
                transition={{ type: 'timing', duration: 500, loop: true }}
                style={styles.liveDot}
              />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          </MotiView>

          {/* Trip cards */}
          {ridesLoading ? (
            <>
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} height={110} borderRadius={radii.xl} style={{ marginBottom: spacing.md }} />
              ))}
            </>
          ) : filteredRides.length === 0 ? (
            <MotiView
              from={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={styles.emptyRides}
            >
              <Text style={{ fontSize: 32 }}>🚌</Text>
              <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ marginTop: spacing.sm, textAlign: 'center' }}>
                {searchQuery.trim() ? 'No rides found for this destination.' : 'No rides available right now. Check back soon.'}
              </Text>
            </MotiView>
          ) : (
            filteredRides.map((ride: any, i: number) => {
              const isBooked = bookedTripIds.has(ride.id);
              const mappedRide = {
                id: ride.id,
                tier: ride.tier === 'ECO' ? 'ECONOMY' : 'COMFORT',
                scheduledAt: ride.departureTime,
                // Always use the backend-calculated estimateFare value.
                farePerSeat: ride.fare ?? 0,
                confirmedSeats: ride.bookings?.length ?? 0,
                maxCapacity: ride.maxSeats ?? 12,
                pendingSeats: 0,
                route: {
                  name: ride.route?.name,
                  origin: ride.route?.originName,
                  destination: ride.route?.destinationName,
                },
                driver: {
                  name: ride.driver?.name,
                  avatarUrl: ride.driver?.profilePhoto,
                  rating: ride.driver?.rating ?? 4.8,
                },
              };
              return (
                <MotiView
                  key={ride.id}
                  from={{ opacity: 0, translateY: 20 }}
                  animate={{ opacity: 1, translateY: 0 }}
                  transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 160 + i * 40 }}
                  style={{ width: '100%', marginBottom: spacing.md }}
                >
                  <View style={{ position: 'relative', opacity: isBooked ? 0.55 : 1 }}>
                    <RideCard
                      ride={mappedRide as any}
                      onPress={() => {
                        if (isBooked) {
                          router.push(`/ride/${ride.id}/tracking` as any);
                        } else {
                          router.push(`/ride/${ride.id}?tier=${mappedRide.tier}` as any);
                        }
                      }}
                    />
                    {isBooked && (
                      <View style={styles.bookedOverlay} pointerEvents="none">
                        <View style={styles.bookedBadge}>
                          <Ionicons name="checkmark-circle" size={13} color="#050508" />
                          <Text style={styles.bookedBadgeText}>Already booked</Text>
                        </View>
                      </View>
                    )}
                  </View>
                </MotiView>
              );
            })
          )}
        </BottomSheetScrollView>
      </BottomSheet>
    </View>
  );
}

function PulseMarker() {
  return (
    <View style={pulseStyles.container}>
      <MotiView
        style={pulseStyles.ring}
        from={{ scale: 1, opacity: 0.7 }}
        animate={{ scale: 1.8, opacity: 0 }}
        transition={{ type: 'timing', duration: 1500, loop: true }}
      />
      <View style={pulseStyles.dot} />
    </View>
  );
}

const pulseStyles = StyleSheet.create({
  container: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  ring: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#4BE277',
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#4BE277',
    borderWidth: 2,
    borderColor: '#050508',
  },
});


const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundDeep },
  bookedOverlay: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    zIndex: 10,
  },
  bookedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  bookedBadgeText: {
    fontFamily: fonts.semiBold,
    fontSize: 10,
    color: '#050508',
    letterSpacing: 0.3,
  },
  topGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    background: 'transparent',
    backgroundImage: 'linear-gradient(to bottom, rgba(9,16,9,0.9), transparent)',
    zIndex: 1,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: spacing['2xl'],
    zIndex: 2,
  },
  logoText: {
    fontFamily: fonts.displayBold,
    fontSize: 20,
    color: colors.primary,
    letterSpacing: -0.5,
  },
  bellButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  notifBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifBadgeText: {
    fontSize: 9,
    fontFamily: fonts.semiBold,
    color: colors.onPrimary,
  },
  sheetBackground: {
    backgroundColor: 'rgba(9, 16, 9, 0.92)',
    borderTopLeftRadius: radii['3xl'],
    borderTopRightRadius: radii['3xl'],
  },
  sheetHandle: {
    backgroundColor: colors.outline,
    width: 40,
    height: 4,
  },
  sheetContent: {
    paddingHorizontal: spacing['2xl'],
    paddingBottom: spacing['3xl'],
    gap: spacing.md,
  },
  searchBar: {
    height: 56,
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.lg,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  searchLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.onSurface,
    paddingVertical: 0,
  },
  greenDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  tierScroll: { marginHorizontal: -spacing['2xl'] },
  tierRow: {
    paddingHorizontal: spacing['2xl'],
    gap: spacing.sm,
  },
  tierChip: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceContainer,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  tierChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(75, 226, 119, 0.12)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.full,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  liveText: {
    fontFamily: fonts.semiBold,
    fontSize: 10,
    color: colors.primary,
    letterSpacing: 1,
  },
  emptyRides: {
    alignItems: 'center',
    paddingVertical: spacing['3xl'],
    gap: spacing.sm,
  },
});
