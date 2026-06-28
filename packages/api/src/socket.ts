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

export type DriverEtaPayload = {
  tripId: string;
  etaMinutes: number;
  distanceKm?: number;
  message?: string;
  geometry?: any;
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

export function configureSocket(opts: { getToken: () => string | null }) {
  getToken = opts.getToken;
}

export function getSocket(): Socket {
  if (!socket) {
    const { io } = require('socket.io-client') as typeof import('socket.io-client');
    const socketUrl = BASE_URL.endsWith('/') ? BASE_URL + 'passenger' : BASE_URL + '/passenger';
    socket = io(socketUrl, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
      auth: (cb: (data: { token: string | null }) => void) => cb({ token: getToken() }),
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      randomizationFactor: 0.5,
    });
    socket!.on('connect_error', (err: Error) => {
      console.warn('[Socket] Connection error:', err.message);
    });
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
  // Update the auth token for the next connection (socket.io reads auth on reconnect)
  _socket.auth = { token: getToken?.() };
  // If socket is already connected, no need to disconnect — just update auth for next reconnect
  // If disconnected, reconnect now
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

  onTripStatus: (cb: (data: TripStatusEvent) => void) => {
    getSocket().on('trip:status_change', cb);
    return () => getSocket().off('trip:status_change', cb);
  },

  onSeatUpdate: (cb: (data: SeatEvent) => void) => {
    getSocket().on('trip:seat_update', cb);
    return () => getSocket().off('trip:seat_update', cb);
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

  onRideCheckAlert: (cb: (data: { message: string; severity: string }) => void) => {
    getSocket().on('safety:ride_check_alert', cb);
    return () => getSocket().off('safety:ride_check_alert', cb);
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
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      randomizationFactor: 0.5,
    });
    driverSocket!.on('connect_error', (err: Error) => {
      console.warn('[DriverSocket] Connection error:', err.message);
    });
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

  emitTripStarted: (tripId: string) => {
    getDriverSocket().emit('driver:trip_started', { tripId });
  },

  emitTripDeparted: (tripId: string) => {
    getDriverSocket().emit('driver:trip_departed', { tripId });
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
    routeOrigin: string;
    routeDestination: string;
    departureTime: string;
    estimatedEarnings?: number;
    seatCount?: number;
    bookedCount?: number;
    expiresAt: string;
  }) => void) => {
    getDriverSocket().on('trip:assigned', cb);
    return () => getDriverSocket().off('trip:assigned', cb);
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
