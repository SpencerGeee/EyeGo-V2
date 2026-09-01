import { apiClient } from './client';
import { assertFareQuote } from './money-guards';
import { PendingOfferSchema, PendingDispatchSchema, assertShape, parseEach } from './schemas';
import type { TripSnapshot } from './tripChannel';

/**
 * On-demand rides — the single canonical path, for both apps.
 *
 * Note what is NOT here: no "get dispatch progress", no "check if a driver
 * accepted yet", no "fetch driver location". Those were polls, and polls
 * racing socket pushes with no version to arbitrate is what made the request
 * screen inconsistent. Everything live arrives on `trip:event`; this module is
 * only for things the user actually initiates, plus the two bootstrap calls.
 */

export interface FareQuote {
  quoteId: string;
  amountPesewas: number;
  currency: string;
  distanceKm: number;
  surgeMultiplier: number;
  /**
   * The fare card, line by line.
   *
   * `null` is a real value here and not an oversight: a line that does not
   * apply to this quote is written as null rather than omitted —
   * `doorstepDetourKm` is null on every ride without a detour. Anything
   * rendering this must skip nulls; anything validating it must allow them.
   */
  breakdown: Record<string, number | boolean | null>;
  /**
   * What the ride would have cost, and what this rider's standing saved them.
   *
   * `amountPesewas` above is already NET of the discount — it is the signed,
   * binding price. These two exist so the app can SHOW the saving: a loyalty
   * discount nobody can see does not change anyone's behaviour, which is the
   * entire point of tying it to cancellations. Both are always present and both
   * are zero-safe: a rider who has earned nothing sees a discount of 0 and a
   * list price equal to the amount.
   */
  listPricePesewas?: number;
  loyaltyDiscountPesewas?: number;
  /** EXCELLENT / GOOD / FAIR / NEW / RESTRICTED — see standing.service.js. */
  standingBand?: string | null;
  /**
   * ── WHAT THE SERVER DECIDED ABOUT THE PICKUP PIN ──────────────────────
   *
   * Doorstep pickup is not a checkbox any more; it is a measurement. The quote
   * takes the road-snapped start of the geometry it already fetched and reports
   * how far the rider's pin sits from it, then prices accordingly. See
   * `fare-quote.service.js`.
   *
   * `doorstepPickup` is the decision that will actually be applied — the client
   * may DECLINE a doorstep pickup, but it cannot assert one for a pin that is
   * already on the road. `kerbPickup` is set only when the rider declined and
   * their pickup point therefore MOVED to the kerb; the app has to say where to
   * and how far they will walk.
   */
  doorstepPickup?: boolean;
  doorstepOffsetMeters?: number | null;
  kerbPickup?: { lat: number; lng: number; walkMeters: number } | null;
  /** The pickup the price is for — the kerb point when doorstep was declined. */
  pickupLat?: number;
  pickupLng?: number;
  /** Routed duration in minutes — part of the price under the on-demand card. */
  durationMin?: number | null;
  /**
   * The road the quote was measured along, for the ride picker's preview map.
   *
   * The SAME line the fare was computed from, so the route the rider is looking
   * at and the distance they are being charged for cannot disagree. Null when
   * the router was unreachable and the distance fell back to a straight-line
   * estimate — there is no road to draw in that case.
   */
  geometry?: { type: 'LineString'; coordinates: [number, number][] } | null;
  /** Render the countdown against this + serverNowMs, never Date.now(). */
  expiresAtServerMs: number;
  serverNowMs: number;
  expiresInSeconds: number;
}

export interface ActiveRideResponse {
  trip: TripSnapshot | null;
  dispatch?: {
    tripId: string;
    currentDriverId: string | null;
    expiresAtServerMs: number | null;
    serverNowMs: number;
    attempt: number;
    totalCandidates: number;
    done: boolean;
  } | null;
  serverNowMs: number;
}

/**
 * A dispatch offer as REST returns it — the socket-miss safety net.
 *
 * Offers ride the socket normally, but they carry no trip `seq`, so unlike
 * every lifecycle event there is nothing to replay them from. A driver whose
 * phone was asleep for the twenty seconds the offer was live simply never
 * learns it existed. `GET /rides/driver/state` therefore answers "is anyone
 * waiting on me right now" alongside "am I on a trip".
 */
export interface PendingOffer {
  tripId: string;
  pickupLat: number | null; pickupLng: number | null; pickupAddress: string | null;
  dropoffLat: number | null; dropoffLng: number | null; dropoffAddress: string | null;
  farePesewas: number | null;
  driverEarningsPesewas: number | null;
  /**
   * The wallet balance this ride demands BEFORE it pays anything in.
   *
   * A CASH seat's commission is debited at boarding, so a driver with a short
   * wallet used to discover the problem at the pickup with the passenger
   * standing there. Computed server-side in `dispatch-cascade.cashFloatPesewas`.
   * Zero for a card/MoMo ride.
   */
  walletRequiredPesewas?: number | null;
  commissionPesewas?: number | null;
  tier: string | null;
  expiresAtServerMs: number;
  etaSeconds: number | null;
  attempt: number;
  totalCandidates: number;
}

/**
 * A trip that is still looking for a driver, from this driver's point of view.
 *
 * Distinct from `PendingOffer`: an offer is exclusively mine right now, whereas
 * these are every live search I am eligible for — including the ones currently
 * held by somebody else. The Dispatch tab lists them so "asking driver 1 of 1"
 * on the rider is never invisible on the driver, and `offeredToMe` is what
 * separates "accept this" from "this is in the queue".
 */
export interface PendingDispatch {
  tripId: string;
  status: string;
  tier: string | null;
  requestedAtMs: number | null;
  pickupLat: number | null; pickupLng: number | null; pickupAddress: string | null;
  dropoffLat: number | null; dropoffLng: number | null; dropoffAddress: string | null;
  farePesewas: number | null;
  driverEarningsPesewas: number | null;
  /** See `PendingOffer.walletRequiredPesewas`. */
  walletRequiredPesewas?: number | null;
  commissionPesewas?: number | null;
  offeredToMe: boolean;
  expiresAtServerMs: number | null;
  heldByAnother: boolean;
}

export interface DriverStateResponse {
  driver: {
    id: string; name: string; status: string; isOnline: boolean;
    lat: number | null; lng: number | null; walletBalancePesewas: number;
  };
  trip: TripSnapshot | null;
  /** Live dispatch offer held by this driver, if any. */
  offer: PendingOffer | null;
  /** Every live search this driver could still be given. Empty while on a trip. */
  pendingRequests: PendingDispatch[];
  serverNowMs: number;
}

/** `driverState` plus however many searches the server actively re-poked. */
export interface DriverResyncResponse extends DriverStateResponse {
  nudged: number;
}

const unwrap = <T>(res: { data: { data: T } }): T => res.data.data;

/**
 * Check the money on a driver-state payload before the Dispatch tab renders it.
 *
 * The offer is FATAL if it is malformed — it is the number a driver accepts a
 * job on, and `walletRequiredPesewas` decides whether they can afford to take a
 * cash seat at all. The queue behind it is not: one unparseable row in
 * `pendingRequests` must not blank the whole tab, so those are filtered. A
 * driver seeing three of four live searches is degraded; a driver seeing an
 * empty screen thinks the platform is dead.
 */
function checkDriverStateMoney<T extends DriverStateResponse>(state: T): T {
  if (state?.offer) assertShape(PendingOfferSchema, state.offer, 'offer');
  if (Array.isArray(state?.pendingRequests)) {
    const kept = parseEach<PendingDispatch>(PendingDispatchSchema, state.pendingRequests);
    if (kept.length !== state.pendingRequests.length) state.pendingRequests = kept;
  }
  return state;
}

export const ridesApi = {
  /** Price a ride. The returned quoteId is what makes the shown price binding. */
  quote: (body: {
    pickupLat: number; pickupLng: number;
    dropoffLat: number; dropoffLng: number;
    tier?: string; doorstepPickup?: boolean; heavyLoad?: boolean;
    /**
     * How many people are travelling. An INPUT TO THE PRICE, not just to
     * capacity: a party up to `RIDE_INCLUDED_SEATS` is one ordinary car at the
     * ordinary fare, and every seat past that buys a share of a bigger vehicle.
     * Omit it for a solo hail. See `partySize` in fare.calculator.js.
     *
     * It is inside the quote's signature, so the ride that redeems this quote
     * must be for the same party — a rider cannot quote for two and travel with
     * eight.
     */
    seatCount?: number;
  }) =>
    apiClient
      .post('/rides/quote', body)
      .then(unwrap<FareQuote>)
      // Checked, not cast. `unwrap<FareQuote>` is a promise the compiler cannot
      // keep — the server is free to break it on any deploy, and for money the
      // consequence is not a blank field but a plausible wrong number:
      // `undefined * 100` is NaN, and a fare that arrives as "2500" divides
      // into something that looks like a price. See money-guards.ts.
      .then((q) => assertFareQuote(q as unknown as Record<string, unknown>) as unknown as FareQuote),

  /**
   * Request a ride.
   *
   * `idempotencyKey` must be generated ONCE per user intent (when the confirm
   * sheet opens, not when the button is tapped) and reused across retries.
   * Without it a flaky connection during Confirm books two rides and charges
   * twice — the request is money-adjacent and phone networks retry.
   */
  request: (
    body: {
      quoteId: string;
      pickupLat: number; pickupLng: number; pickupAddress?: string;
      dropoffLat: number; dropoffLng: number; dropoffAddress?: string;
      paymentMethod?: 'CASH' | 'CARD' | 'MOMO' | 'WALLET';
      doorstepPickup?: boolean;
      /**
       * How many people are travelling.
       *
       * BUGFIX — the rider's seat stepper did nothing. `RequestStage` read
       * `requestSeatCount` off the store and never sent it (TypeScript had it
       * flagged as an unused variable), so a rider who chose 3 seats got a
       * one-seat trip and a driver who had no idea three people were waiting.
       *
       * It does NOT change the price: an on-demand ride is priced as the whole
       * car, which is why the quote passes `seatCount: 1`. This is capacity
       * information for the driver, not a fare input.
       */
      seatCount?: number;
      // NOTE: `quote` takes this too now — the party size is an input to the
      // price (see `partySize` in fare.calculator.js), not just to capacity.
    },
    idempotencyKey: string,
  ) =>
    apiClient
      .post('/rides', body, { headers: { 'Idempotency-Key': idempotencyKey } })
      .then(unwrap<{ tripId: string; snapshot: TripSnapshot; replayed?: boolean }>),

  /**
   * ONE-CALL REHYDRATION. Call on cold start, on foreground, and after any
   * reconnect. Neither app had an equivalent, which is why an app killed
   * mid-trip came back not knowing it was on one.
   */
  active: () => apiClient.get('/rides/active').then(unwrap<ActiveRideResponse>),

  /** Replay. Used by the channel on a detected sequence gap. */
  events: (tripId: string, since = 0) =>
    apiClient
      .get(`/rides/${tripId}/events`, { params: { since } })
      .then(unwrap<{ tripId: string; snapshot: TripSnapshot; events: any[]; serverNowMs: number }>),

  cancel: (tripId: string, reason?: string) =>
    apiClient
      .post(`/rides/${tripId}/cancel`, { reason })
      .then(unwrap<{ tripId: string; status: string; version: number; freeCancel: boolean }>),

  // ── driver ────────────────────────────────────────────────────────────────
  driverState: () =>
    apiClient.get('/rides/driver/state').then(unwrap<DriverStateResponse>).then(checkDriverStateMoney),
  /**
   * Foreground recovery. `driverState` only reports; this one also pokes the
   * cascade — re-publishing an offer this driver already holds and re-sweeping
   * any search that was sitting in `waiting` with nobody left to ask. Call it on
   * every AppState → active, not `driverState`.
   */
  driverResync: () =>
    apiClient
      .post('/rides/driver/resync')
      .then(unwrap<DriverResyncResponse>)
      .then(checkDriverStateMoney),
  accept: (tripId: string) => apiClient.post(`/rides/${tripId}/accept`).then(unwrap),
  decline: (tripId: string) => apiClient.post(`/rides/${tripId}/decline`).then(unwrap),
  enRoute: (tripId: string) => apiClient.post(`/rides/${tripId}/en-route`).then(unwrap),
  arrived: (tripId: string) => apiClient.post(`/rides/${tripId}/arrived`).then(unwrap),
  start: (tripId: string) => apiClient.post(`/rides/${tripId}/start`).then(unwrap),
  complete: (tripId: string) => apiClient.post(`/rides/${tripId}/complete`).then(unwrap),
  driverCancel: (tripId: string, reason?: string) =>
    apiClient.post(`/rides/${tripId}/driver-cancel`, { reason }).then(unwrap),
};
