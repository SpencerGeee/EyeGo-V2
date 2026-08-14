import type { Socket } from 'socket.io-client';
import type { DriverLocationEvent, TripEtaEvent, TripStatusEvent, SeatEvent } from '@eyego/types';

// ── Shared socket event callback types ─────────────────────────────────────
export type ChatMessagePayload = {
  senderId: string;
  senderName?: string;
  senderRole?: string;
  seatNumber?: number | null;
  text: string;
  timestamp: string;
  isPrivate?: boolean;
  recipientId?: string;
};

export type PrivateChatMessagePayload = {
  senderId: string;
  senderName?: string;
  text: string;
  timestamp: string;
  isPrivate: boolean;
  recipientId?: string;
};

export type TypingPayload = {
  senderId: string;
  senderRole: string;
  isTyping: boolean;
};

export type ReadReceiptPayload = {
  tripId: string;
  messageIds: string[];
  readBy: string;
};

export type ChatHistoryPayload = Array<{
  senderId: string;
  senderName?: string;
  senderRole?: string;
  seatNumber?: number | null;
  text: string;
  timestamp: string;
  isPrivate?: boolean;
  recipientId?: string;
}>;

export type SafetyCheckPayload = {
  tripId: string;
  reason: string;
  timestamp: number;
};

/**
 * `trip:eta` as the SERVER now sends it — see
 * eyego-api/src/services/route-geometry.service.js.
 *
 * `leg` is the field that fixes a long-standing lie: the old ETA always routed
 * to the trip's final destination, so "8 min away" during pickup was the time
 * to the rider's destination, a number unrelated to the wait. There are two
 * legs — `toPickup` while the driver is fetching the rider, `toDropoff` once
 * they are aboard — and the geometry belongs to whichever one is live.
 *
 * `rerouted` is true only on the pass where the server detected the driver had
 * left the line and recomputed it, so a client can react to a re-route
 * (re-draw, re-announce) without diffing geometry itself.
 */
export type DriverEtaPayload = {
  tripId: string;
  leg?: 'toPickup' | 'toDropoff';
  etaMinutes: number;
  distanceKm?: number;
  message?: string;
  geometry?: { type: 'LineString'; coordinates: [number, number][] };
  rerouted?: boolean;
};

/**
 * `trip:route` — the narrower "the line changed" event.
 *
 * Emitted only on a re-route, where `trip:eta` carries the same geometry but
 * also a new ETA. A client that only draws the line can listen to this and
 * ignore the ETA traffic entirely.
 */
export type TripRoutePayload = {
  tripId: string;
  leg: 'toPickup' | 'toDropoff';
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  distanceKm?: number;
  durationMin?: number;
};

export type TripStatusPayload = {
  tripId: string;
  status: string;
};

/**
 * Mirror of the same logic in client.ts — auto-detect the dev machine's IP
 * from Expo's dev-server host so sockets connect correctly on physical devices
 * even when the Wi-Fi IP changes between sessions.
 */
function resolveSocketBaseUrl(): string {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Constants = require('expo-constants').default;
      const hostUri: string | undefined =
        Constants.expoConfig?.hostUri ??
        (Constants.manifest2 as any)?.extra?.expoGo?.debuggerHost ??
        (Constants.manifest as any)?.debuggerHost;
      if (hostUri) {
        const host = hostUri.split(':')[0];
        if (host && host !== 'localhost' && host !== '127.0.0.1') {
          const port = process.env.EXPO_PUBLIC_API_PORT ?? '3000';
          return `http://${host}:${port}`;
        }
      }
    } catch (_) {}
  }
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/v1';
  return apiUrl.replace('/api/v1', '').replace('/v1', '');
}

const BASE_URL = resolveSocketBaseUrl();

let socket: Socket | null = null;
let getToken: () => string | null = () => null;
let socketRefs = 0;

/**
 * A cheap authenticated GET used ONLY to provoke the HTTP client's 401 refresh
 * interceptor when the socket handshake was refused for a stale token. Must be
 * an endpoint the CURRENT role is allowed to call, or it 403s and never reaches
 * the refresh path — hence configurable per app rather than hard-coded.
 */
let authProbeUrl = '/user/me';

export function configureSocket(opts: {
  getToken: () => string | null;
  authProbeUrl?: string;
}) {
  getToken = opts.getToken;
  if (opts.authProbeUrl) authProbeUrl = opts.authProbeUrl;
}

/**
 * Reconnection policy, shared by both namespaces.
 *
 * BUGFIX ("the driver tapped I've arrived, i switched to the rider app and it
 * just says Reconnecting forever").
 *
 * `reconnectionAttempts: 10` is what made that "forever" literal. socket.io
 * counts an attempt whether it failed on the network OR on the handshake, and
 * with the 1s→30s backoff ladder ten of them are spent in about two minutes —
 * after which socket.io emits `reconnect_failed`, sets the socket aside and
 * NEVER dials again on its own. Nothing in either app listened for that event,
 * so the trip screen's `connected` flag stayed false for the rest of the ride
 * and the chip that renders off the back of it ("Reconnecting…") had nothing
 * left that could ever clear it.
 *
 * Two things routinely burn all ten attempts on a phone in a car:
 *   - the app is suspended in the background (iOS) and the socket is torn down
 *     while the reconnect timers keep running;
 *   - the 15-minute access token expired, so `socketAuth` rejects the handshake
 *     with "Invalid or expired token" — and every retry presents the SAME
 *     expired token, so all ten are guaranteed to fail. See `recoverSocketAuth`.
 *
 * A rider in a live trip must never stop trying to hear about it, so the ceiling
 * comes off. The backoff already keeps a genuinely offline phone from busy-
 * looping; giving up is not the same thing as backing off.
 */
const RECONNECT_OPTS = {
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 30000,
  randomizationFactor: 0.5,
} as const;

/** Handshake rejections that mean "your access token is stale", not "no network". */
function isAuthHandshakeError(message: string | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes('token') ||
    m.includes('authentication') ||
    m.includes('unauthor') ||
    m.includes('revoked')
  );
}

let authRecoveryInFlight = false;

/**
 * Get a fresh access token when the socket handshake was refused for having a
 * stale one.
 *
 * The socket cannot refresh anything itself — refresh lives on the HTTP client,
 * behind the 401 interceptor. So we deliberately provoke that path with one
 * cheap authenticated GET: if the access token really is expired the request
 * 401s, `client.ts` rotates the pair (with its own retry ladder and its own
 * "only a definitive 401 ends the session" rule), and its `onTokenRefreshed`
 * hook calls `refreshSocketAuth`/`refreshDriverSocketAuth`, which redials. If
 * the token was fine after all, the GET simply succeeds and costs nothing.
 *
 * Guarded by a flag because `connect_error` fires on EVERY reconnection attempt
 * and this must not become one refresh per attempt.
 */
function recoverSocketAuth(): void {
  if (authRecoveryInFlight) return;
  authRecoveryInFlight = true;
  const { apiClient } = require('./client') as typeof import('./client');
  void apiClient
    .get(authProbeUrl)
    .catch(() => {
      // Either the refresh worked (and the redial has already been kicked off by
      // onTokenRefreshed) or the session is genuinely over (and client.ts has
      // already logged out). Nothing left for the socket layer to decide.
    })
    .finally(() => {
      authRecoveryInFlight = false;
    });
}

/**
 * Redial whichever sockets are supposed to be up when the app returns to the
 * foreground.
 *
 * A suspended app's socket is closed by the OS without JS ever running, and the
 * reconnect timers that would have noticed were suspended too. Foregrounding is
 * the moment to check, and it is the exact moment the rider looks at the screen
 * and judges whether the app is working.
 */
let appStateBound = false;
function bindForegroundRedial(): void {
  if (appStateBound) return;
  appStateBound = true;
  try {
    // Required lazily: this package is also imported by non-RN consumers.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AppState } = require('react-native');
    AppState.addEventListener('change', (state: string) => {
      if (state !== 'active') return;
      if (socketRefs > 0 && socket && !socket.connected) socket.connect();
      if (driverSocketRefs > 0 && driverSocket && !driverSocket.connected) driverSocket.connect();
    });
  } catch (_) {
    appStateBound = false;
  }
}

export function getSocket(): Socket {
  if (!socket) {
    const { io } = require('socket.io-client') as typeof import('socket.io-client');
    const socketUrl = BASE_URL.endsWith('/') ? BASE_URL + 'passenger' : BASE_URL + '/passenger';
    socket = io(socketUrl, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
      auth: (cb: (data: { token: string | null }) => void) => cb({ token: getToken() }),
      ...RECONNECT_OPTS,
    });
    socket!.on('connect_error', (err: Error) => {
      console.warn('[Socket] Connection error:', err.message);
      // An expired token fails identically on every retry until somebody
      // refreshes it. Nobody was.
      if (isAuthHandshakeError(err?.message)) recoverSocketAuth();
    });
    bindForegroundRedial();
    startPassengerLeakMonitoring();
  }
  return socket!;
}

export function connectSocket() {
  socketRefs++;
  if (socketRefs === 1) getSocket().connect();
}

export function disconnectSocket() {
  socketRefs = Math.max(0, socketRefs - 1);
  if (socketRefs === 0) {
    socket?.disconnect();
    socket = null;
    stopPassengerLeakMonitoring();
  }
}

/**
 * Hard teardown of the passenger socket regardless of outstanding refs.
 * Used on logout: screens may still hold connectSocket() refs, but on logout
 * we MUST drop the connection so the next user does not inherit a live socket
 * still joined to the prior user's trip room. Resets the refcount to 0.
 */
export function forceDisconnectSocket() {
  socketRefs = 0;
  driverCallbacks.clear();
  socket?.disconnect();
  socket = null;
  stopPassengerLeakMonitoring();
}

export function refreshSocketAuth(tripId?: string, driverId?: string): void {
  const _socket = socket;
  if (!_socket) return;
  // BUGFIX ("the map is frozen and the top says reconnecting"): this line used
  // to be `_socket.auth = { token: getToken() }`.
  //
  // `getSocket()` deliberately installs `auth` as a CALLBACK, because socket.io
  // re-invokes it before every connection attempt — that is the mechanism by
  // which a reconnect picks up a rotated token. Assigning a plain object here
  // destroyed that mechanism and froze the socket on whichever token happened
  // to be current at this instant. It kept working right up until that token
  // expired (~15 minutes), after which every reconnect failed authentication,
  // socket.io retried and failed ten more times, and the trip screen sat on
  // "Reconnecting…" forever with a map that never received another position.
  // Worse, the function whose entire job is to refresh the auth was the thing
  // that broke it.
  //
  // There is nothing to assign: the callback already reads the newest token.
  // All that is left to do is get the connection back up.
  if (!_socket.connected) {
    _socket.connect();
  }
  // Re-join trip room after reconnect if tripId provided
  if (tripId) {
    const rejoin = () => {
      _socket.emit('passenger:join_trip_room', { tripId, driverId });
      _socket.off('connect', rejoin);
    };
    if (_socket.connected) {
      _socket.emit('passenger:join_trip_room', { tripId, driverId });
    } else {
      _socket.once('connect', rejoin);
    }
  }
}

/**
 * The driver-namespace twin of `refreshSocketAuth`.
 *
 * Nothing called the driver socket back up after a token rotation, because this
 * function did not exist — so a driver whose access token expired while the
 * socket happened to be down stayed down, and both the trip channel and the
 * dispatch-offer channel went silent for the rest of the session. Same
 * mechanism as the rider bug; the driver app just never got the fix.
 *
 * As with the rider version there is nothing to ASSIGN: `auth` is a callback
 * that already reads the newest token on every attempt. All that is missing is
 * somebody to dial.
 */
export function refreshDriverSocketAuth(): void {
  const _socket = driverSocket;
  if (!_socket) return;
  if (!_socket.connected) _socket.connect();
}

const driverCallbacks = new Map<((data: DriverLocationEvent) => void), (...args: any[]) => void>();

let _passengerLeakInterval: ReturnType<typeof setInterval> | null = null;
let _driverLeakInterval: ReturnType<typeof setInterval> | null = null;

function startPassengerLeakMonitoring() {
  if (_passengerLeakInterval) return;
  _passengerLeakInterval = setInterval(() => {
    if (driverCallbacks.size > 50) {
      console.warn(`[Socket] Possible subscription leak: ${driverCallbacks.size} active wrappers`);
    }
  }, 300_000);
}

function stopPassengerLeakMonitoring() {
  if (_passengerLeakInterval) {
    clearInterval(_passengerLeakInterval);
    _passengerLeakInterval = null;
  }
}

function startDriverLeakMonitoring() {
  if (_driverLeakInterval) return;
  _driverLeakInterval = setInterval(() => {
    console.warn('[DriverSocket] Leak check: socket still active');
  }, 300_000);
}

function stopDriverLeakMonitoring() {
  if (_driverLeakInterval) {
    clearInterval(_driverLeakInterval);
    _driverLeakInterval = null;
  }
}

export const socketEvents = {
  onConnect: (cb: () => void) => {
    getSocket().on('connect', cb);
    return () => getSocket().off('connect', cb);
  },

  onDisconnect: (cb: () => void) => {
    getSocket().on('disconnect', cb);
    return () => getSocket().off('disconnect', cb);
  },

  onDriverLocation: (cb: (data: DriverLocationEvent) => void) => {
    const wrappedCb = (data: any) => {
      cb({
        driverId: data.driverId ?? '',
        tripId: data.tripId ?? '',
        latitude: data.latitude ?? data.lat,
        longitude: data.longitude ?? data.lng,
        heading: data.heading ?? 0,
        speed: data.speed ?? 0,
      });
    };
    driverCallbacks.set(cb, wrappedCb);
    getSocket().on('driver:location', wrappedCb);
    return () => {
      const wrapped = driverCallbacks.get(cb);
      if (wrapped) {
        getSocket().off('driver:location', wrapped);
        driverCallbacks.delete(cb);
      }
    };
  },

  onTripEta: (cb: (data: TripEtaEvent) => void) => {
    getSocket().on('trip:eta', cb);
    return () => getSocket().off('trip:eta', cb);
  },

  /**
   * The route line changed because the driver left it and the server
   * recomputed. `trip:eta` also carries the new geometry, so a screen already
   * listening there does not need this — it exists so a map can redraw the line
   * without subscribing to ETA churn.
   */
  onTripRoute: (cb: (data: TripRoutePayload) => void) => {
    getSocket().on('trip:route', cb);
    return () => getSocket().off('trip:route', cb);
  },

  onTripStatus: (cb: (data: TripStatusEvent) => void) => {
    getSocket().on('trip:status_change', cb);
    return () => getSocket().off('trip:status_change', cb);
  },

  onSeatUpdate: (cb: (data: SeatEvent) => void) => {
    getSocket().on('trip:seat_update', cb);
    return () => getSocket().off('trip:seat_update', cb);
  },

  /**
   * A driver accepted this rider's on-demand trip request.
   *
   * DEAD-PATH FIX: the backend has always emitted `trip:request_accepted` to
   * `user:<id>` on the /passenger namespace (trip-request.service.js), but
   * nothing in the rider app ever listened for it — the event was constructed,
   * addressed and thrown away every single time. The "looking for a driver"
   * screen only ever learned it had been matched from its own 4-second poll,
   * so the rider sat watching a spinner for up to four seconds after a driver
   * had already accepted and started driving to them.
   */
  onTripRequestAccepted: (cb: (data: { requestId?: string; tripId?: string; driverName?: string }) => void) => {
    getSocket().on('trip:request_accepted', cb);
    return () => getSocket().off('trip:request_accepted', cb);
  },

  /**
   * Live dispatch-cascade progress for the "looking for a driver" screen.
   *
   * Dispatch is sequential: the backend offers the ride to one driver at a time
   * (services/dispatch-cascade.service.js). These events are what let the rider
   * see who is currently being asked — the map draws a polyline to that driver
   * and re-draws it when the offer moves on, the way Uber and Bolt do.
   *
   *  - `dispatch:searching` — cascade started, `totalCandidates` drivers queued
   *  - `dispatch:offer`     — this driver now holds the offer until `expiresAt`
   *  - `dispatch:widening`  — nobody close accepted, search radius grew
   *  - `dispatch:matched`   — a driver accepted
   *  - `dispatch:exhausted` — nobody accepted; show the "all drivers busy" state
   */
  onDispatchProgress: (
    cb: (
      event: 'searching' | 'offer' | 'widening' | 'matched' | 'exhausted',
      data: {
        rideId?: string;
        driverId?: string;
        driverLat?: number | null;
        driverLng?: number | null;
        attempt?: number;
        totalCandidates?: number;
        expiresAt?: string;
        tried?: number;
      },
    ) => void,
  ) => {
    const names = ['searching', 'offer', 'widening', 'matched', 'exhausted'] as const;
    const handlers = names.map((name) => {
      const h = (data: any) => cb(name, data ?? {});
      getSocket().on(`dispatch:${name}`, h);
      return [name, h] as const;
    });
    return () => {
      for (const [name, h] of handlers) getSocket().off(`dispatch:${name}`, h);
    };
  },

  /**
   * Server-side confirmation that a payment settled (gateway webhook landed).
   * Same dead-path story as above: emitted by payments.controller.js, listened
   * for by nobody, so payment screens could only discover success by polling
   * verify.
   */
  onPaymentConfirmed: (cb: (data: { bookingId?: string; tripId?: string; reference?: string }) => void) => {
    getSocket().on('payment:confirmed', cb);
    return () => getSocket().off('payment:confirmed', cb);
  },

  joinTripRoom: (tripId: string, driverId?: string, lastMessageTimestamp?: string) => {
    getSocket().emit('passenger:join_trip_room', { tripId, driverId, lastMessageTimestamp });
  },

  leaveTripRoom: (tripId: string) => {
    getSocket().emit('passenger:leave_trip_room', { tripId });
  },

  emitPaymentConfirmed: (bookingId: string, tripId: string) => {
    getSocket().emit('passenger:payment_confirmed', { bookingId, tripId });
  },

  sendChatMessage: (tripId: string, text: string) => {
    getSocket().emit('chat:send', { tripId, text, timestamp: new Date().toISOString() });
  },

  // Rider → driver private message (recipientId resolves to the trip's driver
  // server-side; pass the driverId when known so optimistic dedup matches).
  sendPrivateChatMessage: (tripId: string, text: string, recipientId?: string) => {
    getSocket().emit('chat:private_send', { tripId, text, recipientId, timestamp: new Date().toISOString() });
  },

  onChatMessage: (cb: (msg: ChatMessagePayload) => void) => {
    getSocket().on('chat:message', cb);
    return () => getSocket().off('chat:message', cb);
  },

  onPrivateChatMessage: (cb: (msg: PrivateChatMessagePayload) => void) => {
    getSocket().on('chat:private_message', cb);
    return () => getSocket().off('chat:private_message', cb);
  },

  onChatHistory: (cb: (messages: ChatHistoryPayload) => void) => {
    getSocket().on('chat:history', cb);
    return () => getSocket().off('chat:history', cb);
  },

  onSafetyCheck: (cb: (data: SafetyCheckPayload) => void) => {
    getSocket().on('safety:check', cb);
    return () => getSocket().off('safety:check', cb);
  },

  sendReadReceipt: (tripId: string, messageIds: string[]) => {
    getSocket().emit('chat:read', { tripId, messageIds });
  },

  onReadReceipt: (cb: (data: ReadReceiptPayload) => void) => {
    getSocket().on('chat:read_receipt', cb);
    return () => getSocket().off('chat:read_receipt', cb);
  },

  sendSafetyLocation: (data: { tripId: string; latitude: number; longitude: number }) => {
    getSocket().emit('safety:location', data);
  },

  onTyping: (cb: (data: TypingPayload) => void) => {
    getSocket().on('chat:typing', cb);
    return () => getSocket().off('chat:typing', cb);
  },

  sendTypingStart: (tripId: string) => {
    getSocket().emit('chat:typing_start', { tripId });
  },

  sendTypingStop: (tripId: string) => {
    getSocket().emit('chat:typing_stop', { tripId });
  },
};

// ── Driver Socket (/driver namespace) ────────────────────────────────────────
let driverSocket: Socket | null = null;

export function getDriverSocket(): Socket {
  if (!driverSocket) {
    const { io } = require('socket.io-client') as typeof import('socket.io-client');
    const socketUrl = BASE_URL.endsWith('/') ? BASE_URL + 'driver' : BASE_URL + '/driver';
    driverSocket = io(socketUrl, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
      auth: (cb: (data: { token: string | null }) => void) => cb({ token: getToken() }),
      ...RECONNECT_OPTS,
    });
    driverSocket!.on('connect_error', (err: Error) => {
      console.warn('[DriverSocket] Connection error:', err.message);
      if (isAuthHandshakeError(err?.message)) recoverSocketAuth();
    });
    bindForegroundRedial();
    startDriverLeakMonitoring();
  }
  return driverSocket!;
}

let driverSocketRefs = 0;

export function connectDriverSocket() {
  driverSocketRefs++;
  if (driverSocketRefs === 1) getDriverSocket().connect();
}

export function disconnectDriverSocket() {
  driverSocketRefs = Math.max(0, driverSocketRefs - 1);
  if (driverSocketRefs === 0) {
    driverSocket?.disconnect();
    driverSocket = null;
    stopDriverLeakMonitoring();
  }
}

export const driverSocketEvents = {
  emitLocation: (data: { lat: number; lng: number; heading?: number; speed?: number }) => {
    getDriverSocket().emit('driver:location_update', data);
  },

  // Server rejected a location update (e.g. outside Ghana's geofence) — the
  // driver silently never lands in the dispatch geo-set until this is fixed,
  // so surface it instead of leaving "why am I not getting trips" unanswered.
  onLocationRejected: (cb: (data: { message: string; code: string; lat: number; lng: number }) => void) => {
    getDriverSocket().on('driver:location_rejected', cb);
    return () => getDriverSocket().off('driver:location_rejected', cb);
  },

  emitTripStarted: (tripId: string) => {
    getDriverSocket().emit('driver:trip_started', { tripId });
  },

  emitTripDeparted: (tripId: string) => {
    getDriverSocket().emit('driver:trip_departed', { tripId });
  },

  // Arrived at the PICKUP stop — distinct from emitArrived below, which means
  // arrived at the final destination and completes the trip.
  emitArrivedAtPickup: (tripId: string) => {
    getDriverSocket().emit('driver:arrived_at_pickup', { tripId });
  },

  emitArrived: (tripId: string) => {
    getDriverSocket().emit('driver:arrived', { tripId });
  },

  sendChatMessage: (tripId: string, text: string) => {
    getDriverSocket().emit('chat:send', { tripId, text, timestamp: new Date().toISOString() });
  },

  sendPrivateChatMessage: (tripId: string, text: string, recipientId: string) => {
    getDriverSocket().emit('chat:private_send', { tripId, text, recipientId, timestamp: new Date().toISOString() });
  },

  onPrivateChatMessage: (cb: (msg: PrivateChatMessagePayload) => void) => {
    getDriverSocket().on('chat:private_message', cb);
    return () => getDriverSocket().off('chat:private_message', cb);
  },

  onPaymentConfirmed: (cb: (data: { bookingId: string; tripId: string }) => void) => {
    getDriverSocket().on('passenger:payment_confirmed', cb);
    return () => getDriverSocket().off('passenger:payment_confirmed', cb);
  },

  onChatMessage: (cb: (msg: ChatMessagePayload) => void) => {
    getDriverSocket().on('chat:message', cb);
    return () => getDriverSocket().off('chat:message', cb);
  },

  onSeatUpdate: (cb: (data: SeatEvent) => void) => {
    getDriverSocket().on('trip:seat_update', cb);
    return () => getDriverSocket().off('trip:seat_update', cb);
  },

  /**
   * Somebody took a seat on this driver's trip.
   *
   * Distinct from `onSeatUpdate`, which is a silent data frame carrying a new
   * seat map — it exists to repaint, not to announce. A direct booking from the
   * rider's suggested-trip card produced only that, so a passenger appeared on
   * the driver's seat map with nothing to draw their eye to it, while the
   * invite flow (which ends in a payment) got a push. This is the announcement
   * half for the path that has no payment yet.
   */
  onPassengerJoined: (
    cb: (data: { tripId: string; seatNumber: number | null; passengerName: string }) => void,
  ) => {
    getDriverSocket().on('trip:passenger_joined', cb);
    return () => getDriverSocket().off('trip:passenger_joined', cb);
  },

  onConnect: (cb: () => void) => {
    getDriverSocket().on('connect', cb);
    return () => getDriverSocket().off('connect', cb);
  },

  onDisconnect: (cb: () => void) => {
    getDriverSocket().on('disconnect', cb);
    return () => getDriverSocket().off('disconnect', cb);
  },

  onTripEta: (cb: (data: DriverEtaPayload) => void) => {
    getDriverSocket().on('trip:eta', cb);
    return () => getDriverSocket().off('trip:eta', cb);
  },

  /**
   * The server re-routed this trip because the driver left the line.
   *
   * The driver map draws the SERVER's geometry rather than calling Directions
   * itself — otherwise the driver and the rider render different lines for one
   * ride and each screen spends its own quota. This is how the line gets
   * corrected after a wrong turn.
   */
  onTripRoute: (cb: (data: TripRoutePayload) => void) => {
    getDriverSocket().on('trip:route', cb);
    return () => getDriverSocket().off('trip:route', cb);
  },

  emitJoinTracking: (tripId: string) => {
    getDriverSocket().emit('driver:join_tracking', { tripId });
  },

  onError: (cb: (data: { message: string; code: string }) => void) => {
    getDriverSocket().on('error', cb);
    return () => getDriverSocket().off('error', cb);
  },

  onTripStatus: (cb: (data: TripStatusPayload) => void) => {
    getDriverSocket().on('trip:status_change', cb);
    return () => getDriverSocket().off('trip:status_change', cb);
  },

  onTripAssigned: (cb: (data: {
    tripId: string;
    tripShortId?: string;
    // 'REQUEST' = an on-demand rider trip request, not yet a real Trip row —
    // the dispatch screen must call acceptTripRequest(id) instead of
    // acceptDispatch(id). 'REASSIGNMENT' = an existing Trip a previous driver
    // bailed on pre-boarding — call claimReassignment(id) instead. Absent/
    // undefined = the normal pre-scheduled-trip path (acceptDispatch(id)).
    kind?: 'REQUEST' | 'REASSIGNMENT';
    routeOrigin: string;
    routeDestination: string;
    departureTime: string;
    /**
     * Driver's cut after commission, in PESEWAS — the name the server has
     * always sent (admin.controller.js). The type said `estimatedEarnings`,
     * so every consumer read a field that does not exist and the dispatch
     * screen's earnings card silently never rendered. Typed wrong is how it
     * stayed unnoticed: the compiler was happy to check the wrong name.
     */
    estimatedEarningsPesewas?: number;
    seatCount?: number;
    bookedCount?: number;
    expiresAt: string;
  }) => void) => {
    getDriverSocket().on('trip:assigned', cb);
    return () => getDriverSocket().off('trip:assigned', cb);
  },

  // Upcoming scheduled ride reminder — fired by the backend on the driver:<id>
  // room as departure approaches, so the driver gets a heads-up notification.
  onScheduledReminder: (cb: (data: {
    tripId: string;
    routeOrigin?: string;
    routeDestination?: string;
    departureTime: string;
    seatCount?: number;
    confirmedSeats?: number;
    minutesUntilDeparture?: number;
  }) => void) => {
    getDriverSocket().on('trip:scheduled_reminder', cb);
    return () => getDriverSocket().off('trip:scheduled_reminder', cb);
  },

  onChatHistory: (cb: (messages: ChatHistoryPayload) => void) => {
    getDriverSocket().on('chat:history', cb);
    return () => getDriverSocket().off('chat:history', cb);
  },

  sendReadReceipt: (tripId: string, messageIds: string[]) => {
    getDriverSocket().emit('chat:read', { tripId, messageIds });
  },

  onReadReceipt: (cb: (data: ReadReceiptPayload) => void) => {
    getDriverSocket().on('chat:read_receipt', cb);
    return () => getDriverSocket().off('chat:read_receipt', cb);
  },

  sendTypingStart: (tripId: string) => {
    getDriverSocket().emit('chat:typing_start', { tripId });
  },

  sendTypingStop: (tripId: string) => {
    getDriverSocket().emit('chat:typing_stop', { tripId });
  },

  onTyping: (cb: (data: TypingPayload) => void) => {
    getDriverSocket().on('chat:typing', cb);
    return () => getDriverSocket().off('chat:typing', cb);
  },
};
