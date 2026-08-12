import type { Socket } from 'socket.io-client';
import { apiClient } from './client';

/**
 * The client half of the `trip:event` channel.
 *
 * WHAT THIS REPLACES. Roughly twenty independent socket listeners
 * (`onDriverLocation`, `onTripStatus`, `onDispatchProgress`,
 * `onTripRequestAccepted`, `onSeatUpdate`, `onTripAssigned`, …), each with its
 * own payload shape and its own handler in whichever screen happened to care.
 * Four of them were different ways to learn overlapping facts. None carried a
 * sequence number, so a client that was backgrounded or reconnecting missed
 * messages **and could not tell that it had** — and on top of that the request
 * screen ran two `setInterval` polls racing the sockets to settle the same
 * transition, with nothing to arbitrate which answer was newer.
 *
 * THE RULE THAT REPLACES ALL OF IT:
 *
 *     if (incoming.version <= mine) discard; else replace.
 *
 * That single comparison is total, because the server bumps `version` on every
 * observable change and stamps it on every payload. A poll answer and a socket
 * push for the same fact carry the same version, so they cannot fight. A late
 * message from before a cancellation loses to the cancellation. And because
 * each event carries the COMPLETE snapshot, applying one event is sufficient —
 * a client that missed fifty is still correct after receiving the fifty-first.
 *
 * Gap detection: `seq` is gap-free per trip, so receiving `seq > lastSeq + 1`
 * proves something was missed, and the channel fetches the replay itself
 * rather than waiting for some other screen to refetch.
 */

export type TripEventType =
  | 'REQUESTED' | 'MATCHING' | 'SCHEDULED' | 'FILLING' | 'CONFIRMED'
  | 'DRIVER_ASSIGNED' | 'REASSIGNING' | 'DRIVER_EN_ROUTE' | 'ARRIVED_AT_PICKUP'
  | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_DRIVERS_FOUND' | 'EXPIRED' | 'NO_SHOW'
  | 'SNAPSHOT' | 'DISPATCH_PROGRESS' | 'DRIVER_LOCATION' | 'ETA'
  | 'OFFER' | 'OFFER_REVOKED';

export type TripStatus = Exclude<
  TripEventType,
  'SNAPSHOT' | 'DISPATCH_PROGRESS' | 'DRIVER_LOCATION' | 'ETA' | 'OFFER' | 'OFFER_REVOKED'
>;

/** Which journey a route line describes. Never conflate the two. */
export type TripLeg = 'toPickup' | 'toDropoff';

export interface TripPath {
  leg: TripLeg;
  /** GeoJSON LineString in [lng, lat] order, as MapLibre wants it. */
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  distanceKm: number;
  durationMin: number;
  computedAt: number;
}

/** Payload of the `trip:eta` push. Carries the live leg's line and countdown. */
export interface TripEtaPush {
  tripId: string;
  leg: TripLeg;
  etaMinutes: number;
  distanceKm: number;
  message: string;
  geometry: TripPath['geometry'];
  rerouted: boolean;
}

export interface TripSnapshot {
  tripId: string;
  shortId: string;
  status: TripStatus;
  /** The arbiter. Monotonic, server-owned. Never trust a lower one. */
  version: number;
  serverNowMs: number;
  isOnDemand: boolean;
  tier: string;
  pickup: { lat: number | null; lng: number | null; address: string | null };
  dropoff: { lat: number | null; lng: number | null; address: string | null };
  driver: {
    id: string; name: string;
    /**
     * Null once the ride is over. The server scopes the driver's real number
     * to the statuses where calling them is legitimate (see trip-view.js), so
     * every consumer must handle its absence rather than assume a string.
     */
    phone: string | null;
    photo: string | null;
    lat: number | null; lng: number | null; heading: number | null;
  } | null;
  vehicle: { plate: string; make: string; model: string; year: number; tier: string } | null;
  route: { id: string; name: string; distanceKm: number } | null;
  /**
   * The road line, computed once by the server for whichever leg is live.
   *
   * `toPickup` while the driver is coming to fetch you; `toDropoff` once you
   * are in the car. No client calls Mapbox Directions any more — the rider and
   * the driver draw the same line because there is only one, and it survives
   * navigation because it arrives with the snapshot.
   */
  path: TripPath | null;
  seats: { confirmed: number; max: number };
  // Money is INTEGER PESEWAS (1 GH₵ = 100). Format with `formatGhs`; never do
  // arithmetic on it — if a screen needs a total, the server sends the total.
  // `surge` is the exception and carries no suffix because it is a
  // dimensionless multiplier, not money.
  fare: {
    basePesewas: number; perKmPesewas: number; surge: number;
    amountPesewas: number | null; paymentMethod: string | null; paymentStatus: string | null;
  };
  booking: {
    id: string;
    status: string;
    seatNumber: number | null;
    /**
     * "Verify My Ride" — the code this rider shows their driver.
     *
     * Only ever populated in the snapshot built FOR the rider who owns the
     * booking; the driver's snapshot has no `booking` at all. Null once used.
     */
    boardingPin?: string | null;
    pinVerified?: boolean;
  } | null;
  timestamps: Record<string, string | null>;
  cancellation: { by: string | null; reason: string | null } | null;
  redispatchCount: number;
}

export interface TripEvent {
  tripId: string;
  /** null for non-lifecycle pushes (dispatch offers). */
  seq: number | null;
  version: number | null;
  type: TripEventType;
  actor: 'RIDER' | 'DRIVER' | 'SYSTEM' | 'ADMIN';
  status: TripStatus | null;
  payload: Record<string, any>;
  snapshot: TripSnapshot | null;
  /** Render every countdown against this, never Date.now(). */
  serverNowMs: number;
  ttlMs: number;
  priority: 'HIGH' | 'NORMAL';
  dedupeKey: string | null;
}

export interface TripChannelState {
  snapshot: TripSnapshot | null;
  lastSeq: number;
  /** Milliseconds to ADD to the device clock to get server time. */
  clockSkewMs: number;
  connected: boolean;
  /** True between detecting a gap and finishing the replay fetch. */
  recovering: boolean;
}

export type TripEventHandler = (event: TripEvent) => void;

/** Local receipt time, so TTL is measured against arrival not against the wire. */
const receivedAt = new WeakMap<TripEvent, number>();

/**
 * Should this event be applied at all?
 *
 * Two independent reasons to drop one, both of which the old ad-hoc listeners
 * had no way to express:
 *  - it is STALE: older than what we already hold (`version <= current`);
 *  - it is EXPIRED: it sat in a queue longer than it was useful for. A "driver
 *    is 2 minutes away" delivered eleven minutes late is worse than not
 *    delivered, because it is applied as though it were fresh.
 */
export function shouldApply(event: TripEvent, currentVersion: number, nowMs = Date.now()): boolean {
  const arrived = receivedAt.get(event) ?? nowMs;
  if (event.ttlMs > 0 && nowMs - arrived > event.ttlMs) return false;
  // Offers carry no version; they are their own liveness, gated by TTL above.
  if (event.version == null) return true;
  return event.version > currentVersion;
}

/**
 * Apply one event. Pure: given the same state and event it always produces the
 * same next state, which is what makes at-least-once delivery safe.
 */
export function reduceTripEvent(state: TripChannelState, event: TripEvent): TripChannelState {
  if (!shouldApply(event, state.snapshot?.version ?? -1)) return state;

  return {
    ...state,
    snapshot: event.snapshot ?? state.snapshot,
    lastSeq: event.seq != null ? Math.max(state.lastSeq, event.seq) : state.lastSeq,
    // Every payload is a free clock reading. Timers rendered against
    // (serverNowMs + elapsed) cannot drift with a mis-set device clock — which
    // is why offer countdowns used to disagree between two phones.
    clockSkewMs: event.serverNowMs - Date.now(),
  };
}

/** True when `event` proves we missed something between it and `lastSeq`. */
export function hasGap(event: TripEvent, lastSeq: number): boolean {
  if (event.seq == null) return false;
  if (event.type === 'SNAPSHOT') return false; // snapshots are self-sufficient
  return event.seq > lastSeq + 1;
}

export interface TripChannelOptions {
  socket: Socket;
  tripId: string;
  /** Where to resume from. 0 on a cold start. */
  lastSeq?: number;
  onState: (state: TripChannelState) => void;
  onEvent?: TripEventHandler;
}

/**
 * Subscribe to one trip and keep it correct across reconnects, backgrounding
 * and missed messages. Returns an unsubscribe function.
 */
export function subscribeToTrip({
  socket,
  tripId,
  lastSeq = 0,
  onState,
  onEvent,
}: TripChannelOptions): () => void {
  let state: TripChannelState = {
    snapshot: null,
    lastSeq,
    clockSkewMs: 0,
    connected: socket.connected,
    recovering: false,
  };
  let disposed = false;

  const emit = () => {
    if (!disposed) onState(state);
  };

  /**
   * Ask the server for everything above what we hold.
   *
   * Used on a detected gap. This is the whole reason `seq` exists: previously a
   * client that missed an event had no mechanism to notice, let alone recover,
   * and simply displayed a stale trip until something unrelated refetched.
   */
  const recover = async () => {
    if (state.recovering) return;
    state = { ...state, recovering: true };
    emit();
    try {
      const { data } = await apiClient.get(`/rides/${tripId}/events`, {
        params: { since: state.lastSeq },
      });
      const payload = data?.data;
      if (payload?.snapshot) {
        state = {
          ...state,
          snapshot: payload.snapshot,
          lastSeq: payload.snapshot.version,
          clockSkewMs: (payload.serverNowMs ?? Date.now()) - Date.now(),
        };
      }
    } catch {
      // Left to the next reconnect, which replays from lastSeq anyway.
    } finally {
      state = { ...state, recovering: false };
      emit();
    }
  };

  /** Reconnecting WITH a lastSeq is itself the acknowledgement (RAMEN). */
  const subscribe = () => {
    socket.emit('trip:subscribe', { tripId, lastSeq: state.lastSeq }, (ack: any) => {
      if (disposed) return;
      if (ack?.serverNowMs) {
        state = { ...state, clockSkewMs: ack.serverNowMs - Date.now() };
      }
      // A truncated replay means our animation state is untrustworthy; the
      // snapshot that follows is the authority, and the server told us so
      // rather than leaving us to guess.
      if (ack?.truncated) void recover();
      // A rejected subscribe is not a lost connection, and must not be reported
      // as one. The socket is up; we are simply not in the room, so no event
      // will ever arrive and the snapshot has to come over HTTP instead. Left
      // unhandled this was indistinguishable from a dead network — the screen
      // showed "Reconnecting…" over a map that would never update, for a socket
      // that was connected the whole time.
      if (ack?.error) void recover();
      emit();
    });
  };

  const handleEvent = (event: TripEvent) => {
    if (disposed || event.tripId !== tripId) return;
    receivedAt.set(event, Date.now());

    if (hasGap(event, state.lastSeq)) void recover();

    const next = reduceTripEvent(state, event);
    const changed = next !== state;
    state = next;
    if (changed) emit();
    onEvent?.(event);
  };

  /** Have we been up at least once? A first connect needs no catch-up. */
  let hasConnectedBefore = socket.connected;

  const handleConnect = () => {
    const isRedial = hasConnectedBefore;
    hasConnectedBefore = true;
    state = { ...state, connected: true };
    // Report the connection BEFORE asking to subscribe, not inside the
    // subscribe ack. The ack is a server round-trip that can be slow, can be
    // dropped, or can never come at all; the connection is a fact we already
    // hold. Publishing it only through the ack meant a perfectly healthy socket
    // still displayed "Reconnecting…" for as long as the server took to answer
    // — and indefinitely if it never did.
    emit();
    subscribe();
    /**
     * REJOIN **AND** REFETCH. `subscribe()` alone was not enough.
     *
     * BUGFIX ("the driver tapped I've arrived and my app never showed it").
     * The replay `trip:subscribe` triggers is served over the SAME socket that
     * just came back, so any of the ways it can fail to land — a handshake that
     * succeeds but whose ack is lost, a room join the server rejects, a redial
     * that races the server's own cleanup of the old session — leaves the client
     * connected, out of the room, and holding a snapshot from before the gap,
     * with nothing scheduled that would ever notice.
     *
     * The HTTP snapshot is a second, independent path to the same truth, and it
     * is free of correctness risk: `recover()` writes only if the server's copy
     * is what it says it is, and `shouldApply` discards it the moment a newer
     * socket event overtakes it. Only on a REDIAL — a first connect already gets
     * a snapshot from the subscribe, and paying for both there would double the
     * cost of every screen open.
     */
    if (isRedial) void recover();
  };
  const handleDisconnect = () => {
    state = { ...state, connected: false };
    emit();
  };

  socket.on('trip:event', handleEvent);
  socket.on('connect', handleConnect);
  socket.on('disconnect', handleDisconnect);
  if (socket.connected) {
    subscribe();
  } else {
    // Not connected yet, and `connect` may be minutes away on a bad network.
    // Pull the snapshot over HTTP so the screen has real pickup and dropoff
    // addresses to draw immediately rather than the placeholders it shows
    // while `snapshot` is null. The socket takes over the moment it is up, and
    // `shouldApply` discards this one if it turns out to be the older of the
    // two — which is exactly why fetching it eagerly is safe.
    void recover();
  }

  /**
   * Periodic high-water mark for a connection that stays up for hours and so
   * never gets to use reconnect-as-ack.
   */
  const ackTimer = setInterval(() => {
    if (socket.connected && state.lastSeq > 0) {
      socket.emit('trip:ack', { tripId, seq: state.lastSeq });
    }
  }, 30_000);

  return () => {
    disposed = true;
    clearInterval(ackTimer);
    socket.emit('trip:unsubscribe', { tripId });
    socket.off('trip:event', handleEvent);
    socket.off('connect', handleConnect);
    socket.off('disconnect', handleDisconnect);
  };
}

/**
 * Server time on this device. Every countdown, "arriving in", offer timer and
 * "requested N seconds ago" must be computed from this — never `Date.now()`.
 */
export function serverNow(clockSkewMs: number): number {
  return Date.now() + clockSkewMs;
}

/** Seconds left on a server-issued deadline. Clamped at zero, never negative. */
export function secondsRemaining(expiresAtServerMs: number, clockSkewMs: number): number {
  return Math.max(0, Math.round((expiresAtServerMs - serverNow(clockSkewMs)) / 1000));
}
