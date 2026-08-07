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

export interface DriverStateResponse {
  driver: {
    id: string; name: string; status: string; isOnline: boolean;
    lat: number | null; lng: number | null; walletBalancePesewas: number;
  };
  trip: TripSnapshot | null;
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
