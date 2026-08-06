import { create } from 'zustand';
import {
  getSocket,
  ridesApi,
  socketEvents,
  subscribeToTrip,
  serverNow,
  type TripPath,
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

  /**
   * Live ETA for the leg currently being driven, as the SERVER computed it.
   *
   * One owner for one fact. The legacy tracking screen called Mapbox Directions
   * itself, on a 2→4→8→15 s retry ladder, and displayed that call's duration —
   * so the rider's "6 min away" and the driver's were two different numbers
   * from two different requests, and neither survived navigating away. `leg`
   * matters as much as `minutes`: the same "6 min" means the driver reaching
   * you or you reaching your destination, and conflating them is what made
   * pickup-phase ETAs describe a journey nobody was making yet.
   */
  eta: {
    leg: 'toPickup' | 'toDropoff';
    minutes: number;
    distanceKm: number | null;
    message: string | null;
    rerouted: boolean;
  } | null;

  /**
   * The road line for the live leg. Seeded from `snapshot.path` (so a screen
   * opened mid-trip has a line immediately) and refreshed in place by
   * `trip:eta`/`trip:route` as the driver moves or is re-routed.
   */
  path: TripPath | null;

  /** Begin (or resume) following a trip. Idempotent. */
  watch: (tripId: string) => void;
  /** Stop following. Called when the trip goes terminal or the surface closes. */
  unwatch: () => void;
  /** One-call rehydration — cold start, foreground, reconnect. */
  /**
   * Resolves the rider's active SOLO ride.
   *
   * `ok: false` means the lookup itself failed (offline, 5xx) — it does NOT
   * mean the rider has no trip, and callers must not act as though it does.
   * Collapsing those two cases into a bare `null` is what let a dropped
   * request bounce a rider out of a live trip and back onto the search sheet.
   */
  hydrate: () => Promise<{ trip: TripSnapshot | null; ok: boolean }>;
  /** Server time on this device. */
  now: () => number;
}

let unsubscribe: (() => void) | null = null;
let unsubscribeEta: (() => void) | null = null;
let watchedTripId: string | null = null;

export const useTripStore = create<TripStoreState>((set, get) => ({
  snapshot: null,
  lastSeq: 0,
  clockSkewMs: 0,
  connected: false,
  recovering: false,
  dispatch: null,
  eta: null,
  path: null,

  watch: (tripId) => {
    if (watchedTripId === tripId && unsubscribe) return;
    unsubscribe?.();
    unsubscribeEta?.();
    watchedTripId = tripId;
    // A new trip must not inherit the previous one's line or countdown.
    set({ eta: null, path: null });

    /**
     * `trip:eta` is the only source of the live line and the countdown.
     *
     * It lives here rather than in the map component because both the map and
     * the panel need it, and two subscribers meant two slightly different
     * numbers on one screen. Note this listens on the RIDER namespace socket —
     * the same one `subscribeToTrip` uses — so it is joined to the trip room by
     * the subscribe below and needs no join of its own.
     */
    unsubscribeEta = socketEvents.onTripEta((e: any) => {
      if (e?.tripId && e.tripId !== watchedTripId) return;
      const coords = e?.geometry?.coordinates;
      const leg: 'toPickup' | 'toDropoff' = e?.leg === 'toPickup' ? 'toPickup' : 'toDropoff';
      set((s) => ({
        eta: Number.isFinite(e?.etaMinutes)
          ? {
              leg,
              minutes: Math.max(0, Math.round(e.etaMinutes)),
              distanceKm: Number.isFinite(e?.distanceKm) ? e.distanceKm : null,
              message: typeof e?.message === 'string' ? e.message : null,
              rerouted: e?.rerouted === true,
            }
          : s.eta,
        path:
          Array.isArray(coords) && coords.length >= 2
            ? {
                leg,
                geometry: { type: 'LineString', coordinates: coords },
                distanceKm: Number.isFinite(e?.distanceKm) ? e.distanceKm : 0,
                durationMin: Number.isFinite(e?.etaMinutes) ? e.etaMinutes : 0,
                computedAt: Date.now(),
              }
            : s.path,
      }));
    });

    unsubscribe = subscribeToTrip({
      socket: getSocket(),
      tripId,
      lastSeq: get().snapshot?.tripId === tripId ? get().lastSeq : 0,
      onState: (s: TripChannelState) =>
        set((prev) => ({
          snapshot: s.snapshot,
          lastSeq: s.lastSeq,
          clockSkewMs: s.clockSkewMs,
          connected: s.connected,
          recovering: s.recovering,
          // The snapshot SEEDS the line; it never overwrites a fresher one.
          // `trip:eta` fires every ~10 s or 50 m, so its geometry is newer than
          // the snapshot's cached copy for most of a ride — and a resumed
          // screen needs the snapshot's copy to have something to draw at all.
          path:
            s.snapshot?.path && (prev.path == null || s.snapshot.path.leg !== prev.path.leg)
              ? s.snapshot.path
              : prev.path,
        })),
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
    unsubscribeEta?.();
    unsubscribe = null;
    unsubscribeEta = null;
    watchedTripId = null;
    set({ snapshot: null, lastSeq: 0, dispatch: null, recovering: false, eta: null, path: null });
  },

  hydrate: async () => {
    try {
      const { trip, dispatch, serverNowMs } = await ridesApi.active();
      set({
        snapshot: trip,
        lastSeq: trip?.version ?? 0,
        clockSkewMs: serverNowMs - Date.now(),
        // What makes a cold start mid-trip open with a drawn route instead of
        // two bare pins and a wait for the driver's next GPS fix.
        path: trip?.path ?? null,
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
      return { trip, ok: true };
    } catch {
      return { trip: null, ok: false };
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
