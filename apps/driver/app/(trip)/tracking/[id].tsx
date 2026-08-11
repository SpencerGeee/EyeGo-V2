import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { formatGhs } from '@eyego/utils';
import {
  View,
  StyleSheet,
  Pressable,
  Alert,
  Linking,
  Platform,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { MotiView } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import * as KeepAwake from 'expo-keep-awake';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { driverApi, driverSocketEvents, connectDriverSocket, disconnectDriverSocket } from '@eyego/api';
import { fonts, fontSizes, spacing, radii, springs, durations } from '@eyego/config';
import { Text, Button, Entrance, Skeleton, GlassSurface, GradientGlowBorder, InlayPanel, AppBackground } from '@eyego/ui';
import { useColors, type DriverColors } from '../../../utils/useColors';
import { useDriverStore } from '../../../stores/driver.store';
import { useNotificationsStore } from '../../../stores/notifications.store';
// Driver app uses the blue-highway dark variant, not rider's brand-green default export.
import { useDriverLocation } from '../../../hooks/useDriverLocation';
import { offlineQueue } from '../../../utils/offlineQueue';
import { DriverTripMap } from '../../../components/trip/DriverTripMap';

const STATUS_FLOW: Record<string, { label: string; next: string | null; action: string }> = {
  SCHEDULED:          { label: 'Scheduled',          next: 'start',  action: 'Start Trip'    },
  FILLING:            { label: 'Boarding Open',       next: 'start',  action: 'Start Trip'    },
  DRIVER_EN_ROUTE:    { label: 'En Route to Stop',    next: 'arrive', action: "I've Arrived"  },
  ARRIVED_AT_PICKUP:  { label: 'Arrived at Pickup',   next: 'depart', action: 'Depart Now'    },
  IN_PROGRESS:        { label: 'In Progress',         next: 'finish', action: 'Mark Arrived'  },
  COMPLETED:          { label: 'Completed',           next: null,     action: ''              },
  CANCELLED:          { label: 'Cancelled',           next: null,     action: ''              },
};

export default function DriverTrackingScreen() {
  const colors = useColors();
  const theme = useDriverStore(s => s.theme);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { setActiveTripId, isOnline } = useDriverStore();
  const { addNotification } = useNotificationsStore();

  const { data: trip, isLoading } = useQuery({
    queryKey: ['driver', 'trip', 'tracking', id],
    // Use getTripById so the screen stays populated through all status transitions.
    // getActiveTrip() returns null after ARRIVED_AT_PICKUP, causing an infinite skeleton.
    queryFn: () => driverApi.getTripById(id),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (r: any) => r.data?.data?.trip ?? null,
    refetchInterval: 8000,
    enabled: !!id,
  });

  const isActiveTrip = !!trip && !['COMPLETED', 'CANCELLED'].includes(trip.status);

  // Live driver location. `useDriverLocation` already emits every fix to the
  // socket, which is why this screen no longer runs its own 4 s emit interval —
  // that was doubling the location traffic for every driver on the road.
  const { location: driverLocation } = useDriverLocation({ enabled: isActiveTrip });

  // ETA state — fed ENTIRELY by the server (route-geometry.service.js) through
  // DriverTripMap's `onEta`. This screen used to call Directions itself and
  // route to the trip's final destination in every phase, so "12 min" during
  // pickup was the time to the rider's DESTINATION, a number unrelated to the
  // wait. The server knows which leg is live; the client no longer guesses.
  const [etaMinutes, setEtaMinutes] = useState<number | null>(null);
  const [etaDistanceKm, setEtaDistanceKm] = useState<number | null>(null);
  const [etaMessage, setEtaMessage] = useState<string | null>(null);
  /**
   * WHICH JOURNEY THE ETA MEASURES.
   *
   * BUGFIX ("i started the trip and the tracking page says i'm moving to the
   * destination, meanwhile the rider app says i'm on my way to them"). This
   * defaulted to 'toDropoff' — so between mount and the FIRST `trip:eta` frame
   * the screen asserted the destination leg no matter what the trip status
   * was. The rider was right and the driver's own app was wrong, about the
   * driver, which is the worst way round for it to be.
   *
   * `null` until the server says, and until then the leg is derived from the
   * status, which both apps already agree on. There is no state in which
   * guessing beats reading.
   */
  const [etaLeg, setEtaLeg] = useState<'toPickup' | 'toDropoff' | null>(null);

  /**
   * The leg to render RIGHT NOW: whatever the server last said, or — before it
   * has said anything — whatever the trip's own status implies. This is the
   * same rule the server applies in `route-geometry.activeLeg`, so the two
   * cannot disagree: the driver is fetching the rider until they are aboard.
   */
  const effectiveLeg: 'toPickup' | 'toDropoff' =
    etaLeg ?? (trip?.status === 'IN_PROGRESS' ? 'toDropoff' : 'toPickup');

  const handleEta = useCallback(
    (eta: { leg: 'toPickup' | 'toDropoff'; minutes: number; distanceKm: number | null; rerouted: boolean }) => {
      setEtaMinutes(eta.minutes);
      setEtaDistanceKm(eta.distanceKm);
      setEtaLeg(eta.leg);
      setEtaMessage(
        eta.rerouted
          ? 'Route updated'
          : eta.distanceKm != null
            ? `${eta.distanceKm} km ${eta.leg === 'toPickup' ? 'to pickup' : 'to destination'}`
            : null,
      );
    },
    [],
  );

  // Keep screen on while trip is active
  useEffect(() => {
    if (isActiveTrip) {
      KeepAwake.activateKeepAwake();
    } else {
      KeepAwake.deactivateKeepAwake();
    }
    return () => { KeepAwake.deactivateKeepAwake(); };
  }, [isActiveTrip]);

  // Socket setup — connect to driver namespace for ETA + events
  useEffect(() => {
    if (!trip || !isActiveTrip) return;

    connectDriverSocket();

    const unsubConnect = driverSocketEvents.onConnect(() => {
      console.log('[DriverTracking] Socket connected');
      driverSocketEvents.emitJoinTracking(id);
    });

    // `trip:eta` / `trip:route` are handled by DriverTripMap (which owns the
    // line as well as the number) — subscribing here too would mean two
    // listeners racing to interpret the same payload differently.

    const unsubPayment = driverSocketEvents.onPaymentConfirmed((data) => {
      if (data.tripId === id) {
        addNotification({
          type: 'PAYMENT_CONFIRMED',
          title: 'Payment Confirmed',
          body: 'A passenger just completed their payment.',
          tripId: id,
        });
        qc.invalidateQueries({ queryKey: ['driver', 'trip', 'tracking', id] });
      }
    });

    const unsubSeat = driverSocketEvents.onSeatUpdate(() => {
      qc.invalidateQueries({ queryKey: ['driver', 'trip', 'tracking', id] });
    });

    // There was a 4-second `emitLocation` interval here. It duplicated what
    // `useDriverLocation.applyPosition` already does on every GPS fix, so every
    // driver on this screen sent their position twice — once per fix and again
    // on a timer that re-sent a stale one in between. The hook is the single
    // emitter now.

    return () => {
      unsubConnect();
      unsubPayment();
      unsubSeat();
      disconnectDriverSocket();
    };
  }, [trip?.id, isActiveTrip, id, qc, addNotification]);

  // The camera lives in DriverTripMap now — one state machine, shared with the
  // rider app (packages/maps/src/camera.ts). What was here instead:
  //
  //   - a `setCamera` call re-issued on EVERY GPS fix, with no user-gesture
  //     release at all. Pan away to look at a junction and the next fix yanked
  //     you back; there was no rule for who owned the camera.
  //   - the Re-center button as the only way out, and only because it re-issued
  //     the same call with `heading: 0`.
  //   - screen-local `zoomLevel: 17` / `pitch: 55` constants, which is why this
  //     screen and the sibling active-trip screen framed one trip differently.
  //
  // BUGFIX kept from the old code and now encoded in `camera.ts`: the map stays
  // course-up via the camera's own heading, never by rotating the marker — the
  // marker's rotation is a TRUE bearing that @eyego/maps compensates against
  // the live map bearing.

  // BUGFIX: these used to default a missing route coordinate to a fixed Accra
  // centre, which rendered a fake pin and fed a fabricated point into the ETA
  // fetch. If a trip genuinely has no coordinate, stay null and let every
  // consumer skip rendering rather than show made-up data.
  const destCoord: [number, number] | null = useMemo(() => {
    const lat = trip?.route?.destLat;
    const lng = trip?.route?.destLng;
    if (typeof lat === 'number' && typeof lng === 'number') return [lng, lat];
    return null;
  }, [trip?.route?.destLat, trip?.route?.destLng]);

  const pickupCoord: [number, number] | null = useMemo(() => {
    const lat = trip?.route?.originLat;
    const lng = trip?.route?.originLng;
    if (typeof lat === 'number' && typeof lng === 'number') return [lng, lat];
    return destCoord;
  }, [trip?.route?.originLat, trip?.route?.originLng, destCoord]);

  // The leg choice (pickup first, then destination) and the road geometry both
  // live on the SERVER now — route-geometry.service.js computes one line per
  // leg, caches it, and re-routes after three consecutive off-route fixes.
  // What was here: a `fetchRoute` call keyed on the driver's own position, a
  // reset effect for the phase switch, and a 60 s interval to refetch. Three
  // moving parts to reproduce, per screen, a line the server already had — and
  // because each screen fetched independently, the driver and the rider could
  // be following two different lines for one ride.

  // ── In-app banner ──
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);
  const bannerAnim = useRef(new Animated.Value(-80)).current;
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showBanner = useCallback((msg: string) => {
    setBannerMsg(msg);
    Animated.spring(bannerAnim, { toValue: 0, useNativeDriver: true, ...springs.standard }).start();
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => {
      Animated.timing(bannerAnim, { toValue: -80, duration: durations.standard, useNativeDriver: true }).start(() => setBannerMsg(null));
    }, 4000);
  }, [bannerAnim]);

  // ── Trip status management ──
  const pendingFromStatus = useRef<string | null>(null);

  const advanceStatus = useMutation({
    mutationFn: async () => {
      const status = trip?.status;
      pendingFromStatus.current = status ?? null;
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

      /*
       * These banners are the DRIVER's own feedback and nothing more. The
       * rider's copy of this news — socket event, push, Live Activity — is fanned
       * out by the server from the transition the `driverApi.*` call above
       * committed, so there is nothing for this screen to announce.
       *
       * The old comment here recorded that this screen "emitted NOTHING" while
       * its sibling `active/[id].tsx` did, and that riders therefore missed the
       * arrival step. That asymmetry is exactly the failure mode of letting
       * clients announce status: it can only ever be fixed one screen at a time,
       * and there is no way to tell which screens are still wrong.
       */
      if (toStatus === 'DRIVER_EN_ROUTE') {
        driverSocketEvents.emitTripStarted(id); // room join only
        showBanner('Trip started — en route to pickup');
      }
      if (toStatus === 'ARRIVED_AT_PICKUP') {
        showBanner('Arrived at pickup — ready to depart');
      }
      if (toStatus === 'IN_PROGRESS') {
        showBanner('Trip is now in progress');
      }
      if (toStatus === 'COMPLETED') {
        setActiveTripId(null);
        qc.invalidateQueries({ queryKey: ['driver', 'trip', 'tracking', id] });
        qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
        qc.invalidateQueries({ queryKey: ['driver', 'trips', 'all'] });
        qc.invalidateQueries({ queryKey: ['driver', 'me'] });
        qc.invalidateQueries({ queryKey: ['driver', 'quests'] });
        // Refresh wallet balance + transactions so home/earnings update.
        qc.invalidateQueries({ queryKey: ['driver', 'wallet'] });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = (res as any)?.data;
        const earningsThisTrip = raw?.data?.earningsThisTrip ?? raw?.data?.totalEarningsPesewas ?? 0;
        addNotification({
          type: 'COMPLETED',
          title: 'Trip completed!',
          body: `You earned ${formatGhs(Number(earningsThisTrip))}`,
          tripId: id,
        });
        router.replace({ pathname: '/(trip)/complete/[id]', params: { id, earnings: String(earningsThisTrip) } } as Href);
        return;
      }

      qc.invalidateQueries({ queryKey: ['driver', 'trip', 'tracking', id] });
      qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
    },
    // A 409 means this step already landed — see the long note on the same
    // handler in `(trip)/active/[id].tsx`. Resync rather than alarm the driver.
    onError: async (err) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      qc.invalidateQueries({ queryKey: ['driver', 'trip', 'active', id] });
      qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
      if (status === 409) return;
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err as Error).message ??
        'Please try again.';
      Alert.alert("Couldn't update the trip", message);
    },
  });

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

  const handleOpenMaps = () => {
    const destLat = trip?.route?.destLat;
    const destLng = trip?.route?.destLng;
    const label = encodeURIComponent(trip?.route?.destinationName ?? 'Destination');
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
  };

  // Navigate home when trip disappears (deleted/cancelled upstream).
  // Must be in a useEffect — calling router.replace() during render causes
  // "Cannot update NavigationContainerInner while rendering DriverTrackingScreen".
  useEffect(() => {
    if (!isLoading && !trip && id) {
      router.replace('/(tabs)/home');
    }
  }, [isLoading, trip, id, router]);

  // ── Computed values ──
  const statusInfo = STATUS_FLOW[trip?.status] ?? STATUS_FLOW.FILLING;
  const rawBookings = trip?.bookings ?? [];
  const activeBookings = rawBookings.filter((b: any) => b.status !== 'CANCELLED');
  const passengers = activeBookings.length;
  const total = trip?.maxSeats ?? 14;
  const fare = trip?.farePerSeatPesewas ?? 0;
  const boarded = activeBookings.filter((b: any) => b.status === 'BOARDED').length;

  // ── Render ──
  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <AppBackground isDark={theme !== 'light'} />
        <View style={styles.loadingContainer}>
          {[80, 160, 120].map((w, i) => (
            <Skeleton key={i} width={w} height={16} borderRadius={radii.md} />
          ))}
        </View>
      </SafeAreaView>
    );
  }

  if (!trip) return null;

  return (
    <View style={styles.container}>
      <AppBackground isDark={theme !== 'light'} />
      {/* The map. One surface, one camera state machine, shared with the
          sibling active-trip screen and — through packages/maps — with the
          rider app. Everything that used to live inline here (a MapView, a
          hand-rolled Camera, the puck, the pins, the line, the Re-center FAB)
          is inside DriverTripMap. */}
      <DriverTripMap
        tripId={id}
        status={trip?.status}
        pickup={pickupCoord}
        dropoff={destCoord}
        location={driverLocation}
        puckColor={colors.primary}
        sheetFraction={0.42}
        active={isActiveTrip}
        onEta={handleEta}
      />
      {/* Floating header */}
      <View style={styles.headerOverlay}>
        <View style={styles.headerRow}>
          <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii['2xl']} intensity="low" />
          <Pressable onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
          </Pressable>
          <View style={styles.headerRouteInfo}>
            <Text style={styles.headerRoute} numberOfLines={1}>
              {trip?.route?.originName ?? '—'} → {trip?.route?.destinationName ?? '—'}
            </Text>
          </View>
          <TripStatusBadge status={trip.status} colors={colors} />
        </View>
      </View>

      {/* LIVE badge */}
      <View style={styles.liveBadge}>
        <MotiView
          from={{ opacity: 0.5 }}
          animate={{ opacity: 1 }}
          transition={{ type: 'timing', duration: 500, loop: true }}
          style={styles.liveDot}
        />
        <Text style={styles.liveText}>LIVE</Text>
      </View>

      {/* ETA and passenger pills, stacked on the LEFT.
          The passenger pill used to sit top-right, directly on top of the map's
          re-center button — "the icon to reset the camera view seems to be at
          the back of the number of seats boarded". The map renders first, so
          the pill always won. Stacking both pills on the left gives the button
          the corner to itself instead of fighting over it with a z-index. */}
      <View style={styles.pillStack} pointerEvents="box-none">
        {etaMinutes != null && (
          <Entrance animation="slideLeft">
            <BlurView intensity={60} tint="dark" style={styles.etaPillBlur}>
              <Ionicons name="time-outline" size={14} color={colors.primary} />
              {/* The leg matters as much as the number: while the driver is
                  still collecting, "12 min to destination" is the length of
                  the ride, not the time to the rider — and it was what made
                  this pill disagree with the rider's own ETA. */}
              <Text style={styles.etaPillText} numberOfLines={1}>
                {etaMinutes < 2
                  ? 'Arriving now'
                  : `${etaMinutes} min ${etaLeg === 'toPickup' ? 'to pickup' : 'to destination'}`}
              </Text>
            </BlurView>
          </Entrance>
        )}
        <Entrance animation="slideLeft">
          <BlurView intensity={60} tint="dark" style={styles.etaPillBlur}>
            <Ionicons name="people-outline" size={14} color={colors.primary} />
            <Text style={styles.etaPillText}>{boarded}/{passengers} boarded</Text>
          </BlurView>
        </Entrance>
      </View>

      {/* In-app banner */}
      {bannerMsg != null && (
        <Animated.View style={[styles.statusBanner, { transform: [{ translateY: bannerAnim }] }]}>
          <BlurView intensity={80} tint="dark" style={styles.statusBannerBlur}>
            <View style={styles.statusBannerIcon}>
              <Ionicons name="notifications" size={16} color="#050508" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.statusBannerLabel}>TRIP UPDATE</Text>
              <Text style={styles.statusBannerText}>{bannerMsg}</Text>
            </View>
          </BlurView>
        </Animated.View>
      )}

      {/* Bottom sheet */}
      <InlayPanel
        // Same fix as the home panel: 0.32 put the card's own content below the
        // fold on open, so the driver had to drag the sheet up before they
        // could read their ETA or reach the action. The resting snap now fits
        // the card.
        snapPointsPct={[0.5, 0.8]}
        initialState="collapsed"
        sheetStyle={styles.sheetBackground}
        grabberColor={colors.outline}
      >
        <View style={styles.sheetContent}>
          {/* ETA + Status — the screen's hero data gets the driver-blue premium ring */}
          <Entrance animation="slideDown">
            <GradientGlowBorder
              palette="driver"
              fillColor={colors.surfaceContainer}
              borderRadius={radii.xl}
              glow
              style={styles.etaSection}
            >
              <GlassSurface borderRadius={radii.xl - 3} intensity="high" dark style={styles.glassInset} />
              <View style={styles.etaLeft}>
                <Text style={styles.etaValue}>
                  {etaMinutes != null ? `${etaMinutes} min` : '...'}
                </Text>
                <Text variant="bodySmall" color={colors.onSurfaceVariant}>
                  {/* Was the hardcoded string 'to destination', which said the
                      same thing while the driver was still collecting the
                      rider as it did once they were aboard. */}
                  {etaMinutes != null
                    ? (effectiveLeg === 'toPickup' ? 'to pickup' : 'to destination')
                    : 'Calculating ETA...'}
                </Text>
              </View>
              <View style={styles.etaDivider} />
              <View style={styles.etaRight}>
                <Text style={styles.etaStatus}>{etaMessage ?? statusInfo.label}</Text>
                <Text variant="bodySmall" color={colors.onSurfaceVariant}>
                  {etaDistanceKm != null ? `${etaDistanceKm} km` : `${passengers} passenger${passengers !== 1 ? 's' : ''}`}
                </Text>
              </View>
            </GradientGlowBorder>
          </Entrance>

          {/* Passenger list */}
          <Entrance animation="slideDown" delay={40} style={styles.passengerListCard}>
            <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.xl} intensity="low" />
            <View style={styles.passengerListHeader}>
              <Text style={styles.passengerListTitle}>Passengers</Text>
              <Text variant="caption" color={colors.onSurfaceVariant}>{passengers}/{total}</Text>
            </View>
            {activeBookings.length === 0 ? (
              <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ paddingVertical: spacing.sm }}>
                No passengers yet. Trip is open for boarding.
              </Text>
            ) : (
              activeBookings.slice(0, 6).map((b: any, i: number) => (
                <View key={b.id ?? i} style={styles.passengerRow}>
                  <View style={[styles.passengerAvatar, !b.user?.name && { backgroundColor: colors.surfaceContainerHighest }]}>
                    <Text style={styles.passengerInitial}>
                      {(b.user?.name?.[0] ?? b.seatNumber ?? '?').toString().toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.passengerName}>
                      {b.user?.name ?? b.guestName ?? `Seat ${b.seatNumber ?? '—'}`}
                    </Text>
                    <Text variant="caption" color={colors.onSurfaceVariant}>
                      Seat {b.seatNumber ?? '—'} · {
                        b.paymentStatus === 'PAID' ? 'Paid'
                        : b.paymentStatus === 'FAILED' ? 'Payment failed'
                        : b.paymentMethod === 'CASH' ? 'Cash'
                        : b.paymentStatus === 'PENDING' ? 'Pending payment'
                        : b.status
                      }
                    </Text>
                  </View>
                  <View style={[
                    styles.boardedBadge,
                    { backgroundColor: b.status === 'BOARDED' ? `${colors.online}22` : `${colors.outline}22` },
                  ]}>
                    <Text style={[
                      styles.boardedText,
                      { color: b.status === 'BOARDED' ? colors.online : colors.onSurfaceVariant },
                    ]}>
                      {b.status === 'BOARDED' ? 'On board' : 'Waiting'}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </Entrance>

          {/* Primary action button */}
          {statusInfo.next && (
            <Entrance animation="slideDown" delay={80}>
              <Button
                label={statusInfo.action}
                onPress={() => advanceStatus.mutate()}
                loading={advanceStatus.isPending}
                disabled={advanceStatus.isPending}
              />
            </Entrance>
          )}

          {/* Secondary actions row */}
          <Entrance animation="slideDown" delay={100} style={styles.secondaryActions}>
            <Pressable
              style={styles.secondaryBtn}
              onPress={() => router.push(`/(trip)/chat/${id}`)}
            >
              <Ionicons name="chatbubble-outline" size={18} color={colors.onSurfaceVariant} />
              <Text style={[styles.secondaryBtnText, { color: colors.onSurfaceVariant }]}>Chat</Text>
            </Pressable>
            <Pressable
              style={styles.secondaryBtn}
              onPress={handleOpenMaps}
            >
              <Ionicons name="navigate-outline" size={18} color={colors.primary} />
              <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>Navigate</Text>
            </Pressable>
            <Pressable
              style={styles.secondaryBtn}
              onPress={() => router.push(`/(trip)/active/${id}`)}
            >
              <Ionicons name="grid-outline" size={18} color={colors.primary} />
              <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>Manage</Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryBtn, { borderColor: colors.error + '55' }]}
              onPress={() => {
                Alert.alert(
                  'Emergency SOS',
                  'This will call Ghana Police (191). Are you in immediate danger?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Call 191',
                      style: 'destructive',
                      onPress: async () => {
                        const payload = {
                          latitude: driverLocation?.latitude,
                          longitude: driverLocation?.longitude,
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
                );
              }}
            >
              <Ionicons name="warning" size={18} color={colors.error} />
              <Text style={[styles.secondaryBtnText, { color: colors.error }]}>SOS</Text>
            </Pressable>
          </Entrance>

          {/* No Show + Cancel actions */}
          {!['COMPLETED', 'CANCELLED'].includes(trip.status) && (
            <Entrance animation="slideDown" delay={120} style={styles.cancelRow}>
              <Pressable
                style={[styles.cancelBtn, { flex: 1, borderColor: '#F59E0B55' }]}
                onPress={() => {
                  Alert.alert(
                    'Mark as No Show',
                    'Mark this trip as a no-show? This will cancel all bookings and may affect your cancellation rate.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Mark No Show', style: 'destructive', onPress: () => {
                          if (['CANCELLED', 'COMPLETED'].includes(trip?.status ?? '')) {
                            Alert.alert('Already resolved', 'This trip has already been cancelled or completed.');
                            return;
                          }
                          cancelTrip.mutate();
                        }},
                    ],
                  );
                }}
                disabled={cancelTrip.isPending}
              >
                <Ionicons name="eye-off-outline" size={18} color="#F59E0B" />
                <Text style={[styles.secondaryBtnText, { color: '#F59E0B' }]}>
                  {cancelTrip.isPending ? '…' : 'No Show'}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.cancelBtn, { flex: 1 }]}
                onPress={handleCancel}
                disabled={cancelTrip.isPending}
              >
                <Ionicons name="close-circle-outline" size={18} color={colors.error} />
                <Text style={[styles.secondaryBtnText, { color: colors.error }]}>
                  {cancelTrip.isPending ? 'Cancelling…' : 'Cancel Trip'}
                </Text>
              </Pressable>
            </Entrance>
          )}
        </View>
      </InlayPanel>
    </View>
  );
}

// ── Status badge ──
const TRIP_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  SCHEDULED:          { label: 'Scheduled',       color: '#94A3B8' },
  FILLING:            { label: 'Boarding',         color: '#3B82F6' },
  DRIVER_EN_ROUTE:    { label: 'En Route',         color: '#F59E0B' },
  ARRIVED_AT_PICKUP:  { label: 'Arrived',          color: '#A78BFA' },
  IN_PROGRESS:        { label: 'In Progress',      color: '#22C55E' },
  COMPLETED:          { label: 'Completed',        color: '#60A5FA' },
  CANCELLED:          { label: 'Cancelled',        color: '#F87171' },
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

// The pulsing pickup marker moved into DriverTripMap with the rest of the map's
// furniture — a pin that only this screen could draw was half the reason the two
// trip screens looked like different apps.

// ── Styles ──
const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: 'transparent' },
    loadingContainer: { padding: spacing['2xl'], gap: spacing.lg },
    skeleton: { height: 20, borderRadius: 10, backgroundColor: colors.surfaceContainerHigh },
    headerOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      paddingTop: 50,
      paddingHorizontal: spacing.xl,
      zIndex: 10,
    },
    // Sits above the bottom panel and clear of the header; 48pt is the minimum
    // comfortable target for a thumb on a phone in a cradle.
    // The Re-center control lives in DriverTripMap, next to the camera that
    // knows whether the user has actually taken it — this screen used to render
    // the button unconditionally, so it was there even when it did nothing.
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: 'rgba(6,15,26,0.9)',
      borderRadius: radii['2xl'],
      borderWidth: 1,
      borderColor: colors.outline,
      padding: spacing.sm,
    },
    headerBtn: {
      width: 36,
      height: 36,
      borderRadius: 12,
      backgroundColor: colors.surfaceContainer,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerRouteInfo: { flex: 1 },
    headerRoute: {
      fontFamily: fonts.displaySemiBold,
      fontSize: fontSizes.bodySmall,
      lineHeight: Math.round(fontSizes.bodySmall * 1.3),
      color: colors.onSurface,
    },
    liveBadge: {
      position: 'absolute',
      top: 110,
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      backgroundColor: 'rgba(6,15,26,0.85)',
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.xs,
      borderRadius: radii.full,
      borderWidth: 1,
      borderColor: colors.primary + '40',
      zIndex: 10,
    },
    liveDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.primary,
    },
    liveText: {
      fontFamily: fonts.semiBold,
      fontSize: 11,
      lineHeight: Math.round(11 * 1.3),
      color: colors.primary,
      letterSpacing: 1.5,
    },
    pillStack: {
      position: 'absolute',
      left: spacing.xl,
      // The stack is bounded on BOTH sides. Left-only positioning let a pill
      // grow to whatever its text needed, and "12 min to destination" reached
      // far enough right to slide under the map's re-center button — which
      // sits at `right: 16` and overlaps this stack's vertical band. Moving
      // the pills to the left was supposed to have settled that; it only did
      // for short strings. 76 = the button's 44 plus its 16 inset and a 16
      // gap, so nothing in here can reach it however long the label gets.
      right: 76,
      top: 155,
      zIndex: 10,
      gap: spacing.sm,
      // Left-aligned so a short pill and a long one share a left edge rather
      // than centring against each other.
      alignItems: 'flex-start',
    },
    etaPillBlur: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.sm,
      borderRadius: radii.full,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.primary + '30',
    },
    etaPillText: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodySmall,
      lineHeight: Math.round(fontSizes.bodySmall * 1.3),
      color: colors.primary,
    },
    statusBanner: {
      position: 'absolute',
      top: 150,
      left: spacing.base,
      right: spacing.base,
      zIndex: 20,
      borderRadius: radii['2xl'],
      overflow: 'hidden',
    },
    statusBannerBlur: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.sm,
      borderWidth: 1.5,
      borderColor: colors.primary + '60',
      borderRadius: radii['2xl'],
      overflow: 'hidden',
    },
    statusBannerIcon: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    statusBannerLabel: {
      fontFamily: fonts.semiBold,
      fontSize: 9,
      lineHeight: Math.round(9 * 1.3),
      color: colors.primary,
      letterSpacing: 1.5,
      marginBottom: 1,
    },
    statusBannerText: {
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodySmall,
      lineHeight: Math.round(fontSizes.bodySmall * 1.3),
      color: colors.onSurface,
    },
    sheetBackground: {
      borderTopLeftRadius: radii['3xl'],
      borderTopRightRadius: radii['3xl'],
    },
    sheetHandle: { backgroundColor: colors.outline, width: 40, height: 4 },
    sheetContent: {
      paddingHorizontal: spacing['2xl'],
      // Top padding gives the ETA card's GradientGlowBorder room for its
      // shadow-based glow to bleed upward — without it, the ScrollView's
      // implicit overflow clips the glow flush at the top edge.
      paddingTop: spacing.lg,
      paddingBottom: spacing['2xl'],
      gap: spacing.base,
    },
    etaSection: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: radii.xl,
      padding: spacing.base,
      overflow: 'hidden',
    },
    glassInset: StyleSheet.absoluteFillObject,
    etaLeft: { alignItems: 'center', flex: 1 },
    etaValue: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.titleLarge,
      lineHeight: Math.round(fontSizes.titleLarge * 1.4),
      color: colors.primary,
    },
    etaDivider: { width: 1, height: 40, backgroundColor: colors.outlineVariant },
    etaRight: { flex: 2, paddingLeft: spacing.base },
    etaStatus: {
      fontFamily: fonts.displaySemiBold,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
      color: colors.onSurface,
    },
    passengerListCard: {
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outline,
      padding: spacing.base,
      gap: spacing.sm,
    },
    passengerListHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    passengerListTitle: {
      fontFamily: fonts.displaySemiBold,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.3),
      color: colors.onSurface,
    },
    passengerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.xs,
    },
    passengerAvatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surfaceContainerHigh,
      alignItems: 'center',
      justifyContent: 'center',
    },
    passengerInitial: {
      fontFamily: fonts.semiBold,
      fontSize: 13,
      lineHeight: Math.round(13 * 1.3),
      color: colors.onSurface,
    },
    passengerName: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodySmall,
      lineHeight: Math.round(fontSizes.bodySmall * 1.3),
      color: colors.onSurface,
    },
    boardedBadge: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: radii.full,
    },
    boardedText: {
      fontFamily: fonts.semiBold,
      fontSize: 9,
      lineHeight: Math.round(9 * 1.3),
      letterSpacing: 0.3,
    },
    secondaryActions: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    secondaryBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outline,
      paddingVertical: spacing.sm,
    },
    secondaryBtnText: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.caption,
      lineHeight: Math.round(fontSizes.caption * 1.3),
    },
    cancelRow: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    cancelBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.error + '55',
      paddingVertical: spacing.sm,
    },
    // The puck, pin and destination-marker styles moved into DriverTripMap —
    // they were duplicated, with slightly different numbers, in both trip
    // screens, which is why one ride looked like two.
  });
