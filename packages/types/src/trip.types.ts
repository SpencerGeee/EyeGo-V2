export type TripTier = 'ECONOMY' | 'COMFORT' | 'PREMIUM';

/**
 * Mirrors `enum TripStatus` in prisma/schema.prisma. It must stay COMPLETE —
 * the same contract `BookingStatus` in ./booking.types.ts already states.
 *
 * It was neither complete nor correct. It listed 8 of the server's 15 statuses
 * and invented a 9th (`'BOARDING'`) that exists nowhere in the schema, the
 * services, or either app. Two consequences, and both of them are why the apps
 * "deviate":
 *
 *   1. The compiler could not help. Eight real statuses — REQUESTED, MATCHING,
 *      CONFIRMED, DRIVER_ASSIGNED, REASSIGNING, NO_DRIVERS_FOUND, EXPIRED,
 *      NO_SHOW — were not assignable to `TripStatus`, so every client `switch`
 *      over a trip status was incomplete BY CONSTRUCTION and no exhaustiveness
 *      check could ever flag it. A trip in a status the screen had no branch for
 *      fell through to whatever the default was: a blank label, a stuck
 *      "Reconnecting", a card that never rendered.
 *   2. `'BOARDING'` was dead weight that read as real. Anything comparing
 *      against it is unreachable code that looks like a handled case.
 *
 * Keep the groupings below in sync with `src/services/trip-state.service.js`
 * (`TERMINAL_STATUSES`, `ACTIVE_STATUSES`, `PRE_DRIVER_STATUSES`,
 * `PRE_TRIP_STATUSES`, `LIVE_STATUSES`). Clients should import these rather
 * than hand-rolling status arrays, which is how the two apps' notions of "my
 * current ride" drifted apart in the first place.
 */
export type TripStatus =
  // ── no driver yet
  | 'REQUESTED'
  | 'MATCHING'
  | 'REASSIGNING'
  // ── group / bus product, before departure
  | 'SCHEDULED'
  | 'FILLING'
  | 'CONFIRMED'
  // ── a driver is attached and the ride is running
  | 'DRIVER_ASSIGNED'
  | 'DRIVER_EN_ROUTE'
  | 'ARRIVED_AT_PICKUP'
  | 'IN_PROGRESS'
  // ── terminal (absorbing: the server refuses every outbound edge)
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_DRIVERS_FOUND'
  | 'EXPIRED'
  | 'NO_SHOW';

/** Absorbing. Nothing leaves these. */
export const TERMINAL_TRIP_STATUSES = [
  'COMPLETED',
  'CANCELLED',
  'NO_DRIVERS_FOUND',
  'EXPIRED',
  'NO_SHOW',
] as const satisfies readonly TripStatus[];

/** A driver is attached and the ride is running. */
export const ACTIVE_TRIP_STATUSES = [
  'DRIVER_ASSIGNED',
  'DRIVER_EN_ROUTE',
  'ARRIVED_AT_PICKUP',
  'IN_PROGRESS',
] as const satisfies readonly TripStatus[];

/** Dispatch is looking for someone; no driver attached yet. */
export const PRE_DRIVER_TRIP_STATUSES = [
  'REQUESTED',
  'MATCHING',
  'REASSIGNING',
] as const satisfies readonly TripStatus[];

/** Group / bus product, gathering passengers before departure. */
export const PRE_TRIP_TRIP_STATUSES = [
  'SCHEDULED',
  'FILLING',
  'CONFIRMED',
] as const satisfies readonly TripStatus[];

/** Everything a rider or driver would call "my current ride". */
export const LIVE_TRIP_STATUSES = [
  ...PRE_DRIVER_TRIP_STATUSES,
  ...PRE_TRIP_TRIP_STATUSES,
  ...ACTIVE_TRIP_STATUSES,
] as const satisfies readonly TripStatus[];

export const isTerminalTripStatus = (s: TripStatus | null | undefined): boolean =>
  !!s && (TERMINAL_TRIP_STATUSES as readonly string[]).includes(s);

export const isActiveTripStatus = (s: TripStatus | null | undefined): boolean =>
  !!s && (ACTIVE_TRIP_STATUSES as readonly string[]).includes(s);

export const isLiveTripStatus = (s: TripStatus | null | undefined): boolean =>
  !!s && (LIVE_TRIP_STATUSES as readonly string[]).includes(s);

/** True once a driver is attached — i.e. there is someone to show on a map. */
export const tripHasDriver = (s: TripStatus | null | undefined): boolean =>
  isActiveTripStatus(s);

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
  farePerSeatPesewas: number;
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
  baseFarePesewas: number;
  platformFeePesewas: number;
  total: number;
  currency: string;
  eta: number; // minutes
}
