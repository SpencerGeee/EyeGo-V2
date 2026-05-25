export type TripTier = 'ECONOMY' | 'COMFORT' | 'PREMIUM';
export type TripStatus = 'SCHEDULED' | 'BOARDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface Location {
  latitude: number;
  longitude: number;
  address: string;
  placeId?: string;
}

export interface Trip {
  id: string;
  origin: Location;
  destination: Location;
  departureTime: string;
  estimatedArrival: string;
  tier: TripTier;
  status: TripStatus;
  totalSeats: number;
  availableSeats: number;
  fare: number;
  currency: string;
  driver: TripDriver;
  vehicle: Vehicle;
  routePolyline?: string;
  distanceKm: number;
  durationMinutes: number;
}

export interface TripDriver {
  id: string;
  name: string;
  avatarUrl: string | null;
  rating: number;
  totalTrips: number;
  phone: string;
}

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  plate: string;
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
