'use strict';
import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { formatGhs } from '@eyego/utils';
import {
  View,
  StyleSheet,
  Pressable,
  Alert,
  Linking,
  Modal,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import * as KeepAwake from 'expo-keep-awake';
import * as Location from 'expo-location';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { driverApi, driverSocketEvents } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Skeleton, Entrance, GlassSurface, GradientGlowBorder, InlayPanel, SwipeToConfirm } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../../utils/useColors';
import { useDriverStore } from '../../../stores/driver.store';
import { useNotificationsStore } from '../../../stores/notifications.store';
import { useDriverSocket } from '../../../hooks/useDriverSocket';
import { useDriverLocation } from '../../../hooks/useDriverLocation';
import { SeatMap } from '../../../components/SeatMap';
import { offlineQueue } from '../../../utils/offlineQueue';
import { openExternalNavigation } from '../../../utils/externalNav';
// The ONE map in the driver trip flow. It owns the MapView, the map style, the
// camera state machine and the server's route geometry, so nothing map-shaped is
// imported here any more.
import { DriverTripMap } from '../../../components/trip/DriverTripMap';

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_FLOW: Record<string, { label: string; next: string | null; action: string }> = {
  // "Start Trip" is a SCHEDULED-ride concept only: the driver committed to a
  // trip earlier and taps it when they actually set off. An on-demand ride is
  // different — accepting the dispatch *is* setting off, so those trips are
  // created straight at DRIVER_EN_ROUTE server-side (trip-request.service.js)
  // and never surface a Start Trip button at all.
  //
  // CONFIRMED still reaches here for a scheduled trip whose bookings got paid
  // (payments.service.js promotes SCHEDULED → CONFIRMED), so it keeps the same
  // treatment as SCHEDULED/FILLING. Without an entry it fell through to a
  // fallback whose action VALID_ADVANCE_STATUSES didn't accept, throwing
  // "Cannot advance from status: CONFIRMED" client-side.
  CONFIRMED:          { label: 'Confirmed',            next: 'start',  action: 'Start Trip'    },
  SCHEDULED:          { label: 'Scheduled',           next: 'start',  action: 'Start Trip'    },
  FILLING:            { label: 'Boarding Open',        next: 'start',  action: 'Start Trip'    },
  DRIVER_EN_ROUTE:    { label: 'Heading to Pickup',    next: 'arrive', action: "I've Arrived"  },
  // Not "Start Trip" — the trip is long since started by this point; this is
  // the passenger-is-aboard, pulling-off action. Two buttons reading "Start
  // Trip" at different points in one flow is exactly what made this confusing.
  ARRIVED_AT_PICKUP:  { label: 'Arrived at Pickup',    next: 'depart', action: 'Start Ride'    },
  IN_PROGRESS:        { label: 'In Progress',          next: 'arrive', action: 'Mark Arrived'  },
  COMPLETED:          { label: 'Completed',            next: null,     action: ''              },
  CANCELLED:          { label: 'Cancelled',            next: null,     action: ''              },
};

const TRIP_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  CONFIRMED:          { label: 'Confirmed',         color: '#94A3B8' },
  SCHEDULED:          { label: 'Scheduled',        color: '#94A3B8' },
  FILLING:            { label: 'Boarding',          color: '#3B82F6' },
  DRIVER_EN_ROUTE:    { label: 'En Route',          color: '#F59E0B' },
  ARRIVED_AT_PICKUP:  { label: 'Arrived',           color: '#A78BFA' },
  IN_PROGRESS:        { label: 'In Progress',       color: '#4be277' },
  COMPLETED:          { label: 'Completed',         color: '#60A5FA' },
  CANCELLED:          { label: 'Cancelled',         color: '#F87171' },
};

const STATUS_STEPS = ['SCHEDULED', 'FILLING', 'DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'IN_PROGRESS', 'COMPLETED'];

// The route line, the route COLOURS (amber core over a deep-brown casing —
// the driver map style paints its roads blue, so a blue line disappeared into
// them) and the road geometry all live in DriverTripMap now.
//
// What was here: a local `useRoadRoute` hook calling Directions from the
// driver's own position, plus an identical copy in tracking/[id].tsx. Two
// screens fetching independently meant one ride could be drawn as two different
// lines, and — because the target was the trip's FINAL destination in every
// phase — the pickup-phase line and ETA described a journey the driver was not
// yet making. The server owns the leg now (route-geometry.service.js).

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function ActiveTripScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const qc = useQueryClient();
  const { setActiveTripId } = useDriverStore();
  const { addNotification } = useNotificationsStore();
  const [showPaymentQr, setShowPaymentQr] = useState(false);

  const { data: trip, isLoading } = useQuery({
    queryKey: ['driver', 'trip', 'active', id],
    // getTripById(id) — not getActiveTrip(), which is a findFirst that can
    // return the WRONG trip if the driver has more than one active trip.
    queryFn: () => driverApi.getTripById(id!),
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

  // The puck's bearing is derived inside the shared interpolator now
  // (packages/maps/src/puck.ts) — same rule as before (GPS course while moving,
  // last known heading while stopped, compass only as a cold-start hint) but
  // applied identically on both trip screens and in the rider app, instead of
  // being re-derived per screen with slightly different thresholds.

  // ETA for the leg the driver is ACTUALLY on, straight from the server. This
  // screen previously showed no ETA at all — the only number on it was the
  // scheduled departure time, which says nothing once a trip is moving.
  const [eta, setEta] = useState<string | null>(null);
  const handleEta = useCallback(
    (next: { leg: 'toPickup' | 'toDropoff'; minutes: number; distanceKm: number | null; rerouted: boolean }) => {
      const where = next.leg === 'toPickup' ? 'to pickup' : 'to drop-off';
      const dist = next.distanceKm != null ? ` · ${next.distanceKm} km` : '';
      setEta(`${Math.max(1, Math.round(next.minutes))} min ${where}${dist}`);
    },
    [],
  );

  useEffect(() => {
    if (!trip) return;
    if (['COMPLETED', 'CANCELLED'].includes(trip.status)) return;

    const unsubPayment = driverSocketEvents.onPaymentConfirmed((data) => {
      if (data.tripId === id) {
        addNotification({ type: 'PAYMENT_CONFIRMED', title: 'Payment Confirmed', body: 'A passenger just completed their payment.', tripId: id });
        Alert.alert('Payment Confirmed', 'A passenger just completed their payment.');
        qc.invalidateQueries({ queryKey: ['driver', 'trip', 'active', id] });
      }
    });

    const unsubSeat = driverSocketEvents.onSeatUpdate((data) => {
      if (data.tripId === id) qc.invalidateQueries({ queryKey: ['driver', 'trip', 'active', id] });
    });

    return () => { unsubPayment(); unsubSeat(); };
  }, [trip?.status, id, qc, addNotification]);

  // Route to the dedicated cancel screen (reason picker + note + penalty
  // warning) instead of a bare confirm Alert with no reason capture.
  const handleCancel = () => router.push(`/(trip)/cancel/${id}` as Href);

  // Dedicated no-show endpoint — not cancelTrip. It guards to pre-departure
  // states only, issues no-show-labeled refunds, and sends riders the
  // correct "driver no-show" push copy instead of a generic cancellation one.
  const noShowTrip = useMutation({
    mutationFn: () => driverApi.driverNoShow(id),
    onSuccess: () => {
      setActiveTripId(null);
      qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
      qc.invalidateQueries({ queryKey: ['driver', 'trips', 'all'] });
      router.replace('/(tabs)/home');
    },
    onError: (err: any) => Alert.alert('Error', err?.response?.data?.message ?? (err as Error).message),
  });

  const pendingFromStatus = useRef<string | null>(null);

  /**
   * A brief, explicit "that worked" on the swipe control itself.
   *
   * The status chip at the top of the screen was the ONLY evidence a transition
   * had landed, and the driver had to go looking for it — the swipe simply
   * sprang back, which is the same thing it does when nothing happened. Naming
   * the state the trip has just reached means the driver never has to guess
   * whether to swipe again (and swiping again is what earns a 409).
   */
  const [confirmedLabel, setConfirmedLabel] = useState<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashConfirmed = useCallback((text: string) => {
    setConfirmedLabel(text);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirmedLabel(null), 1500);
  }, []);
  useEffect(
    () => () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    },
    [],
  );
  // CONFIRMED included: it's the status a trip has immediately after a driver
  // accepts (acceptDispatch/acceptTripRequest both set status: 'CONFIRMED'),
  // including on a resumed trip reopened from the home screen's "Resume Trip"
  // banner. Without it, "Start Trip" on a CONFIRMED trip threw client-side
  // instead of ever calling the backend.
  const VALID_ADVANCE_STATUSES = ['CONFIRMED', 'SCHEDULED', 'FILLING', 'DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'IN_PROGRESS'];

  const advanceStatus = useMutation({
    /*
     * NO RETRY. A status transition is not idempotent: the server applies it
     * through the state machine under a version compare-and-swap, so replaying
     * one that already landed is rejected.
     *
     * BUGFIX ("i swipe to say i've arrived and it gives me request failed with
     * status code 409"). With `retry: 1`, a first attempt that actually
     * SUCCEEDED but whose response was slow or lost — routine on a driver's
     * phone — was retried, and the retry asked the server to move from a
     * status the trip had already left. `DRIVER_EN_ROUTE → ARRIVED_AT_PICKUP`
     * is legal exactly once; the second call is a conflict, and the driver was
     * shown a raw axios message for an action that had worked.
     */
    retry: 0,
    mutationFn: async () => {
      const status = trip?.status;
      if (!status || !VALID_ADVANCE_STATUSES.includes(status)) throw new Error(`Cannot advance from status: ${status ?? 'unknown'}`);
      pendingFromStatus.current = status;
      if (status === 'CONFIRMED' || status === 'SCHEDULED' || status === 'FILLING') return driverApi.startTrip(id);
      if (status === 'DRIVER_EN_ROUTE') return driverApi.arriveAtPickup(id);
      if (status === 'ARRIVED_AT_PICKUP') return driverApi.departTrip(id);
      if (status === 'IN_PROGRESS') return driverApi.arriveTrip(id);
      throw new Error('Cannot advance from current status');
    },
    onSuccess: (res) => {
      const fromStatus = pendingFromStatus.current;
      let toStatus: string | null = null;
      if (fromStatus === 'CONFIRMED' || fromStatus === 'SCHEDULED' || fromStatus === 'FILLING') toStatus = 'DRIVER_EN_ROUTE';
      else if (fromStatus === 'DRIVER_EN_ROUTE') toStatus = 'ARRIVED_AT_PICKUP';
      else if (fromStatus === 'ARRIVED_AT_PICKUP') toStatus = 'IN_PROGRESS';
      else if (fromStatus === 'IN_PROGRESS') toStatus = 'COMPLETED';

      /*
       * NOTE: these no longer announce the status to the server.
       *
       * The `driverApi.*` call above already performed the transition through
       * the state machine, and the server fans the result out itself — the
       * rider's `trip:event`, their push, their Live Activity. Emitting a
       * socket event here as well made the CLIENT the announcer of a fact the
       * server already owned, which is how a rider could be told a status the
       * trip had not actually reached. `emitTripStarted` survives only to join
       * the trip room for chat.
       */
      if (toStatus === 'DRIVER_EN_ROUTE') {
        driverSocketEvents.emitTripStarted(id);
        addNotification({ type: 'DRIVER_EN_ROUTE', title: 'Trip started', body: 'You are now en route to the pickup stop.', tripId: id });
        qc.invalidateQueries({ queryKey: ['driver', 'trip', 'active', id] });
        qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
        // Redirect driver to the live tracking screen
        router.replace({ pathname: '/(trip)/tracking/[id]', params: { id } } as Href);
        return;
      }
      if (toStatus === 'ARRIVED_AT_PICKUP') {
        flashConfirmed('Marked as arrived');
        addNotification({ type: 'ARRIVED_AT_PICKUP', title: 'Arrived at pickup', body: 'You have arrived at the pickup stop.', tripId: id });
      }
      if (toStatus === 'IN_PROGRESS') {
        flashConfirmed('Trip started');
        addNotification({ type: 'IN_PROGRESS', title: 'Trip in progress', body: 'You have departed. Ride is underway.', tripId: id });
      }

      if (toStatus === 'COMPLETED') {
        setActiveTripId(null);
        qc.invalidateQueries({ queryKey: ['driver', 'trip', 'active', id] });
        qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
        qc.invalidateQueries({ queryKey: ['driver', 'trips', 'all'] });
        qc.invalidateQueries({ queryKey: ['driver', 'me'] });
        qc.invalidateQueries({ queryKey: ['driver', 'quests'] });
        // Refresh wallet balance + transaction list so home/earnings show the
        // new trip earnings immediately instead of a stale balance.
        qc.invalidateQueries({ queryKey: ['driver', 'wallet'] });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = (res as any)?.data;
        const earningsThisTrip = raw?.data?.earningsThisTrip ?? raw?.data?.totalEarningsPesewas ?? 0;
        const safeEarnings = (typeof earningsThisTrip === 'number' && !isNaN(earningsThisTrip)) ? earningsThisTrip : 0;
        addNotification({ type: 'COMPLETED', title: 'Trip completed!', body: `You earned ${formatGhs(safeEarnings)} from this trip.`, tripId: id });
        router.replace({ pathname: '/(trip)/complete/[id]', params: { id, earnings: String(safeEarnings) } } as Href);
        return;
      }

      qc.invalidateQueries({ queryKey: ['driver', 'trip', 'active', id] });
      qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
    },
    /*
     * A 409 means the trip is no longer in the status we asked to move it out
     * of — almost always because THIS driver already moved it (a double swipe,
     * a retried request, the socket applying the change first). That is not a
     * failure the driver can act on, and showing them "Request failed with
     * status code 409" for a step that has already happened is worse than
     * showing nothing: it teaches them to swipe again, which is what produced
     * the conflict in the first place.
     *
     * So: re-read the trip and let the truth decide. If the status has in fact
     * advanced, the swipe worked — resync and say so. Only a genuine failure
     * reaches the driver, and never as a raw HTTP string.
     */
    onError: async (err) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      qc.invalidateQueries({ queryKey: ['driver', 'trip', 'active', id] });
      qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
      if (status === 409) {
        addNotification({
          type: 'DRIVER_EN_ROUTE',
          title: 'Already updated',
          body: 'This step had already gone through — your trip status is up to date.',
          tripId: id,
        });
        return;
      }
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err as Error).message ??
        'Please try again.';
      Alert.alert("Couldn't update the trip", message);
    },
  });

  // BUGFIX: pickup/dest markers used to silently collapse onto a hard-coded
  // Accra centre whenever trip.route lacked real coordinates, rendering a fake
  // pickup/destination pin on the driver's own map. An active trip's route
  // should always carry real coordinates (route creation requires successful
  // geocoding), but stay null instead of fabricating one if it somehow doesn't —
  // every consumer then renders nothing rather than a plausible lie.
  const pickupCoord: [number, number] | null = typeof trip?.route?.originLat === 'number' && typeof trip?.route?.originLng === 'number'
    ? [trip.route.originLng, trip.route.originLat]
    : null;
  const destCoord: [number, number] | null = typeof trip?.route?.destLat === 'number' && typeof trip?.route?.destLng === 'number'
    ? [trip.route.destLng, trip.route.destLat]
    : pickupCoord;

  // What the external-navigation hand-off should aim at: the same phase rule as
  // the route line above, so tapping Navigate never contradicts the line the
  // driver is already following.
  const externalNavTarget = useCallback(() => {
    const inProgress = trip?.status === 'IN_PROGRESS' || trip?.status === 'COMPLETED';
    const coord = (inProgress ? destCoord : pickupCoord) ?? destCoord ?? pickupCoord;
    return {
      latitude: coord ? coord[1] : NaN,
      longitude: coord ? coord[0] : NaN,
      label: inProgress
        ? (trip?.route?.destinationName ?? 'Destination')
        : (trip?.route?.originName ?? 'Pickup'),
    };
  }, [trip?.status, trip?.route?.destinationName, trip?.route?.originName, destCoord, pickupCoord]);

  // ─── Loading skeleton ────────────────────────────────────────────────────

  if (isLoading || !trip) {
    return (
      <View style={styles.safe}>
        {/* A flat backdrop, not a MapView. This used to mount a whole second
            interactive map purely as skeleton wallpaper — a full GL surface and
            a tile fetch for something the driver looks at for under a second,
            immediately torn down and replaced by the real map below. */}
        <View style={styles.loadingBackdrop} />
        <View style={[styles.loadingOverlay, { paddingTop: insets.top + 20 }]}>
          {[120, 80, 160].map((w, i) => (
            <Skeleton key={i} width={w} height={16} borderRadius={radii.md} />
          ))}
        </View>
        {/* Escape hatch — without this, a trip that's no longer in getActiveTrip's
            result set (e.g. mid-transition) leaves the driver stuck on this skeleton
            with no way back short of force-closing the app. */}
        {!isLoading && !trip && (
          <Pressable
            onPress={() => router.replace('/(tabs)' as any)}
            hitSlop={12}
            style={[styles.backEscapeButton, { top: insets.top + 12 }]}
          >
            <Text style={{ color: '#fff', fontFamily: fonts.semiBold, fontSize: 13 }}>← Back to Home</Text>
          </Pressable>
        )}
      </View>
    );
  }

  // ─── Derived data ────────────────────────────────────────────────────────

  const statusInfo = STATUS_FLOW[trip.status] ?? STATUS_FLOW.FILLING;
  const statusCfg = TRIP_STATUS_CONFIG[trip.status] ?? { label: trip.status, color: colors.onSurfaceVariant };
  const rawBookings = trip.bookings ?? [];
  const total = trip.maxSeats ?? 14;
  // farePerSeatPesewas IS the full passenger-facing fare (same value as booking.fareAmountPesewas) —
  // it is NOT the driver's net cut. Use the backend-computed commissionRate/
  // driverEarningsPerSeatPesewas directly instead of guessing a split client-side.
  const fullFare      = trip.farePerSeatPesewas ?? 0;
  const commissionRate = trip.commissionRate ?? 0.15;
  // Integer pesewas: take the commission and keep the REMAINDER, exactly as
  // the server does, so the fallback can never disagree with the receipt by a
  // pesewa. `parseFloat(x.toFixed(2))` was the cedis-era way of saying this and
  // is now both wrong (the values are pesewas) and unnecessary.
  const fare          = trip.driverEarningsPerSeatPesewas ?? fullFare - Math.round(fullFare * commissionRate);
  const activeBookings = rawBookings.filter((b: any) => b.status !== 'CANCELLED');
  // A HELD seat is reserved, not sold: the rider has picked it but not paid,
  // and it releases itself if they never do. It must be visible on the map (a
  // driver needs to know the seat isn't free) but it must NOT be counted as
  // revenue, or the earnings card promises money that may never arrive.
  const isHeld = (b: any) =>
    b.status !== 'BOARDED' &&
    b.paymentStatus !== 'PAID' &&
    !b.isOffline &&
    b.paymentMethod !== 'CASH';
  const paidBookings = activeBookings.filter((b: any) => !isHeld(b));
  const heldCount = activeBookings.length - paidBookings.length;
  const passengers = paidBookings.length;
  const grossEarnings = passengers * fullFare;
  const platformFeePesewas   = passengers * (fullFare - fare);
  const netEarnings   = passengers * fare;
  const seats = activeBookings.map((b: any) => ({
    seatNumber: b.seatNumber,
    // BUGFIX: an unpaid hold used to fall through to 'EMPTY', so the seat map
    // drew it as free while the header counted it as booked — the two halves of
    // the same card disagreed, and a rider whose hold expired looked to the
    // driver like a seat that was never taken.
    status: (
      b.status === 'BOARDED' ? 'BOARDED' : isHeld(b) ? 'HELD' : 'BOOKED'
    ) as 'BOARDED' | 'BOOKED' | 'HELD',
    userId: b.user?.id ?? b.userId,
    userName: b.user?.name ?? b.guestName ?? 'Passenger',
    bookingId: b.id,
  }));

  const currentStepIndex = STATUS_STEPS.indexOf(trip.status);

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <View style={styles.safe}>
      {/* The map. Same component, same camera state machine and same route
          line as the sibling tracking screen — this screen used to mount its own
          MapView with its own NavCamera and its own Directions call, so moving
          between the two mid-trip tore one map down, built another, and re-framed
          the ride differently on arrival. */}
      <DriverTripMap
        tripId={id!}
        status={trip.status}
        pickup={pickupCoord}
        dropoff={destCoord}
        location={location}
        puckColor={statusCfg.color}
        sheetFraction={0.46}
        active={isActiveTrip}
        onEta={handleEta}
      />

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
                {
                  text: 'Call 191',
                  style: 'destructive',
                  onPress: async () => {
                    let pos: Awaited<ReturnType<typeof Location.getLastKnownPositionAsync>> = null;
                    try { pos = await Location.getLastKnownPositionAsync(); } catch { /* no position — send alert without coords */ }
                    const payload = {
                      latitude: pos?.coords.latitude,
                      longitude: pos?.coords.longitude,
                      timestamp: new Date().toISOString(),
                    };
                    try {
                      await driverApi.emergencyAlert(id, payload);
                    } catch {
                      // Never block the actual emergency call — but the alert
                      // must still reach dispatch, so queue it for retry.
                      offlineQueue.enqueue('SOS', `/driver/trips/${id}/emergency`, 'POST', payload);
                    }
                    Linking.openURL('tel:191');
                  },
                },
              ],
            )
          }
        >
          <Text style={styles.sosBtnText}>SOS</Text>
        </Pressable>
      </View>

      {/* Draggable bottom sheet */}
      <InlayPanel
        snapPointsPct={[0.38, 0.75]}
        initialState="collapsed"
        sheetStyle={styles.sheetBackground}
        grabberColor={colors.outline}
      >
        <View style={styles.sheetContent}>
          {/* Route summary */}
          <Entrance animation="slideDown">
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
                {/* Live ETA wins over the scheduled departure time: once the
                    driver is moving, "07:40" is history and "6 min to pickup"
                    is the only number that answers what they are asking. */}
                <Text variant="caption" color={eta ? statusCfg.color : colors.onSurfaceVariant}>
                  {eta
                    ?? (trip.departureTime
                      ? new Date(trip.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : '--:--')}{' '}
                  · {passengers}/{total} seats
                </Text>
              </View>
            </View>
          </Entrance>

          {/* Step progress chips */}
          <Entrance animation="slideDown" delay={40} style={styles.stepsRow}>
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
          </Entrance>

          {/* Seat map */}
          <Entrance animation="slideDown" delay={80} style={styles.card}>
            <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii['2xl']} intensity="low" />
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Seat Map</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Text variant="bodySmall" color={colors.onSurfaceVariant}>
                  {passengers}/{total} booked{heldCount > 0 ? ` · ${heldCount} held` : ''}
                </Text>
                <Pressable
                  onPress={() => setShowPaymentQr(true)}
                  style={styles.qrBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Show payment QR code"
                  hitSlop={8}
                >
                  <Ionicons name="qr-code-outline" size={16} color={colors.primary} />
                </Pressable>
              </View>
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
                          .then(() => qc.invalidateQueries({ queryKey: ['driver', 'trip', 'active', id] }))
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
          </Entrance>

          {/* Earnings card — the screen's hero money surface gets the premium ring */}
          <Entrance animation="slideDown" delay={120}>
            <GradientGlowBorder
              palette="driver"
              fillColor={colors.surfaceContainer}
              borderRadius={radii['2xl']}
              glow
              style={styles.earningsCard}
            >
              <Text style={styles.earningsTitle}>Earnings Estimate</Text>
              <View style={styles.earningsRow}>
                <Text variant="bodySmall" color={colors.onSurfaceVariant}>Gross ({passengers} seats)</Text>
                <Text variant="bodyMedium">{formatGhs(grossEarnings)}</Text>
              </View>
              <View style={styles.earningsRow}>
                {/* The percentage is READ from the same commissionRate the amount
                    below is derived from. It was hardcoded to "30%" while the
                    server has always charged 15% (env.PLATFORM_COMMISSION), so
                    this screen told drivers they were losing twice what they
                    actually lose — and disagreed with the create-trip screen and
                    the trip-complete receipt on the same trip. */}
                <Text variant="bodySmall" color={colors.onSurfaceVariant}>
                  Platform fee ({Math.round(commissionRate * 100)}%)
                </Text>
                <Text variant="bodyMedium" color={colors.error}>− {formatGhs(platformFeePesewas)}</Text>
              </View>
              <View style={[styles.earningsRow, styles.earningsNet]}>
                <Text variant="label">Your earnings</Text>
                <Text style={styles.earningsNetValue}>{formatGhs(netEarnings)}</Text>
              </View>
            </GradientGlowBorder>
          </Entrance>

          {/* Quick-action row */}
          <Entrance animation="slideDown" delay={160} style={styles.actionRow}>
            {/* Hand off to Google/Apple Maps/Waze — the driver's own app, with
                the choice remembered (long-press to change it). See
                utils/externalNav.
                BUGFIX: this always navigated to the DESTINATION, even while the
                status was DRIVER_EN_ROUTE — i.e. exactly when the driver needs
                directions to the PICKUP. It also hard-coded Apple Maps on iOS
                with no way to choose Google, and used `maps://?ll=` (drop a pin)
                rather than a directions URL, so it didn't start navigation at
                all. Target now follows the trip phase, same rule as the in-app
                route line. */}
            <QuickAction
              icon="navigate-outline"
              label="Navigate"
              color={colors.primary}
              onPress={() => {
                void openExternalNavigation(externalNavTarget(), { forceChooser: false });
              }}
              onLongPress={() => {
                void openExternalNavigation(externalNavTarget(), { forceChooser: true });
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
          </Entrance>

          {/* Primary CTA — SWIPE, not tap.
              Every action behind this control is irreversible (arriving at the
              pickup, pulling off with passengers aboard, ending the trip and
              settling the fares) and the phone lives in a cradle on a rough
              road, where a single accidental tap is entirely plausible. Uber and
              Bolt both moved these exact steps to a slide gesture for that
              reason. See @eyego/ui SwipeToConfirm. */}
          {statusInfo.next && (
            <Entrance animation="slideDown" delay={200}>
              <SwipeToConfirm
                label={`Swipe to ${statusInfo.action.replace(/^(I've|Mark)\s+/i, '').toLowerCase()}`}
                loadingLabel={`${statusInfo.action}…`}
                onConfirm={() => advanceStatus.mutate()}
                loading={advanceStatus.isPending}
                confirmed={confirmedLabel != null}
                confirmedLabel={confirmedLabel ?? undefined}
                color={colors.primary}
                onColor={colors.onPrimary ?? '#0A0D14'}
                trackColor={colors.surfaceContainer}
                borderColor={colors.outline}
              />
            </Entrance>
          )}

          {/* No Show / Cancel */}
          {!['COMPLETED', 'CANCELLED'].includes(trip.status) && (
            <Entrance animation="slideDown" delay={220} style={styles.dangerRow}>
              <Pressable
                style={[styles.dangerBtn, { borderColor: '#F59E0B66' }]}
                onPress={() =>
                  Alert.alert(
                    'Mark as No Show',
                    'Mark this trip as a no-show? This will cancel all bookings.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Mark No Show', style: 'destructive', onPress: () => noShowTrip.mutate() },
                    ],
                  )
                }
                disabled={noShowTrip.isPending}
              >
                <Ionicons name="eye-off-outline" size={16} color="#F59E0B" />
                <Text style={[styles.dangerBtnText, { color: '#F59E0B' }]}>No Show</Text>
              </Pressable>
              <Pressable
                style={[styles.dangerBtn, { borderColor: colors.error + '66' }]}
                onPress={handleCancel}
                disabled={noShowTrip.isPending}
              >
                <Ionicons name="close-circle-outline" size={16} color={colors.error} />
                <Text style={[styles.dangerBtnText, { color: colors.error }]}>Cancel Trip</Text>
              </Pressable>
            </Entrance>
          )}
        </View>
      </InlayPanel>

      {/* Payment QR — lets a boarding rider scan straight into this trip's payment
          screen instead of the driver having no way to hand off a payable code at all. */}
      <Modal visible={showPaymentQr} transparent animationType="fade" onRequestClose={() => setShowPaymentQr(false)}>
        <Pressable style={styles.qrModalBackdrop} onPress={() => setShowPaymentQr(false)}>
          <Pressable style={styles.qrModalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.cardTitle}>Scan to Pay</Text>
            <View style={styles.qrWrap}>
              {/* A real universal-link URL, not the old bare `eyego:trip:<id>`
                  string — a phone's stock camera cannot act on a bare custom
                  scheme, so that version only worked from inside the rider
                  app's own scanner. */}
              <QRCode value={`https://eyego.app/ride/${id}`} size={220} />
            </View>
            <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ textAlign: 'center' }}>
              Passenger scans this with their camera or in the EyeGo app to pay their fare for this trip.
            </Text>
            <Pressable style={styles.qrCloseBtn} onPress={() => setShowPaymentQr(false)}>
              <Text variant="label" color={colors.onSurface}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

// The vehicle puck (and its rotation, its shadow and the -45° glyph
// counter-rotation) lives in DriverTripMap now — it was duplicated here and in
// tracking/[id].tsx with drifting shadow values.

function QuickAction({
  icon,
  label,
  color,
  onPress,
  onLongPress,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
  onLongPress?: () => void;
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
      onLongPress={onLongPress}
      delayLongPress={450}
    >
      <Ionicons name={icon} size={20} color={color} />
      <Text style={{ fontFamily: fonts.medium, fontSize: 10, lineHeight: 13, color, letterSpacing: 0.2 }}>{label}</Text>
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
    backEscapeButton: {
      position: 'absolute',
      left: spacing.base,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.sm,
      borderRadius: radii.lg,
      backgroundColor: 'rgba(0,0,0,0.5)',
    },
    skeleton: {
      height: 20,
      borderRadius: 10,
      backgroundColor: colors.surfaceContainerHigh,
    },
    // Stands in for the map while the trip loads. Deliberately not a MapView:
    // see the note at its use site.
    loadingBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#050508' },
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
      lineHeight: Math.round(fontSizes.titleSmall * 1.4),
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
      lineHeight: 14,
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
      lineHeight: 14,
      color: '#fff',
      letterSpacing: 0.5,
    },
    // Bottom sheet
    sheetBackground: {
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
      lineHeight: 12,
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
      borderRadius: radii['2xl'],
      padding: spacing.xl,
      overflow: 'hidden',
    },
    earningsCard: {
      borderRadius: radii['2xl'],
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
      lineHeight: Math.round(fontSizes.titleSmall * 1.4),
      color: colors.onSurface,
    },
    qrBtn: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary + '18',
    },
    qrModalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xl,
    },
    qrModalCard: {
      width: '100%',
      maxWidth: 320,
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii['2xl'],
      padding: spacing.xl,
      alignItems: 'center',
      gap: spacing.md,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
    },
    qrWrap: {
      backgroundColor: '#fff',
      padding: spacing.lg,
      borderRadius: radii.xl,
    },
    qrCloseBtn: {
      marginTop: spacing.sm,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.md,
      borderRadius: radii.full,
      backgroundColor: colors.surfaceContainerHigh,
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
      lineHeight: Math.round(fontSizes.bodySmall * 1.3),
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
      lineHeight: Math.round(fontSizes.titleMedium * 1.3),
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
      lineHeight: Math.round(fontSizes.bodySmall * 1.3),
    },
  });
