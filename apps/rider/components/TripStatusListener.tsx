'use client';
import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Animated, View, StyleSheet, Platform, Pressable } from 'react-native';
import { useRouter, useSegments, type Href } from 'expo-router';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { BlurView } from 'expo-blur';
import { socketEvents, connectSocket, disconnectSocket, bookingsApi, queryKeys } from '@eyego/api';
import { useRideStore } from '../stores/ride.store';
import { useAuthStore } from '../stores/auth.store';
import { useColors } from '../utils/useColors';
import { Text } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radii, fonts, fontSizes } from '@eyego/config';

// Hermes-safe property accessor — wraps reads in try-catch because Hermes
// throws ReferenceError for properties that don't exist on Zustand-persisted
// objects deserialized from AsyncStorage. See: Property 'tripId' doesn't exist.
function safeRead(obj: unknown, key: string, fallback?: string): string | undefined {
  try {
    if (obj && typeof obj === 'object') {
      // Support dot-path access like 'trip.driverId'
      if (key.includes('.')) {
        const parts = key.split('.');
        let cursor: any = obj;
        for (const part of parts) {
          if (cursor == null || typeof cursor !== 'object') return fallback;
          cursor = (cursor as Record<string, any>)[part];
        }
        return (cursor ?? fallback) as string | undefined;
      }
      return ((obj as Record<string, any>)[key] ?? fallback) as string | undefined;
    }
  } catch {
    // Hermes ReferenceError swallowed here
  }
  return fallback;
}

/**
 * TripStatusListener — mounted once at the root layout.
 *
 * Connects to the passenger socket whenever the user has an activeBooking and
 * broadcasts trip-status banners + auto-navigation to every screen in the app.
 * Automatically fetches active booking on boot if Zustand has been cleared/reset.
 * Listens to driver location and ETA in the background to ensure no snap/lag.
 */
export function TripStatusListener() {
  const router = useRouter();
  const segments = useSegments();
  const colors = useColors();
  const queryClient = useQueryClient();
  const { isLoggedIn } = useAuthStore();
  const { activeBooking, selectedTrip } = useRideStore();

  // ── Safely extract booking properties ──
  // Must come BEFORE useQuery hooks because safeRead wraps try-catch for Hermes
  // compat, and activeBookingId is used in the enabled guard below.
  const activeBookingId = safeRead(activeBooking, 'id');
  const computedTripId = safeRead(activeBooking, 'tripId', safeRead(selectedTrip, 'id'));
  const computedDriverId =
    safeRead(activeBooking, 'trip.driverId') ??
    safeRead(selectedTrip, 'driverId') ??
    safeRead(selectedTrip, 'driver.id');

  const [bannerMsg, setBannerMsg] = useState<string | null>(null);
  const [bannerIcon, setBannerIcon] = useState<string>('notifications');
  const bannerAnim = useRef(new Animated.Value(-120)).current;
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks where tapping the banner should navigate ('chat' or null → tracking)
  const bannerDestinationRef = useRef<'chat' | null>(null);

  // Hydrate active booking from backend on boot if local state is null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: apiActiveBooking } = useQuery<any, Error, import('@eyego/types').Booking | null>({
    queryKey: ['bookings', 'active-root-listener'],
    queryFn: () => bookingsApi.getActive(),
    enabled: isLoggedIn && !activeBookingId,
    select: (r: any) => {
      const data = (r.data as { data?: { booking?: import('@eyego/types').Booking } | import('@eyego/types').Booking })?.data;
      return (((data as { booking?: import('@eyego/types').Booking })?.booking ?? data) ?? null) as import('@eyego/types').Booking | null;
    },
    staleTime: 30_000,
  });

  // Hydrate Zustand store dynamically
  useEffect(() => {
    if (apiActiveBooking && !activeBooking) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      useRideStore.getState().setActiveBooking(apiActiveBooking as any);
    }
  }, [apiActiveBooking, activeBooking]);

  // Refs so socket callbacks never read stale closure values
  const activeBookingRef = useRef(activeBooking);
  const selectedTripRef = useRef(selectedTrip);
  const segmentsRef = useRef(segments);

  useEffect(() => { activeBookingRef.current = activeBooking; }, [activeBooking]);
  useEffect(() => { selectedTripRef.current = selectedTrip; }, [selectedTrip]);
  useEffect(() => { segmentsRef.current = segments; }, [segments]);

  const showBanner = useCallback((msg: string, icon: string = 'notifications') => {
    setBannerMsg(msg);
    setBannerIcon(icon);
    // Slide in
    Animated.spring(bannerAnim, {
      toValue: 0,
      useNativeDriver: true,
      speed: 20,
      bounciness: 6,
    }).start();
    // Auto-dismiss after 5 s
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => {
      Animated.timing(bannerAnim, {
        toValue: -120,
        duration: 300,
        useNativeDriver: true,
      }).start(() => setBannerMsg(null));
    }, 5000);
  }, [bannerAnim]);

  // ── Socket connection: connect as soon as user is logged in ──
  // We do NOT gate on activeBooking?.id because the persisted Zustand
  // state may not be hydrated yet on cold boot. Connecting early ensures
  // the socket pipe is always ready by the time driverId resolves.
  // Ref-counting ensures the socket stays connected as long as any
  // other component also holds a reference (e.g. tracking, seat, chat).
  useEffect(() => {
    if (!isLoggedIn) return;

    connectSocket();

    return () => {
      disconnectSocket();
    };
  }, [isLoggedIn]);

  // ── Join trip room once driverId becomes available ──
  // Deduplication ref: track which tripId we've already joined to prevent double-join.
  const joinedTripRoomRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!computedTripId || !computedDriverId) return;
    // Only join if we haven't already joined this specific tripId
    if (joinedTripRoomRef.current === computedTripId) return;
    joinedTripRoomRef.current = computedTripId;
    socketEvents.joinTripRoom(computedTripId, computedDriverId);

    return () => {
      // Leave room when tripId changes or component unmounts
      if (joinedTripRoomRef.current) {
        socketEvents.leaveTripRoom(joinedTripRoomRef.current);
        joinedTripRoomRef.current = undefined;
      }
    };
  }, [computedTripId, computedDriverId]);

  // ── Subscribe to trip-status / location / ETA events ──
  useEffect(() => {
    if (!isLoggedIn) return;

    // Show reconnecting banner when socket drops mid-trip
    const unsubDisconnect = socketEvents.onDisconnect?.(() => {
      showBanner('Connection lost — reconnecting…', 'wifi-outline');
    });

    // Re-join on reconnect (network blip recovery) + clear reconnecting banner
    const unsubConnect = socketEvents.onConnect(() => {
      // Clear any "reconnecting" banner
      setBannerMsg(null);
      const booking = activeBookingRef.current;
      const trip = selectedTripRef.current;
      const tId = safeRead(booking, 'tripId');
      const dId =
        safeRead(booking, 'trip.driverId') ??
        safeRead(booking, 'trip.id') ??
        safeRead(trip, 'driverId') ??
        safeRead(trip, 'driver.id');
      if (tId && dId) socketEvents.joinTripRoom(tId, dId);
    });

    const unsubStatus = socketEvents.onTripStatus((data) => {
      const segs = segmentsRef.current;
      // tracking.tsx handles its own banners + navigation — don't double-fire
      const isOnTrackingScreen = segs.some((s) => s === 'tracking');

      if (data.status === 'DRIVER_EN_ROUTE') {
        showBanner('Your driver has started the trip', 'car-outline');
      } else if (data.status === 'IN_PROGRESS') {
        showBanner('EyeGo has departed — enjoy the ride!', 'navigate-outline');
      } else if (data.status === 'CANCELLED' || data.status === 'NO_SHOW' || data.status === 'REFUNDED') {
        showBanner('Trip was cancelled', 'close-circle');
        disconnectSocket();
        queryClient.invalidateQueries({ queryKey: queryKeys.bookings.myHistory() });
        queryClient.invalidateQueries({ queryKey: ['bookings', 'active'] });
        useRideStore.getState().clearRideState();
        setTimeout(() => {
          router.replace('/(tabs)/home' as Href);
        }, 1500);
      } else if (data.status === 'COMPLETED') {
        // Refresh all relevant query caches
        queryClient.invalidateQueries({ queryKey: queryKeys.bookings.myHistory() });
        queryClient.invalidateQueries({ queryKey: ['bookings', 'completed', 'count'] });
        queryClient.invalidateQueries({ queryKey: ['bookings', 'active'] });

        if (!isOnTrackingScreen) {
          // User is on home/trips/etc — push them to the trip complete screen
          const booking = activeBookingRef.current;
          const bookingId = safeRead(booking, 'id') ?? '';
          const tId = safeRead(booking, 'tripId') ?? safeRead(selectedTripRef.current, 'id');

          showBanner('You have arrived! Rate your trip', 'checkmark-circle');
          setTimeout(() => {
            disconnectSocket();
            router.push(
              `/ride/${tId}/complete${bookingId ? `?bookingId=${bookingId}` : ''}` as Href
            );
          }, 1500);
        }
        // If on tracking screen: tracking.tsx handles disconnect + navigation
      }
    });

    // Capture driver location in background to keep store hydrated
    const unsubLocation = socketEvents.onDriverLocation((data) => {
      useRideStore.getState().setDriverLocation({
        latitude: data.latitude,
        longitude: data.longitude,
        heading: data.heading,
      });
    });

    // Capture dynamic ETA in background to keep store hydrated
    const unsubEta = socketEvents.onTripEta((data) => {
      useRideStore.getState().setTripEta(data.etaMinutes);
    });

    // ── Listen for safety check events (route deviation, stopped too long) ──
    // Show a banner/alert so the rider is aware their trip is being monitored
    const unsubSafetyCheck = socketEvents.onSafetyCheck((data) => {
      // Only show for the current active trip
      const currentBooking = activeBookingRef.current;
      const currentTripId = safeRead(currentBooking, 'tripId') ?? safeRead(selectedTripRef.current, 'id');
      if (data.tripId && data.tripId !== currentTripId) return;

      if (data.reason === 'ROUTE_DEVIATION') {
        showBanner('Your trip has deviated from the expected route. Are you safe?', 'warning');
      } else if (data.reason === 'STOPPED_TOO_LONG') {
        showBanner('Your driver has been stopped for a while — everything okay?', 'time-outline');
      } else if (data.reason === 'UNEXPECTED_DROP') {
        showBanner('Unexpected stop detected — tap to check in', 'location-outline');
      }
    });

    // ── Chat message banners (app-wide) ──
    // Show a banner on every screen except the chat screen itself.
    // Tapping the banner navigates to the chat screen.
    const unsubChat = socketEvents.onChatMessage((msg) => {
      const segs = segmentsRef.current;
      const isOnChatScreen = segs.some((s) => s === 'chat');
      if (isOnChatScreen) return;

      const preview = msg.text.length > 55 ? msg.text.slice(0, 52) + '\u2026' : msg.text;
      bannerDestinationRef.current = 'chat';
      showBanner(`${msg.senderName ?? 'Driver'}: ${preview}`, 'chatbubble-ellipses');
    });

    return () => {
      unsubDisconnect?.();
      unsubConnect();
      unsubStatus();
      unsubLocation();
      unsubEta();
      unsubSafetyCheck();
      unsubChat();
    };
  }, [isLoggedIn, showBanner, queryClient, router]);

  // Cleanup timer on unmount
  useEffect(() => () => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
  }, []);

  // Don't render when the relevant screen already handles its own banner
  const isOnTrackingScreen = segments.some((s) => s === 'tracking');
  const isOnChatScreen = segments.some((s) => s === 'chat');
  if (!bannerMsg || isOnTrackingScreen || isOnChatScreen) return null;

  const handleBannerPress = () => {
    const tId = safeRead(activeBooking, 'tripId');
    if (!tId) return;
    if (bannerDestinationRef.current === 'chat') {
      bannerDestinationRef.current = null;
      router.push(`/ride/${tId}/chat` as Href);
    } else {
      router.push(`/ride/${tId}/tracking` as Href);
    }
  };

  return (
    <Animated.View
      style={[styles.container, { transform: [{ translateY: bannerAnim }] }]}
      pointerEvents="box-none"
    >
      <Pressable onPress={handleBannerPress} style={styles.pressable}>
        <BlurView intensity={85} tint="dark" style={styles.blurContainer}>
          <View style={[styles.iconCircle, { backgroundColor: colors.primary }]}>
            <Ionicons name={bannerIcon as any} size={16} color="#050508" />
          </View>
          <View style={styles.textContainer}>
            <Text style={[styles.label, { color: colors.primary }]}>TRIP UPDATE</Text>
            <Text style={[styles.body, { color: colors.onSurface }]}>{bannerMsg}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.primary} style={styles.chevron} />
        </BlurView>
      </Pressable>
    </Animated.View>
  );
}

// BUGFIX: Use status bar height from expo-constants for accurate positioning
// across all devices. The previous hardcoded values (56 iOS / 46 Android) are
// wrong for Android devices with cutouts or iOS Dynamic Island.
import Constants from 'expo-constants';
const TOP_OFFSET = (Constants.statusBarHeight || (Platform.OS === 'ios' ? 56 : 46));

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: TOP_OFFSET,
    left: spacing.base,
    right: spacing.base,
    zIndex: 9999,
    elevation: 30,
  },
  pressable: {
    borderRadius: radii['2xl'],
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#1DB95450', // Premium Spotify Green border glow
    shadowColor: '#1DB954',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
  },
  blurContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    borderRadius: radii['2xl'],
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  textContainer: {
    flex: 1,
  },
  label: {
    fontFamily: fonts.semiBold,
    fontSize: 9,
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  body: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodySmall,
  },
  chevron: {
    paddingLeft: spacing.xs,
  },
});
