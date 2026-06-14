'use strict';
import React, { useMemo, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { MotiView } from 'moti';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import * as KeepAwake from 'expo-keep-awake';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { driverApi, driverSocketEvents } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../../utils/useColors';
import { useDriverStore } from '../../../stores/driver.store';
import { useNotificationsStore } from '../../../stores/notifications.store';
import { useDriverSocket } from '../../../hooks/useDriverSocket';
import { useDriverLocation } from '../../../hooks/useDriverLocation';
import { SeatMap } from '../../../components/SeatMap';
import eyegoDarkStyle from '@eyego/map-styles';
import MapboxGL from '../../../utils/mapbox';

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_FLOW: Record<string, { label: string; next: string | null; action: string }> = {
  SCHEDULED:          { label: 'Scheduled',           next: 'start',  action: 'Start Trip'    },
  FILLING:            { label: 'Boarding Open',        next: 'start',  action: 'Start Trip'    },
  DRIVER_EN_ROUTE:    { label: 'En Route to Stop',     next: 'arrive', action: "I've Arrived"  },
  ARRIVED_AT_PICKUP:  { label: 'Arrived at Pickup',    next: 'depart', action: 'Start Trip'    },
  IN_PROGRESS:        { label: 'In Progress',          next: 'arrive', action: 'Mark Arrived'  },
  COMPLETED:          { label: 'Completed',            next: null,     action: ''              },
  CANCELLED:          { label: 'Cancelled',            next: null,     action: ''              },
};

const TRIP_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  SCHEDULED:          { label: 'Scheduled',        color: '#94A3B8' },
  FILLING:            { label: 'Boarding',          color: '#3B82F6' },
  DRIVER_EN_ROUTE:    { label: 'En Route',          color: '#F59E0B' },
  ARRIVED_AT_PICKUP:  { label: 'Arrived',           color: '#A78BFA' },
  IN_PROGRESS:        { label: 'In Progress',       color: '#4be277' },
  COMPLETED:          { label: 'Completed',         color: '#60A5FA' },
  CANCELLED:          { label: 'Cancelled',         color: '#F87171' },
};

const STATUS_STEPS = ['SCHEDULED', 'FILLING', 'DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'IN_PROGRESS', 'COMPLETED'];

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function ActiveTripScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['38%', '68%', '92%'], []);

  const qc = useQueryClient();
  const { setActiveTripId } = useDriverStore();
  const { addNotification } = useNotificationsStore();

  const { data: trip, isLoading } = useQuery({
    queryKey: ['driver', 'trip', id],
    queryFn: () => driverApi.getActiveTrip(),
    select: (r) => r.data.data?.trip ?? null,
    refetchInterval: 8000,
    enabled: !!id && typeof id === 'string',
  });

  useEffect(() => {
    if (!id || typeof id !== 'string') router.back();
  }, [id, router]);

  const isActiveTrip = !!trip && !['COMPLETED', 'CANCELLED'].includes(trip.status);

  useEffect(() => {
    if (isActiveTrip) KeepAwake.activateKeepAwake();
    else KeepAwake.deactivateKeepAwake();
    return () => { KeepAwake.deactivateKeepAwake(); };
  }, [isActiveTrip]);

  useDriverSocket({ tripId: id, enabled: !!trip });
  const { location } = useDriverLocation({ enabled: isActiveTrip });

  useEffect(() => {
    if (!trip) return;
    if (['COMPLETED', 'CANCELLED'].includes(trip.status)) return;

    const unsubPayment = driverSocketEvents.onPaymentConfirmed((data) => {
      if (data.tripId === id) {
        addNotification({ type: 'PAYMENT_CONFIRMED', title: 'Payment Confirmed', body: 'A passenger just completed their payment.', tripId: id });
        Alert.alert('Payment Confirmed', 'A passenger just completed their payment.');
        qc.invalidateQueries({ queryKey: ['driver', 'trip', id] });
      }
    });

    const unsubSeat = driverSocketEvents.onSeatUpdate((data) => {
      if (data.tripId === id) qc.invalidateQueries({ queryKey: ['driver', 'trip', id] });
    });

    return () => { unsubPayment(); unsubSeat(); };
  }, [trip?.status, id, qc, addNotification]);

  const cancelTrip = useMutation({
    mutationFn: () => driverApi.cancelTrip(id),
    onSuccess: () => {
      setActiveTripId(null);
      qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
      qc.invalidateQueries({ queryKey: ['driver', 'trips', 'all'] });
      router.replace('/(tabs)/home');
    },
    onError: (err: any) => Alert.alert('Error', err?.response?.data?.message ?? (err as Error).message),
  });

  const handleCancel = () => {
    Alert.alert(
      'Cancel Trip',
      'Are you sure you want to cancel this trip? All passenger bookings will also be cancelled.',
      [
        { text: 'Keep Trip', style: 'cancel' },
        { text: 'Cancel Trip', style: 'destructive', onPress: () => cancelTrip.mutate() },
      ],
    );
  };

  const pendingFromStatus = useRef<string | null>(null);
  const VALID_ADVANCE_STATUSES = ['SCHEDULED', 'FILLING', 'DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'IN_PROGRESS'];

  const advanceStatus = useMutation({
    retry: 1,
    mutationFn: async () => {
      const status = trip?.status;
      if (!status || !VALID_ADVANCE_STATUSES.includes(status)) throw new Error(`Cannot advance from status: ${status ?? 'unknown'}`);
      pendingFromStatus.current = status;
      if (status === 'SCHEDULED' || status === 'FILLING') return driverApi.startTrip(id);
      if (status === 'DRIVER_EN_ROUTE') return driverApi.arriveAtPickup(id);
      if (status === 'ARRIVED_AT_PICKUP') return driverApi.departTrip(id);
      if (status === 'IN_PROGRESS') return driverApi.arriveTrip(id);
      throw new Error('Cannot advance from current status');
    },
    onSuccess: (res) => {
      const fromStatus = pendingFromStatus.current;
      let toStatus: string | null = null;
      if (fromStatus === 'SCHEDULED' || fromStatus === 'FILLING') toStatus = 'DRIVER_EN_ROUTE';
      else if (fromStatus === 'DRIVER_EN_ROUTE') toStatus = 'ARRIVED_AT_PICKUP';
      else if (fromStatus === 'ARRIVED_AT_PICKUP') toStatus = 'IN_PROGRESS';
      else if (fromStatus === 'IN_PROGRESS') toStatus = 'COMPLETED';

      if (toStatus === 'DRIVER_EN_ROUTE') {
        driverSocketEvents.emitTripStarted(id);
        addNotification({ type: 'DRIVER_EN_ROUTE', title: 'Trip started', body: 'You are now en route to the pickup stop.', tripId: id });
        qc.invalidateQueries({ queryKey: ['driver', 'trip', id] });
        qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
        // Redirect driver to the live tracking screen
        router.replace({ pathname: '/(trip)/tracking/[id]', params: { id } } as Href);
        return;
      }
      if (toStatus === 'ARRIVED_AT_PICKUP') {
        addNotification({ type: 'ARRIVED_AT_PICKUP', title: 'Arrived at pickup', body: 'You have arrived at the pickup stop.', tripId: id });
      }
      if (toStatus === 'IN_PROGRESS') {
        driverSocketEvents.emitTripDeparted(id);
        addNotification({ type: 'IN_PROGRESS', title: 'Trip in progress', body: 'You have departed. Ride is underway.', tripId: id });
      }

      if (toStatus === 'COMPLETED') {
        driverSocketEvents.emitArrived(id);
        setActiveTripId(null);
        qc.invalidateQueries({ queryKey: ['driver', 'trip', id] });
        qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
        qc.invalidateQueries({ queryKey: ['driver', 'trips', 'all'] });
        qc.invalidateQueries({ queryKey: ['driver', 'me'] });
        qc.invalidateQueries({ queryKey: ['driver', 'quests'] });
        // Refresh wallet balance + transaction list so home/earnings show the
        // new trip earnings immediately instead of a stale balance.
        qc.invalidateQueries({ queryKey: ['driver', 'wallet'] });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = (res as any)?.data;
        const earningsThisTrip = raw?.data?.earningsThisTrip ?? raw?.data?.totalEarnings ?? 0;
        const safeEarnings = (typeof earningsThisTrip === 'number' && !isNaN(earningsThisTrip)) ? earningsThisTrip : 0;
        addNotification({ type: 'COMPLETED', title: 'Trip completed!', body: `You earned GHS ${safeEarnings.toFixed(2)} from this trip.`, tripId: id });
        router.replace({ pathname: '/(trip)/complete/[id]', params: { id, earnings: String(safeEarnings) } } as Href);
        return;
      }

      qc.invalidateQueries({ queryKey: ['driver', 'trip', id] });
      qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
    },
    onError: (err) => Alert.alert('Error', (err as Error).message),
  });

  // ─── Loading skeleton ────────────────────────────────────────────────────

  if (isLoading || !trip) {
    return (
      <View style={styles.safe}>
        <MapboxGL.MapView
          style={StyleSheet.absoluteFillObject}
          styleURL={eyegoDarkStyle}
          logoEnabled={false}
          attributionEnabled={false}
          compassEnabled={false}
          rotateEnabled={false}
          scaleBarEnabled={false}
          zoomEnabled={false}
          scrollEnabled={false}
        />
        <View style={[styles.loadingOverlay, { paddingTop: insets.top + 20 }]}>
          {[120, 80, 160].map((w, i) => (
            <MotiView
              key={i}
              from={{ opacity: 0.2 }}
              animate={{ opacity: 0.6 }}
              transition={{ type: 'timing', duration: 800, loop: true, delay: i * 150 }}
              style={[styles.skeleton, { width: w }]}
            />
          ))}
        </View>
      </View>
    );
  }

  // ─── Derived data ────────────────────────────────────────────────────────

  const statusInfo = STATUS_FLOW[trip.status] ?? STATUS_FLOW.FILLING;
  const statusCfg = TRIP_STATUS_CONFIG[trip.status] ?? { label: trip.status, color: colors.onSurfaceVariant };
  const rawBookings = trip.bookings ?? [];
  const total = trip.maxSeats ?? 14;
  // farePerSeat is the driver's 70% net cut. Reverse-calculate full passenger fare.
  const fare      = trip.farePerSeat ?? 0;
  const fullFare  = fare > 0 ? parseFloat((fare / 0.70).toFixed(2)) : 0;
  const activeBookings = rawBookings.filter((b: any) => b.status !== 'CANCELLED');
  const passengers = activeBookings.length;
  const grossEarnings = passengers * fullFare;
  const platformFee   = passengers * (fullFare - fare);   // 30% platform cut
  const netEarnings   = passengers * fare;
  const seats = activeBookings.map((b: any) => ({
    seatNumber: b.seatNumber,
    // Only show seat as occupied when payment is confirmed or it's an offline booking
    status: (
      b.status === 'BOARDED'
        ? 'BOARDED'
        : (b.paymentStatus === 'PAID' || b.isOffline || b.paymentMethod === 'CASH')
          ? 'BOOKED'
          : 'EMPTY'
    ) as 'BOARDED' | 'BOOKED' | 'EMPTY',
    userId: b.user?.id ?? b.userId,
    userName: b.user?.name ?? 'Passenger',
    bookingId: b.id,
  }));

  const driverCoord: [number, number] = location
    ? [location.longitude, location.latitude]
    : [trip.route?.originLng ?? -0.187, trip.route?.originLat ?? 5.6037];

  const currentStepIndex = STATUS_STEPS.indexOf(trip.status);

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <View style={styles.safe}>
      {/* Full-screen dark map */}
      <MapboxGL.MapView
        style={StyleSheet.absoluteFillObject}
        styleURL={eyegoDarkStyle}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        rotateEnabled={false}
        scaleBarEnabled={false}
      >
        <MapboxGL.Camera
          centerCoordinate={driverCoord}
          zoomLevel={13}
          animationMode="flyTo"
          animationDuration={800}
        />
        {/* Driver position pulse */}
        <MapboxGL.MarkerView coordinate={driverCoord}>
          <DriverPulse color={statusCfg.color} />
        </MapboxGL.MarkerView>
      </MapboxGL.MapView>

      {/* Glassmorphic top header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable style={styles.headerIconBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
        </Pressable>

        <View style={styles.headerCenter}>
          <Text style={styles.headerRoute} numberOfLines={1}>
            {trip.route?.originName ?? '—'} → {trip.route?.destinationName ?? '—'}
          </Text>
          <View style={styles.statusBadge}>
            <View style={[styles.statusDot, { backgroundColor: statusCfg.color }]} />
            <Text style={[styles.statusLabel, { color: statusCfg.color }]}>{statusCfg.label}</Text>
          </View>
        </View>

        <Pressable
          style={styles.sosBtn}
          onPress={() =>
            Alert.alert(
              'Emergency SOS',
              'This will call Ghana Police (191). Are you in immediate danger?',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Call 191', style: 'destructive', onPress: () => Linking.openURL('tel:191') },
              ],
            )
          }
        >
          <Text style={styles.sosBtnText}>SOS</Text>
        </Pressable>
      </View>

      {/* Draggable bottom sheet */}
      <BottomSheet
        ref={bottomSheetRef}
        index={1}
        snapPoints={snapPoints}
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.sheetHandle}
        enablePanDownToClose={false}
      >
        <BottomSheetScrollView
          contentContainerStyle={styles.sheetContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Route summary */}
          <View style={styles.routeSummary}>
            <View style={styles.routeDot} />
            <Text variant="titleSmall" style={{ flex: 1 }} numberOfLines={1}>
              {trip.route?.originName ?? '—'}
            </Text>
          </View>
          <View style={styles.routeLine} />
          <View style={[styles.routeSummary, { marginBottom: spacing.xl }]}>
            <View style={[styles.routeDot, { backgroundColor: colors.secondary ?? '#7DD8F5', borderRadius: 3 }]} />
            <Text variant="titleSmall" style={{ flex: 1 }} numberOfLines={1}>
              {trip.route?.destinationName ?? '—'}
            </Text>
            <View style={styles.tripMeta}>
              <Text variant="caption" color={colors.onSurfaceVariant}>
                {trip.departureTime
                  ? new Date(trip.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : '--:--'}{' '}
                · {passengers}/{total} seats
              </Text>
            </View>
          </View>

          {/* Step progress chips */}
          <View style={styles.stepsRow}>
            {STATUS_STEPS.slice(0, -1).map((step, i) => {
              const cfg = TRIP_STATUS_CONFIG[step];
              const isDone = i < currentStepIndex;
              const isCurrent = i === currentStepIndex;
              return (
                <React.Fragment key={step}>
                  <View style={[
                    styles.stepChip,
                    isDone && { backgroundColor: colors.primary + '22', borderColor: colors.primary + '55' },
                    isCurrent && { backgroundColor: cfg.color + '22', borderColor: cfg.color + '66' },
                  ]}>
                    {isDone
                      ? <Ionicons name="checkmark" size={9} color={colors.primary} />
                      : <View style={[styles.stepDot, { backgroundColor: isCurrent ? cfg.color : colors.outlineVariant }]} />}
                    <Text style={[
                      styles.stepLabel,
                      isDone && { color: colors.primary },
                      isCurrent && { color: cfg.color },
                    ]}>
                      {cfg.label}
                    </Text>
                  </View>
                  {i < STATUS_STEPS.length - 2 && (
                    <View style={[styles.stepConnector, i < currentStepIndex && { backgroundColor: colors.primary }]} />
                  )}
                </React.Fragment>
              );
            })}
          </View>

          {/* Seat map */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Seat Map</Text>
              <Text variant="bodySmall" color={colors.onSurfaceVariant}>{passengers}/{total} booked</Text>
            </View>
            <SeatMap
              seats={seats}
              totalSeats={total}
              onSeatPress={(seat) => {
                const name = seat.userName ?? 'Passenger';
                Alert.alert(
                  `Seat ${seat.seatNumber} · ${name}`,
                  'What would you like to do?',
                  [
                    {
                      text: 'Message',
                      onPress: () =>
                        router.push({
                          pathname: '/(trip)/chat/[id]',
                          params: {
                            id,
                            seatNumber: String(seat.seatNumber),
                            recipientId: seat.userId ?? '',
                            riderName: encodeURIComponent(name),
                          },
                        } as any),
                    },
                    {
                      text: 'Mark Boarded',
                      onPress: () => {
                        if (!seat.bookingId) return;
                        driverApi.boardPassenger(id, seat.bookingId)
                          .then(() => qc.invalidateQueries({ queryKey: ['driver', 'trip', id] }))
                          .catch((err: any) => Alert.alert('Error', err?.response?.data?.message ?? 'Failed'));
                      },
                    },
                    { text: 'Cancel', style: 'cancel' },
                  ],
                );
              }}
            />
            <View style={styles.legend}>
              {[
                { color: colors.primary, label: 'Boarded' },
                { color: `${colors.primary}55`, label: 'Reserved' },
                { color: colors.surfaceContainerHighest, label: 'Empty' },
              ].map(({ color, label }) => (
                <View key={label} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: color }]} />
                  <Text variant="caption" color={colors.onSurfaceVariant}>{label}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Earnings card */}
          <View style={[styles.card, { borderColor: colors.primary + '35' }]}>
            <Text style={styles.earningsTitle}>Earnings Estimate</Text>
            <View style={styles.earningsRow}>
              <Text variant="bodySmall" color={colors.onSurfaceVariant}>Gross ({passengers} seats)</Text>
              <Text variant="bodyMedium">GHS {grossEarnings.toFixed(2)}</Text>
            </View>
            <View style={styles.earningsRow}>
              <Text variant="bodySmall" color={colors.onSurfaceVariant}>Platform fee (30%)</Text>
              <Text variant="bodyMedium" color={colors.error}>− GHS {platformFee.toFixed(2)}</Text>
            </View>
            <View style={[styles.earningsRow, styles.earningsNet]}>
              <Text variant="label">Your earnings</Text>
              <Text style={styles.earningsNetValue}>GHS {netEarnings.toFixed(2)}</Text>
            </View>
          </View>

          {/* Quick-action row */}
          <View style={styles.actionRow}>
            <QuickAction
              icon="navigate-outline"
              label="Navigate"
              color={colors.primary}
              onPress={() => {
                const destLat = trip.route?.destLat;
                const destLng = trip.route?.destLng;
                const label   = encodeURIComponent(trip.route?.destinationName ?? 'Destination');
                if (!destLat || !destLng) { Alert.alert('No destination', 'Destination coordinates are not available.'); return; }
                const url = Platform.OS === 'ios'
                  ? `maps://?ll=${destLat},${destLng}&q=${label}`
                  : `google.navigation:q=${destLat},${destLng}`;
                Linking.openURL(url).catch(() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLng}`));
              }}
              colors={colors}
            />
            <QuickAction
              icon="person-add-outline"
              label="Add Rider"
              color={colors.primary}
              onPress={() => router.push({ pathname: '/(trip)/add-passenger', params: { tripId: id } })}
              colors={colors}
            />
            <QuickAction
              icon="chatbubble-outline"
              label="Chat"
              color={colors.onSurfaceVariant}
              onPress={() => router.push(`/(trip)/chat/${id}`)}
              colors={colors}
            />
            <QuickAction
              icon="map-outline"
              label="Tracking"
              color={colors.onSurfaceVariant}
              onPress={() => router.push(`/(trip)/tracking/${id}`)}
              colors={colors}
            />
          </View>

          {/* Primary CTA */}
          {statusInfo.next && (
            <Button
              label={statusInfo.action}
              onPress={() => advanceStatus.mutate()}
              loading={advanceStatus.isPending}
              disabled={advanceStatus.isPending}
            />
          )}

          {/* No Show / Cancel */}
          {!['COMPLETED', 'CANCELLED'].includes(trip.status) && (
            <View style={styles.dangerRow}>
              <Pressable
                style={[styles.dangerBtn, { borderColor: '#F59E0B66' }]}
                onPress={() =>
                  Alert.alert(
                    'Mark as No Show',
                    'Mark this trip as a no-show? This will cancel all bookings.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Mark No Show', style: 'destructive', onPress: () => cancelTrip.mutate() },
                    ],
                  )
                }
                disabled={cancelTrip.isPending}
              >
                <Ionicons name="eye-off-outline" size={16} color="#F59E0B" />
                <Text style={[styles.dangerBtnText, { color: '#F59E0B' }]}>No Show</Text>
              </Pressable>
              <Pressable
                style={[styles.dangerBtn, { borderColor: colors.error + '66' }]}
                onPress={handleCancel}
                disabled={cancelTrip.isPending}
              >
                <Ionicons name="close-circle-outline" size={16} color={colors.error} />
                <Text style={[styles.dangerBtnText, { color: colors.error }]}>
                  {cancelTrip.isPending ? 'Cancelling…' : 'Cancel Trip'}
                </Text>
              </Pressable>
            </View>
          )}
        </BottomSheetScrollView>
      </BottomSheet>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DriverPulse({ color }: { color: string }) {
  return (
    <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
      <MotiView
        style={{ position: 'absolute', width: 24, height: 24, borderRadius: 12, backgroundColor: color }}
        from={{ scale: 1, opacity: 0.7 }}
        animate={{ scale: 2, opacity: 0 }}
        transition={{ type: 'timing', duration: 1600, loop: true }}
      />
      <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: color, borderWidth: 2.5, borderColor: '#050508' }} />
    </View>
  );
}

function QuickAction({
  icon,
  label,
  color,
  onPress,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
  colors: DriverColors;
}) {
  return (
    <Pressable
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        backgroundColor: colors.surfaceContainer,
        borderRadius: radii.xl,
        borderWidth: 1,
        borderColor: colors.outline,
        paddingVertical: spacing.base,
      }}
      onPress={onPress}
    >
      <Ionicons name={icon} size={20} color={color} />
      <Text style={{ fontFamily: fonts.medium, fontSize: 10, color, letterSpacing: 0.2 }}>{label}</Text>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: '#050508' },
    loadingOverlay: {
      position: 'absolute',
      top: 0, left: 0, right: 0,
      padding: spacing['2xl'],
      gap: spacing.lg,
      backgroundColor: 'rgba(5,5,8,0.5)',
    },
    skeleton: {
      height: 20,
      borderRadius: 10,
      backgroundColor: colors.surfaceContainerHigh,
    },
    // Glassmorphic header
    header: {
      position: 'absolute',
      top: 0, left: 0, right: 0,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.md,
      gap: spacing.md,
      backgroundColor: 'rgba(5,5,8,0.65)',
      zIndex: 10,
    },
    headerIconBtn: {
      width: 38,
      height: 38,
      borderRadius: radii.lg,
      backgroundColor: 'rgba(255,255,255,0.08)',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.12)',
    },
    headerCenter: {
      flex: 1,
      gap: 2,
    },
    headerRoute: {
      fontFamily: fonts.displaySemiBold,
      fontSize: fontSizes.titleSmall,
      color: colors.onSurface,
    },
    statusBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      alignSelf: 'flex-start',
    },
    statusDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    statusLabel: {
      fontFamily: fonts.semiBold,
      fontSize: 11,
      letterSpacing: 0.3,
    },
    sosBtn: {
      backgroundColor: '#EF4444',
      borderRadius: radii.md,
      width: 44,
      height: 38,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sosBtnText: {
      fontFamily: fonts.displayBold,
      fontSize: 11,
      color: '#fff',
      letterSpacing: 0.5,
    },
    // Bottom sheet
    sheetBackground: {
      backgroundColor: 'rgba(9,14,9,0.96)',
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
      paddingBottom: 40,
      gap: spacing.lg,
    },
    // Route summary
    routeSummary: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    routeDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: '#4be277',
      flexShrink: 0,
    },
    routeLine: {
      width: 1,
      height: 16,
      backgroundColor: colors.outline,
      marginLeft: 5,
      marginVertical: 2,
    },
    tripMeta: {},
    // Step progress
    stepsRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    stepChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      borderRadius: radii.full,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      paddingHorizontal: 7,
      paddingVertical: 4,
    },
    stepDot: {
      width: 5,
      height: 5,
      borderRadius: 3,
    },
    stepLabel: {
      fontFamily: fonts.medium,
      fontSize: 9,
      color: colors.onSurfaceVariant,
      letterSpacing: 0.1,
    },
    stepConnector: {
      flex: 1,
      height: 1,
      backgroundColor: colors.outlineVariant,
      marginHorizontal: 2,
    },
    // Cards
    card: {
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii['2xl'],
      borderWidth: 1,
      borderColor: colors.outline,
      padding: spacing.xl,
    },
    cardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.lg,
    },
    cardTitle: {
      fontFamily: fonts.displaySemiBold,
      fontSize: fontSizes.titleSmall,
      color: colors.onSurface,
    },
    legend: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: spacing.xl,
      marginTop: spacing.lg,
    },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    legendDot: { width: 10, height: 10, borderRadius: 3 },
    // Earnings
    earningsTitle: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodySmall,
      color: '#4be277',
      letterSpacing: 0.5,
      marginBottom: spacing.sm,
    },
    earningsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    earningsNet: {
      borderTopWidth: 1,
      borderTopColor: colors.outlineVariant,
      paddingTop: spacing.sm,
      marginTop: spacing.xs,
    },
    earningsNetValue: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.titleMedium,
      color: '#4be277',
    },
    // Quick actions
    actionRow: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    // Danger row
    dangerRow: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    dangerBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      borderWidth: 1,
      paddingVertical: spacing.md,
    },
    dangerBtnText: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodySmall,
    },
  });
