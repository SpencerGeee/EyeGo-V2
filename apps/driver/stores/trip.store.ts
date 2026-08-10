import { create } from 'zustand';
import {
  getDriverSocket,
  connectDriverSocket,
  disconnectDriverSocket,
  ridesApi,
  subscribeToTrip,
  serverNow,
  secondsRemaining,
  type TripSnapshot,
  type TripStatus,
  type TripEvent,
  type TripChannelState,
} from '@eyego/api';

/**
 * The driver's single source of truth for the current trip and the current
 * dispatch offer.
 *
 * WHAT THIS REPLACES. The driver app learned about its own trip from a
 * scattering of independent socket events (`trip:assigned`, `trip:status_update`,
 * a `dispatch:*` family) plus a REST poll for pending requests, with no
 * sequence number anywhere. Two consequences the driver felt:
 *
 *   - "The app forgot I was on a trip." There was no `GET /driver/state`, so a
 *     cold start after a force-quit rebuilt the trip from whatever the current
 *     screen happened to query. Now `hydrate()` answers it in one call.
 *   - Offer countdowns disagreed between phones, because each device counted
 *     down against its own clock. Every payload now carries `serverNowMs` and
 *     `expiresAtServerMs`; `offerSecondsLeft()` renders the difference, so two
 *     drivers looking at the same offer see the same number.
 */

export interface DispatchOffer {
  tripId: string;
  pickupLat: number | null;
  pickupLng: number | null;
  pickupAddress: string | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
  dropoffAddress: string | null;
  /** Gross fare on the trip, and what this driver actually keeps. Pesewas. */
  farePesewas: number | null;
  driverEarningsPesewas: number | null;
  tier: string | null;
  /** Server deadline. Never compare this to Date.now() directly. */
  expiresAtServerMs: number;
  etaSeconds: number | null;
  attempt: number;
  totalCandidates: number;
}

interface DriverTripState {
  snapshot: TripSnapshot | null;
  lastSeq: number;
  clockSkewMs: number;
  connected: boolean;
  recovering: boolean;
  /** The exclusive offer this driver currently holds, if any. */
  offer: DispatchOffer | null;

  watch: (tripId: string) => void;
  unwatch: () => void;
  /** ONE-CALL REHYDRATION — cold start, foreground, reconnect. */
  hydrate: () => Promise<TripSnapshot | null>;
  /** Start listening for dispatch offers. Call once, while online. */
  listenForOffers: () => () => void;
  clearOffer: () => void;
  now: () => number;
  /** Seconds left on the held offer, against SERVER time. */
  offerSecondsLeft: () => number | null;
}

let unsubscribe: (() => void) | null = null;
let watchedTripId: string | null = null;

export const useDriverTripStore = create<DriverTripState>((set, get) => ({
  snapshot: null,
  lastSeq: 0,
  clockSkewMs: 0,
  connected: false,
  recovering: false,
  offer: null,

  watch: (tripId) => {
    if (watchedTripId === tripId && unsubscribe) return;
    const hadRef = unsubscribe != null;
    unsubscribe?.();
    watchedTripId = tripId;
    // Hold a socket ref for as long as we are watching — `disconnectDriverSocket`
    // nulls the module's socket at zero refs, and this subscription's listeners
    // would be left on the discarded object. See the same note in the rider
    // store; it is the same bug with a different namespace.
    if (!hadRef) connectDriverSocket();
    unsubscribe = subscribeToTrip({
      socket: getDriverSocket(),
      tripId,
      lastSeq: get().snapshot?.tripId === tripId ? get().lastSeq : 0,
      onState: (s: TripChannelState) =>
        set({
          snapshot: s.snapshot,
          lastSeq: s.lastSeq,
          clockSkewMs: s.clockSkewMs,
          connected: s.connected,
          recovering: s.recovering,
        }),
    });
  },

  unwatch: () => {
    const hadRef = unsubscribe != null;
    unsubscribe?.();
    if (hadRef) disconnectDriverSocket();
    unsubscribe = null;
    watchedTripId = null;
    set({ snapshot: null, lastSeq: 0, recovering: false });
  },

  hydrate: async () => {
    try {
      const { trip, serverNowMs } = await ridesApi.driverState();
      set({
        snapshot: trip,
        lastSeq: trip?.version ?? 0,
        clockSkewMs: serverNowMs - Date.now(),
      });
      if (trip) get().watch(trip.tripId);
      return trip;
    } catch {
      return null;
    }
  },

  /**
   * Dispatch offers ride the same `trip:event` envelope as everything else, so
   * there is ONE socket handler in this app rather than one per event name —
   * and one staleness rule (TTL) rather than none.
   */
  listenForOffers: () => {
    const socket = getDriverSocket();
    const handler = (event: TripEvent) => {
      if (event.type === 'OFFER') {
        const p = event.payload;
        set({
          clockSkewMs: event.serverNowMs - Date.now(),
          offer: {
            tripId: p.tripId,
            pickupLat: p.pickupLat ?? null,
            pickupLng: p.pickupLng ?? null,
            pickupAddress: p.pickupAddress ?? null,
            dropoffLat: p.dropoffLat ?? null,
            dropoffLng: p.dropoffLng ?? null,
            dropoffAddress: p.dropoffAddress ?? null,
            farePesewas: p.farePesewas ?? null,
            driverEarningsPesewas: p.driverEarningsPesewas ?? null,
            tier: p.tier ?? null,
            expiresAtServerMs: p.expiresAtServerMs,
            etaSeconds: p.etaSeconds ?? null,
            attempt: p.attempt ?? 0,
            totalCandidates: p.totalCandidates ?? 0,
          },
        });
      } else if (event.type === 'OFFER_REVOKED') {
        // The offer moved on — taken, cancelled or timed out. Told explicitly
        // so no driver is left holding a dead card and tapping Accept into a
        // 409, which is what a broadcast dispatch does to four drivers in five.
        set((s) => (s.offer?.tripId === event.payload?.tripId ? { offer: null } : s));
      }
    };
    socket.on('trip:event', handler);
    return () => socket.off('trip:event', handler);
  },

  clearOffer: () => set({ offer: null }),
  now: () => serverNow(get().clockSkewMs),
  offerSecondsLeft: () => {
    const { offer, clockSkewMs } = get();
    return offer ? secondsRemaining(offer.expiresAtServerMs, clockSkewMs) : null;
  },
}));

/**
 * Which screen this trip belongs on. The mirror image of the rider's
 * `stageForStatus` — same source of truth, so the two apps cannot be showing
 * different phases of the same ride.
 */
export function driverScreenForStatus(
  status: TripStatus | null | undefined,
): 'dispatch' | 'active' | 'tracking' | null {
  switch (status) {
    case 'DRIVER_ASSIGNED':
      return 'dispatch';
    case 'DRIVER_EN_ROUTE':
    case 'ARRIVED_AT_PICKUP':
      return 'active';
    case 'IN_PROGRESS':
      return 'tracking';
    default:
      return null;
  }
}

export const DRIVER_TERMINAL_STATUSES: TripStatus[] = [
  'COMPLETED', 'CANCELLED', 'NO_DRIVERS_FOUND', 'EXPIRED', 'NO_SHOW',
];

export const isTerminal = (s: TripStatus | null | undefined): boolean =>
  !!s && DRIVER_TERMINAL_STATUSES.includes(s);
