'use client';
import React, { useEffect, useRef, useCallback, useState } from 'react';
import { useRouter, useSegments, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import {
  connectDriverSocket,
  disconnectDriverSocket,
  driverSocketEvents,
} from '@eyego/api';
import { useDriverStore } from '../stores/driver.store';
import { useNotificationsStore } from '../stores/notifications.store';
import { useDriverTripStore } from '../stores/trip.store';
import { useChatUnread } from '../stores/chatUnread.store';
import { DriverToast, type ToastTone } from './DriverToast';
import { goDeeper } from '@eyego/ui';

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
  const queryClient = useQueryClient();
  const { isLoggedIn, activeTripId } = useDriverStore();

  /**
   * ONE TOAST, WITH A TONE.
   *
   * The banner used to be four pieces of local state and a hand-rolled
   * `Animated.Value`, all of it rendering in the app's primary blue whatever
   * had happened. `DriverToast` owns the surface now — see its header for the
   * four things that were wrong with the old one. This component's job is to
   * decide WHAT to say; the toast decides how it looks.
   */
  type BannerDest = {
    type: 'chat' | 'dispatch' | 'tracking';
    tripId: string;
    kind?: 'REQUEST' | 'REASSIGNMENT';
    /** The words on the toast's button. No label, no button — see DriverToast. */
    label: string;
  };

  const [toast, setToast] = useState<{
    message: string;
    title?: string;
    icon: keyof typeof Ionicons.glyphMap;
    tone: ToastTone;
    durationMs?: number;
    /**
     * WHERE THIS BANNER GOES, CARRIED BY THE BANNER ITSELF.
     *
     * BUGFIX ("I had one of the notifications and chose to click on the
     * unstyled part, and it took me to a cancelled trip that's stale — the map
     * is blank and all").
     *
     * The destination used to live in a ref that `showBanner` never cleared.
     * Every banner without a destination of its own — "Payment received", "A
     * passenger cancelled their booking", "Trip completed" — inherited whatever
     * the LAST navigable banner had pointed at, which for a driver who has been
     * online a while is a dispatch offer that expired an hour ago. Tapping it
     * opened the offer screen on a dead trip.
     *
     * Making it part of the toast's own state removes the failure by
     * construction: a banner that names no destination has none.
     */
    dest?: BannerDest | null;
  } | null>(null);

  // Refs so socket callbacks never read stale closure values
  const activeTripIdRef = useRef(activeTripId);
  const segmentsRef = useRef(segments);
  useEffect(() => { activeTripIdRef.current = activeTripId; }, [activeTripId]);
  useEffect(() => { segmentsRef.current = segments; }, [segments]);

  const showBanner = useCallback(
    (
      msg: string,
      icon: keyof typeof Ionicons.glyphMap = 'notifications',
      opts: { tone?: ToastTone; title?: string; durationMs?: number; dest?: BannerDest | null } = {},
    ) => {
      setToast({
        message: msg,
        icon,
        tone: opts.tone ?? 'info',
        title: opts.title,
        durationMs: opts.durationMs,
        // Explicit, every time. `undefined` here means "this banner goes
        // nowhere", not "keep whatever the last one pointed at".
        dest: opts.dest ?? null,
      });
    },
    [],
  );

  const dismissToast = useCallback(() => setToast(null), []);

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
      showBanner('Connection lost — reconnecting…', 'wifi-outline', { tone: 'alert' });
    });

    // Re-join the active trip room on (re)connect + clear the reconnecting banner.
    const unsubConnect = driverSocketEvents.onConnect(() => {
      dismissToast();
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
      // BUSY-DRIVER GUARD — a driver already committed to a trip (their own
      // created route or an accepted dispatch) must never be shown an offer
      // for an unrelated rider. Backend filters these out now; this is the
      // client backstop for an emit already in flight when they got busy.
      if (activeTripIdRef.current && activeTripIdRef.current !== tId) return;
      queryClient.invalidateQueries({ queryKey: ['driver', 'trips'] });
      const kind = safeRead(data, 'kind') as 'REQUEST' | 'REASSIGNMENT' | undefined;
      const route = safeRead(data, 'routeOrigin');
      const dest = safeRead(data, 'routeDestination');
      const title = kind === 'REQUEST' ? 'New ride request nearby' : kind === 'REASSIGNMENT' ? 'Trip needs a driver' : 'New trip assigned';
      useNotificationsStore.getState().addNotification({
        type: 'TRIP_ASSIGNED',
        title,
        body: route && dest ? `${route} → ${dest}` : '',
        tripId: tId,
      });
      showBanner(
        route && dest ? `${title}: ${route} → ${dest}` : title,
        'navigate-circle',
        {
          tone: 'offer',
          title,
          durationMs: 9000,
          dest: { type: 'dispatch', tripId: tId, kind, label: 'See the offer' },
        },
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

    /**
     * Somebody just took a seat. The seat-map refresh above is silent by
     * design; this is the half that tells the driver it happened.
     *
     * Reported as "when I book directly using the suggested trip card nothing
     * happens, it just shows on the driver side" — against the invite flow,
     * which ends in a payment and therefore got the payment push. The banner is
     * suppressed on the screens that already show the passenger arriving.
     */
    const unsubPassengerJoined = driverSocketEvents.onPassengerJoined((data) => {
      queryClient.invalidateQueries({ queryKey: ['driver', 'trips'] });
      const tId = safeRead(data, 'tripId');
      if (tId) queryClient.invalidateQueries({ queryKey: ['driver', 'trip', tId] });
      const segs = segmentsRef.current;
      if (segs.some((s) => s === 'tracking' || s === 'active')) return;
      const who = safeRead(data, 'passengerName') ?? 'A passenger';
      const seat = safeRead(data, 'seatNumber');
      showBanner(seat ? `${who} took seat ${seat}` : `${who} joined your trip`, 'person-add-outline');
    });

    // Group chat banners (app-wide, except on the chat screen itself).
    const unsubChat = driverSocketEvents.onChatMessage((msg) => {
      const segs = segmentsRef.current;
      if (segs.some((s) => s === 'chat')) return;
      const text = safeRead(msg, 'text') ?? '';
      const sender = safeRead(msg, 'senderName') ?? 'Passenger';
      const tId = safeRead(msg, 'tripId') ?? activeTripIdRef.current;
      if (!tId) return;
      // The banner lives about four seconds. A driver watching the road misses
      // it, and until now that was the end of it — there was no badge anywhere
      // in this app, so the message left no trace to come back to.
      useChatUnread.getState().received(tId);
      const preview = text.length > 55 ? text.slice(0, 52) + '…' : text;
      showBanner(`${sender}: ${preview}`, 'chatbubble-ellipses', {
        dest: { type: 'chat', tripId: tId, label: 'Reply' },
      });
    });

    // Private (1:1) chat banners.
    const unsubPrivateChat = driverSocketEvents.onPrivateChatMessage((msg) => {
      const segs = segmentsRef.current;
      if (segs.some((s) => s === 'chat')) return;
      const text = safeRead(msg, 'text') ?? '';
      const sender = safeRead(msg, 'senderName') ?? 'Passenger';
      const tId = safeRead(msg, 'tripId') ?? activeTripIdRef.current;
      if (!tId) return;
      useChatUnread.getState().received(tId);
      const preview = text.length > 55 ? text.slice(0, 52) + '…' : text;
      showBanner(`${sender} (private): ${preview}`, 'lock-closed', {
        dest: { type: 'chat', tripId: tId, label: 'Reply' },
      });
    });

    return () => {
      unsubDisconnect();
      unsubConnect();
      unsubAssigned();
      unsubStatus();
      unsubPayment();
      unsubSeat();
      // Was never unsubscribed — every remount left another live listener on
      // the socket, so a driver who logged out and back in got the same
      // "X took seat N" banner two and three times over.
      unsubPassengerJoined();
      unsubChat();
      unsubPrivateChat();
    };
  }, [isLoggedIn, showBanner, dismissToast, queryClient]);

  /**
   * ── THE BANNER THAT DID NOT EXIST: A DISPATCH OFFER ───────────────────────
   *
   * BUGFIX (item 10: "the dispatch can't see your toast notification — when it
   * comes, it doesn't seem to reconnect on its own unless you close the app or
   * go offline and back online").
   *
   * Everything above listens to a NAMED socket event, and the one this file
   * cared most about — `trip:assigned` — is not what the cascade publishes. A
   * dispatch offer rides the sequenced `trip:event` envelope as `type: 'OFFER'`
   * and is parked in the trip store (see stores/trip.store.ts). So
   * `onTripAssigned` fired for essentially nothing, and the driver's only
   * signal that work had arrived was the full-screen offer sheet — which
   * renders ONLY for an exclusive offer. A search that is merely OPEN to this
   * driver, which is most of a ride's five-minute life, announced itself
   * nowhere at all.
   *
   * Subscribing to the STORE rather than to a socket event is what makes this
   * work on every delivery path at once: the socket frame, the two-second REST
   * safety net in `_layout`, and the foreground resync all land in the same
   * place. A reconnect that recovers a missed offer therefore announces itself
   * too, which is the other half of the report.
   */
  const announcedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isLoggedIn) return undefined;
    return useDriverTripStore.subscribe((state) => {
      // The exclusive offer wins — it has a countdown on it. Otherwise, the
      // newest open search this driver could still claim.
      const held = state.offer;
      const claimable = state.pendingRequests.find((r) => !r.heldByAnother && !r.offeredToMe);
      const subject = held
        ? { tripId: held.tripId, where: held.pickupAddress, exclusive: true }
        : claimable
          ? { tripId: claimable.tripId, where: claimable.pickupAddress, exclusive: false }
          : null;

      if (!subject) {
        announcedRef.current = null;
        return;
      }
      // Once per trip, not once per store write. The store is written by every
      // poll, and a toast re-firing every two seconds is worse than none.
      if (announcedRef.current === subject.tripId) return;
      announcedRef.current = subject.tripId;

      // The offer sheet is the announcement for an exclusive hold; the dispatch
      // screen is already showing the ride; mid-trip it is not takeable anyway.
      if (subject.exclusive) return;
      if (segmentsRef.current.some((sg) => sg === 'dispatch')) return;
      if (activeTripIdRef.current) return;

      showBanner(
        subject.where
          ? `Open request from ${subject.where}`
          : 'A ride nearby is open',
        'flash',
        {
          tone: 'offer',
          title: 'Ride available',
          durationMs: 9000,
          // "tap to take it" is gone from the copy: the button says it now.
          dest: { type: 'dispatch', tripId: subject.tripId, kind: 'REQUEST', label: 'Take the ride' },
        },
      );
    });
  }, [isLoggedIn, showBanner]);

  // Suppress on screens that render their own banners/navigation.
  const isOnChat = segments.some((s) => s === 'chat');
  const isOnTrip = segments.some((s) => s === 'tracking' || s === 'active' || s === 'dispatch');
  if (!toast || isOnChat || isOnTrip) return null;

  const dest = toast.dest ?? null;

  const handlePress = () => {
    if (!dest?.tripId) return;
    dismissToast();
    if (dest.type === 'chat') {
      goDeeper({ pathname: '/(trip)/chat/[id]', params: { id: dest.tripId } } as Href);
    } else if (dest.type === 'dispatch') {
      /**
       * A DISPATCH BANNER IS ONLY A DOOR WHILE THE RIDE IS STILL LIVE.
       *
       * The trip store is the driver's own live view of what is being
       * dispatched. If this trip is no longer in it, the search has ended —
       * taken, expired or cancelled — and the offer screen would open on a dead
       * trip with a blank map. It refuses that itself now (see the terminal
       * guard in `(trip)/dispatch/[id].tsx`), but not sending the driver there
       * in the first place is the better answer.
       */
      const live = useDriverTripStore.getState();
      const stillLive =
        live.offer?.tripId === dest.tripId ||
        live.pendingRequests.some((r) => r.tripId === dest.tripId);
      if (!stillLive) {
        showBanner('That ride is gone — another driver took it, or it expired.', 'close-circle', {
          tone: 'alert',
          title: 'No longer available',
        });
        return;
      }
      goDeeper({ pathname: '/(trip)/dispatch/[id]', params: { id: dest.tripId, kind: dest.kind } } as Href);
    } else {
      goDeeper({ pathname: '/(trip)/tracking/[id]', params: { id: dest.tripId } } as Href);
    }
  };

  return (
    <DriverToast
      message={toast.message}
      title={toast.title}
      icon={toast.icon}
      tone={toast.tone}
      durationMs={toast.durationMs}
      actionLabel={dest?.label ?? null}
      onPress={dest?.tripId ? handlePress : undefined}
      onDismiss={dismissToast}
    />
  );
}
