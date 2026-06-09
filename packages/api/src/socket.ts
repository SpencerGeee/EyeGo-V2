import type { Socket } from 'socket.io-client';
import type { DriverLocationEvent, TripEtaEvent, TripStatusEvent } from '@eyego/types';

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
    // Lazy-load socket.io-client so it doesn't run at module evaluation time
    // during React Native boot (avoids global property conflicts in Hermes)
    const { io } = require('socket.io-client') as typeof import('socket.io-client');
    
    // Connect explicitly to the /passenger namespace
    const socketUrl = BASE_URL.endsWith('/') ? BASE_URL + 'passenger' : BASE_URL + '/passenger';
    
    socket = io(socketUrl, {
      autoConnect: false,
      transports: ['websocket'],
      auth: (cb: (data: { token: string | null }) => void) => cb({ token: getToken() }),
    });

    socket!.on('connect_error', (err: Error) => {
      console.warn('[Socket] Connection error:', err.message);
    });
  }
  return socket!;
}

/**
 * Ref-counted connect — safe to call from multiple components simultaneously.
 * The underlying socket is only connected on the first call.
 */
export function connectSocket() {
  socketRefs++;
  if (socketRefs === 1) {
    getSocket().connect();
  }
}

/**
 * Ref-counted disconnect — only disconnects when all callers have released.
 */
export function disconnectSocket() {
  socketRefs = Math.max(0, socketRefs - 1);
  if (socketRefs === 0) {
    socket?.disconnect();
    socket = null;
  }
}

/**
 * RC1: Re-authenticate the passenger socket after a token refresh.
 * socket.io-client re-reads the auth callback on reconnect, so a
 * disconnect → connect cycle picks up the new token automatically.
 */
export function refreshSocketAuth() {
  if (socket && socket.connected) {
    socket.disconnect();
    socket.connect();
  }
}

// Maps wrapped callbacks to original callbacks so off() can clean up correctly
const driverCallbacks = new Map<any, (...args: any[]) => void>();

// Typed event subscriptions
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

  onSeatUpdate: (cb: (data: any) => void) => {
    getSocket().on('trip:seat_update', cb);
    return () => getSocket().off('trip:seat_update', cb);
  },

  joinTripRoom: (tripId: string, driverId?: string) => {
    getSocket().emit('passenger:join_trip_room', { tripId, driverId });
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

  onChatMessage: (cb: (msg: { senderId: string; text: string; timestamp: string; senderName?: string; senderRole?: string; seatNumber?: number | null; isPrivate?: boolean; recipientId?: string }) => void) => {
    getSocket().on('chat:message', cb);
    return () => getSocket().off('chat:message', cb);
  },

  onPrivateChatMessage: (cb: (msg: { senderId: string; senderName?: string; text: string; timestamp: string; isPrivate: boolean; recipientId?: string }) => void) => {
    getSocket().on('chat:private_message', cb);
    return () => getSocket().off('chat:private_message', cb);
  },

  onChatHistory: (cb: (messages: any[]) => void) => {
    getSocket().on('chat:history', cb);
    return () => getSocket().off('chat:history', cb);
  },

  onSafetyCheck: (cb: (data: { tripId: string; reason: string; timestamp: number }) => void) => {
    getSocket().on('safety:check', cb);
    return () => getSocket().off('safety:check', cb);
  },

  sendReadReceipt: (tripId: string, messageIds: string[]) => {
    getSocket().emit('chat:read', { tripId, messageIds });
  },

  onReadReceipt: (cb: (data: { tripId: string; messageIds: string[]; readBy: string }) => void) => {
    getSocket().on('chat:read_receipt', cb);
    return () => getSocket().off('chat:read_receipt', cb);
  },

  // SOS: stream passenger location to backend for safety monitoring
  sendSafetyLocation: (data: { tripId: string; latitude: number; longitude: number }) => {
    getSocket().emit('safety:location', data);
  },

  onRideCheckAlert: (cb: (data: { message: string; severity: string }) => void) => {
    getSocket().on('safety:ride_check_alert', cb);
    return () => getSocket().off('safety:ride_check_alert', cb);
  },

  sendTypingStart: (tripId: string) => {
    getSocket().emit('chat:typing_start', { tripId });
  },

  sendTypingStop: (tripId: string) => {
    getSocket().emit('chat:typing_stop', { tripId });
  },

  onTyping: (cb: (data: { senderId: string; senderRole: string; isTyping: boolean }) => void) => {
    getSocket().on('chat:typing', cb);
    return () => getSocket().off('chat:typing', cb);
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
      transports: ['websocket'],
      auth: (cb: (data: { token: string | null }) => void) => cb({ token: getToken() }),
    });
    driverSocket!.on('connect_error', (err: Error) => {
      console.warn('[DriverSocket] Connection error:', err.message);
    });
  }
  return driverSocket!;
}

// Ref-count so multiple components can safely call connect/disconnect
// without tearing down the socket while another component still needs it.
let driverSocketRefs = 0;

export function connectDriverSocket() {
  driverSocketRefs++;
  if (driverSocketRefs === 1) {
    getDriverSocket().connect();
  }
}

export function disconnectDriverSocket() {
  driverSocketRefs = Math.max(0, driverSocketRefs - 1);
  if (driverSocketRefs === 0) {
    driverSocket?.disconnect();
    driverSocket = null;
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

  onPrivateChatMessage: (cb: (msg: { senderId: string; senderName?: string; text: string; timestamp: string; isPrivate: boolean; recipientId?: string }) => void) => {
    getDriverSocket().on('chat:private_message', cb);
    return () => getDriverSocket().off('chat:private_message', cb);
  },

  onPaymentConfirmed: (cb: (data: { bookingId: string; tripId: string }) => void) => {
    getDriverSocket().on('passenger:payment_confirmed', cb);
    return () => getDriverSocket().off('passenger:payment_confirmed', cb);
  },

  onChatMessage: (cb: (msg: { senderId: string; senderName?: string; senderRole?: string; seatNumber?: number | null; text: string; timestamp: string; isPrivate?: boolean; recipientId?: string }) => void) => {
    getDriverSocket().on('chat:message', cb);
    return () => getDriverSocket().off('chat:message', cb);
  },

  onSeatUpdate: (cb: (data: any) => void) => {
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

  onTripEta: (cb: (data: { tripId: string; etaMinutes: number; distanceKm?: number; message?: string; geometry?: any }) => void) => {
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

  onTripStatus: (cb: (data: { tripId: string; status: string }) => void) => {
    getDriverSocket().on('trip:status_change', cb);
    return () => getDriverSocket().off('trip:status_change', cb);
  },

  // Admin dispatch: backend emits this when a trip is assigned to the driver
  onTripAssigned: (cb: (data: {
    tripId: string;
    routeOrigin: string;
    routeDestination: string;
    departureTime: string;
    expiresAt: string; // ISO timestamp — driver must respond before this
  }) => void) => {
    getDriverSocket().on('trip:assigned', cb);
    return () => getDriverSocket().off('trip:assigned', cb);
  },

  onChatHistory: (cb: (messages: { senderId: string; senderName?: string; senderRole?: string; seatNumber?: number | null; text: string; timestamp: string; isPrivate?: boolean; recipientId?: string }[]) => void) => {
    getDriverSocket().on('chat:history', cb);
    return () => getDriverSocket().off('chat:history', cb);
  },

  sendReadReceipt: (tripId: string, messageIds: string[]) => {
    getDriverSocket().emit('chat:read', { tripId, messageIds });
  },

  onReadReceipt: (cb: (data: { tripId: string; messageIds: string[]; readBy: string }) => void) => {
    getDriverSocket().on('chat:read_receipt', cb);
    return () => getDriverSocket().off('chat:read_receipt', cb);
  },

  sendTypingStart: (tripId: string) => {
    getDriverSocket().emit('chat:typing_start', { tripId });
  },

  sendTypingStop: (tripId: string) => {
    getDriverSocket().emit('chat:typing_stop', { tripId });
  },

  onTyping: (cb: (data: { senderId: string; senderRole: string; isTyping: boolean }) => void) => {
    getDriverSocket().on('chat:typing', cb);
    return () => getDriverSocket().off('chat:typing', cb);
  },
};
