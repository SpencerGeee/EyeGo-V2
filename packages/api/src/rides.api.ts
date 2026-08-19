import { apiClient } from './client';
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
  breakdown: Record<string, number | boolean>;
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
  tier: string | null;
  expiresAtServerMs: number;
  etaSeconds: number | null;
  attempt: number;
  totalCandidates: number;
}

export interface DriverStateResponse {
  driver: {
    id: string; name: string; status: string; isOnline: boolean;
    lat: number | null; lng: number | null; walletBalancePesewas: number;
  };
  trip: TripSnapshot | null;
  /** Live dispatch offer held by this driver, if any. */
  offer: PendingOffer | null;
  serverNowMs: number;
}

const unwrap = <T>(res: { data: { data: T } }): T => res.data.data;

export const ridesApi = {
  /** Price a ride. The returned quoteId is what makes the shown price binding. */
  quote: (body: {
    pickupLat: number; pickupLng: number;
    dropoffLat: number; dropoffLng: number;
    tier?: string; doorstepPickup?: boolean; heavyLoad?: boolean;
  }) => apiClient.post('/rides/quote', body).then(unwrap<FareQuote>),

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
  driverState: () => apiClient.get('/rides/driver/state').then(unwrap<DriverStateResponse>),
  accept: (tripId: string) => apiClient.post(`/rides/${tripId}/accept`).then(unwrap),
  decline: (tripId: string) => apiClient.post(`/rides/${tripId}/decline`).then(unwrap),
  enRoute: (tripId: string) => apiClient.post(`/rides/${tripId}/en-route`).then(unwrap),
  arrived: (tripId: string) => apiClient.post(`/rides/${tripId}/arrived`).then(unwrap),
  start: (tripId: string) => apiClient.post(`/rides/${tripId}/start`).then(unwrap),
  complete: (tripId: string) => apiClient.post(`/rides/${tripId}/complete`).then(unwrap),
  driverCancel: (tripId: string, reason?: string) =>
    apiClient.post(`/rides/${tripId}/driver-cancel`, { reason }).then(unwrap),
};
