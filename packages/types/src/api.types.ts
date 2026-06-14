export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface ApiError {
  success: false;
  message: string;
  errors?: Record<string, string[]>;
  statusCode: number;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

// Socket.io event types
export interface DriverLocationEvent {
  driverId: string;
  tripId: string;
  latitude: number;
  longitude: number;
  heading: number;
  speed: number;
}

export interface TripEtaEvent {
  tripId: string;
  etaMinutes: number;
  distanceKm: number;
  stopsAway?: number;
  message: string;
  geometry?: {
    type: 'LineString';
    coordinates: [number, number][]; // [lng, lat][] — Mapbox/GeoJSON order
  };
}

export interface TripStatusEvent {
  tripId: string;
  status: import('./trip.types').TripStatus | 'DRIVER_EN_ROUTE' | 'NO_SHOW' | 'REFUNDED';
  message: string;
}

export interface SeatEvent {
  tripId: string;
  seatData: Record<string, any>;
}

export interface ChatMessagePayload {
  senderId: string;
  senderName?: string;
  senderRole?: string;
  seatNumber?: number | null;
  text: string;
  timestamp: string;
  isPrivate?: boolean;
  recipientId?: string;
}

export interface PrivateChatMessagePayload {
  senderId: string;
  senderName?: string;
  text: string;
  timestamp: string;
  isPrivate: boolean;
  recipientId?: string;
}

export interface TypingPayload {
  senderId: string;
  senderRole: string;
  isTyping: boolean;
}

export interface ReadReceiptPayload {
  tripId: string;
  messageIds: string[];
  readBy: string;
}

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

export interface SafetyCheckPayload {
  tripId: string;
  reason: string;
  timestamp: number;
}
