import React, { useRef, useMemo, useEffect, useCallback, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { driverApi, walletApi, connectDriverSocket, disconnectDriverSocket, driverSocketEvents } from '@eyego/api';
import * as Location from 'expo-location';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useDriverStore } from '../../stores/driver.store';
import { useDriverLocation } from '../../hooks/useDriverLocation';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { OnlineToggle } from '../../components/OnlineToggle';

export default function HomeScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const qc = useQueryClient();
  const { driver, isOnline, setOnline, activeTripId, setActiveTripId, updateDriver } = useDriverStore();
  const sheetRef = useRef<BottomSheet>(null);
  const mapRef = useRef<MapView>(null);
  const [onlineError, setOnlineError] = useState<string | null>(null);

  const { location, hasPermission } = useDriverLocation({ enabled: true });
  const { isOffline } = useNetworkStatus();

  const { data: walletData } = useQuery({
    queryKey: ['driver', 'wallet', 'balance'],
    queryFn: () => walletApi.getBalance(),
    select: (r) => r.data.data,
  });

  const { data: txData } = useQuery({
    queryKey: ['driver', 'wallet', 'transactions'],
    queryFn: () => walletApi.getTransactions({ limit: 50 }),
    select: (r) => (r.data as any)?.data?.items ?? [],
  });

  const todayEarnings = useMemo(() => {
    if (!txData) return 0;
    const today = new Date().toDateString();
    return (txData as any[])
      .filter((t: any) => t.type === 'CREDIT' && new Date(t.createdAt).toDateString() === today)
      .reduce((sum: number, t: any) => sum + (t.amount ?? 0), 0);
  }, [txData]);

  const todayTrips = useMemo(() => {
    if (!txData) return 0;
    const today = new Date().toDateString();
    const tripIds = new Set(
      (txData as any[])
        .filter((t: any) => t.type === 'CREDIT' && t.tripId && new Date(t.createdAt).toDateString() === today)
        .map((t: any) => t.tripId)
    );
    return tripIds.size;
  }, [txData]);

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
  }, [activeTripData]);

  // Manage driver socket lifecycle — connect when online, disconnect when offline.
  // Ref-counted so the active-trip screen can also hold a connection simultaneously.
  useEffect(() => {
    if (!isOnline) return;
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
    return () => {
      cleanDispatch();
      disconnectDriverSocket();
    };
  }, [isOnline]);

  const goOnline = useMutation({
    mutationFn: () => {
      if (!location) throw new Error('Location not available yet');
      return driverApi.goOnline({ lat: location.latitude, lng: location.longitude });
    },
    onSuccess: () => {
      setOnline(true);
      setOnlineError(null);
      qc.invalidateQueries({ queryKey: ['driver'] });
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
    onSuccess: () => setOnline(false),
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
  }, [isOnline, hasPermission, location]);

  const initialRegion = location
    ? { latitude: location.latitude, longitude: location.longitude, latitudeDelta: 0.02, longitudeDelta: 0.02 }
    : { latitude: 5.6037, longitude: -0.187, latitudeDelta: 0.05, longitudeDelta: 0.05 };

  return (
    <View style={styles.container}>
      {/* MAP */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_GOOGLE}
        initialRegion={initialRegion}
        showsUserLocation={false}
        showsMyLocationButton={false}
        customMapStyle={darkMapStyle}
      >
        {location && (
          <Marker coordinate={location} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={[styles.driverMarker, { backgroundColor: isOnline ? colors.online : colors.offline }]}>
              <Ionicons name="car" size={16} color="#fff" />
            </View>
          </Marker>
        )}
      </MapView>

      {/* Header overlay */}
      <MotiView
        from={{ opacity: 0, translateY: -10 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 100 }}
        style={styles.header}
      >
        <View>
          <Text style={styles.headerLogo}>EyeGo</Text>
          {!!driver?.name && (
            <Text variant="caption" color={colors.onSurfaceVariant}>
              {driver.name.split(' ')[0]}
            </Text>
          )}
        </View>
        <OnlineToggle
          isOnline={isOnline}
          loading={goOnline.isPending || goOffline.isPending}
          onToggle={handleToggleOnline}
        />
      </MotiView>

      {/* Online error banner */}
      {!!onlineError && (
        <MotiView
          from={{ opacity: 0, translateY: -8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          style={styles.errorBanner}
        >
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
              <TouchableOpacity
                onPress={() => devActivate.mutate()}
                disabled={devActivate.isPending}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
              >
                <Ionicons name="flash-outline" size={12} color={colors.primary} />
                <Text style={{ fontFamily: fonts.semiBold, fontSize: 11, color: colors.primary }}>
                  {devActivate.isPending ? 'Activating…' : 'Activate Account (Dev)'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity onPress={() => setOnlineError(null)}>
            <Ionicons name="close" size={14} color={colors.onSurfaceVariant} />
          </TouchableOpacity>
        </MotiView>
      )}

      {/* No internet banner */}
      {isOffline && (
        <MotiView
          from={{ opacity: 0, translateY: -8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          style={styles.offlineBanner}
        >
          <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
          <Text variant="caption" style={{ color: '#fff', flex: 1 }}>No internet connection</Text>
        </MotiView>
      )}

      {/* Bottom sheet */}
      <BottomSheet
        ref={sheetRef}
        index={0}
        snapPoints={['28%', '60%']}
        backgroundStyle={styles.sheetBg}
        handleIndicatorStyle={styles.sheetHandle}
      >
        <BottomSheetScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
          {/* Status row */}
          <MotiView
            from={{ opacity: 0, translateY: 10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 150 }}
            style={styles.statsRow}
          >
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
                GHS {(walletData as any)?.balance?.toFixed(2) ?? '0.00'}
              </Text>
            </View>
          </MotiView>

          {/* Active trip / Create trip CTA */}
          <MotiView
            from={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 200 }}
            style={styles.ctaWrapper}
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
            {!isOnline && !activeTripData && (
              <Text variant="caption" color={colors.onSurfaceVariant} style={styles.offlineHint}>
                Go online to start accepting trips
              </Text>
            )}
          </MotiView>
        </BottomSheetScrollView>
      </BottomSheet>
    </View>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      position: 'absolute',
      top: 56,
      left: spacing['2xl'],
      right: spacing['2xl'],
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: 'rgba(6, 15, 26, 0.85)',
      borderRadius: radii['2xl'],
      borderWidth: 1,
      borderColor: colors.outline,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.sm,
    },
    headerLogo: {
      fontFamily: fonts.displayBold,
      fontSize: 18,
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
    sheetHandle: { backgroundColor: colors.outline, width: 36 },
    sheetContent: {
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing.md,
      paddingBottom: 120,
      gap: spacing.xl,
    },
    statsRow: {
      flexDirection: 'row',
      backgroundColor: colors.surfaceContainerHigh,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outline,
      padding: spacing.base,
    },
    statCard: { flex: 1, alignItems: 'center', gap: 4 },
    statDivider: { width: 1, backgroundColor: colors.outline, marginVertical: 4 },
    statValue: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.titleMedium,
      color: colors.onSurface,
    },
    ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    ctaWrapper: { gap: spacing.md },
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
      color: colors.onSurface,
      flex: 1,
    },
    offlineHint: { textAlign: 'center', marginTop: spacing.xs },
    errorBanner: {
      position: 'absolute',
      top: 120,
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
      top: 168,
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

// Google Maps dark style
const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#0d1b2a' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#94a3b8' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#030c18' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#112240' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1e3a5f' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#1d4ed8' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#030c18' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
];
