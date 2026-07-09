import React, { useRef, useMemo, useEffect, useCallback, useState } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  Alert,
} from 'react-native';
import MapboxGL from '../../utils/mapbox';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { driverApi, walletApi, heatmapApi, connectDriverSocket, disconnectDriverSocket, driverSocketEvents } from '@eyego/api';
import * as Location from 'expo-location';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import {
  Text,
  Button,
  Entrance,
  GlassSurface,
  InlayPanel,
  GradientGlowBorder,
} from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useDriverStore } from '../../stores/driver.store';
import { useDriverLocation } from '../../hooks/useDriverLocation';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { OnlineToggle } from '../../components/OnlineToggle';
import DemandOverlay from '../../components/DemandOverlay';
import eyegoDarkStyle from '@eyego/map-styles';

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const qc = useQueryClient();
  const driver = useDriverStore(s => s.driver);
  const isOnline = useDriverStore(s => s.isOnline);
  const activeTripId = useDriverStore(s => s.activeTripId);
  const setOnline = useDriverStore(s => s.setOnline);
  const setActiveTripId = useDriverStore(s => s.setActiveTripId);
  const updateDriver = useDriverStore(s => s.updateDriver);
  const mapRef = useRef<any>(null);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  // D14: reconnect retry counter
  const reconnectAttemptsRef = useRef(0);
  // FIX2: single ref for reconnect timer — prevents leaked timers on rapid disconnect/reconnect
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { location, hasPermission } = useDriverLocation({ enabled: true, isOnTrip: false });
  const { isOffline } = useNetworkStatus();
  const [showHeatmap, setShowHeatmap] = useState(false);

  const { data: walletData } = useQuery({
    queryKey: ['driver', 'me'],
    queryFn: () => driverApi.getMe(),
    select: (r) => {
      const d = (r.data as any).data?.driver ?? (r.data as any).data;
      // Show the spendable wallet balance (matches earnings screen), not lifetime totalEarned.
      return { balance: d?.walletBalance ?? d?.totalEarned ?? 0 };
    },
    staleTime: 30_000,
  });

  const { data: txData } = useQuery({
    queryKey: ['driver', 'wallet', 'transactions'],
    // Driver ledger lives at /driver/wallet/transactions and returns { transactions }.
    queryFn: () => driverApi.getWalletTransactions({ limit: 50 }),
    select: (r) => (r.data as any)?.data?.transactions ?? (r.data as any)?.data?.items ?? [],
  });

  // Driver earnings credit types (see earnings.tsx). Filtering only 'CREDIT' showed 0.
  const CREDIT_TYPES = ['CREDIT', 'TRIP_EARNING', 'EARNINGS_CREDIT', 'QUEST_BONUS'];

  const todayEarnings = useMemo(() => {
    if (!txData) return 0;
    const today = new Date().toDateString();
    return (txData as any[])
      .filter((t: any) => CREDIT_TYPES.includes(t.type) && new Date(t.createdAt).toDateString() === today)
      .reduce((sum: number, t: any) => sum + (t.amount ?? 0), 0);
  }, [txData]);

  const todayTrips = useMemo(() => {
    if (!txData) return 0;
    const today = new Date().toDateString();
    const tripIds = new Set(
      (txData as any[])
        .filter((t: any) => CREDIT_TYPES.includes(t.type) && t.tripId && new Date(t.createdAt).toDateString() === today)
        .map((t: any) => t.tripId)
    );
    return tripIds.size;
  }, [txData]);

  const { data: heatmapData } = useQuery({
    queryKey: ['driver', 'heatmap'],
    queryFn: () => heatmapApi.getDemand(location?.latitude ?? 5.6037, location?.longitude ?? -0.187, 5),
    select: (r) => r.data.data?.cells ?? [],
    refetchInterval: showHeatmap ? 60000 : false, // ~60s poll
    enabled: showHeatmap && isOnline,
  });

  const { data: activeTripData } = useQuery({
    queryKey: ['driver', 'activeTrip'],
    queryFn: () => driverApi.getActiveTrip(),
    select: (r) => r.data.data?.trip ?? null,
    refetchInterval: isOnline ? 10000 : false,
  });

  useEffect(() => {
    if (activeTripData?.id) {
      setActiveTripId(activeTripData.id);
    }
  }, [activeTripData, setActiveTripId]);

  // D17: cleanup map ref on unmount
  useEffect(() => {
    return () => {
      mapRef.current = null;
    };
  }, []);

  // FIX2: final safety net — clear reconnect timer if component unmounts while one is pending
  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, []);

  // Manage driver socket lifecycle — connect when online, disconnect when offline.
  // Ref-counted so the active-trip screen can also hold a connection simultaneously.
  useEffect(() => {
    if (!isOnline) return;
    reconnectAttemptsRef.current = 0;
    connectDriverSocket();
    const cleanDispatch = driverSocketEvents.onTripAssigned((data) => {
      router.push({
        pathname: '/(trip)/dispatch/[id]',
        params: {
          id: data.tripId,
          origin: data.routeOrigin,
          destination: data.routeDestination,
          departureTime: data.departureTime,
          expiresAt: data.expiresAt,
        },
      } as any);
    });
    // D14: reconnect on disconnect if still online, capped at 5 attempts
    const cleanDisconnect = driverSocketEvents.onDisconnect(() => {
      if (useDriverStore.getState().isOnline && reconnectAttemptsRef.current < 5) {
        reconnectAttemptsRef.current += 1;
        // FIX2: clear any pending reconnect before scheduling a new one
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        const delay = Math.min(3000 * Math.pow(2, reconnectAttemptsRef.current - 1), 60000);
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          if (useDriverStore.getState().isOnline) {
            connectDriverSocket();
          }
        }, delay);
      }
    });
    return () => {
      cleanDispatch();
      cleanDisconnect();
      // FIX2: cancel any pending reconnect timer on cleanup
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      disconnectDriverSocket();
    };
  }, [isOnline, router]);

  const goOnline = useMutation({
    mutationFn: async () => {
      // D4/S21: refetch wallet/profile so the go-online gate checks a FRESH
      // balance, not a stale cache (a driver could otherwise go online below
      // the minimum). await the refetch before proceeding.
      await qc.invalidateQueries({ queryKey: ['driver', 'me'] });
      let coords = location;
      if (!coords) {
        try {
          const last = await Location.getLastKnownPositionAsync();
          if (last) coords = { latitude: last.coords.latitude, longitude: last.coords.longitude };
        } catch { /* no last-known position — proceed without coords */ }
      }
      return driverApi.goOnline(coords ? { lat: coords.latitude, lng: coords.longitude } : {});
    },
    onSuccess: () => {
      setOnline(true);
      setOnlineError(null);
      qc.invalidateQueries({ queryKey: ['driver'] });
      // DC3: re-fetch active trip state from server when going online
      qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
    },
    onError: (err: any) => {
      const status = err?.response?.status;
      const msg: string = err?.response?.data?.message ?? (err as Error).message ?? 'Could not go online';
      if (status === 403 || msg.toLowerCase().includes('approv') || msg.toLowerCase().includes('pending')) {
        setOnlineError('pending_review');
      } else if (msg.toLowerCase().includes('wallet') || msg.toLowerCase().includes('balance')) {
        setOnlineError('wallet');
      } else {
        setOnlineError(msg);
      }
    },
  });

  const goOffline = useMutation({
    mutationFn: () => driverApi.goOffline(),
    onSuccess: () => {
      setOnline(false);
      // DC3: only clear stale active trip if no trip is currently in progress
      const currentTripId = useDriverStore.getState().activeTripId;
      if (!currentTripId) {
        setActiveTripId(null); // no active trip, safe to clear
      }
      // If there IS an active trip, keep it — connectivity blips shouldn't lose the trip
      qc.invalidateQueries({ queryKey: ['activeTrip'] });
      qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
    },
    onError: (err: any) => {
      // Don't flip local state — driver stays ONLINE so backend/store remain in sync.
      // Surface the failure so the driver knows the toggle didn't take effect.
      const msg: string = err?.response?.data?.message ?? (err as Error).message ?? 'Could not go offline. Please try again.';
      setOnlineError(msg);
    },
  });

  // Dev-only: activates a PENDING_REVIEW account then immediately retries go-online
  const devActivate = useMutation({
    mutationFn: () => driverApi.devActivate(),
    onSuccess: () => {
      updateDriver({ status: 'ACTIVE', isActive: true });
      setOnlineError(null);
      goOnline.mutate();
    },
    onError: () => Alert.alert('Activation Failed', 'Could not activate account. Is the server running?'),
  });

  const handleToggleOnline = useCallback(async () => {
    if (isOnline) {
      goOffline.mutate();
      return;
    }
    // Guard: negative wallet balance = account suspended
    const walletBalance = walletData?.balance ?? 0;
    if (walletBalance < 0) {
      Alert.alert(
        'Account Suspended',
        `Account suspended — GHS ${Math.abs(walletBalance).toFixed(2)} outstanding. Top up your wallet to go back online.`
      );
      return;
    }
    // Guard: location permission must be granted before going online
    if (!hasPermission) {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Location Required',
          'EyeGo needs your location to go online and accept trips. Please enable location access in your device settings.',
          [{ text: 'OK' }]
        );
        return;
      }
    }
    goOnline.mutate();
  }, [isOnline, hasPermission, location, walletData, goOnline, goOffline]);

  const initialCenter: [number, number] = useMemo(
    () => (location ? [location.longitude, location.latitude] : [-0.187, 5.6037]),
    [location?.latitude, location?.longitude]
  );
  const initialZoom = location ? 14 : 13;

  return (
    <View style={styles.container}>
      {/* MAP — full-bleed, mirrors the rider app's map screens (ride/[id].tsx,
          tracking.tsx) instead of a boxed card. AppBackground (mounted in
          _layout.tsx) only shows through the loading/error veil now. */}
      <MapboxGL.MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        styleURL={eyegoDarkStyle}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
      >
        <MapboxGL.Camera centerCoordinate={initialCenter} zoomLevel={initialZoom} animationMode="none" />

        {location && (
          <MapboxGL.MarkerView coordinate={[location.longitude, location.latitude]}>
            <View style={[styles.driverMarker, { backgroundColor: isOnline ? colors.online : colors.offline }]}>
              <Ionicons name="car" size={16} color="#fff" />
            </View>
          </MapboxGL.MarkerView>
        )}

        {/* Demand heatmap overlay — weighted circles for high-demand areas */}
        <DemandOverlay
          cells={heatmapData ?? []}
          primaryColor={colors.primary}
          visible={showHeatmap && isOnline}
        />
      </MapboxGL.MapView>

      {/* Header overlay — glass */}
      <Entrance animation="slideUp" delay={100} style={[styles.header, { top: insets.top + 12 }]}>
        <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii['2xl']} />
        <View>
          <Text style={styles.headerLogo}>EyeGo</Text>
          {!!driver?.name && (
            <Text variant="caption" color={colors.onSurfaceVariant}>
              {driver.name.split(' ')[0]}
            </Text>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          {isOnline && (
            <Pressable
              onPress={() => setShowHeatmap(!showHeatmap)}
              style={{
                width: 36, height: 36,
                borderRadius: 18,
                backgroundColor: showHeatmap ? `${colors.primary}22` : 'transparent',
                alignItems: 'center', justifyContent: 'center',
                borderWidth: 1, borderColor: showHeatmap ? colors.primary : colors.outline,
              }}
            >
              <Ionicons name="flame-outline" size={16} color={showHeatmap ? colors.primary : colors.onSurfaceVariant} />
            </Pressable>
          )}
          <OnlineToggle
            isOnline={isOnline}
            loading={goOnline.isPending || goOffline.isPending}
            onToggle={handleToggleOnline}
          />
        </View>
      </Entrance>

      {/* Online error banner */}
      {!!onlineError && (
        <Entrance animation="slideUp" style={[styles.errorBanner, { top: insets.top + 64 }]}>
          <Ionicons
            name={onlineError === 'pending_review' ? 'time-outline' : 'warning-outline'}
            size={16}
            color={colors.error}
          />
          <View style={{ flex: 1, gap: 6 }}>
            <Text variant="caption" color={colors.error}>
              {onlineError === 'pending_review'
                ? 'Account pending approval.'
                : onlineError === 'wallet'
                ? 'Wallet error — please check your balance.'
                : onlineError}
            </Text>
            {onlineError === 'pending_review' && (
              <Pressable
                onPress={() => devActivate.mutate()}
                disabled={devActivate.isPending}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
              >
                <Ionicons name="flash-outline" size={12} color={colors.primary} />
                <Text style={{ fontFamily: fonts.semiBold, fontSize: 11, lineHeight: 14, color: colors.primary }}>
                  {devActivate.isPending ? 'Activating…' : 'Activate Account (Dev)'}
                </Text>
              </Pressable>
            )}
          </View>
          <Pressable onPress={() => setOnlineError(null)}>
            <Ionicons name="close" size={14} color={colors.onSurfaceVariant} />
          </Pressable>
        </Entrance>
      )}

      {/* No internet banner */}
      {isOffline && (
        <Entrance animation="slideUp" style={[styles.offlineBanner, { top: insets.top + (onlineError ? 112 : 64) }]}>
          <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
          <Text variant="caption" style={{ color: '#fff', flex: 1 }}>No internet connection</Text>
        </Entrance>
      )}

      {/* Bottom panel — collapsed snap keeps the CTA in view on launch;
          driver can drag up for the fuller stats view. */}
      <InlayPanel
        snapPointsPct={[0.42, 0.72]}
        sheetStyle={styles.sheetBg}
        grabberColor={colors.outline}
      >
        <View style={styles.sheetContent}>
          {/* Status row */}
          <Entrance animation="slideDown" delay={150} style={styles.statsRow}>
            <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.xl} intensity="low" />
            <View style={styles.statCard}>
              <Text variant="caption" color={colors.onSurfaceVariant}>Today</Text>
              <Text style={styles.statValue}>
                GHS {todayEarnings.toFixed(2)}
              </Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCard}>
              <Text variant="caption" color={colors.onSurfaceVariant}>Trips</Text>
              <Text style={styles.statValue}>{todayTrips}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCard}>
              <Text variant="caption" color={colors.onSurfaceVariant}>Balance</Text>
              <Text style={styles.statValue}>
                GHS {walletData?.balance != null ? walletData.balance.toFixed(2) : '0.00'}
              </Text>
            </View>
          </Entrance>

          {/* Active trip / Create trip CTA — the screen's hero action gets the premium ring */}
          <Entrance animation="slideDown" delay={200} style={styles.ctaWrapper}>
            <GradientGlowBorder
              palette="driver"
              fillColor={colors.surfaceContainerHigh}
              borderRadius={radii['2xl']}
              glow
              disabled={!isOnline && !activeTripData}
              style={styles.ctaGlow}
            >
              {activeTripData ? (
                <>
                  <View style={styles.activeTripBanner}>
                    <View style={[styles.activeDot, { backgroundColor: colors.online }]} />
                    <Text style={styles.activeTripText}>
                      Active trip: {(activeTripData as any).route?.originName ?? '—'} → {(activeTripData as any).route?.destinationName ?? '—'}
                    </Text>
                  </View>
                  <Button
                    label="Resume Trip"
                    onPress={() => router.push(`/(trip)/active/${activeTripData.id}`)}
                  />
                </>
              ) : (
                <Button
                  label="+ Create Trip"
                  onPress={() => router.push('/(trip)/create')}
                  disabled={!isOnline}
                />
              )}
            </GradientGlowBorder>
            {!isOnline && !activeTripData && (
              <Text variant="caption" color={colors.onSurfaceVariant} style={styles.offlineHint}>
                Go online to start accepting trips
              </Text>
            )}
          </Entrance>
        </View>
      </InlayPanel>
    </View>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    // Transparent — the map is full-bleed and AppBackground (mounted in
    // _layout.tsx) only needs to show through the map's own loading/error
    // veil, not get blocked by an opaque fill here.
    container: { flex: 1, backgroundColor: 'transparent' },
    header: {
      position: 'absolute',
      left: spacing['2xl'],
      right: spacing['2xl'],
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderRadius: radii['2xl'],
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.sm,
      overflow: 'hidden',
    },
    headerLogo: {
      fontFamily: fonts.displayBold,
      fontSize: 18,
      lineHeight: 23,
      color: colors.primary,
      letterSpacing: -0.5,
    },
    driverMarker: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: '#fff',
    },
    sheetBg: {
      backgroundColor: colors.surfaceContainer,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
    },
    sheetContent: {
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing.md,
      paddingBottom: 120,
      gap: spacing.xl,
    },
    statsRow: {
      flexDirection: 'row',
      borderRadius: radii.xl,
      padding: spacing.base,
      overflow: 'hidden',
    },
    statCard: { flex: 1, alignItems: 'center', gap: 4 },
    statDivider: { width: 1, backgroundColor: colors.outline, marginVertical: 4 },
    statValue: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.titleMedium,
      lineHeight: Math.round(fontSizes.titleMedium * 1.3),
      color: colors.onSurface,
    },
    ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    ctaWrapper: { gap: spacing.md },
    ctaGlow: { padding: spacing.base, gap: spacing.sm },
    activeTripBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: `${colors.online}18`,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: `${colors.online}44`,
      padding: spacing.base,
    },
    activeDot: { width: 8, height: 8, borderRadius: 4 },
    activeTripText: {
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
      color: colors.onSurface,
      flex: 1,
    },
    offlineHint: { textAlign: 'center', marginTop: spacing.xs },
    errorBanner: {
      position: 'absolute',
      left: spacing['2xl'],
      right: spacing['2xl'],
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: `${colors.error}18`,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: `${colors.error}44`,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.sm,
    },
    offlineBanner: {
      position: 'absolute',
      left: spacing['2xl'],
      right: spacing['2xl'],
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: '#334155',
      borderRadius: radii.lg,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.sm,
    },
  });
