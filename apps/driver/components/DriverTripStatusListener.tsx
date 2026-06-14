'use client';
import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Animated, View, StyleSheet, Platform, Pressable } from 'react-native';
import { useRouter, useSegments, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { BlurView } from 'expo-blur';
import {
  connectDriverSocket,
  disconnectDriverSocket,
  driverSocketEvents,
} from '@eyego/api';
import { useDriverStore } from '../stores/driver.store';
import { useColors } from '../utils/useColors';
import { Text } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radii, fonts, fontSizes } from '@eyego/config';
import Constants from 'expo-constants';

// Hermes-safe property accessor — wraps reads in try-catch because Hermes
// throws ReferenceError for properties that don't exist on objects deserialized
// from AsyncStorage. Mirrors the rider TripStatusListener.safeRead helper.
function safeRead(obj: unknown, key: string, fallback?: string): string | undefined {
  try {
    if (obj && typeof obj === 'object') {
      if (key.includes('.')) {
        const parts = key.split('.');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let cursor: any = obj;
        for (const part of parts) {
          if (cursor == null || typeof cursor !== 'object') return fallback;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          cursor = (cursor as Record<string, any>)[part];
        }
        return (cursor ?? fallback) as string | undefined;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((obj as Record<string, any>)[key] ?? fallback) as string | undefined;
    }
  } catch {
    // Hermes ReferenceError swallowed here
  }
  return fallback;
}

/**
 * DriverTripStatusListener — mounted once at the driver root layout.
 *
 * Off-screen parity for the driver app, mirroring the rider's TripStatusListener:
 * connects to the driver socket whenever logged in, and surfaces app-wide banners
 * + cache invalidation for chat messages, new dispatch/assignment requests, payment
 * confirmation, and terminal trip-status changes — regardless of which screen the
 * driver is currently on. Re-joins the active trip room on every (re)connect so
 * live updates survive socket drops while backgrounded.
 *
 * Banners are suppressed on the screens that already render their own (chat,
 * tracking, active, dispatch) to avoid double-firing.
 */
export function DriverTripStatusListener() {
  const router = useRouter();
  const segments = useSegments();
  const colors = useColors();
  const queryClient = useQueryClient();
  const { isLoggedIn, activeTripId } = useDriverStore();

  const [bannerMsg, setBannerMsg] = useState<string | null>(null);
  const [bannerIcon, setBannerIcon] = useState<string>('notifications');
  const bannerAnim = useRef(new Animated.Value(-120)).current;
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Where tapping the banner should navigate, with the route param.
  const bannerDestRef = useRef<{ type: 'chat' | 'dispatch' | 'tracking'; tripId: string } | null>(null);

  // Refs so socket callbacks never read stale closure values
  const activeTripIdRef = useRef(activeTripId);
  const segmentsRef = useRef(segments);
  useEffect(() => { activeTripIdRef.current = activeTripId; }, [activeTripId]);
  useEffect(() => { segmentsRef.current = segments; }, [segments]);

  const showBanner = useCallback((msg: string, icon: string = 'notifications') => {
    setBannerMsg(msg);
    setBannerIcon(icon);
    Animated.spring(bannerAnim, {
      toValue: 0,
      useNativeDriver: true,
      speed: 20,
      bounciness: 6,
    }).start();
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => {
      Animated.timing(bannerAnim, {
        toValue: -120,
        duration: 300,
        useNativeDriver: true,
      }).start(() => setBannerMsg(null));
    }, 5000);
  }, [bannerAnim]);

  // ── Socket connection: connect as soon as the driver is logged in ──
  // Ref-counted (connectDriverSocket) so the socket stays alive as long as any
  // other component (home/active/tracking/chat) also holds a reference.
  useEffect(() => {
    if (!isLoggedIn) return;
    connectDriverSocket();
    return () => {
      disconnectDriverSocket();
    };
  }, [isLoggedIn]);

  // ── Subscribe to driver realtime events (app-wide) ──
  useEffect(() => {
    if (!isLoggedIn) return;

    const unsubDisconnect = driverSocketEvents.onDisconnect(() => {
      showBanner('Connection lost — reconnecting…', 'wifi-outline');
    });

    // Re-join the active trip room on (re)connect + clear the reconnecting banner.
    const unsubConnect = driverSocketEvents.onConnect(() => {
      setBannerMsg(null);
      const tId = activeTripIdRef.current;
      if (tId) driverSocketEvents.emitJoinTracking(tId);
    });

    // New dispatch / trip assignment — drivers must see this on ANY screen.
    const unsubAssigned = driverSocketEvents.onTripAssigned((data) => {
      const tId = safeRead(data, 'tripId');
      if (!tId) return;
      const segs = segmentsRef.current;
      // The dispatch modal already presents the offer — don't double-fire.
      if (segs.some((s) => s === 'dispatch')) return;
      queryClient.invalidateQueries({ queryKey: ['driver', 'dispatch'] });
      queryClient.invalidateQueries({ queryKey: ['driver', 'trips'] });
      bannerDestRef.current = { type: 'dispatch', tripId: tId };
      const route = safeRead(data, 'routeOrigin');
      const dest = safeRead(data, 'routeDestination');
      showBanner(
        route && dest ? `New trip: ${route} → ${dest}` : 'New trip request — tap to view',
        'navigate-circle',
      );
    });

    // Terminal/started trip-status changes pushed from the backend.
    const unsubStatus = driverSocketEvents.onTripStatus((data) => {
      const segs = segmentsRef.current;
      const status = safeRead(data, 'status');
      const tId = safeRead(data, 'tripId') ?? activeTripIdRef.current ?? '';
      // The active/tracking screens manage their own banners + navigation.
      const onTripScreen = segs.some((s) => s === 'tracking' || s === 'active');

      if (status === 'CANCELLED' || status === 'NO_SHOW' || status === 'REFUNDED') {
        showBanner('A passenger cancelled their booking', 'close-circle');
        queryClient.invalidateQueries({ queryKey: ['driver', 'trips'] });
        queryClient.invalidateQueries({ queryKey: ['driver', 'me'] });
      } else if (status === 'COMPLETED') {
        // Trip wrapped up off-screen — refresh earnings/wallet/quests/trip lists.
        queryClient.invalidateQueries({ queryKey: ['driver', 'trips'] });
        queryClient.invalidateQueries({ queryKey: ['driver', 'wallet', 'transactions'] });
        queryClient.invalidateQueries({ queryKey: ['driver', 'me'] });
        queryClient.invalidateQueries({ queryKey: ['driver', 'quests'] });
        if (!onTripScreen) showBanner('Trip completed — earnings updated', 'checkmark-circle');
      }
    });

    // Passenger paid — keep earnings/quest/wallet caches fresh app-wide.
    const unsubPayment = driverSocketEvents.onPaymentConfirmed((data) => {
      queryClient.invalidateQueries({ queryKey: ['driver', 'wallet', 'transactions'] });
      queryClient.invalidateQueries({ queryKey: ['driver', 'me'] });
      queryClient.invalidateQueries({ queryKey: ['driver', 'quests'] });
      const tId = safeRead(data, 'tripId');
      const segs = segmentsRef.current;
      if (tId && !segs.some((s) => s === 'tracking' || s === 'active')) {
        showBanner('Payment received', 'cash-outline');
      }
    });

    // Seat updates while off the active screen → refresh the trip lists so seat
    // counts stay accurate on home/trips.
    const unsubSeat = driverSocketEvents.onSeatUpdate(() => {
      queryClient.invalidateQueries({ queryKey: ['driver', 'trips'] });
    });

    // Group chat banners (app-wide, except on the chat screen itself).
    const unsubChat = driverSocketEvents.onChatMessage((msg) => {
      const segs = segmentsRef.current;
      if (segs.some((s) => s === 'chat')) return;
      const text = safeRead(msg, 'text') ?? '';
      const sender = safeRead(msg, 'senderName') ?? 'Passenger';
      const tId = safeRead(msg, 'tripId') ?? activeTripIdRef.current;
      if (!tId) return;
      const preview = text.length > 55 ? text.slice(0, 52) + '…' : text;
      bannerDestRef.current = { type: 'chat', tripId: tId };
      showBanner(`${sender}: ${preview}`, 'chatbubble-ellipses');
    });

    // Private (1:1) chat banners.
    const unsubPrivateChat = driverSocketEvents.onPrivateChatMessage((msg) => {
      const segs = segmentsRef.current;
      if (segs.some((s) => s === 'chat')) return;
      const text = safeRead(msg, 'text') ?? '';
      const sender = safeRead(msg, 'senderName') ?? 'Passenger';
      const tId = safeRead(msg, 'tripId') ?? activeTripIdRef.current;
      if (!tId) return;
      const preview = text.length > 55 ? text.slice(0, 52) + '…' : text;
      bannerDestRef.current = { type: 'chat', tripId: tId };
      showBanner(`${sender} (private): ${preview}`, 'lock-closed');
    });

    return () => {
      unsubDisconnect();
      unsubConnect();
      unsubAssigned();
      unsubStatus();
      unsubPayment();
      unsubSeat();
      unsubChat();
      unsubPrivateChat();
    };
  }, [isLoggedIn, showBanner, queryClient]);

  // Cleanup timer on unmount
  useEffect(() => () => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
  }, []);

  // Suppress on screens that render their own banners/navigation.
  const isOnChat = segments.some((s) => s === 'chat');
  const isOnTrip = segments.some((s) => s === 'tracking' || s === 'active' || s === 'dispatch');
  if (!bannerMsg || isOnChat || isOnTrip) return null;

  const handlePress = () => {
    const dest = bannerDestRef.current;
    if (!dest?.tripId) return;
    bannerDestRef.current = null;
    if (dest.type === 'chat') {
      router.push({ pathname: '/(trip)/chat/[id]', params: { id: dest.tripId } } as Href);
    } else if (dest.type === 'dispatch') {
      router.push({ pathname: '/(trip)/dispatch/[id]', params: { id: dest.tripId } } as Href);
    } else {
      router.push({ pathname: '/(trip)/tracking/[id]', params: { id: dest.tripId } } as Href);
    }
  };

  return (
    <Animated.View
      style={[styles.container, { transform: [{ translateY: bannerAnim }] }]}
      pointerEvents="box-none"
    >
      <Pressable onPress={handlePress} style={styles.pressable} accessibilityRole="button">
        <BlurView intensity={85} tint="dark" style={styles.blurContainer}>
          <View style={[styles.iconCircle, { backgroundColor: colors.primary }]}>
            <Ionicons name={bannerIcon as never} size={16} color="#04070D" />
          </View>
          <View style={styles.textContainer}>
            <Text style={[styles.label, { color: colors.primary }]}>EYEGO DRIVER</Text>
            <Text style={[styles.body, { color: colors.onSurface }]} numberOfLines={2}>{bannerMsg}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.primary} style={styles.chevron} />
        </BlurView>
      </Pressable>
    </Animated.View>
  );
}

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
    borderColor: 'rgba(59,130,246,0.32)',
    shadowColor: '#3B82F6',
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
  textContainer: { flex: 1 },
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
  chevron: { paddingLeft: spacing.xs },
});
