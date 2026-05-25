'use client';
import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Animated, View, StyleSheet, Platform } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { socketEvents, connectSocket, disconnectSocket, queryKeys } from '@eyego/api';
import { useRideStore } from '../stores/ride.store';
import { useAuthStore } from '../stores/auth.store';
import { useColors } from '../utils/useColors';
import { Text } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radii, fonts, fontSizes } from '@eyego/config';

/**
 * TripStatusListener — mounted once at the root layout.
 *
 * Connects to the passenger socket whenever the user has an activeBooking and
 * broadcasts trip-status banners + auto-navigation to every screen in the app.
 * This makes trip events (driver en-route, departed, arrived) consistent
 * regardless of which screen the rider is currently on.
 */
export function TripStatusListener() {
  const router = useRouter();
  const segments = useSegments();
  const colors = useColors();
  const queryClient = useQueryClient();
  const { isLoggedIn } = useAuthStore();
  const { activeBooking, selectedTrip } = useRideStore();

  const [bannerMsg, setBannerMsg] = useState<string | null>(null);
  const [bannerIcon, setBannerIcon] = useState<any>('notifications');
  const bannerAnim = useRef(new Animated.Value(-100)).current;
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs so socket callbacks never read stale closure values
  const activeBookingRef = useRef(activeBooking);
  const selectedTripRef = useRef(selectedTrip);
  const segmentsRef = useRef(segments);

  useEffect(() => { activeBookingRef.current = activeBooking; }, [activeBooking]);
  useEffect(() => { selectedTripRef.current = selectedTrip; }, [selectedTrip]);
  useEffect(() => { segmentsRef.current = segments; }, [segments]);

  const showBanner = useCallback((msg: string, icon: any = 'notifications') => {
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
        toValue: -100,
        duration: 300,
        useNativeDriver: true,
      }).start(() => setBannerMsg(null));
    }, 5000);
  }, [bannerAnim]);

  useEffect(() => {
    if (!isLoggedIn || !activeBooking?.id) return;

    const tripId = activeBooking.tripId;
    const driverId =
      (activeBooking as any).trip?.driverId ??
      (activeBooking as any).trip?.driver?.id ??
      selectedTrip?.driverId ??
      (selectedTrip?.driver as any)?.id;

    connectSocket();
    if (tripId && driverId) {
      socketEvents.joinTripRoom(tripId, driverId);
    }

    // Re-join on reconnect (network blip recovery)
    const unsubConnect = socketEvents.onConnect(() => {
      const booking = activeBookingRef.current;
      const trip = selectedTripRef.current;
      const tId = booking?.tripId;
      const dId =
        (booking as any)?.trip?.driverId ??
        (booking as any)?.trip?.driver?.id ??
        trip?.driverId ??
        (trip?.driver as any)?.id;
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
      } else if (data.status === 'COMPLETED') {
        // Refresh all relevant query caches
        queryClient.invalidateQueries({ queryKey: queryKeys.bookings.myHistory() });
        queryClient.invalidateQueries({ queryKey: ['bookings', 'completed', 'count'] });
        queryClient.invalidateQueries({ queryKey: ['bookings', 'active'] });

        if (!isOnTrackingScreen) {
          // User is on home/trips/etc — push them to the trip complete screen
          const bookingId = activeBookingRef.current?.id ?? '';
          const tId = activeBookingRef.current?.tripId ?? (data as any).tripId ?? tripId;

          showBanner('You have arrived! Rate your trip', 'checkmark-circle');
          setTimeout(() => {
            disconnectSocket();
            router.push(
              `/ride/${tId}/complete${bookingId ? `?bookingId=${bookingId}` : ''}` as any
            );
          }, 1500);
        }
        // If on tracking screen: tracking.tsx handles disconnect + navigation
      }
    });

    return () => {
      unsubConnect();
      unsubStatus();
    };
  // Re-subscribe whenever the active booking changes (new trip started)
  }, [activeBooking?.id, isLoggedIn, showBanner, queryClient, router]);

  // Cleanup timer on unmount
  useEffect(() => () => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
  }, []);

  // Don't render when tracking screen has its own banner, or nothing to show
  const isOnTrackingScreen = segments.some((s) => s === 'tracking');
  if (!bannerMsg || isOnTrackingScreen) return null;

  return (
    <Animated.View
      style={[styles.container, { transform: [{ translateY: bannerAnim }] }]}
      pointerEvents="box-none"
    >
      <View
        style={[
          styles.banner,
          {
            backgroundColor: colors.surfaceContainerHigh,
            borderColor: colors.primary + '70',
            shadowColor: colors.primary,
          },
        ]}
      >
        <View style={[styles.iconCircle, { backgroundColor: colors.primary }]}>
          <Ionicons name={bannerIcon} size={16} color="#050508" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.label, { color: colors.primary }]}>TRIP UPDATE</Text>
          <Text style={[styles.body, { color: colors.onSurface }]}>{bannerMsg}</Text>
        </View>
      </View>
    </Animated.View>
  );
}

const TOP_OFFSET = Platform.OS === 'ios' ? 54 : 42;

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: TOP_OFFSET,
    left: spacing.base,
    right: spacing.base,
    zIndex: 9999,
    elevation: 30,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    borderRadius: radii['2xl'],
    borderWidth: 1.5,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
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
});
