import { create } from 'zustand';

/**
 * Trip-flow stage machine — drives the single persistent trip surface
 * (app/trip.tsx). The booking flow is stages inside ONE route (map + panel
 * stay mounted, content crossfades) instead of separate router pushes that
 * remount the map per screen.
 */
export type TripStage = 'search' | 'select' | 'request' | 'assigned' | 'tracking';

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
  /** Advance to a stage (pushes onto the back stack). */
  go: (stage: TripStage, params?: { bookingId?: string }) => void;
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

  popStage: () => {
    const { stack } = get();
    if (stack.length <= 1) return null;
    const next = stack.slice(0, -1);
    const stage = next[next.length - 1];
    set({ stage, stack: next });
    return stage;
  },
}));
