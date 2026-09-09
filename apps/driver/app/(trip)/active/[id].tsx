'use strict';
import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { formatGhs, originLabel, destinationLabel, seatsOf } from '@eyego/utils';
import {
  View,
  StyleSheet,
  Pressable,
  Alert,
  Linking,
  Modal,
  TextInput,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import * as KeepAwake from 'expo-keep-awake';
import * as Location from 'expo-location';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { driverApi, driverSocketEvents } from '@eyego/api';
import { fonts, fontSizes, spacing, radii, TRIP_STATUS_COPY, driverStatusLabel } from '@eyego/config';
import { Text, Skeleton, Entrance, GlassSurface, GradientGlowBorder, InlayPanel, SwipeToConfirm, goLateral, SmoothScreen, goDeeper, goBack, notify, callNumber } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../../utils/useColors';
import { usePlatformConfig } from '../../../hooks/usePlatformConfig';
import { useDriverStore } from '../../../stores/driver.store';
import { useNotificationsStore } from '../../../stores/notifications.store';
import { useChatUnread } from '../../../stores/chatUnread.store';
import { applyDriverTripStatus } from '../../../stores/trip.store';
import { useDriverSocket } from '../../../hooks/useDriverSocket';
import { useDriverLocation } from '../../../hooks/useDriverLocation';
import * as Haptics from 'expo-haptics';
import { SeatMap } from '../../../components/SeatMap';
import { StopTimelineSurface } from '../../../components/trip/StopTimelineSurface';
import { StopTimeline, CabinStrip } from '../../../components/trip/StopTimeline';
import { useTripStops } from '../../../components/trip/useTripStops';
import { PassengerSheet, type PassengerSheetData } from '../../../components/trip/PassengerSheet';
import { offlineQueue } from '../../../utils/offlineQueue';
import { openExternalNavigation } from '../../../utils/externalNav';
import type { GeoPlace } from '@eyego/utils';
// The ONE map in the driver trip flow. It owns the MapView, the map style, the
// camera state machine and the server's route geometry, so nothing map-shaped is
// imported here any more.
import { DriverTripMap } from '../../../components/trip/DriverTripMap';
import { TripStatusRail, type RailStep } from '../../../components/trip/TripStatusRail';
import { VALID_ADVANCE_STATUSES, nextStatusAfter, advanceRequest } from '../../../components/surface/useTripAdvance';
import type { TripBooking } from '@eyego/types';

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
  // A dispatched trip normally lands straight at DRIVER_EN_ROUTE, but the state
  // machine still routes DRIVER_ASSIGNED → DRIVER_EN_ROUTE (an admin assignment,
  // a reassignment, a scheduled trip a driver claimed), and with no entry here
  // the screen fell through to the FILLING fallback — a "Start Trip" button that
  // happened to work by accident. Spelled out so it works on purpose.
  DRIVER_ASSIGNED:    { label: 'Assigned',             next: 'start',  action: 'Head to Pickup' },
  DRIVER_EN_ROUTE:    { label: 'Heading to Pickup',    next: 'arrive', action: "I've Arrived"  },
  // Not "Start Trip" — the trip is long since started by this point; this is
  // the passenger-is-aboard, pulling-off action. Two buttons reading "Start
  // Trip" at different points in one flow is exactly what made this confusing.
  ARRIVED_AT_PICKUP:  { label: 'Arrived at Pickup',    next: 'depart', action: 'Start Ride'    },
  // BUGFIX ("i'm in the trip in progress state and when i swipe again, the
  // trip is done"). It was labelled 'Mark Arrived', so the control read
  // "Swipe to arrived" — but the mutation for IN_PROGRESS calls
  // `driverApi.arriveTrip`, whose transition is IN_PROGRESS → COMPLETED. The
  // wiring was right and the word was wrong: the driver was told they were
  // logging an arrival and were in fact ending the ride and being sent to the
  // receipt. `arriveTrip` means "arrived at the DESTINATION", which is the same
  // event as finishing; the label now says what actually happens.
  IN_PROGRESS:        { label: 'In Progress',          next: 'complete', action: 'Complete Trip' },
  COMPLETED:          { label: 'Completed',            next: null,     action: ''              },
  CANCELLED:          { label: 'Cancelled',            next: null,     action: ''              },
};

/**
 * Colours stay local (they are this app's palette); the LABEL now comes from
 * the shared vocabulary in @eyego/config.
 *
 * This file previously declared two label maps of its own — one here and one
 * in STATUS_FLOW above — which disagreed with each other and with the tracking
 * screen, so the same status renamed itself as the driver moved around. See
 * packages/config/src/tripStatus.ts.
 */
const STATUS_TONE_COLOR: Record<string, string> = {
  CONFIRMED:          '#94A3B8',
  SCHEDULED:          '#94A3B8',
  FILLING:            '#3B82F6',
  DRIVER_EN_ROUTE:    '#F59E0B',
  ARRIVED_AT_PICKUP:  '#A78BFA',
  IN_PROGRESS:        '#4be277',
  COMPLETED:          '#60A5FA',
  CANCELLED:          '#F87171',
};

const TRIP_STATUS_CONFIG: Record<string, { label: string; color: string }> =
  Object.fromEntries(
    Object.keys(TRIP_STATUS_COPY).map((key) => [
      key,
      { label: driverStatusLabel(key), color: STATUS_TONE_COLOR[key] ?? '#94A3B8' },
    ]),
  );

const STATUS_STEPS = ['SCHEDULED', 'FILLING', 'DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'IN_PROGRESS', 'COMPLETED'];

/**
 * Statuses where BOARDING is the thing the driver is doing right now.
 *
 * Both products in one list. A driver-created trip loads at SCHEDULED/FILLING
 * and never sees `ARRIVED_AT_PICKUP`; a dispatched ride reaches the kerb at
 * `ARRIVED_AT_PICKUP` and never sits at FILLING. Gating the boarding hint on
 * either one alone hides it from the other product — which is exactly what was
 * reported. `DRIVER_EN_ROUTE` is deliberately absent: the driver is still
 * driving to the pickup, and there is nobody to board yet.
 */
const BOARDING_STATUSES = ['SCHEDULED', 'FILLING', 'ARRIVED_AT_PICKUP'];

/**
 * Which step a status stands on — NOT `STATUS_STEPS.indexOf(status)`.
 *
 * BUGFIX ("on the tracking page it's showing Ready to Start at the top, but on
 * the manage page the statuses are all greyed out").
 *
 * `indexOf` answers -1 for any status that is not literally one of the six
 * labels above, and -1 makes every step render as neither done nor current —
 * the whole progress rail goes grey. Two real statuses hit that: `CONFIRMED`,
 * which payments.service.js promotes a fully-paid SCHEDULED trip to, and
 * `DRIVER_ASSIGNED`, which a dispatched on-demand trip passes through. Both are
 * states a driver spends real time in, and both drew an empty rail.
 *
 * They are not new steps — CONFIRMED is the scheduled trip waiting to set off,
 * DRIVER_ASSIGNED is the driver about to head for pickup — so they ALIAS onto
 * the step they belong to rather than lengthening the rail. Keep this in sync
 * with `STATUS_FLOW` above and with the tracking screen's `advanceStatus`;
 * those three are the same state machine seen from three angles.
 */
const STEP_ALIASES: Record<string, string> = {
  CONFIRMED: 'SCHEDULED',
  DRIVER_ASSIGNED: 'DRIVER_EN_ROUTE',
};

function stepIndexFor(status: string | undefined | null): number {
  if (!status) return -1;
  return STATUS_STEPS.indexOf(STEP_ALIASES[status] ?? status);
}

/**
 * The same six steps, dressed for the animated rail. Icons rather than dots so
 * a glance tells the driver WHICH stage they are on, not merely how many are
 * behind them — the rail is read at arm's length in a moving vehicle.
 */
const RAIL_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  SCHEDULED: 'calendar-outline',
  FILLING: 'people-outline',
  DRIVER_EN_ROUTE: 'navigate-outline',
  ARRIVED_AT_PICKUP: 'location-outline',
  IN_PROGRESS: 'car-sport-outline',
  COMPLETED: 'flag-outline',
};

const RAIL_STEPS: RailStep[] = STATUS_STEPS.slice(0, -1).map((key) => ({
  key,
  label: TRIP_STATUS_CONFIG[key]?.label ?? key,
  icon: RAIL_ICONS[key] ?? 'ellipse-outline',
  color: TRIP_STATUS_CONFIG[key]?.color ?? '#94A3B8',
}));

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
  // One emergency number for both apps, editable in the console without a
  // release. Falls back to Ghana’s unified line, so it is never empty even
  // before the first config fetch answers.
  const { emergencyNumber } = usePlatformConfig();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const qc = useQueryClient();
  const { setActiveTripId } = useDriverStore();
  const { addNotification } = useNotificationsStore();
  /**
   * WHICH CODE IS ON SCREEN — pay, book, or none.
   *
   * BUGFIX ("for scan-to-pay the QR should be different and for scan-to-book
   * the QR should be different"). It was one boolean and one URL, and that URL
   * was the BOOKING one, so the button labelled "Scan to Pay" handed a
   * passenger the code for buying another seat. They are two different asks
   * pointed at two different routes, so they are two different codes.
   */
  const [qrMode, setQrMode] = useState<'pay' | 'book' | null>(null);
  /** Local mirror of Driver.requestsPaused — see the toggle's note below for
   *  why this is optimistic rather than read back from the server. */
  const [requestsPaused, setRequestsPaused] = useState(false);

  /**
   * "VERIFY MY RIDE" — the driver's side.
   *
   * Server-driven on purpose. The driver's app does NOT decide whether a code
   * is needed: it boards, and if the server answers PIN_REQUIRED it asks for
   * one and retries. That keeps the rule in exactly one place (the server, the
   * only place it can actually be enforced) and means a driver never sees a
   * keypad for a rider who did not turn the setting on.
   */
  const [pinPrompt, setPinPrompt] = useState<
    { bookingId: string; seatNumber: number; name: string } | null
  >(null);
  const [pinValue, setPinValue] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState(false);

  /**
   * A BOARDING RUN — the kerbside routine, as one gesture.
   *
   * FEATURE ("if a rider orders a ride and the driver accepts and gets to the
   * pickup, if they want to start the trip, they would be prompted to put the
   * pin (if there's a pin) and it automatically boards the passenger. that
   * makes it consistent").
   *
   * Exactly right, and the old shape had it backwards. Boarding was a thing the
   * driver had to remember to do on the seat map FIRST, and starting the ride
   * was a separate swipe that the server refused until they had. Two steps, in
   * an order nobody is told, with the failure arriving as a 409 alert — which
   * is why "I chose to start the trip without boarding" kept being reported.
   *
   * Now the swipe IS the routine. Swiping Start walks every passenger who is
   * not yet aboard: it boards each one, stops for a code where the rider asked
   * for one, offers `Not here` for the seat nobody claims, and pulls off when
   * the queue is empty. One gesture, and the server's precondition is satisfied
   * on the way past rather than discovered afterwards.
   *
   * `queue` is frozen when the run starts. Re-deriving it per step would let a
   * booking that lands mid-run extend a queue the driver is already standing
   * in — the bus would never leave.
   */
  const [boardingRun, setBoardingRun] = useState<
    { queue: { bookingId: string; seatNumber: number; name: string }[]; index: number } | null
  >(null);

  /**
   * "IT'S DOWN THERE" — the pointer for a refused departure.
   *
   * The server now refuses IN_PROGRESS while the car is empty or a Verify My
   * Ride code is outstanding, and both are fixed on the seat map, which is on
   * this same screen but below the fold of a collapsed sheet. An alert that says
   * "board your passengers" and leaves the driver to find where costs them the
   * seconds they were trying to save by skipping it.
   *
   * Lights the seat card and clears itself, so it is a nudge rather than a state
   * the driver has to dismiss.
   */
  const [seatMapNudge, setSeatMapNudge] = useState(false);
  useEffect(() => {
    if (!seatMapNudge) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    const t = setTimeout(() => setSeatMapNudge(false), 4200);
    return () => clearTimeout(t);
  }, [seatMapNudge]);

  const boardWithPin = React.useCallback(
    async (bookingId: string, seatNumber: number, name: string, pin?: string) => {
      try {
        setPinBusy(true);
        await driverApi.boardPassenger(id, bookingId, pin);
        setPinPrompt(null);
        setPinValue('');
        setPinError(null);
        qc.invalidateQueries({ queryKey: ['driver', 'trip', 'active', id] });
      } catch (err: any) {
        const code = err?.response?.data?.code ?? err?.response?.data?.error?.code;
        const msg = err?.response?.data?.message ?? 'Failed';
        if (code === 'PIN_REQUIRED') {
          // First contact with a verified rider — open the keypad.
          setPinValue('');
          setPinError(null);
          setPinPrompt({ bookingId, seatNumber, name });
          /**
           * AND PUT THE CODE IN FRONT OF THE RIDER.
           *
           * BUGFIX ("the rider app isn't showing the pin verification — when
           * the driver marks as boarded it should bring up the popup on the
           * rider tracking page"). The keypad on this side has always existed;
           * the other half never did, so the driver was asking for a number the
           * rider had no way to see. This raises it on their screen (and pushes,
           * for a phone that is in a pocket). Fire-and-forget: a failed ping
           * must not stop a driver who can already see the code.
           */
          void driverApi.requestBoardingPin(id, bookingId).catch(() => {});
          return;
        }
        if (code === 'PIN_INCORRECT') {
          // Keep the keypad open. Closing it here would make a mistyped digit
          // feel like a rejection of the whole boarding.
          setPinError(msg);
          setPinValue('');
          return;
        }
        setPinPrompt(null);
        notify('Could not board that passenger', msg);
      } finally {
        setPinBusy(false);
      }
    },
    [id, qc],
  );
  const unreadChats = useChatUnread((s) => (id ? s.counts[id] ?? 0 : 0));

  /**
   * The passenger whose sheet is open, or null.
   *
   * Replaces the `Alert.alert` that tapping a seat used to raise — see
   * components/trip/PassengerSheet.tsx for why an OS alert was the wrong object
   * for a passenger record.
   */
  const [sheetPassenger, setSheetPassenger] = useState<PassengerSheetData | null>(null);

  const { data: trip, isLoading } = useQuery({
    queryKey: ['driver', 'trip', 'active', id],
    // getTripById(id) — not getActiveTrip(), which is a findFirst that can
    // return the WRONG trip if the driver has more than one active trip.
    queryFn: () => driverApi.getTripById(id!),
    select: (r) => r.data.data?.trip ?? null,
    // 8s was ~450 requests an hour on the screen a driver sits on for an
    // entire trip, and every one of them re-rendered this whole screen. The
    // trip channel already pushes a complete snapshot on every change, so this
    // poll is a SAFETY NET for a missed socket frame, not the delivery
    // mechanism — it does not need to run at socket cadence.
    refetchInterval: 30000,
    enabled: !!id && typeof id === 'string',
  });

  useEffect(() => {
    if (!id || typeof id !== 'string') goBack();
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
        /**
         * BUGFIX ("when a passenger completes a payment it shouldn't be shown
         * as red — it looks like an error").
         *
         * `notify()` defaults to `tone: 'error'`, because its dominant caller
         * is an `onError` handler. That default is right for the API and wrong
         * for every announcement that is good news, and this is the best news
         * a driver gets: money arrived, in red, with an error haptic.
         */
        notify('Payment confirmed', 'A passenger just completed their payment.', { tone: 'success' });
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
  const handleCancel = () => goDeeper(`/(trip)/cancel/${id}` as Href);

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
    onError: (err: any) => notify('Could not update the trip', err?.response?.data?.message ?? (err as Error).message),
  });

  /**
   * ONE passenger did not board. Not the same event as `noShowTrip` above.
   *
   * That one is "nobody came" — it kills the trip and refunds everyone. This is
   * the minibus case the driver terms describe and the app could not do: a
   * single reserved seat whose passenger never appeared. Marking it releases the
   * seat number back into the map and takes it out of the minimum-occupancy
   * count, so the bus can actually leave; the rest of the trip is untouched.
   *
   * The seat map is what the driver is looking at when they decide this, so the
   * seat sheet is where the action lives.
   */
  const riderNoShow = useMutation({
    mutationFn: ({ bookingId }: { bookingId: string; seatNumber: number }) =>
      driverApi.riderNoShow(id, bookingId),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ['driver', 'trip', 'active', id] });
      notify('Marked as no-show', `Seat ${vars.seatNumber} is free again.`, { tone: 'success' });
    },
    onError: (err: any) =>
      notify(
        'Could not mark no-show',
        err?.response?.data?.message ?? (err as Error).message,
      ),
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
    // 1.5s was not long enough to be sure of. A driver swipes, looks up at the
    // road, and looks back — the confirmation has to survive that glance away,
    // which is the whole reason they were missing it.
    confirmTimer.current = setTimeout(() => setConfirmedLabel(null), 2800);
  }, []);
  useEffect(
    () => () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    },
    [],
  );
  /*
   * The list and the successor function both come from `useTripAdvance` now.
   *
   * This screen used to keep its own copy of each. They agreed on which
   * statuses may advance — CONFIRMED included, because that is the status a
   * trip has immediately after a driver accepts — but NOT on what each one
   * advances to: the local successor derivation omitted DRIVER_ASSIGNED, so a
   * trip reaching this screen by admin assignment, reassignment, or a claimed
   * scheduled ride took the successful path through the mutation and then fell
   * out of every branch below. See `nextStatusAfter`.
   */

  /**
   * The driver's answer to "you're below minimum occupancy — go anyway?".
   *
   * A ref, not state: it is read inside `mutationFn` on the immediate re-run
   * after the Alert, and a `setState` would not have landed by then. Cleared as
   * soon as it is spent, so one acknowledgement covers one departure and the
   * next trip asks again.
   */
  const departUnderMinAckRef = useRef(false);

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
      if (!status || !(VALID_ADVANCE_STATUSES as readonly string[]).includes(status)) throw new Error(`Cannot advance from status: ${status ?? 'unknown'}`);
      pendingFromStatus.current = status;
      // Spend the acknowledgement, if there is one. Read-and-clear in one go:
      // a failed departure must not leave a standing permission behind.
      const ack = departUnderMinAckRef.current;
      departUnderMinAckRef.current = false;
      return advanceRequest(status, id, { acknowledgeUnderMinimum: ack });
    },
    onSuccess: (res) => {
      const toStatus = nextStatusAfter(pendingFromStatus.current);

      /**
       * WRITE THE NEW STATUS STRAIGHT INTO THE CACHE.
       *
       * BUGFIX ("when you switch from one status to the next by swiping or
       * clicking the button, it visibly takes a long while before it updates on
       * the status fields at the top of the manage page").
       *
       * Every branch below only calls `invalidateQueries`, which marks the data
       * stale and starts a REFETCH. So the chips — and the route card's ETA
       * colour, which reads the same status — kept rendering the OLD status
       * until a second network round-trip came back. On a driver's connection
       * that is the "long while": the swipe had already succeeded server-side
       * and the screen was the last thing to find out.
       *
       * We are not guessing here. The mutation resolved, so the transition
       * landed, and `toStatus` is the state machine's only legal successor to
       * the status we sent from. The invalidation still runs underneath and
       * reconciles against the server's own snapshot, so this is a head start,
       * not a competing source of truth.
       *
       * Writes through `applyDriverTripStatus` rather than patching this screen's
       * own key, so the tracking screen and the home card learn about it at the
       * same instant this screen does. Patching only our own key is what left
       * the SIBLING screen stale for minutes — see that function.
       */
      if (toStatus) {
        applyDriverTripStatus(qc, id, toStatus);
      }

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
      /**
       * EVERY FORWARD STEP LANDS ON THE TRACKING SCREEN.
       *
       * BUGFIX — "when the driver app swipes to advance the status, it should
       * redirect to the tracking page. When you start the ride it automatically
       * takes you there, but if you mark as arrived it doesn't, so it's like
       * nothing happens."
       *
       * Only `DRIVER_EN_ROUTE` navigated. The other two steps flashed a
       * confirmation on the swipe control and left the driver on the same
       * screen, which — because that screen's own header is driven by a query
       * that had not refetched yet — looked exactly like a swipe that did
       * nothing. The state HAD moved; there was simply nowhere for the driver
       * to see it move.
       *
       * The tracking screen is where a driver mid-trip belongs: it is the one
       * with the live map, the next action and the passenger list. So arrival
       * and departure now go there too, after the same short confirmation beat
       * so the swipe control gets to finish its own animation first.
       */
      /**
       * ARRIVING KEEPS YOU WHERE THE NEXT ACTION IS.
       *
       * BUGFIX — "if I get to the pickup point and I swipe to say arrived, you
       * don't have to bring me to the tracking page again for me to go back to
       * the manage page to swipe to start. Make it consistent."
       *
       * A previous sweep sent every forward step to the tracking screen, on the
       * reasoning that a swipe with no visible consequence looks broken. The
       * reasoning was sound and the destination was wrong for THIS step:
       * arriving is the moment the driver starts boarding people, and boarding
       * happens on the seat map — which is on this screen. Bouncing them to a
       * map and making them navigate back was a round trip to see less.
       *
       * So arrival stays put, and the consequence is made visible HERE instead:
       * `flashConfirmed` lands on the swipe control, and the arrival banner
       * (see `atPickup` in the render) puts the state where it cannot be missed.
       * Departure still goes to tracking — that IS a change of activity.
       */
      if (toStatus === 'ARRIVED_AT_PICKUP') {
        flashConfirmed('At the pickup point');
        addNotification({ type: 'ARRIVED_AT_PICKUP', title: 'Arrived at pickup', body: 'You have arrived at the pickup stop.', tripId: id });
        qc.invalidateQueries({ queryKey: ['driver', 'trip', 'active', id] });
        qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
        return;
      }
      if (toStatus === 'IN_PROGRESS') {
        flashConfirmed('Trip started');
        addNotification({ type: 'IN_PROGRESS', title: 'Trip in progress', body: 'You have departed. Ride is underway.', tripId: id });
        qc.invalidateQueries({ queryKey: ['driver', 'trip', 'active', id] });
        qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });
        setTimeout(
          () => router.replace({ pathname: '/(trip)/tracking/[id]', params: { id } } as Href),
          520,
        );
        return;
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
      const body = (err as {
        response?: { data?: { code?: string; message?: string; details?: Record<string, number> } };
      })?.response?.data;
      qc.invalidateQueries({ queryKey: ['driver', 'trip', 'active', id] });
      qc.invalidateQueries({ queryKey: ['driver', 'activeTrip'] });

      /**
       * DEPARTING UNDER MINIMUM OCCUPANCY — ASK, DON'T SWALLOW.
       *
       * This must be checked BEFORE the generic 409 branch below, which treats
       * every 409 as "this step already went through". That reading is right for
       * a double swipe and catastrophically wrong here: the departure did NOT
       * happen, and telling the driver their status is up to date would leave
       * them sitting at the pickup point believing they had set off.
       *
       * The group fare divides by `maxSeats`, so departing half-empty means
       * driving the whole route for a fraction of its fare. The driver may still
       * want to — a schedule to keep, one paying passenger, a dead market — but
       * it has to be their call with the numbers in front of them, which is the
       * whole reason the server refuses the first attempt.
       */
      if (status === 409 && body?.code === 'BELOW_MIN_OCCUPANCY') {
        const seats = body.details?.confirmedSeats ?? 0;
        const min = body.details?.minOccupancy ?? 0;
        Alert.alert(
          'Depart with empty seats?',
          `${body.message ?? `You have ${seats} of ${min} seats filled.`}\n\n` +
            'You can wait for more passengers, or depart now and earn less for this trip.',
          [
            { text: 'Keep waiting', style: 'cancel' },
            {
              text: 'Depart anyway',
              style: 'destructive',
              onPress: () => {
                departUnderMinAckRef.current = true;
                advanceStatus.mutate();
              },
            },
          ],
        );
        return;
      }

      /**
       * THE RIDE CANNOT START UNTIL PEOPLE ARE IN THE CAR.
       *
       * BUGFIX (item 16: "I chose to start the trip without boarding and putting
       * the pin in and it still started the ride"), plus "gate starting a ride
       * if no one has been boarded".
       *
       * These two land BEFORE the generic 409 branch below on purpose. That
       * branch reads every conflict as "this step had already gone through",
       * which is true of a duplicate swipe and flatly wrong here — it would tell
       * a driver their trip was up to date at the exact moment the server had
       * refused to start it, and they would have no idea why nothing moved.
       *
       * Both are recoverable in one place: the seat map, on this screen, which
       * is also where the Verify My Ride keypad lives. So the alert points at
       * it rather than describing the rule.
       */
      if (status === 409 && (body?.code === 'NOBODY_BOARDED' || body?.code === 'BOARDING_PIN_REQUIRED')) {
        const pinCase = body?.code === 'BOARDING_PIN_REQUIRED';
        notify(
          pinCase ? 'Verify your passengers first' : 'Board your passengers first',
          body?.message ??
            (pinCase
              ? 'Ask each rider for their 4-digit code and board them before starting.'
              : 'Mark who is in the vehicle on the seat map — the ride cannot start with an empty car.'),
          // The seat map is already on this screen, under the sheet. Lighting it
          // is the pointer — see `highlightSeatMap`. It survives the move off
          // `Alert.alert` as the notice's one action: a driver who is told to
          // board someone and not shown where has been told nothing.
          { action: { label: 'Show me', onPress: () => setSeatMapNudge(true) } },
        );
        return;
      }

      /**
       * "NOTHING HAPPENS."
       *
       * BUGFIX — "if I board the passenger on the driver app, it's like it
       * overrides everything, and even if I swipe to say I've arrived, nothing
       * happens."
       *
       * It was doing something. Boarding a passenger advances the trip on the
       * server, so the driver's next swipe asks to move OUT of a status the trip
       * has already left, and the server answers 409. The handling for that was
       * to append a row to the notifications LIST — a screen the driver is not
       * on, behind a tab they have no reason to open mid-trip. From the kerb it
       * was indistinguishable from a swipe that did not register, so drivers
       * swiped again, which is how the same conflict gets manufactured twice.
       *
       * Say it on the control that was swiped. `flashConfirmed` is the swipe's
       * own confirmed state — the same green tick a successful step produces —
       * because from the driver's point of view the step IS done. The list entry
       * stays for the record.
       */
      if (status === 409) {
        flashConfirmed('Already up to date');
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
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
      notify("Couldn't update the trip", message);
    },
  });

  // BUGFIX: pickup/dest markers used to silently collapse onto a hard-coded
  // Accra centre whenever trip.route lacked real coordinates, rendering a fake
  // pickup/destination pin on the driver's own map. An active trip's route
  // should always carry real coordinates (route creation requires successful
  // geocoding), but stay null instead of fabricating one if it somehow doesn't —
  // every consumer then renders nothing rather than a plausible lie.
  /**
   * THE TRIP'S OWN ENDPOINTS COME FIRST, THE ROUTE'S SECOND.
   *
   * BUGFIX ("the Navigate button opens the map with my current location as the
   * pickup and the trip's pickup point as the destination"), root cause half.
   *
   * These read `trip.route.*` and nothing else. A `Route` is the group/bus
   * product; an ON-DEMAND ride carries its endpoints as `pickupLat/Lng` and
   * `dropoffLat/Lng` columns on the trip itself and may have no route at all.
   * So on every hailed ride both of these were null, `externalNavTarget`
   * handed the map app `NaN, NaN`, and the only thing left for it to plot was
   * the address string — or, failing that, wherever the phone happened to be.
   *
   * Ordered trip-first rather than route-first because for an ad-hoc route the
   * two agree, and where they can disagree the trip's columns are the ones the
   * rider actually chose.
   */
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const coordOf = (lat: unknown, lng: unknown): [number, number] | null => {
    const la = num(lat); const ln = num(lng);
    return la != null && ln != null ? [ln, la] : null;
  };
  const pickupCoord: [number, number] | null =
    coordOf((trip as any)?.pickupLat, (trip as any)?.pickupLng)
    ?? coordOf((trip as any)?.pickup?.lat, (trip as any)?.pickup?.lng)
    ?? coordOf(trip?.route?.originLat, trip?.route?.originLng);
  const destCoord: [number, number] | null =
    coordOf((trip as any)?.dropoffLat, (trip as any)?.dropoffLng)
    ?? coordOf((trip as any)?.dropoff?.lat, (trip as any)?.dropoff?.lng)
    ?? coordOf(trip?.route?.destLat, trip?.route?.destLng)
    ?? pickupCoord;

  // What the external-navigation hand-off should aim at: the same phase rule as
  // the route line above, so tapping Navigate never contradicts the line the
  // driver is already following.
  /**
   * Where Navigate sends the driver, and — the part that was missing — what it
   * CALLS the place.
   *
   * BUGFIX ("the navigate button takes you to Google Maps but pure coordinates
   * so it's not searchable"). Two independent causes, both here:
   *
   *   1. `trip.route.*Name` is null for every ON-DEMAND trip — a route is the
   *      group/bus product only — so the label fell through to the literal
   *      strings "Destination" and "Pickup", which are not places.
   *   2. Even a good label was thrown away downstream; see the note in
   *      utils/externalNav.ts.
   *
   * The trip's own `pickupAddress`/`dropoffAddress` are the geocoded strings the
   * rider actually chose, so they are what a driver should see and search. The
   * route name is the fallback for group trips, and coordinates are the last
   * resort — `searchableAddress` in @eyego/utils rejects placeholders like
   * "Current Location" so they can never leak into another app.
   */
  const tripPickupPlace = useCallback((): GeoPlace => {
    const t = trip as any;
    return {
      latitude: pickupCoord ? pickupCoord[1] : NaN,
      longitude: pickupCoord ? pickupCoord[0] : NaN,
      address: originLabel(t),
      label: 'Pickup',
    };
  }, [trip, pickupCoord]);

  /** The trip's drop-off as a place the map app can search, not a coordinate. */
  const tripDestinationPlace = useCallback((): GeoPlace => {
    const t = trip as any;
    return {
      latitude: destCoord ? destCoord[1] : NaN,
      longitude: destCoord ? destCoord[0] : NaN,
      address: destinationLabel(t),
      label: 'Destination',
    };
  }, [trip, destCoord]);

  /**
   * NAVIGATE OFFERS BOTH LEGS, NOT JUST THE ONE THE PHASE IMPLIES.
   *
   * BUGFIX ("when I click Navigate on the manage page it should make sure the
   * pickup point shown is the pickup point put in the trip, and the destination
   * should proceed to the maps so the driver can use it if they want to use
   * that one").
   *
   * The old button had exactly one behaviour per phase: before pickup it routed
   * current-position → pickup and there was NO way to hand the drop-off to the
   * map app at all. A driver who wants to see the whole job before they set off
   * — where am I taking this person, is it worth it, which way will I come back
   * — had nothing to tap.
   *
   * So the tap now names the two legs explicitly, using the trip's OWN
   * endpoints (`pickupLat/Lng`, `dropoffLat/Lng`) rather than the driver's
   * current position for the pickup end:
   *
   *   • "To pickup"        — from wherever the driver is, to the trip's pickup.
   *   • "Pickup → Destination" — the passenger's actual journey, anchored at the
   *     trip's pickup so the map app plots the leg the rider booked rather than
   *     a line from the kerb the driver happens to be standing on.
   *
   * The phase-appropriate leg is listed first so the common case is still one
   * tap plus one confirm, and long-press still re-asks which map app to use.
   * A trip with no usable drop-off (a group route still filling) skips straight
   * to the pickup leg rather than offering a dead option.
   */
  const openNavigation = useCallback(
    (forceChooser: boolean) => {
      const carrying = trip?.status === 'IN_PROGRESS' || trip?.status === 'COMPLETED';
      const hasDest = !!destCoord && destCoord !== pickupCoord;

      const goPickup = () =>
        void openExternalNavigation(tripPickupPlace(), { forceChooser, origin: null });
      const goFullLeg = () =>
        void openExternalNavigation(tripDestinationPlace(), {
          forceChooser,
          // Anchored at the TRIP's pickup — the whole point of the report.
          origin: pickupCoord ? tripPickupPlace() : null,
        });

      if (!hasDest) return goPickup();
      if (!pickupCoord) return goFullLeg();

      const pickupLabel = 'To pickup';
      const legLabel = 'Pickup → Destination';
      const buttons = carrying
        ? [
            { text: legLabel, onPress: goFullLeg },
            { text: pickupLabel, onPress: goPickup },
          ]
        : [
            { text: pickupLabel, onPress: goPickup },
            { text: legLabel, onPress: goFullLeg },
          ];

      Alert.alert(
        'Open in maps',
        [
          (trip as any)?.pickupAddress ?? (trip as any)?.pickup?.address
            ? `Pickup: ${(trip as any).pickupAddress ?? (trip as any).pickup?.address}`
            : null,
          (trip as any)?.dropoffAddress ?? (trip as any)?.dropoff?.address
            ? `Destination: ${(trip as any).dropoffAddress ?? (trip as any).dropoff?.address}`
            : null,
        ]
          .filter(Boolean)
          .join('\n') || 'Choose which leg to navigate.',
        [...buttons, { text: 'Cancel', style: 'cancel' as const }],
      );
    },
    [trip, destCoord, pickupCoord, tripPickupPlace, tripDestinationPlace],
  );

  /**
   * The trip as a list of places — the projection this screen is now built on.
   *
   * ONE derivation, shared with the tracking screen, so the two cannot form
   * different opinions of the same route. See components/trip/useTripStops.ts.
   *
   * ── WHY IT IS UP HERE AND NOT BESIDE THE CODE THAT USES IT ───────────────
   *
   * BUGFIX ("I tried creating a trip on the driver app and it's telling me
   * something went wrong and that it rendered more hooks than during the
   * previous render… opening the new manage trip page and the tracking page
   * throws that error").
   *
   * This call used to sit ~115 lines BELOW the `if (isLoading || !trip)` guard
   * that returns the skeleton. That is a conditional hook, and it fires on the
   * single most ordinary path this screen has:
   *
   *   render 1  query loading, no trip  → guard returns the skeleton early, so
   *                                       React records N hooks for this
   *                                       component;
   *   render 2  the trip arrives        → the guard no longer fires, execution
   *                                       reaches `useTripStops`, and React
   *                                       counts N+1.
   *
   * "Rendered more hooks than during the previous render", every single time
   * the page was opened and the trip loaded. Nothing about it was intermittent;
   * it only looked that way because a cached trip skips render 1.
   *
   * `useTripStops` is null-safe by construction (`trip?.` throughout), so
   * calling it before the trip exists is free — it returns empty stops for one
   * frame and then the real ones. The rule it now obeys is the ordinary one:
   * every hook runs before any early return.
   */
  const { stops } = useTripStops(trip);

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
            with no way back short of force-closing the app.

            It names the screen, not the group. `'/(tabs)'` is a group with no
            screen of its own, so expo-router has nothing to match and renders
            "Unmatched Route · eyego-driver:///" — which is worse than the stuck
            skeleton this button exists to escape. Same defect as the one already
            fixed on the dispatch screen; this copy of it survived because the
            `as any` hid it from the compiler. */}
        {!isLoading && !trip && (
          <Pressable
            onPress={() => router.replace('/(tabs)/home')}
            hitSlop={12}
            style={[styles.backEscapeButton, { top: insets.top + 12 }]}
           accessibilityRole="button">
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
  // `driverEarningsPerSeatPesewas` is no longer read here: earnings are summed
  // from the booking rows below rather than multiplied out of a per-seat figure,
  // so there is nothing left for a per-seat net to be multiplied by.
  //
  // Seat-occupying rows only — the server already filters these with
  // seatOccupyingWhere(), and "not CANCELLED" would let an EXPIRED hold, a
  // NO_SHOW and a REFUND back in as passengers.
  const activeBookings = rawBookings.filter(
    (b: TripBooking) => !['CANCELLED', 'EXPIRED', 'REFUNDED', 'NO_SHOW'].includes(b.status),
  );
  /** Who is paying for whom — see attachGroupSummary in drivers.service.js. */
  const groupInfo = (trip as {
    group?: {
      coverAll: boolean;
      leadName: string | null;
      seatCount: number;
      seatNumbers: number[];
      totalPesewas: number;
      settledSeatCount: number;
      settled: boolean;
      paymentMethod: string | null;
    } | null;
  }).group ?? null;
  // A HELD seat is reserved, not sold: the rider has picked it but not paid,
  // and it releases itself if they never do. It must be visible on the map (a
  // driver needs to know the seat isn't free) but it must NOT be counted as
  // revenue, or the earnings card promises money that may never arrive.
  //
  // BUGFIX ("I opened the group hub and closed the app without picking a payment
  // method, and the driver's earnings already showed one person paid").
  //
  // `b.paymentMethod !== 'CASH'` was the hole. A booking's payment METHOD says
  // nothing about whether anyone committed to it — and the group hub pre-creates
  // its hold with `paymentMethod: 'CASH'` as a placeholder before the rider has
  // chosen anything at all. So every abandoned invite read as a settled cash
  // passenger and went straight into `grossEarnings`.
  //
  // Commitment is a STATUS. `SEAT_HELD`/`PENDING` is a reservation with a timer
  // on it; `CONFIRMED` and beyond is a rider who said yes, which for cash means
  // the fare is owed to the driver in hand. Paid outright counts regardless, and
  // so does a seat the driver added themselves.
  const isHeld = (b: TripBooking) =>
    !b.isOffline &&
    b.paymentStatus !== 'PAID' &&
    !['CONFIRMED', 'BOARDED', 'COMPLETED'].includes(b.status);
  const paidBookings = activeBookings.filter((b: TripBooking) => !isHeld(b));
  /**
   * SEATS, NOT ROWS.
   *
   * BUGFIX ("I chose to book for 3 seats but the driver app shows 1"). A group
   * seat is one booking row; an on-demand party of three is ONE row carrying
   * three, because it is one payment and one person to phone. Counting rows was
   * right for one product and understated the other by the size of the party.
   * `seatsOf` reads `Booking.seats`, which is 1 for every legacy row.
   */
  const heldCount = activeBookings.reduce((n: number, b: any) => n + (isHeld(b) ? seatsOf(b) : 0), 0);
  const passengers = paidBookings.reduce((n: number, b: any) => n + seatsOf(b), 0);
  /**
   * SEATS ACTUALLY IN THE CAR — the precondition the server now enforces.
   *
   * "Gate starting a ride if no one has been boarded." The swipe at
   * ARRIVED_AT_PICKUP is refused with 409 NOBODY_BOARDED while this is zero, so
   * the screen says so BEFORE the swipe rather than after it.
   */
  const boardedSeats = activeBookings.reduce(
    (n: number, b: any) => n + (b.status === 'BOARDED' || b.status === 'COMPLETED' ? seatsOf(b) : 0),
    0,
  );

  // `stops` is derived ABOVE the loading guard — see the note there.

  /**
   * ── THE BOARDING RUN ──────────────────────────────────────────────────────
   * Everyone who has paid and is not yet in the vehicle, in seat order. Unpaid
   * holds are excluded: a hold is a reservation that may still evaporate, and
   * boarding one would put somebody in a seat they have not bought.
   *
   * Plain consts and plain functions, deliberately — they sit below this
   * screen's loading guard, where a hook cannot go.
   */
  const pendingBoarders: { bookingId: string; seatNumber: number; name: string }[] =
    (activeBookings as any[])
      .filter((b) => b.status !== 'BOARDED' && b.status !== 'COMPLETED' && !isHeld(b))
      .slice()
      .sort((a, b) => (a.seatNumber ?? 0) - (b.seatNumber ?? 0))
      .map((b) => ({
        bookingId: b.id as string,
        seatNumber: typeof b.seatNumber === 'number' ? b.seatNumber : 0,
        name: (b.guestName ?? b.user?.name ?? 'Passenger') as string,
      }));

  /**
   * Walk the queue. Each step boards one passenger; a rider who asked for a
   * code stops the walk at the keypad and the driver's `Confirm` resumes it
   * from the same index with the digits attached.
   *
   * A named function expression so the recursion has a name to call, and
   * recursive rather than a loop because the pauses are asynchronous — the
   * driver typing four digits is a suspension of the walk, not an exit from it.
   */
  const runBoarding = async function step(
    queue: { bookingId: string; seatNumber: number; name: string }[],
    index: number,
    pin?: string,
  ): Promise<void> {
    if (index >= queue.length) {
      // Queue drained: everybody who is coming is aboard. Pull off.
      setBoardingRun(null);
      setPinPrompt(null);
      setPinValue('');
      setPinError(null);
      advanceStatus.mutate();
      return;
    }

    const who = queue[index];
    setBoardingRun({ queue, index });
    try {
      setPinBusy(true);
      await driverApi.boardPassenger(id!, who.bookingId, pin);
      setPinPrompt(null);
      setPinValue('');
      setPinError(null);
      qc.invalidateQueries({ queryKey: ['driver', 'trip', 'active', id] });
      await step(queue, index + 1);
    } catch (err: any) {
      const code = err?.response?.data?.code ?? err?.response?.data?.error?.code;
      const msg = err?.response?.data?.message ?? 'Could not board that passenger.';
      if (code === 'PIN_REQUIRED') {
        // Stop here and raise the code on the rider's phone too — the driver is
        // about to ask for a number the rider has to be able to see.
        setPinValue('');
        setPinError(null);
        setPinPrompt(who);
        void driverApi.requestBoardingPin(id!, who.bookingId).catch(() => {});
        return;
      }
      if (code === 'PIN_INCORRECT') {
        // Keypad stays open. A mistyped digit is not a rejected passenger.
        setPinError(msg);
        setPinValue('');
        return;
      }
      if (err?.response?.status === 409) {
        // Already aboard — the queue catching up with a seat the driver boarded
        // by hand a moment ago. Not a failure; carry on down the row.
        await step(queue, index + 1);
        return;
      }
      setBoardingRun(null);
      setPinPrompt(null);
      notify('Could not board that passenger', msg);
    } finally {
      setPinBusy(false);
    }
  };

  /**
   * "NOT HERE" — the seat nobody claimed.
   *
   * Releases it and moves on rather than abandoning the whole run: a bus that
   * cannot leave because one passenger did not show is the exact situation
   * `riderNoShow` exists to end. A failure to release is swallowed on purpose —
   * stranding the vehicle over a bookkeeping call would be worse than the
   * stale seat it leaves behind, and the server reconciles it either way.
   */
  const skipBoarder = async () => {
    if (!boardingRun) return;
    const { queue, index } = boardingRun;
    const who = queue[index];
    try {
      setPinBusy(true);
      await driverApi.riderNoShow(id!, who.bookingId);
      qc.invalidateQueries({ queryKey: ['driver', 'trip', 'active', id] });
    } catch {
      /* see above */
    } finally {
      setPinBusy(false);
    }
    await runBoarding(queue, index + 1);
  };

  /**
   * WHAT THE PRIMARY SWIPE DOES.
   *
   * At the kerb it is the whole boarding routine (see `boardingRun`). Anywhere
   * else it is the plain status transition it has always been — heading to the
   * pickup, completing the trip. Only `ARRIVED_AT_PICKUP` has passengers
   * standing in front of the vehicle waiting to get in.
   */
  const startsTheRide = trip.status === 'ARRIVED_AT_PICKUP';
  const beginPrimaryAction = () => {
    if (startsTheRide && pendingBoarders.length > 0) {
      void runBoarding(pendingBoarders, 0);
      return;
    }
    advanceStatus.mutate();
  };

  /**
   * ── IS THERE A SEAT TO SELL AT ALL? ────────────────────────────────────────
   *
   * BUGFIX ("I booked 2 seats… I tried to add an offline passenger but it's
   * allowing me to. Once it's booked I shouldn't be able to").
   *
   * "Add Rider" was rendered unconditionally, on every trip, at every occupancy.
   * Two cases where it should never appear:
   *
   *  • A PRIVATE ON-DEMAND RIDE. The vehicle belongs to the party that hailed
   *    it, however many of them there are; there is no seat that is the
   *    driver's to sell, and offering one puts a stranger in a car a rider
   *    booked for their own people.
   *  • A FULL VEHICLE. Counted as PEOPLE, so a single booking carrying a party
   *    of three fills three seats — the row-count version of this sum is what
   *    told the driver "1 of 2 free" about a car with two passengers in it.
   *
   * The server refuses both (`PRIVATE_RIDE_NO_OFFLINE_SEATS` / `TRIP_FULL`), so
   * this is the same rule stated where the driver can see it rather than
   * discovered as a rejected request.
   */
  const isPrivateRide = trip?.isOnDemand === true || (!trip?.routeId && !trip?.route);
  const occupiedSeats = activeBookings.reduce((n: number, b: any) => n + seatsOf(b), 0);
  const canAddRider = !isPrivateRide && occupiedSeats < (trip?.maxSeats ?? 0);
  /**
   * ONE FARE DENOMINATOR. Sum the seats that were actually sold, at the price
   * each was actually sold for.
   *
   * `passengers × trip.farePerSeatPesewas` was a SECOND derivation of the same
   * money, and it disagreed with the first the moment any booking carried a
   * surcharge: a group host's seat with heavy cargo on it is genuinely worth more
   * than the listed per-seat price, so the driver was quoted a gross that no
   * booking row supported. The rows are the record.
   */
  const grossEarnings = paidBookings.reduce(
    (s: number, b: any) => s + (Number(b.fareAmountPesewas) || fullFare),
    0,
  );
  const platformFeePesewas = paidBookings.reduce((s: number, b: any) => {
    const c = Number(b.commissionAmountPesewas);
    return s + (Number.isFinite(c) ? c : Math.round((Number(b.fareAmountPesewas) || fullFare) * commissionRate));
  }, 0);
  const netEarnings = Math.max(0, grossEarnings - platformFeePesewas);
  /**
   * ONE NAME PER PERSON ON THE SEAT MAP.
   *
   * BUGFIX ("if a user chooses to pay for everything, it shouldn't list the
   * passengers as a duplicate of the user for all the seats — it should show
   * that the one user paid for everyone, so it's consistent and neat").
   *
   * A cover-all rider owns one booking per covered seat, so mapping bookings
   * straight to tiles printed the same name across the whole van. The seats are
   * real and must stay drawn — the driver still boards each one — but only the
   * anchor (lowest-numbered) seat carries the payer's name; the rest say who
   * covered them instead of impersonating twelve different passengers.
   */
  const anchorSeatByUser = new Map<string, number>();
  for (const b of activeBookings as any[]) {
    const uid = b.user?.id ?? b.userId;
    if (!uid || typeof b.seatNumber !== 'number') continue;
    const current = anchorSeatByUser.get(uid);
    if (current == null || b.seatNumber < current) anchorSeatByUser.set(uid, b.seatNumber);
  }
  const seatsHeldByUser = new Map<string, number>();
  for (const b of activeBookings as any[]) {
    const uid = b.user?.id ?? b.userId;
    if (!uid) continue;
    // Seats, not rows — one on-demand row can be a party of three.
    seatsHeldByUser.set(uid, (seatsHeldByUser.get(uid) ?? 0) + seatsOf(b));
  }

  /**
   * ── ONE TILE PER SEAT, NOT ONE TILE PER BOOKING ──────────────────────────
   *
   * BUGFIX ("if a rider books for 3 seats (on demand ride) and the rider is
   * boarded, it should mark all the seats as boarded in the seat map — at the
   * moment it marks just one seat as boarded and the rest are left in the
   * reserved state, but it shows 3/3 booked").
   *
   * The two halves of the card were counting different things. Every header
   * number on this screen already went through `seatsOf`, which reads
   * `Booking.seats` and answers 3 for a party of three — so the header said
   * 3/3. The grid underneath was `activeBookings.map`, one tile per ROW, and a
   * party of three is ONE row. So three seats were sold, three seats were paid
   * for, one tile was drawn, and boarding that tile left the other two looking
   * like passengers who had not turned up.
   *
   * A booking carries a single `seatNumber` — its anchor. The extra seats it
   * bought are real seats on the vehicle that simply have no row of their own,
   * so they are allocated here: the lowest free numbers not already claimed by
   * another booking's anchor. Every tile a booking owns then shares that
   * booking's status, which is the invariant that was missing — boarding a
   * party boards the whole party, because it always did server-side.
   *
   * Allocation is deterministic (anchors first, then ascending) so the grid
   * does not reshuffle itself between renders.
   */
  const claimedSeatNumbers = new Set<number>(
    (activeBookings as any[])
      .map((b) => b.seatNumber)
      .filter((n): n is number => typeof n === 'number'),
  );
  let nextFreeSeat = 1;
  const takeFreeSeat = (): number => {
    while (claimedSeatNumbers.has(nextFreeSeat)) nextFreeSeat += 1;
    claimedSeatNumbers.add(nextFreeSeat);
    return nextFreeSeat;
  };
  /** The seat numbers one booking occupies: its anchor plus its extra seats. */
  const seatNumbersFor = (b: TripBooking): number[] => {
    const anchor = typeof b.seatNumber === 'number' ? b.seatNumber : takeFreeSeat();
    const extra = Math.max(0, seatsOf(b) - 1);
    return [anchor, ...Array.from({ length: extra }, () => takeFreeSeat())];
  };

  const seats = activeBookings.flatMap((b: TripBooking) => {
    const userId = b.user?.id ?? b.userId;
    /**
     * WHO IS IN THE SEAT, NOT WHO PAID FOR IT.
     *
     * BUGFIX (item 13: "I booked for someone — I put the name there as Sophia
     * Edna and her number and everything — but on the driver manage page,
     * tapping on the seat shows that it's me, Cyril Spencer, and not my
     * guest").
     *
     * `b.user?.name ?? b.guestName` had the priority exactly backwards. A
     * booking made on someone else's behalf carries BOTH: `userId` is the
     * account that pays and owns the tracking, and `guestName`/`guestPhone` are
     * the person standing at the kerb. The account name is never null when it
     * exists, so `??` meant the guest name could not win — and the driver was
     * shown, and told to call, somebody who is not travelling.
     *
     * `guestName` is only ever set when the booker explicitly named someone
     * else, so preferring it cannot mislabel an ordinary booking.
     */
    const realName = b.guestName ?? b.user?.name ?? 'Passenger';
    const holdsMany = userId != null && (seatsHeldByUser.get(userId) ?? 0) > 1;
    const isAnchor = userId != null && anchorSeatByUser.get(userId) === b.seatNumber;
    return seatNumbersFor(b).map((seatNumber: number, seatIdx: number) => ({
      seatNumber,
      // BUGFIX: an unpaid hold used to fall through to 'EMPTY', so the seat map
      // drew it as free while the header counted it as booked — the two halves of
      // the same card disagreed, and a rider whose hold expired looked to the
      // driver like a seat that was never taken.
      status: (
        b.status === 'BOARDED' ? 'BOARDED' : isHeld(b) ? 'HELD' : 'BOOKED'
      ) as 'BOARDED' | 'BOOKED' | 'HELD',
      userId,
      /* The payer's name goes on the anchor tile only — and now, on a party
         booking, only on its FIRST tile. The extra seats this booking bought
         say who covered them rather than printing the same person three times
         across the van, which is the same rule the cover-all case already had. */
      userName: holdsMany && !(isAnchor && seatIdx === 0) ? `Covered by ${realName}` : realName,
      bookingId: b.id,
      /**
       * WHO IS ACTUALLY IN THIS SEAT.
       *
       * BUGFIX ("on the manage page you can see a seat is booked but there's no
       * way to verify the passenger's name and details"). The seat carried a
       * display name and a booking id and nothing else, so the sheet that opens
       * on tap could not tell the driver who they were collecting, how to reach
       * them, whether the seat was paid or held, or whether that person was
       * already aboard — the four things a driver at a kerb needs.
       */
      realName,
      // Same inversion as the name: the guest's number is how the driver
      // reaches the person at the kerb. The booker's number reaches whoever
      // ordered the car, who may be across town.
      phone: b.guestPhone ?? b.user?.phone ?? null,
      // "Is somebody OTHER than the account holder travelling", which is what
      // every caller of this flag actually wants to know. `!b.user?.id` asked
      // "was this booked by a logged-out walk-up", so a named guest booked from
      // an account read as a normal passenger and the seat sheet never said
      // whose ride it really was.
      isGuest: !!b.guestName || !b.user?.id,
      /** The account that booked and pays, when that is not the passenger. */
      bookedBy: b.guestName && b.user?.name ? b.user.name : null,
      seatsHeld: userId != null ? (seatsHeldByUser.get(userId) ?? 1) : 1,
      coveredBy: holdsMany && !isAnchor ? realName : null,
      paymentMethod: b.paymentMethod ?? null,
      paymentStatus: b.paymentStatus ?? null,
      boarded: b.status === 'BOARDED',
      pinVerified: !!b.pinVerifiedAt,
      // The server sends this boolean, never the code itself — a driver who
      // could read the PIN would not have to be told it. See
      // scrubBookingSecrets in drivers.service.js.
      needsPin: !!b.requiresBoardingPin,
    }));
  });

  const currentStepIndex = stepIndexFor(trip.status);

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    /**
     * ── MANAGE, AS A STOP TIMELINE ───────────────────────────────────────────
     *
     * REDESIGN ("completely redesign the manage trip page of the driver app
     * where it shows the seat map and all… I don't want to see the same design
     * you've made of those two pages — take a whole different approach").
     *
     * What this replaced was a full-bleed map with a draggable sheet over it,
     * and inside that sheet: a route card, a status chip row, a six-step rail, a
     * seat GRID whose only affordance was an OS `Alert`, a quick-action row, a
     * swipe control, a pause toggle, a no-show button and a cancel button —
     * stacked vertically, so the single most important control on the screen was
     * usually below the fold, and the map it all sat on was a strip.
     *
     * The deeper problem was the projection. That layout shows the trip's STATE,
     * and a driver is not asking what state the trip is in — they are asking
     * where they are going and who gets on or off when they arrive. On a minibus
     * with four passengers and three drop-offs, a status chip cannot answer
     * either question and a seat grid answers only half of one.
     *
     * So the trip is a list of STOPS, with the people who board or alight at
     * each one nested beneath it, exactly one action pinned at the bottom, and a
     * map pane the driver can trade against the list by dragging. The seat grid
     * becomes a `CabinStrip` inside the current stop — occupancy is context, and
     * the passengers themselves are already listed where they belong.
     *
     * WHAT DID NOT CHANGE: every mutation, socket handler, query key, transition
     * and guard above this line. This is the presentation layer only. Manage
     * remains the sole owner of status transitions (tracking defers to it), and
     * the boarding-PIN run and its keypad are untouched.
     */
    <>
      <StopTimelineSurface
        onBack={() => goBack()}
        title={`${originLabel(trip) ?? 'Pickup'} → ${destinationLabel(trip) ?? 'Destination'}`}
        subtitle={statusCfg.label}
        map={
          <DriverTripMap
            tripId={id!}
            status={trip.status}
            pickup={pickupCoord}
            dropoff={destCoord}
            location={location}
            puckColor={statusCfg.color}
            // The map owns its whole pane now — nothing is docked over it.
            sheetFraction={0}
            active={isActiveTrip}
            onEta={handleEta}
          />
        }
        mapOverlay={
          /**
           * SOS is the only thing that has earned a place on the map.
           *
           * It used to sit in the header next to the back button, which is where
           * a thumb goes by accident. On the map, bottom-right, it is reachable
           * and deliberate — and it is the one control whose value is that it
           * can be found without reading.
           */
          <View style={styles.mapOverlayRow} pointerEvents="box-none">
            <View style={{ flex: 1 }} />
            <Pressable
              style={styles.sosBtn}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Emergency SOS"
              onPress={() =>
                Alert.alert(
                  'Emergency SOS',
                  `This will call the emergency services on ${emergencyNumber}. Are you in immediate danger?`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: `Call ${emergencyNumber}`,
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
                        void callNumber(emergencyNumber, { label: 'the emergency services' });
                      },
                    },
                  ],
                )
              }
            >
              <Text style={styles.sosBtnText}>SOS</Text>
            </Pressable>
          </View>
        }
        action={
          /**
           * ONE ACTION, PINNED.
           *
           * A status transition is legal exactly once and is the reason this
           * screen exists, so it never scrolls away. The swipe (rather than a
           * tap) is unchanged and deliberate — see @eyego/ui SwipeToConfirm: a
           * phone in a cradle on a bad road taps itself.
           */
          statusInfo.next ? (
            <SwipeToConfirm
              label={
                startsTheRide && pendingBoarders.length > 0
                  ? `Swipe to board ${pendingBoarders.length === 1 ? pendingBoarders[0].name.split(' ')[0] : `${pendingBoarders.length} passengers`} & go`
                  : `Swipe to ${statusInfo.action.replace(/^(I've|Mark)\s+/i, '').toLowerCase()}`
              }
              loadingLabel={
                boardingRun ? `Boarding ${boardingRun.index + 1} of ${boardingRun.queue.length}…` : `${statusInfo.action}…`
              }
              onConfirm={beginPrimaryAction}
              loading={advanceStatus.isPending || boardingRun != null}
              confirmed={confirmedLabel != null}
              confirmedLabel={confirmedLabel ?? undefined}
              color={colors.primary}
              onColor={colors.onPrimary ?? '#0A0D14'}
              trackColor={colors.surfaceContainer}
              borderColor={colors.outline}
            />
          ) : null
        }
      >
        <StopTimeline
          stops={stops}
          onNavigate={() => openNavigation(false)}
          onPassenger={(p) => {
            void Haptics.selectionAsync().catch(() => {});
            /**
             * The seat's own row is the source, so the sheet gets the RICH
             * record (payment method, held-vs-paid, PIN requirement) rather
             * than the timeline's summary — the timeline only carries what a
             * row needs to render.
             */
            const seat = seats.find((s: any) => s.bookingId === p.bookingId);
            setSheetPassenger({
              bookingId: p.bookingId,
              name: p.name,
              bookedBy: p.bookedBy,
              coveredBy: seat?.coveredBy ?? null,
              phone: p.phone,
              photo: null,
              seatNumber: p.seatNumber,
              seatsHeld: seat?.seatsHeld ?? 1 + (p.extraSeats?.length ?? 0),
              farePesewas: p.farePesewas,
              paymentMethod: seat?.paymentMethod ?? null,
              paymentStatus: p.paid ? 'PAID' : (seat?.paymentStatus ?? null),
              boarded: p.boarded,
              noShow: p.noShow,
              held: seat?.status === 'HELD',
              needsPin: seat?.needsPin ?? false,
            });
          }}
          currentStopAccessory={
            <CabinStrip
              seatsTotal={total}
              seatsTaken={passengers}
              boarded={boardedSeats}
              onPress={() => setSeatMapNudge(true)}
            />
          }
        />

        {/* ── SECONDARY ACTIONS ── */}
        <View style={styles.quickRow}>
          <QuickAction icon="navigate" label="Navigate" color={colors.primary} colors={colors} onPress={() => openNavigation(false)} />
          {canAddRider && (
            <QuickAction
              icon="person-add"
              label="Add Rider"
              color={colors.primary} colors={colors}
              onPress={() => goDeeper({ pathname: '/(trip)/add-passenger', params: { tripId: id } } as Href)}
            />
          )}
          <QuickAction
            icon="chatbubble"
            label="Chat"
            color={colors.primary} colors={colors}
            badge={unreadChats}
            onPress={() => goDeeper(`/(trip)/chat/${id}` as Href)}
          />
          <QuickAction
            icon="map"
            label="Tracking"
            color={colors.primary} colors={colors}
            onPress={() => goLateral(`/(trip)/tracking/${id}`)}
          />
          <QuickAction
            icon="qr-code"
            label="Scan to pay"
            color={colors.primary} colors={colors}
            onPress={() => setQrMode('pay')}
          />
        </View>

        {/*
          PAUSE REQUESTS — mid-trip, without going offline.

          Kept, and kept HERE, for the reason it was added: the offers that
          matter arrive while the driver is still carrying someone, and going
          offline to stop them costs their place in the supply index. Optimistic,
          because a switch that waits on a round trip reads as broken and this
          one is tapped in traffic.
        */}
        <Pressable
          style={styles.pauseRow}
          onPress={async () => {
            const next = !requestsPaused;
            setRequestsPaused(next);
            try {
              await driverApi.setRequestsPaused(next);
            } catch {
              setRequestsPaused(!next);
              notify(
                'Could not change that',
                "We couldn't reach the server. Your request settings are unchanged.",
              );
            }
          }}
          accessibilityRole="switch"
          accessibilityState={{ checked: requestsPaused }}
          accessibilityLabel="Pause incoming trip requests"
        >
          <Ionicons
            name={requestsPaused ? 'pause-circle' : 'play-circle-outline'}
            size={20}
            color={requestsPaused ? colors.statusWarning : colors.onSurfaceVariant}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.pauseLabel}>
              {requestsPaused ? 'New requests paused' : 'Accepting new requests'}
            </Text>
            <Text style={styles.pauseHint}>
              {requestsPaused
                ? "You'll finish this trip without new offers arriving."
                : 'Offers can arrive while you finish this trip.'}
            </Text>
          </View>
        </Pressable>

        {/* ── ENDING THE TRIP BADLY. Last, quiet, and each behind a confirm. ── */}
        <View style={styles.endRow}>
          <Pressable
            style={styles.endBtn}
            accessibilityRole="button"
            accessibilityLabel="Mark this trip as a no-show"
            onPress={() =>
              Alert.alert(
                'Nobody showed up?',
                'This cancels the trip and refunds every passenger. Your cancellation rate is not affected by a genuine no-show.',
                [
                  { text: 'Keep waiting', style: 'cancel' },
                  { text: 'Mark No Show', style: 'destructive', onPress: () => noShowTrip.mutate() },
                ],
              )
            }
          >
            <Text style={[styles.endBtnText, { color: colors.onSurfaceVariant }]}>No-show</Text>
          </Pressable>
          <Pressable
            style={styles.endBtn}
            onPress={handleCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel this trip"
          >
            <Text style={[styles.endBtnText, { color: colors.error }]}>Cancel trip</Text>
          </Pressable>
        </View>
      </StopTimelineSurface>

      {/*
        The passenger sheet — what tapping a person opens.

        REDESIGN ("the way the modal that's shown when you tap on the seat is
        designed, it's very basic"). It was an `Alert.alert` with six newline-
        joined lines and five stacked OS buttons. See PassengerSheet.
      */}
      <PassengerSheet
        passenger={sheetPassenger}
        onClose={() => setSheetPassenger(null)}
        onMessage={(p) => {
          setSheetPassenger(null);
          goDeeper({
            pathname: '/(trip)/chat/[id]',
            params: {
              id,
              seatNumber: String(p.seatNumber ?? ''),
              recipientId: seats.find((s: any) => s.bookingId === p.bookingId)?.userId ?? '',
              riderName: encodeURIComponent(p.name),
            },
          } as any);
        }}
        onBoard={(p) => {
          setSheetPassenger(null);
          if (!p.bookingId || p.seatNumber == null) return;
          void boardWithPin(p.bookingId, p.seatNumber, p.name);
        }}
        onNoShow={(p) => {
          Alert.alert(
            `Mark ${p.name} as a no-show?`,
            'Their seat is released back into the map and stops counting toward the minimum to depart. This cannot be undone from here.',
            [
              { text: 'Keep the seat', style: 'cancel' },
              {
                text: 'Mark no-show',
                style: 'destructive',
                onPress: () => {
                  setSheetPassenger(null);
                  if (!p.bookingId || p.seatNumber == null) return;
                  riderNoShow.mutate({ bookingId: p.bookingId, seatNumber: p.seatNumber });
                },
              },
            ],
          );
        }}
      />

      {/* Payment QR — lets a boarding rider scan straight into this trip's payment
          screen instead of the driver having no way to hand off a payable code at all. */}
      {/*
        The "Verify My Ride" keypad. Only ever opened by a PIN_REQUIRED from the
        server — see boardWithPin. Four digits, numeric keyboard, and the rider's
        name in the prompt so a driver boarding a full van knows which passenger
        they are asking.
      */}
      <Modal
        visible={pinPrompt != null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          // Backing out of a run ends the run — otherwise the swipe control
          // would sit in its loading state with no keypad to resume from.
          setBoardingRun(null);
          setPinPrompt(null);
        }}
      >
        <View style={styles.pinBackdrop}>
          <View style={styles.pinSheet}>
            {/* WHERE THE DRIVER IS IN THE ROW.
                A keypad with no position is a keypad that could be the last one
                or the first of six, and a driver holding up a queue needs to
                know which. Only shown during a run — a single hand-boarded seat
                has no queue to count. */}
            {boardingRun && boardingRun.queue.length > 1 && (
              <View style={styles.pinProgress}>
                {boardingRun.queue.map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.pinProgressPip,
                      i < boardingRun.index && { backgroundColor: colors.primary },
                      i === boardingRun.index && { backgroundColor: colors.primary, width: 18 },
                    ]}
                  />
                ))}
              </View>
            )}
            <Text variant="titleSmall" style={{ color: colors.onSurface }}>
              Seat {pinPrompt?.seatNumber} · {pinPrompt?.name ?? 'passenger'}
            </Text>
            <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ textAlign: 'center' }}>
              {boardingRun && boardingRun.queue.length > 1
                ? `Passenger ${boardingRun.index + 1} of ${boardingRun.queue.length}. Ask them to read out the 4-digit code on their screen.`
                : 'Ask them to read out the 4-digit code on their screen.'}
            </Text>

            <TextInput maxFontSizeMultiplier={1.4}
              value={pinValue}
              onChangeText={(t) => {
                setPinValue(t.replace(/[^0-9]/g, '').slice(0, 4));
                if (pinError) setPinError(null);
              }}
              keyboardType="number-pad"
              maxLength={4}
              autoFocus
              placeholder="––––"
              placeholderTextColor={colors.outline}
              style={styles.pinInput}
              accessibilityLabel="Enter the rider's 4-digit code"
            />

            {pinError && (
              <Text variant="bodySmall" style={{ color: colors.error, textAlign: 'center' }}>
                {pinError}
              </Text>
            )}

            <View style={styles.pinActions}>
              {/* DURING A RUN THE LEFT BUTTON IS "NOT HERE", NOT "CANCEL".
                  Cancelling out of a boarding run abandons every passenger
                  behind this one; what the driver actually wants at a kerb is
                  to release the seat of the person who did not turn up and keep
                  going. Outside a run it stays a plain dismiss. */}
              <Pressable
                style={styles.pinCancel}
                disabled={pinBusy}
                onPress={() => {
                  if (boardingRun) {
                    void skipBoarder();
                    return;
                  }
                  setPinPrompt(null);
                  setPinValue('');
                  setPinError(null);
                }}
                accessibilityRole="button"
                accessibilityLabel={boardingRun ? 'This passenger is not here' : 'Cancel'}
              >
                <Text style={{ color: colors.onSurfaceVariant }}>
                  {boardingRun ? 'Not here' : 'Cancel'}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.pinConfirm, (pinValue.length !== 4 || pinBusy) && { opacity: 0.5 }]}
                disabled={pinValue.length !== 4 || pinBusy}
                onPress={() => {
                  if (!pinPrompt) return;
                  // Inside a run, resume the walk at the same index with the
                  // digits attached; outside one, board this seat alone.
                  if (boardingRun) {
                    void runBoarding(boardingRun.queue, boardingRun.index, pinValue);
                    return;
                  }
                  void boardWithPin(pinPrompt.bookingId, pinPrompt.seatNumber, pinPrompt.name, pinValue);
                }}
                accessibilityRole="button"
              >
                <Text style={{ color: colors.onPrimary ?? '#0A0D14', fontFamily: fonts.semiBold }}>
                  {pinBusy ? 'Checking…' : boardingRun ? 'Board' : 'Confirm'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/*
        ── TWO CODES, BECAUSE THEY ARE TWO DIFFERENT ASKS ────────────────────
        See `qrMode`. Paying and booking are opposite ends of a ride and the
        screen now says which one it is showing.
      */}
      <Modal visible={qrMode != null} transparent animationType="fade" onRequestClose={() => setQrMode(null)}>
        <Pressable style={styles.qrModalBackdrop} onPress={() => setQrMode(null)} accessibilityRole="button">
          <Pressable style={styles.qrModalCard} onPress={(e) => e.stopPropagation()} accessibilityRole="button">
            <Text style={styles.cardTitle}>{qrMode === 'book' ? 'Scan to Board' : 'Scan to Pay'}</Text>

            {/* One toggle, so the driver can flip between them at the kerb
                without closing the sheet and finding another button. */}
            <View style={styles.qrToggle}>
              {(['pay', 'book'] as const).map((m) => (
                <Pressable
                  key={m}
                  onPress={() => setQrMode(m)}
                  style={[styles.qrToggleBtn, qrMode === m && { backgroundColor: colors.primary }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: qrMode === m }}
                  accessibilityLabel={m === 'pay' ? 'Show the pay code' : 'Show the booking code'}
                >
                  <Text
                    variant="label"
                    color={qrMode === m ? (colors.onPrimary ?? '#0A0D14') : colors.onSurfaceVariant}
                  >
                    {m === 'pay' ? 'Pay fare' : 'Take a seat'}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.qrWrap}>
              {/*
                A real universal-link URL, not a bare `eyego:` string — a
                phone's stock camera cannot act on a custom scheme, so that only
                ever worked from inside the rider app's own scanner.

                BUGFIX ("when I scan the QR from the driver's scan-to-pay page
                using the rider app's scan option, it opens the 'book this ride'
                thing… if I'm already in the trip and I want to scan to pay, I
                should be able to scan to pay directly without booking again").
                Both codes pointed at `/ride/<id>`, which is the trip DETAIL
                screen — the one whose primary button is "Book This Seat". A
                passenger already aboard was being asked to buy a second seat.

                `/pay/trip/<id>` is the payment route and has existed all along;
                nothing linked to it. `/ride/<id>` stays as the BOOKING code,
                which is what it was always right for.
              */}
              <QRCode
                value={
                  qrMode === 'book'
                    ? `https://eyego.app/ride/${id}`
                    : `https://eyego.app/pay/trip/${id}`
                }
                size={220}
              />
            </View>

            <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ textAlign: 'center' }}>
              {qrMode === 'book'
                ? 'Someone at the kerb scans this to take a seat on this trip and pay for it.'
                : 'A passenger already on this trip scans this to pay their fare — it goes straight to payment, not to booking.'}
            </Text>
            <Pressable style={styles.qrCloseBtn} onPress={() => setQrMode(null)} accessibilityRole="button">
              <Text variant="label" color={colors.onSurface}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
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
  badge = 0,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
  onLongPress?: () => void;
  colors: DriverColors;
  /** Unread count. Rendered as a corner pip; 0 renders nothing. */
  badge?: number;
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
     accessibilityRole="button">
      <Ionicons name={icon} size={20} color={color} />
      <Text style={{ fontFamily: fonts.medium, fontSize: 10, lineHeight: 13, color, letterSpacing: 0.2 }}>{label}</Text>
      {badge > 0 && (
        <View
          style={{
            position: 'absolute',
            top: 6,
            right: 10,
            minWidth: 17,
            height: 17,
            borderRadius: 8.5,
            paddingHorizontal: 4,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.primary,
          }}
        >
          <Text style={{ fontFamily: fonts.semiBold, fontSize: 10, lineHeight: 14, color: colors.onPrimary ?? '#0A0D14' }}>
            {badge > 9 ? '9+' : badge}
          </Text>
        </View>
      )}
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
    /** Content rhythm only — padding and the top glow gap come from the shared
     *  shell now, so manage and tracking cannot space themselves differently. */
    /** The pay/book segmented control inside the QR sheet. */
    qrToggle: {
      flexDirection: 'row',
      alignSelf: 'stretch',
      padding: 3,
      borderRadius: radii.full,
      backgroundColor: colors.surfaceContainer,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
    },
    qrToggleBtn: {
      flex: 1,
      minHeight: 38,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.full,
    },

    // ── Stop-timeline surface ──
    /** Bottom-right of the map pane. SOS only — see the render. */
    mapOverlayRow: { flexDirection: 'row', alignItems: 'flex-end' },
    /** The secondary verbs, under the timeline, evenly weighted. */
    quickRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginTop: spacing.base,
    },
    pauseLabel: {
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodyMedium,
      color: colors.onSurface,
    },
    pauseHint: {
      fontFamily: fonts.regular,
      fontSize: fontSizes.caption,
      color: colors.onSurfaceVariant,
      marginTop: 1,
    },
    /**
     * The two ways a trip ends badly. Quiet, last, and side by side rather than
     * stacked as full-width buttons — a destructive action that looks like the
     * primary one gets tapped by mistake, and both of these are irreversible.
     */
    endRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
    endBtn: {
      flex: 1,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
    },
    endBtnText: {
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodySmall,
    },

    sheetInner: {
      gap: spacing.lg,
    },

    // ── Pause requests ──
    pauseRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      borderRadius: radii.xl,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.md,
      overflow: 'hidden',
    },
    pausePill: {
      width: 40,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.surfaceContainerHighest,
      padding: 3,
      justifyContent: 'center',
    },
    pauseKnob: {
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: colors.onSurface,
    },

    // ── "Verify My Ride" keypad ──
    pinBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.72)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing['2xl'],
    },
    pinSheet: {
      width: '100%',
      maxWidth: 340,
      borderRadius: radii['2xl'],
      backgroundColor: colors.surfaceContainerHigh,
      borderWidth: 1,
      borderColor: colors.outline,
      padding: spacing['2xl'],
      gap: spacing.md,
      alignItems: 'center',
    },
    /** The arrival strip. See the render note above `ARRIVED_AT_PICKUP`. */
    arrivedStrip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.base,
      paddingHorizontal: spacing.base,
      borderRadius: radii.xl,
    },
    arrivedDot: { width: 9, height: 9, borderRadius: 5 },
    arrivedTitle: {
      fontFamily: fonts.bold,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.3),
      letterSpacing: -0.1,
    },
    arrivedCount: {
      minWidth: 46,
      paddingHorizontal: 8,
      paddingVertical: 5,
      borderRadius: radii.full,
      borderWidth: 1,
      alignItems: 'center',
    },
    /* Tabular figures: this counter changes as passengers board and a
       proportional 1 would shuffle the pill's width every time. */
    arrivedCountText: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodySmall,
      fontVariant: ['tabular-nums'],
    },
    /** Where in the row of passengers this keypad is. See the render. */
    pinProgress: { flexDirection: 'row', gap: 5, alignItems: 'center', marginBottom: 2 },
    pinProgressPip: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.outline,
    },
    /** Big and widely tracked — the driver is reading this back against a code
     *  being spoken to them, often through a window. */
    pinInput: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.headlineMedium,
      letterSpacing: 12,
      textAlign: 'center',
      color: colors.onSurface,
      paddingVertical: spacing.md,
      minWidth: 180,
    },
    pinActions: {
      flexDirection: 'row',
      gap: spacing.md,
      alignSelf: 'stretch',
    },
    pinCancel: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.base,
      borderRadius: radii.full,
      borderWidth: 1,
      borderColor: colors.outline,
    },
    pinConfirm: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.base,
      borderRadius: radii.full,
      backgroundColor: colors.primary,
    },
    sheetContent: {
      paddingHorizontal: spacing['2xl'],
      /**
       * BUGFIX ("the top part of the pickup and destination section has the top
       * side cut off — the section above the status labels").
       *
       * There was no `paddingTop` at all, so the route card began at y=0 of the
       * sheet content, immediately under the grabber. That card is wrapped in a
       * GradientGlowBorder: the ring is drawn just OUTSIDE the card's bounds and
       * the glow reaches further still, so both were sliced flat by the sheet's
       * rounded top edge. The card looked cropped because it was — the lit
       * border simply had nowhere to be drawn.
       *
       * Big enough to clear the ring, the glow's capped reach, and the grabber
       * above it. See `maxGlowRadius` on the card itself, which is the other
       * half of this fix: padding gives the glow room, the cap stops it needing
       * more than the room it has.
       */
      paddingTop: spacing.lg,
      paddingBottom: 40,
      gap: spacing.lg,
    },
    // Route summary
    /** The lit surface the origin/destination pair sits on. */
    routeCard: {
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.base,
      marginBottom: spacing.lg,
    },
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
    groupPaidBadge: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: radii.full,
    },
    groupPaidBadgeText: {
      fontFamily: fonts.semiBold,
      fontSize: 10,
      lineHeight: 14,
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
    /** The affordance for the seat map's tap target — see the render site. */
    boardingNotice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radii.lg,
      borderWidth: StyleSheet.hairlineWidth,
      marginBottom: spacing.md,
    },
    seatHint: { marginTop: 2, opacity: 0.85 },
    /** The tap hint, on its own line under the Seat Map header. */
    seatHintRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.xs,
      marginBottom: spacing.sm,
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
