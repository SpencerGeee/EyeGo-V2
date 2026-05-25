import React, { useMemo, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MotiView } from 'moti';
import * as KeepAwake from 'expo-keep-awake';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { driverApi, driverSocketEvents, connectDriverSocket, disconnectDriverSocket } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../../utils/useColors';
import { useDriverStore } from '../../../stores/driver.store';
import { useNotificationsStore } from '../../../stores/notifications.store';
import { useDriverSocket } from '../../../hooks/useDriverSocket';
import { useDriverLocation } from '../../../hooks/useDriverLocation';
import { SeatMap } from '../../../components/SeatMap';

const STATUS_FLOW: Record<string, { label: string; next: string | null; action: string }> = {
  SCHEDULED:       { label: 'Scheduled',         next: 'start',  action: 'Start Trip'   },
  FILLING:         { label: 'Boarding Open',      next: 'start',  action: 'Start Trip'   },
  DRIVER_EN_ROUTE: { label: 'En Route to Stop',   next: 'depart', action: 'Depart Now'   },
  IN_PROGRESS:     { label: 'In Progress',        next: 'arrive', action: 'Mark Arrived' },
  COMPLETED:       { label: 'Completed',          next: null,     action: ''             },
  CANCELLED:       { label: 'Cancelled',          next: null,     action: ''             },
};

export default function ActiveTripScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { setActiveTripId } = useDriverStore();
  const { addNotification } = useNotificationsStore();

  const { data: trip, isLoading } = useQuery({
    queryKey: ['driver', 'trip', id],
    queryFn: () => driverApi.getActiveTrip(),
    select: (r) => r.data.data?.trip ?? null,
    refetchInterval: 8000,
  });

  const isActiveTrip = !!trip && !['COMPLETED', 'CANCELLED'].includes(trip.status);

  // Keep screen on while the trip is running; release once it ends
  useEffect(() => {
    if (isActiveTrip) {
      KeepAwake.activateKeepAwake();
    } else {
      KeepAwake.deactivateKeepAwake();
    }
    return () => { KeepAwake.deactivateKeepAwake(); };
  }, [isActiveTrip]);

  useDriverSocket({ tripId: id, enabled: !!trip });

  // Live location — broadcast to passenger sockets every 4s while trip is active
  const { location } = useDriverLocation({ enabled: isActiveTrip });
  const locationRef = useRef(location);
  useEffect(() => { locationRef.current = location; }, [location]);

  useEffect(() => {
    if (!trip) return;
    if (['COMPLETED', 'CANCELLED'].includes(trip.status)) return;

    connectDriverSocket();
    
    const unsubPayment = driverSocketEvents.onPaymentConfirmed((data) => {
      if (data.tripId === id) {
        addNotification({
          type: 'PAYMENT_CONFIRMED',
          title: 'Payment Confirmed',
          body: 'A passenger just completed their payment.',
          tripId: id,
        });
        Alert.alert('Payment Confirmed', 'A passenger just completed their payment.');
        qc.invalidateQueries({ queryKey: ['driver', 'trip', id] });
      }
    });

    const unsubSeat = driverSocketEvents.onSeatUpdate((data) => {
      if (data.tripId === id) {
        qc.invalidateQueries({ queryKey: ['driver', 'trip', id] });
      }
    });

    const interval = setInterval(() => {
      const loc = locationRef.current;
      if (loc) {
        driverSocketEvents.emitLocation({ 
          lat: loc.latitude, 
          lng: loc.longitude,
          heading: loc.heading ?? 0,
          speed: loc.speed ?? 0
        });
      }
    }, 4000);

    return () => {
      clearInterval(interval);
      unsubPayment();
      unsubSeat();
      disconnectDriverSocket();
    };
  }, [trip?.status]);

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

  // Capture the current status at the moment the mutation fires so onSuccess
  // knows what transition happened even if trip data has changed by then.
  const pendingFromStatus = useRef<string | null>(null);

  const advanceStatus = useMutation({
    mutationFn: async () => {
      const status = trip?.status;
      pendingFromStatus.current = status ?? null;
      if (status === 'SCHEDULED' || status === 'FILLING') return driverApi.startTrip(id);
      if (status === 'DRIVER_EN_ROUTE') return driverApi.departTrip(id);
      if (status === 'IN_PROGRESS') return driverApi.arriveTrip(id);
      throw new Error('Cannot advance from current status');
    },
    onSuccess: (res) => {
      const fromStatus = pendingFromStatus.current;

      // Derive what we transitioned TO — never parse from response shape
      // because arriveTrip returns earnings/wallet data, not a trip object.
      let toStatus: string | null = null;
      if (fromStatus === 'SCHEDULED' || fromStatus === 'FILLING') toStatus = 'DRIVER_EN_ROUTE';
      else if (fromStatus === 'DRIVER_EN_ROUTE') toStatus = 'IN_PROGRESS';
      else if (fromStatus === 'IN_PROGRESS') toStatus = 'COMPLETED';

      // Emit matching socket event so rider tracking updates in real time
      if (toStatus === 'DRIVER_EN_ROUTE') {
        driverSocketEvents.emitTripStarted(id);
        addNotification({ type: 'DRIVER_EN_ROUTE', title: 'Trip started', body: 'You are now en route to the pickup stop.', tripId: id });
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
        const raw = (res as any)?.data;
        const earningsThisTrip = raw?.data?.earningsThisTrip ?? raw?.data?.totalEarnings ?? 0;
        addNotification({
          type: 'COMPLETED',
          title: 'Trip completed!',
          body: `You earned GHS ${Number(earningsThisTrip).toFixed(2)} from this trip.`,
          tripId: id,
        });
        router.replace({ pathname: '/(trip)/complete/[id]', params: { id, earnings: String(earningsThisTrip) } } as any);
        return;
      }

      qc.invalidateQueries({ queryKey: ['driver', 'trip', id] });
      qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
    },
    onError: (err) => Alert.alert('Error', (err as Error).message),
  });

  if (isLoading || !trip) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loadingContainer}>
          {[80, 160, 120].map((w, i) => (
            <MotiView
              key={i}
              from={{ opacity: 0.3 }}
              animate={{ opacity: 0.7 }}
              transition={{ type: 'timing', duration: 800, loop: true, delay: i * 150 }}
              style={[styles.skeleton, { width: w }]}
            />
          ))}
        </View>
      </SafeAreaView>
    );
  }

  const statusInfo = STATUS_FLOW[trip.status] ?? STATUS_FLOW.FILLING;
  const rawBookings: any[] = (trip as any).bookings ?? [];
  const total = (trip as any).maxSeats ?? 14;
  const fare = (trip as any).farePerSeat ?? 0;
  const activeBookings = rawBookings.filter((b) => b.status !== 'CANCELLED');
  const passengers = activeBookings.length;

  // Earnings breakdown
  const grossEarnings = activeBookings.reduce((sum: number, b: any) => sum + (parseFloat(b.fareAmount) || fare), 0);
  const platformFee = activeBookings.reduce((sum: number, b: any) => {
    const commission = parseFloat(b.commissionAmount);
    return sum + (isNaN(commission) ? (parseFloat(b.fareAmount) || fare) * 0.15 : commission);
  }, 0);
  const netEarnings = Math.max(0, grossEarnings - platformFee);
  const boarded = activeBookings.filter((b) => b.status === 'BOARDED').length;
  const seats = activeBookings.map((b) => ({
    seatNumber: b.seatNumber,
    status: (b.status === 'BOARDED' ? 'BOARDED' : 'BOOKED') as 'BOARDED' | 'BOOKED' | 'EMPTY',
  }));

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerRoute} numberOfLines={1}>
            {trip.route?.originName ?? '—'} → {trip.route?.destinationName ?? '—'}
          </Text>
        </View>
        <TripStatusBadge status={trip.status} colors={colors} />
        <TouchableOpacity
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
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Seat map */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 80 }}
          style={styles.seatMapCard}
        >
          <View style={styles.seatMapHeader}>
            <Text style={styles.seatMapTitle}>Seats</Text>
            <Text variant="bodyMedium" color={colors.onSurfaceVariant}>
              {passengers}/{total} booked
            </Text>
          </View>
          <SeatMap seats={seats} totalSeats={total} />
          {/* Legend */}
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
        </MotiView>

        {/* Trip info */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 130 }}
          style={styles.infoCard}
        >
          <InfoRow icon="time-outline" label="Departure" value={new Date(trip.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} colors={colors} />
          <View style={styles.infoDivider} />
          <InfoRow icon="cash-outline" label="Fare/seat" value={`GHS ${fare.toFixed(2)}`} colors={colors} />
          <View style={styles.infoDivider} />
          <InfoRow icon="people-outline" label="Passengers" value={`${passengers} / ${total}`} colors={colors} />
        </MotiView>

        {/* Earnings breakdown */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 155 }}
          style={styles.earningsCard}
        >
          <Text style={styles.earningsTitle}>Earnings Estimate</Text>
          <View style={styles.earningsRow}>
            <Text variant="bodySmall" color={colors.onSurfaceVariant}>Gross ({passengers} seats)</Text>
            <Text variant="bodyMedium" color={colors.onSurface}>GHS {grossEarnings.toFixed(2)}</Text>
          </View>
          <View style={styles.earningsRow}>
            <Text variant="bodySmall" color={colors.onSurfaceVariant}>Platform fee</Text>
            <Text variant="bodyMedium" color={colors.error}>− GHS {platformFee.toFixed(2)}</Text>
          </View>
          <View style={[styles.earningsRow, styles.earningsNet]}>
            <Text variant="label" color={colors.onSurface}>Your earnings</Text>
            <Text style={styles.earningsNetValue}>GHS {netEarnings.toFixed(2)}</Text>
          </View>
        </MotiView>

        {/* Action button */}
        {statusInfo.next && (
          <MotiView
            from={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 170 }}
            style={styles.actionWrapper}
          >
            <Button
              label={statusInfo.action}
              onPress={() => advanceStatus.mutate()}
              loading={advanceStatus.isPending}
              disabled={advanceStatus.isPending}
            />
          </MotiView>
        )}

        {/* Add passenger + chat + navigate */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 200 }}
          style={styles.secondaryActions}
        >
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => router.push({ pathname: '/(trip)/add-passenger', params: { tripId: id } })}
            activeOpacity={0.8}
          >
            <Ionicons name="person-add-outline" size={18} color={colors.primary} />
            <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>Add Passenger</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => {
              const destLat = (trip as any).route?.destLat;
              const destLng = (trip as any).route?.destLng;
              const label   = encodeURIComponent((trip as any).route?.destinationName ?? 'Destination');
              if (!destLat || !destLng) {
                Alert.alert('No destination', 'Destination coordinates are not available.');
                return;
              }
              const url = Platform.OS === 'ios'
                ? `maps://?ll=${destLat},${destLng}&q=${label}`
                : `google.navigation:q=${destLat},${destLng}`;
              Linking.openURL(url).catch(() =>
                Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLng}`)
              );
            }}
            activeOpacity={0.8}
          >
            <Ionicons name="navigate-outline" size={18} color={colors.primary} />
            <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>Navigate</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => router.push(`/(trip)/chat/${id}`)}
            activeOpacity={0.8}
          >
            <Ionicons name="chatbubble-outline" size={18} color={colors.onSurfaceVariant} />
            <Text style={[styles.secondaryBtnText, { color: colors.onSurfaceVariant }]}>Chat</Text>
          </TouchableOpacity>
        </MotiView>

        {/* Cancel trip */}
        {!['COMPLETED', 'CANCELLED'].includes(trip.status) && (
          <MotiView
            from={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 230 }}
          >
            <TouchableOpacity
              style={[styles.secondaryBtn, { borderColor: colors.error + '66' }]}
              onPress={handleCancel}
              disabled={cancelTrip.isPending}
              activeOpacity={0.8}
            >
              <Ionicons name="close-circle-outline" size={18} color={colors.error} />
              <Text style={[styles.secondaryBtnText, { color: colors.error }]}>
                {cancelTrip.isPending ? 'Cancelling…' : 'Cancel Trip'}
              </Text>
            </TouchableOpacity>
          </MotiView>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const TRIP_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  SCHEDULED:       { label: 'Scheduled',  color: '#94A3B8' },
  FILLING:         { label: 'Boarding',   color: '#3B82F6' },
  DRIVER_EN_ROUTE: { label: 'En Route',   color: '#F59E0B' },
  IN_PROGRESS:     { label: 'In Progress', color: '#22C55E' },
  COMPLETED:       { label: 'Completed',  color: '#60A5FA' },
  CANCELLED:       { label: 'Cancelled',  color: '#F87171' },
};

function TripStatusBadge({ status, colors }: { status: string; colors: DriverColors }) {
  const cfg = TRIP_STATUS_CONFIG[status] ?? { label: status, color: colors.onSurfaceVariant };
  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: `${cfg.color}22`,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: `${cfg.color}55`,
      paddingHorizontal: 10,
      paddingVertical: 4,
    }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: cfg.color }} />
      <Text style={{ fontFamily: fonts.semiBold, fontSize: 11, color: cfg.color }}>{cfg.label}</Text>
    </View>
  );
}

function InfoRow({ icon, label, value, colors }: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  colors: DriverColors;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm }}>
      <Ionicons name={icon} size={18} color={colors.onSurfaceVariant} />
      <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ flex: 1 }}>{label}</Text>
      <Text style={{ fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, color: colors.onSurface }}>{value}</Text>
    </View>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    loadingContainer: {
      padding: spacing['2xl'],
      gap: spacing.lg,
    },
    skeleton: {
      height: 20,
      borderRadius: 10,
      backgroundColor: colors.surfaceContainerHigh,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.xl,
      paddingBottom: spacing.md,
      gap: spacing.md,
    },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 12,
      backgroundColor: colors.surfaceContainer,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerInfo: { flex: 1 },
    headerRoute: {
      fontFamily: fonts.displaySemiBold,
      fontSize: fontSizes.titleSmall,
      color: colors.onSurface,
    },
    scroll: {
      paddingHorizontal: spacing['2xl'],
      paddingBottom: 100,
      gap: spacing.lg,
    },
    seatMapCard: {
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii['2xl'],
      borderWidth: 1,
      borderColor: colors.outline,
      padding: spacing.xl,
    },
    seatMapHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.lg,
    },
    seatMapTitle: {
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
    infoCard: {
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outline,
      paddingHorizontal: spacing.xl,
    },
    infoDivider: { height: 1, backgroundColor: colors.outlineVariant },
    earningsCard: {
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.primary + '35',
      padding: spacing.base,
      gap: spacing.sm,
    },
    earningsTitle: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodySmall,
      color: colors.primary,
      letterSpacing: 0.5,
      marginBottom: spacing.xs,
    },
    earningsRow: {
      flexDirection: 'row' as const,
      justifyContent: 'space-between' as const,
      alignItems: 'center' as const,
    },
    earningsNet: {
      borderTopWidth: 1,
      borderTopColor: colors.outlineVariant,
      paddingTop: spacing.sm,
      marginTop: spacing.xs,
    },
    earningsNetValue: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.titleSmall,
      color: colors.primary,
    },
    sosBtn: {
      backgroundColor: colors.error,
      borderRadius: radii.lg,
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sosBtnText: { fontFamily: fonts.displayBold, fontSize: 11, color: '#fff', letterSpacing: 0.5 },
    actionWrapper: {},
    secondaryActions: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    secondaryBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outline,
      paddingVertical: spacing.base,
    },
    secondaryBtnText: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyMedium,
    },
  });
