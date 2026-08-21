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
export type TripStage = 'search' | 'configure' | 'select' | 'request' | 'assigned' | 'tracking';

/** Stages the client may still navigate itself — no server trip exists yet. */
export const CLIENT_OWNED_STAGES: TripStage[] = ['search', 'configure', 'select'];

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
  /**
   * The road between pickup and destination, BEFORE any trip exists.
   *
   * `trip.store.path` is the live ride's route and is necessarily null until a
   * trip has been created, so the ride picker had nothing to draw and the map
   * behind it framed two loose pins. This is the same line the quote measured
   * its distance along (`POST /rides/quote` hands it back), which is what makes
   * the route the rider is looking at and the price they are being shown the
   * same fact rather than two calls that might disagree.
   */
  previewPath: { type: 'LineString'; coordinates: [number, number][] } | null;

  /**
   * THE RIDER OPENED THIS SURFACE ON PURPOSE, WHILE ALREADY ON A RIDE.
   *
   * BUGFIX — "oh so I realised if you go to the Where To page, it just takes
   * you to the live ride", and its twin, "I'm already in a trip and I tap on
   * another trip from suggested trips and it lets me book another ride".
   *
   * The projection below is unconditional: the moment a Trip status exists, the
   * surface is dragged to that trip's stage. That is exactly right when the
   * rider is RESUMING a ride — cold start, a tapped notification, a killed app.
   * It is exactly wrong when they deliberately tapped "Where to?", because it
   * makes the search sheet unreachable for the entire duration of a ride.
   *
   * Uber and Bolt both allow the search sheet mid-ride, and both treat what it
   * produces as a ride FOR SOMEONE ELSE — you cannot be in two cars. So this
   * flag says "the rider asked to be here", the projection respects it while
   * they are on a stage no trip owns, and `bookingFor` records whose ride it
   * is going to be. The server enforces the same rule independently
   * (`bookings.service.bookSeat`, `ALREADY_ON_A_RIDE`).
   */
  pinnedToSearch: boolean;
  /**
   * Who this booking is for. `guest` is forced — not defaulted — whenever the
   * rider starts a booking while another of their rides is live.
   */
  bookingFor: 'self' | 'guest';
  /** True when the rider has a live ride elsewhere, so the UI can say so. */
  hasLiveRideElsewhere: boolean;

  setPreviewPath: (path: TripFlowState['previewPath']) => void;
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

  /**
   * "I know I'm on a ride; I want the search sheet anyway."
   *
   * Called by the trip surface once it knows both facts: that the rider asked
   * for a client-owned stage, and that a live ride exists. Pins the surface
   * there and switches the booking to a guest booking.
   */
  pinToSearch: (hasLiveRideElsewhere: boolean) => void;
  /** Release the pin — the rider committed a request, or left the surface. */
  releasePin: () => void;
  setBookingFor: (who: 'self' | 'guest') => void;
}

export const useTripFlow = create<TripFlowState>((set, get) => ({
  stage: 'search',
  stack: ['search'],
  searchPlace: null,
  nearbyDrivers: [],
  dispatchOffer: null,
  pickupCoord: null,
  previewPath: null,
  pinnedToSearch: false,
  bookingFor: 'self',
  hasLiveRideElsewhere: false,

  setPreviewPath: (previewPath) => set({ previewPath }),
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
      // A preview line belongs to one origin/destination pair. Carried into a
      // new surface it would draw the previous trip's road behind this one.
      previewPath: null,
      // A pin belongs to one surface opening. The trip screen re-applies it
      // immediately if the rider is still on a ride — carrying it would leave
      // a resumed trip pinned to a search sheet it never asked for.
      pinnedToSearch: false,
      hasLiveRideElsewhere: false,
      bookingFor: 'self',
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
    set((s) => {
      // The rider deliberately opened the search sheet while a ride of theirs
      // is live. That ride's status has no business dragging them out of a
      // stage no trip owns — see `pinnedToSearch`.
      if (s.pinnedToSearch && CLIENT_OWNED_STAGES.includes(s.stage)) return s;
      return s.stage === stage ? s : { stage, stack: [stage] };
    }),

  pinToSearch: (hasLiveRideElsewhere) =>
    set({ pinnedToSearch: true, hasLiveRideElsewhere, bookingFor: hasLiveRideElsewhere ? 'guest' : 'self' }),

  releasePin: () => set({ pinnedToSearch: false }),

  setBookingFor: (bookingFor) => set({ bookingFor }),

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
