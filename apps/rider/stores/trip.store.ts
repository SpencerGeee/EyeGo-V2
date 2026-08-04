import { create } from 'zustand';
import {
  getSocket,
  ridesApi,
  subscribeToTrip,
  serverNow,
  type TripSnapshot,
  type TripStatus,
  type TripEvent,
  type TripChannelState,
} from '@eyego/api';
import type { TripStage } from './tripFlow.store';

/**
 * The rider's single source of truth for the current ride.
 *
 * WHAT THIS REPLACES. Trip state used to live in three places at once —
 * `ride.store.ts`, `tripFlow.store.ts` and assorted React Query caches — with
 * no documented rule for which won when they disagreed, and no version to
 * decide with. On top of that `tripFlow` owned the stage as a client-side
 * STACK: the client decided what stage it was in, and then two `setInterval`
 * polls in the request screen raced the socket pushes to settle the same
 * transition. That is the mechanical reason the request flow felt inconsistent.
 *
 * The rule now: **the server owns the ride, the client owns the camera.**
 * There is one snapshot, it only ever moves forward by version, and the visible
 * stage is a pure function of `status` (see `stageForStatus`). Nothing in the
 * UI may set the stage directly once a trip exists.
 */

interface TripStoreState {
  snapshot: TripSnapshot | null;
  lastSeq: number;
  /** Add to Date.now() for server time. Every countdown uses this. */
  clockSkewMs: number;
  connected: boolean;
  /** True while catching up after a detected gap — drives the "reconnecting" chip. */
  recovering: boolean;
  /** Live dispatch progress: which driver is being asked, and for how much longer. */
  dispatch: {
    driverId: string | null;
    driverLat: number | null;
    driverLng: number | null;
    attempt: number;
    totalCandidates: number;
    expiresAtServerMs: number | null;
    etaSeconds: number | null;
  } | null;

  /** Begin (or resume) following a trip. Idempotent. */
  watch: (tripId: string) => void;
  /** Stop following. Called when the trip goes terminal or the surface closes. */
  unwatch: () => void;
  /** One-call rehydration — cold start, foreground, reconnect. */
  hydrate: () => Promise<TripSnapshot | null>;
  /** Server time on this device. */
  now: () => number;
}

let unsubscribe: (() => void) | null = null;
let watchedTripId: string | null = null;

export const useTripStore = create<TripStoreState>((set, get) => ({
  snapshot: null,
  lastSeq: 0,
  clockSkewMs: 0,
  connected: false,
  recovering: false,
  dispatch: null,

  watch: (tripId) => {
    if (watchedTripId === tripId && unsubscribe) return;
    unsubscribe?.();
    watchedTripId = tripId;

    unsubscribe = subscribeToTrip({
      socket: getSocket(),
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
      onEvent: (event: TripEvent) => {
        // Dispatch progress is not lifecycle — three drivers may be asked in
        // sequence and only one becomes a transition — so it is tracked
        // alongside the snapshot rather than inside it.
        if (event.type === 'DISPATCH_PROGRESS') {
          const p = event.payload;
          if (p.phase === 'OFFERED') {
            set({
              dispatch: {
                driverId: p.driverId ?? null,
                driverLat: p.driverLat ?? null,
                driverLng: p.driverLng ?? null,
                attempt: p.attempt ?? 0,
                totalCandidates: p.totalCandidates ?? 0,
                expiresAtServerMs: p.expiresAtServerMs ?? null,
                etaSeconds: p.etaSeconds ?? null,
              },
            });
          } else if (p.phase === 'SEARCHING' || p.phase === 'WIDENING') {
            set((s) => ({
              dispatch: {
                driverId: null, driverLat: null, driverLng: null,
                attempt: 0,
                totalCandidates: p.totalCandidates ?? s.dispatch?.totalCandidates ?? 0,
                expiresAtServerMs: null, etaSeconds: null,
              },
            }));
          }
        }
        // The search is over the moment a driver is attached or the trip dies.
        if (event.status && !SEARCHING_STATUSES.includes(event.status)) {
          set({ dispatch: null });
        }
      },
    });
  },

  unwatch: () => {
    unsubscribe?.();
    unsubscribe = null;
    watchedTripId = null;
    set({ snapshot: null, lastSeq: 0, dispatch: null, recovering: false });
  },

  hydrate: async () => {
    try {
      const { trip, dispatch, serverNowMs } = await ridesApi.active();
      set({
        snapshot: trip,
        lastSeq: trip?.version ?? 0,
        clockSkewMs: serverNowMs - Date.now(),
        dispatch: dispatch?.currentDriverId
          ? {
              driverId: dispatch.currentDriverId,
              driverLat: null,
              driverLng: null,
              attempt: dispatch.attempt,
              totalCandidates: dispatch.totalCandidates,
              expiresAtServerMs: dispatch.expiresAtServerMs,
              etaSeconds: null,
            }
          : null,
      });
      if (trip) get().watch(trip.tripId);
      return trip;
    } catch {
      return null;
    }
  },

  now: () => serverNow(get().clockSkewMs),
}));

/** Statuses where the system is still looking for a driver. */
const SEARCHING_STATUSES: TripStatus[] = ['REQUESTED', 'MATCHING', 'REASSIGNING'];

/**
 * The whole stage machine, as one pure function.
 *
 * This is the change that matters. The stage is no longer something the client
 * decides and then defends against contradicting pushes — it is a projection
 * of the server's status, so the screen physically cannot disagree with the
 * ride. `search` and `select` are the only stages the client still owns,
 * because at that point no Trip exists and the server has no opinion.
 */
export function stageForStatus(status: TripStatus | null | undefined): TripStage | null {
  switch (status) {
    case 'REQUESTED':
    case 'MATCHING':
    case 'REASSIGNING':
      return 'request';
    case 'DRIVER_ASSIGNED':
    case 'DRIVER_EN_ROUTE':
    case 'ARRIVED_AT_PICKUP':
      return 'assigned';
    case 'IN_PROGRESS':
      return 'tracking';
    // Terminal: the surface is done and the caller routes onward (receipt,
    // rating, or the "no drivers" screen). Deliberately not a stage.
    case 'COMPLETED':
    case 'CANCELLED':
    case 'NO_DRIVERS_FOUND':
    case 'EXPIRED':
    case 'NO_SHOW':
      return null;
    default:
      return null;
  }
}

export const TERMINAL_STATUSES: TripStatus[] = [
  'COMPLETED', 'CANCELLED', 'NO_DRIVERS_FOUND', 'EXPIRED', 'NO_SHOW',
];

export const isTerminal = (s: TripStatus | null | undefined): boolean =>
  !!s && TERMINAL_STATUSES.includes(s);
