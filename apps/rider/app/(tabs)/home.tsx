import React, { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import * as Location from 'expo-location';
import {
  AppState,
  View,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  RefreshControl,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import MapboxGL from '../../utils/mapbox';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { MotiView } from 'moti';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { tripsApi, notificationsApi, bookingsApi, queryKeys } from '@eyego/api';
import NetInfo from '@react-native-community/netinfo';
import { useAuthStore } from '../../stores/auth.store';
import { fonts, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, RideCard, Skeleton } from '@eyego/ui';
import eyegoDarkStyle from '@eyego/map-styles';

// Shared premium MapLibre style (OpenFreeMap tiles, no token). MapLibre RN
// expects a JSON *string* via styleJSON — passing a `mapbox://` URL needs a
// Mapbox token and crashes the native map. Stringify once at module scope.
const EYEGO_MAP_STYLE = JSON.stringify(eyegoDarkStyle);

const TIERS = ['All', 'Economy', 'Comfort', 'Premium'];

export default function HomeScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, isLoggedIn } = useAuthStore();
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['28%', '52%', '82%'], []);
  const [activeTier, setActiveTier] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      setIsOnline(state.isConnected ?? true);
    });
    return () => unsub();
  }, []);

  const DEFAULT_COORDINATE: [number, number] = [-0.187, 5.6037];
  const [location, setLocation] = useState<[number, number]>(DEFAULT_COORDINATE);

  useEffect(() => {
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;

    async function startTracking() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (status !== 'granted') {
          if (__DEV__) { console.log('Permission to access location was denied'); }
          Alert.alert(
            'Location Required',
            'EyeGo needs your location to show nearby rides. Please enable location access in Settings.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
            ]
          );
          return;
        }

        const initialLocation = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        if (cancelled) return;
        setLocation([initialLocation.coords.longitude, initialLocation.coords.latitude]);

        const sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 5000,
            distanceInterval: 10,
          },
          (newLocation) => {
            if (cancelled) return;
            setLocation([newLocation.coords.longitude, newLocation.coords.latitude]);
          }
        );
        if (cancelled) {
          sub.remove();
        } else {
          subscription = sub;
        }
      } catch (error) {
        console.error('Error tracking location:', error);
      }
    }

    startTracking();

    return () => {
      cancelled = true;
      if (subscription) subscription.remove();
    };
  }, []);

  const [refreshing, setRefreshing] = useState(false);
  const queryClient = useQueryClient();

  const { data: ridesData, isLoading: ridesLoading, isError: ridesError, error: ridesErrorObj, refetch: refetchRides } = useQuery({
    queryKey: queryKeys.rides.list({ tier: activeTier }),
    queryFn: () => tripsApi.search({ tier: activeTier === 'All' ? undefined : activeTier.toUpperCase() as 'ECONOMY' | 'COMFORT' | 'PREMIUM' } as any),
    refetchInterval: 15_000,
    staleTime: 10_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ['rides'] });
      await refetchRides();
    } finally {
      setRefreshing(false);
    }
  }, [queryClient, refetchRides]);

  const { data: unreadData } = useQuery({
    queryKey: queryKeys.notifications.unreadCount(),
    queryFn: () => notificationsApi.getUnreadCount(),
    refetchInterval: 30_000,
    staleTime: 20_000,
    enabled: isLoggedIn,
  });

  const { data: upcomingBookingsData } = useQuery({
    queryKey: ['bookings', 'upcoming-trip-ids'],
    queryFn: () => bookingsApi.getHistory({ status: 'CONFIRMED,SEAT_HELD,BOARDED,PAID' }),
    staleTime: 30_000,
    refetchOnMount: true,
  });
  const bookedTripIds = useMemo(() => {
    const bookings = (upcomingBookingsData?.data?.data as any)?.bookings ?? [];
    return new Set(bookings.map((b: any) => b.tripId).filter(Boolean));
  }, [upcomingBookingsData]);

  const rides = ((ridesData?.data?.data as any)?.trips ?? []) as Array<Record<string, unknown>>;
  const unreadCount: number = unreadData?.data?.data?.count ?? 0;

  const filteredRides = useMemo(() => {
    if (!searchQuery.trim()) return rides;
    const query = searchQuery.toLowerCase();
    return rides.filter((ride: any) => 
      ride.route?.destinationName?.toLowerCase().includes(query) ||
      ride.route?.originName?.toLowerCase().includes(query) ||
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
      {/* Offline banner — slides down from top */}
      {!isOnline && (
        <MotiView
          from={{ translateY: -50, opacity: 0 }}
          animate={{ translateY: 0, opacity: 1 }}
          exit={{ translateY: -50, opacity: 0 }}
          transition={{ type: 'timing' as const, duration: 300 }}
          style={[styles.offlineBanner, { paddingTop: 8 + (insets.top > 0 ? insets.top : 0) }]}
        >
          <Ionicons name="cloud-offline-outline" size={14} color="#000" />
          <Text style={{ fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 12, color: '#000' }}>
            No internet connection
          </Text>
        </MotiView>
      )}

      {/* Map layer */}
      <MapboxGL.MapView
        style={[StyleSheet.absoluteFillObject, { backgroundColor: '#050508' }]}
        styleJSON={EYEGO_MAP_STYLE}
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
        <MapboxGL.MarkerView coordinate={location}>
          <PulseMarker />
        </MapboxGL.MarkerView>
      </MapboxGL.MapView>

      {/* Compact glass header — mirrored from driver app */}
      <MotiView
        from={{ opacity: 0, translateY: -10 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 100 }}
        style={[styles.glassHeader, { top: insets.top + spacing.md }]}
      >
        {Platform.OS === 'ios' && (
          <BlurView intensity={70} tint="systemChromeMaterialDark" style={StyleSheet.absoluteFill} />
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 }}>
          <View style={styles.headerLogoContainer}>
            <Text style={styles.headerLogo}>EyeGo</Text>
            <Text variant="caption" color={colors.onSurfaceVariant} numberOfLines={1}>
              {greeting()}, {firstName}
            </Text>
          </View>
        </View>
        <Pressable
          style={styles.bellButton}
          onPress={() => router.push('/(tabs)/notifications')}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
        >
          <Ionicons name="notifications-outline" size={18} color={colors.onSurface} />
          {unreadCount > 0 && (
            <View style={styles.notifBadge}>
              <Text style={styles.notifBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
            </View>
          )}
        </Pressable>
      </MotiView>

      {/* Bottom Sheet */}
      <BottomSheet
        ref={bottomSheetRef}
        index={0}
        snapPoints={snapPoints}
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.sheetHandle}
        enablePanDownToClose={false}
        enableContentPanningGesture={true}
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
          {/* Search bar — glassmorphism */}
          <MotiView
            from={{ opacity: 0, translateY: 6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 80 }}
          >
            <BlurView intensity={50} tint="dark" style={styles.searchBar}>
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
                <Pressable onPress={() => setSearchQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
                  <Ionicons name="close-circle" size={22} color={colors.onSurfaceVariant} />
                </Pressable>
              ) : (
                <Ionicons name="search" size={22} color={colors.primary} />
              )}
            </BlurView>
          </MotiView>

          {/* Quick-action pills */}
          <MotiView
            from={{ opacity: 0, translateY: 6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 100 }}
            style={styles.quickActionsRow}
          >
            {([
              { label: 'Saved', icon: 'bookmark-outline', route: '/profile/saved-places' },
              { label: 'Promos', icon: 'gift-outline', route: '/profile/promotions' },
              { label: 'Wallet', icon: 'wallet-outline', route: '/profile/wallet' },
            ] as const).map((action) => (
              <Pressable
                key={action.label}
                onPress={() => router.push(action.route as Href)}
                style={styles.quickActionPill}
                accessibilityRole="button"
              >
                <BlurView intensity={40} tint="dark" style={styles.quickActionBlur}>
                  <Ionicons name={action.icon} size={15} color={colors.primary} />
                  <Text style={[styles.quickActionLabel, { color: colors.onSurface }]}>
                    {action.label}
                  </Text>
                </BlurView>
              </Pressable>
            ))}
          </MotiView>

          {/* Tier filter chips */}
          <MotiView
            from={{ opacity: 0, translateY: 6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 120 }}
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tierRow}
            >
              {TIERS.map((tier) => (
                <AnimatedTierChip
                  key={tier}
                  tier={tier}
                  isActive={activeTier === tier}
                  onPress={() => setActiveTier(tier)}
                  colors={colors}
                />
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
          ) : ridesError ? (
            <MotiView
              from={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={styles.emptyRides}
            >
              <Ionicons name="cloud-offline-outline" size={32} color={colors.onSurfaceVariant} />
              <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ marginTop: spacing.sm, textAlign: 'center' }}>
                Failed to load rides. Please try again.
              </Text>
              <Pressable
                onPress={() => refetchRides()}
                style={{ marginTop: spacing.md, backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radii.full }}
              >
                <Text variant="label" color={colors.onPrimary}>Retry</Text>
              </Pressable>
            </MotiView>
          ) : filteredRides.length === 0 ? (
            <MotiView
              from={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={styles.emptyRides}
            >
              <Ionicons name="bus-outline" size={32} color={colors.onSurfaceVariant} />
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
                farePerSeat: ride.farePerSeat ?? 0,
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
                          router.push(`/ride/${ride.id}/tracking` as Href);
                        } else {
                          router.push(`/ride/${ride.id}?tier=${mappedRide.tier}` as Href);
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

function AnimatedTierChip({
  tier,
  isActive,
  onPress,
  colors,
}: {
  tier: string;
  isActive: boolean;
  onPress: () => void;
  colors: Colors;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => { scale.value = withSpring(0.92, { stiffness: 700, damping: 15 }); }}
      onPressOut={() => { scale.value = withSpring(1, { stiffness: 700, damping: 15 }); }}
      accessibilityRole="button"
      accessibilityState={{ selected: isActive }}
      accessibilityLabel={`${tier} tier${isActive ? ', selected' : ''}`}
    >
      <Animated.View style={[
        {
          paddingHorizontal: spacing.base,
          paddingVertical: spacing.xs + 2,
          borderRadius: radii.full,
          backgroundColor: isActive ? colors.primary : colors.surfaceContainer,
          borderWidth: 1,
          borderColor: isActive ? colors.primary : colors.outlineVariant,
        },
        animStyle,
      ]}>
        <Text variant="label" color={isActive ? colors.onPrimary : colors.onSurfaceVariant}>
          {tier}
        </Text>
      </Animated.View>
    </Pressable>
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
  offlineBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#F59E0B',
    paddingVertical: 8,
  },
  // ── Compact glass header (mirrors driver app) ──
  glassHeader: {
    position: 'absolute',
    left: spacing['2xl'],
    right: spacing['2xl'],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Platform.OS === 'ios' ? 'transparent' : 'rgba(9, 16, 9, 0.90)',
    borderRadius: radii['2xl'],
    borderWidth: 1,
    borderColor: colors.outline,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    overflow: 'hidden',
    zIndex: 10,
  },
  headerLogoContainer: {
    flexDirection: 'column',
  },
  headerLogo: {
    fontFamily: fonts.displayBold,
    fontSize: 18,
    color: colors.primary,
    letterSpacing: -0.5,
  },
  bellButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  notifBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
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
  // ── Bottom sheet ──
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
    paddingBottom: 100,
    gap: spacing.md,
  },
  searchBar: {
    height: 52,
    borderRadius: radii.xl,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
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
  quickActionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  quickActionPill: {
    flex: 1,
    borderRadius: radii.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.primary + '30',
  },
  quickActionBlur: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm + 2,
  },
  quickActionLabel: {
    fontFamily: fonts.medium,
    fontSize: 12,
  },
  tierRow: {
    paddingHorizontal: spacing['2xl'],
    gap: spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
