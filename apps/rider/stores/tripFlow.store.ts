import { create } from 'zustand';

/**
 * Trip-flow SURFACE state — drives the single persistent trip surface
 * (app/trip.tsx). The booking flow is stages inside ONE route (map + panel
 * stay mounted, content crossfades) instead of separate router pushes that
 * remount the map per screen.
 *
 * IMPORTANT — WHAT THIS STORE NO LONGER DECIDES.
 *
 * `stage` used to be a client-owned STACK: the app pushed itself from
 * 'request' to 'assigned' when it felt like it, while two `setInterval` polls
 * raced socket pushes to settle the same transition with nothing to arbitrate
 * which answer was newer. The screen could — and did — show a stage the server
 * disagreed with.
 *
 * Once a Trip exists, the stage is a pure projection of `Trip.status` via
 * `stageForStatus()` in trip.store.ts. `search` and `select` remain
 * client-owned because at that point no Trip exists and the server has no
 * opinion about where the rider is. Everything from 'request' onwards is
 * derived. Do not call `go()` for a derived stage.
 */
export type TripStage = 'search' | 'select' | 'request' | 'assigned' | 'tracking';

/** Stages the client may still navigate itself — no server trip exists yet. */
export const CLIENT_OWNED_STAGES: TripStage[] = ['search', 'select'];

export type SearchPlace = {
  name: string;
  fullAddress: string;
  latitude: number;
  longitude: number;
};

/** A driver pin on the request-stage map. */
export type NearbyDriver = {
  id: string;
  latitude: number;
  longitude: number;
};

/**
 * Who the dispatch cascade is currently asking. The request stage draws a
 * polyline from the pickup to this driver, and redraws it when the offer moves
 * on — the visible feedback Uber/Bolt give while a ride is being placed.
 */
export type DispatchOffer = {
  driverId: string;
  latitude: number;
  longitude: number;
  /** 1-based position in the candidate queue, for "trying driver 2 of 5". */
  attempt: number;
  totalCandidates: number;
};

interface TripFlowState {
  stage: TripStage;
  /** Stages visited in order — powers back navigation inside the surface. */
  stack: TripStage[];
  tier?: string;
  type?: string;
  morphId?: string;
  bookingId?: string;
  /** Destination picked in the search stage; the persistent map renders its pin. */
  searchPlace: SearchPlace | null;
  /** Live driver pins shown while a request is being dispatched. */
  nearbyDrivers: NearbyDriver[];
  /** The driver currently holding the dispatch offer, if any. */
  dispatchOffer: DispatchOffer | null;
  /** Pickup point the polyline starts from. */
  pickupCoord: [number, number] | null;

  setSearchPlace: (place: SearchPlace | null) => void;
  setNearbyDrivers: (drivers: NearbyDriver[]) => void;
  setDispatchOffer: (offer: DispatchOffer | null) => void;
  setPickupCoord: (coord: [number, number] | null) => void;
  /** Seed the machine when the trip surface opens (from route params). */
  seed: (params: { stage?: TripStage; tier?: string; type?: string; morphId?: string; bookingId?: string }) => void;
  /** Advance to a CLIENT-OWNED stage (pushes onto the back stack). */
  go: (stage: TripStage, params?: { bookingId?: string }) => void;
  /** Project a server-derived stage. Called only from the status subscription. */
  syncFromServer: (stage: TripStage) => void;
  /** Step back one stage; returns the new stage, or null when already at the root. */
  popStage: () => TripStage | null;
}

export const useTripFlow = create<TripFlowState>((set, get) => ({
  stage: 'search',
  stack: ['search'],
  searchPlace: null,
  nearbyDrivers: [],
  dispatchOffer: null,
  pickupCoord: null,

  setSearchPlace: (searchPlace) => set({ searchPlace }),
  setNearbyDrivers: (nearbyDrivers) => set({ nearbyDrivers }),
  setDispatchOffer: (dispatchOffer) => set({ dispatchOffer }),
  setPickupCoord: (pickupCoord) => set({ pickupCoord }),

  seed: ({ stage = 'search', tier, type, morphId, bookingId }) =>
    set({
      stage, stack: [stage], tier, type, morphId, bookingId,
      searchPlace: null,
      // Dispatch state belongs to one request attempt — carrying it into a new
      // surface would draw a polyline to a driver from the previous booking.
      nearbyDrivers: [],
      dispatchOffer: null,
      pickupCoord: null,
    }),

  go: (stage, params) =>
    set((s) => ({ stage, stack: [...s.stack, stage], ...(params ?? {}) })),

  /**
   * Server-driven stage change. Called ONLY by the trip surface's subscription
   * to `Trip.status` — never from a button handler.
   *
   * It replaces the stack rather than pushing onto it: you cannot "go back"
   * from tracking to request, because the ride cannot go back. Making that
   * structural is what stops a stale screen resurrecting a stage the trip has
   * already left.
   */
  syncFromServer: (stage: TripStage) =>
    set((s) => (s.stage === stage ? s : { stage, stack: [stage] })),

  popStage: () => {
    const { stack, stage } = get();
    // Back is a client-owned concept only. Once the server owns the stage,
    // there is nothing to pop — the rider cancels the ride instead.
    if (!CLIENT_OWNED_STAGES.includes(stage)) return null;
    if (stack.length <= 1) return null;
    const next = stack.slice(0, -1);
    const prev = next[next.length - 1];
    set({ stage: prev, stack: next });
    return prev;
  },
}));
