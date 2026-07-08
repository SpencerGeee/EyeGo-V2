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

  setSearchPlace: (place: SearchPlace | null) => void;
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

  setSearchPlace: (searchPlace) => set({ searchPlace }),

  seed: ({ stage = 'search', tier, type, morphId, bookingId }) =>
    set({ stage, stack: [stage], tier, type, morphId, bookingId, searchPlace: null }),

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
