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

/**
 * ── RECONCILED AGAINST WHAT THE APPS ACTUALLY READ ──────────────────────────
 *
 * This interface existed for a long time and the apps imported it NINE times
 * across 210 files carrying 1,286 `any`s. That was not laziness. The type had
 * drifted from the wire in both directions, so annotating against it produced a
 * wall of errors on correct code and `as any` won every time.
 *
 * It was rebuilt by OBSERVATION rather than intention: every property access on
 * a trip-shaped identifier across both apps was enumerated, and a field is
 * optional here wherever its readers guard it with `?.` or `??`. A type that
 * documents what the server sends beats one that documents what we wish it sent
 * — the second kind is the reason nobody used this one.
 *
 * ── WHAT WAS WRONG, CONCRETELY ──────────────────────────────────────────────
 *
 * REQUIRED, BUT FREQUENTLY ABSENT. `driver` and `vehicle` do not exist on an
 * unassigned trip or on a search result; `origin`/`destination` are the group
 * flow's shape and an on-demand ride carries `pickupAddress`/`dropoffAddress`
 * instead. Declaring those required made every honest null-check an error.
 *
 * ABSENT, BUT READ DAILY. Twenty-five fields, including every coordinate an
 * ad-hoc trip carries — and `bookings[].seats`, which is the field `seatsOf()`
 * reads. That omission is not incidental: it is the field behind BOTH
 * seats-vs-rows bugs (a party of three showing as one seat on the driver's
 * receipt, and one boarded tile out of three on the seat map). The type could
 * not have caught either, because it did not know the field existed.
 */
export interface Trip {
  id: string;
  /** Some payloads echo the id under this name. Prefer `id`. */
  tripId?: string;
  status: TripStatus;
  tier?: TripTier;
  departureTime?: string;
  estimatedArrival?: string;
  scheduledAt?: string;
  arrivedAt?: string;
  completedAt?: string;

  /**
   * ── THE ENDPOINTS, IN ALL THE SHAPES THE SERVER SENDS THEM ────────────────
   * A route-backed group trip carries `origin`/`destination` objects; an ad-hoc
   * on-demand ride carries flat `pickup*`/`dropoff*` columns; the tracking
   * snapshot carries `pickup`/`dropoff`. Every consumer in both apps already
   * tries several of these in turn — see `originLabel`/`destinationLabel` in
   * @eyego/utils, which exists precisely because of this. All optional,
   * because for any given payload most of them are.
   */
  origin?: Location;
  destination?: Location;
  pickup?: { lat?: number; lng?: number; address?: string } | null;
  dropoff?: { lat?: number; lng?: number; address?: string } | null;
  pickupLocation?: { lat?: number; lng?: number; address?: string } | null;
  dropoffLocation?: { lat?: number; lng?: number; address?: string } | null;
  pickupAddress?: string | null;
  dropoffAddress?: string | null;
  pickupLat?: number | null;
  pickupLng?: number | null;
  dropoffLat?: number | null;
  dropoffLng?: number | null;
  destLat?: number | null;
  destLng?: number | null;

  maxSeats?: number;
  totalSeats?: number;
  availableSeats?: number;
  /** Seats sold and settled. Counted in SEATS, never in booking rows. */
  confirmedSeats?: number;
  /** Seats held but not yet paid for. */
  pendingSeats?: number;

  fare?: number;
  farePerSeatPesewas?: number;
  totalTripCostPesewas?: number;
  driverEarningsPerSeatPesewas?: number;
  commissionRate?: number;
  currency?: string;
  paymentMethod?: string | null;

  distanceKm?: number;
  durationMinutes?: number;
  etaMinutes?: number | null;
  routePolyline?: string;

  /** Absent until a driver is attached — which is most of a trip's life. */
  driver?: TripDriver | null;
  driverId?: string;
  /** Absent on search payloads, which never join the vehicle. */
  vehicle?: Vehicle | null;

  shortId?: string;
  routeId?: string | null;
  /** True for a hailed ride, false for a driver-created route trip. */
  isOnDemand?: boolean;
  /** Monotonic snapshot version — see the trip channel's replay contract. */
  version?: number;

  bookings?: Array<{
    id: string;
    userId?: string;
    /**
     * The account that booked. `id` is OPTIONAL on purpose: a driver-added
     * offline passenger is a real booking with a real name and phone and no
     * account behind it at all. Requiring `id` here is what made the driver's
     * own seat-map reducer reject this type.
     */
    user?: { id?: string; name?: string; phone?: string; profilePhoto?: string } | null;
    status: string;
    createdAt?: string;
    /** Present on flattened activity payloads that fold the trip in. */
    departureTime?: string;
    seatNumber?: number;
    /**
     * PARTY SIZE ON THIS ONE ROW — the field behind both seats-vs-rows bugs.
     *
     * One booking can be three people. Anything counting PEOPLE must read this
     * (via `seatsOf` in @eyego/utils, which defaults legacy rows to 1);
     * anything counting ROWS is almost certainly wrong. It was missing from
     * this interface entirely, so the compiler could not have caught either
     * bug.
     */
    seats?: number;
    paymentStatus?: string;
    paymentMethod?: string;
    isOffline?: boolean;
    guestName?: string | null;
    guestPhone?: string | null;
    fareAmountPesewas?: number;
    commissionAmountPesewas?: number;
    /** Set when the rider read their code back. See the boarding PIN flow. */
    pinVerifiedAt?: string | null;
    /** The server sends this boolean, never the code itself. */
    requiresBoardingPin?: boolean;
  }>;
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

/**
 * ONE ROW OF A TRIP'S BOOKING LIST.
 *
 * Named so the seventeen reducers that walk this array can stop being
 * `(b: any)`. That matters more here than anywhere else in either app: these
 * are the functions that decide how many people are on a vehicle and how much
 * money the driver is owed, and `any` is precisely why a party of three could
 * be counted as one seat twice in the same day.
 */
export type TripBooking = NonNullable<Trip['bookings']>[number];
