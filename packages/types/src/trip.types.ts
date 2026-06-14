export type TripTier = 'ECONOMY' | 'COMFORT' | 'PREMIUM';
export type TripStatus =
  | 'SCHEDULED'
  | 'FILLING'
  | 'BOARDING'
  | 'DRIVER_EN_ROUTE'
  | 'ARRIVED_AT_PICKUP'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';

export interface Location {
  latitude: number;
  longitude: number;
  address: string;
  placeId?: string;
}

export interface VirtualStop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  sequence: number;
  isActive: boolean;
}

export interface Trip {
  id: string;
  origin: Location;
  destination: Location;
  departureTime: string;
  estimatedArrival: string;
  tier: TripTier;
  status: TripStatus;
  maxSeats?: number;
  totalSeats: number;
  availableSeats: number;
  fare: number;
  farePerSeat: number;
  currency: string;
  driver: TripDriver;
  vehicle: Vehicle;
  routePolyline?: string;
  distanceKm: number;
  durationMinutes: number;
  bookings?: Array<{
    id: string;
    userId?: string;
    user?: { id: string; name?: string; phone?: string };
    status: string;
    seatNumber?: number;
    paymentStatus?: string;
    paymentMethod?: string;
    isOffline?: boolean;
  }>;
  shortId?: string;
  driverId?: string;
  commissionRate?: number;
  route?: {
    id: string;
    name?: string;
    originName?: string;
    destinationName?: string;
    originLat: number;
    originLng: number;
    destLat: number;
    destLng: number;
    distanceKm: number;
    virtualStops?: VirtualStop[];
  };
}

export interface TripDriver {
  id: string;
  name: string;
  avatarUrl: string | null;
  rating: number;
  totalTrips: number;
  phone: string;
  currentLat?: number;
  currentLng?: number;
}

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  plate: string;
  plateNumber?: string;
  color: string;
  seats: number;
  imageUrl: string | null;
}

export interface Seat {
  id: string;
  number: number;
  row: number;
  column: number;
  status: 'AVAILABLE' | 'OCCUPIED' | 'SELECTED' | 'RESERVED';
}

export interface SearchTripsParams {
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
  tier?: TripTier;
  departureDate?: string;
}

export interface FareEstimate {
  tier: TripTier;
  baseFare: number;
  platformFee: number;
  total: number;
  currency: string;
  eta: number; // minutes
}
