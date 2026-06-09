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
