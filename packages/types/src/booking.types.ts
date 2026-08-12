/**
 * Mirrors `enum BookingStatus` in prisma/schema.prisma. It must stay complete:
 * a status the server can send but this union omits is a status every
 * `switch`/lookup on the client silently mishandles.
 *
 * SEAT_HELD is a *hold*, not a booking. The seat is reserved for the length of
 * SEAT_HOLD_DURATION_MINUTES while the rider pays, is released automatically if
 * they don't, and must never be presented to either app as "booked".
 */
export type BookingStatus =
  | 'PENDING'
  | 'SEAT_HELD'
  | 'CONFIRMED'
  | 'PAID'
  | 'BOARDED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'EXPIRED'
  | 'NO_SHOW';

/** True while the seat is only reserved — payment has not landed. */
export const isSeatHeld = (s: BookingStatus | null | undefined): boolean =>
  s === 'SEAT_HELD' || s === 'PENDING';

export interface Booking {
  id: string;
  tripId: string;
  passengerId: string;
  seatId: string;
  seatNumber: number;
  status: BookingStatus;
  fare: number;
  fareAmountPesewas?: number;
  currency: string;
  paymentMethod: 'MOMO' | 'CARD' | 'CASH' | 'WALLET';
  paymentStatus: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  boardingOtp?: string;
  inviteToken?: string;
  groupId?: string;
  rating?: number;
  passengerRating?: number;
  ratingComment?: string;
  pickupStopId?: string;
  pickupStop?: { id: string; name: string };
  enRouteRatio?: number;
  // Set when this seat was booked FOR someone else. One account can hold
  // several seats on one trip — its own plus one per guest — so this is the
  // field that tells two of that account's bookings apart.
  guestName?: string | null;
  guestPhone?: string | null;
  commissionAmountPesewas?: number;
  // A group-hub joiner's own pickup point when it differs from the trip's
  // main pickup, and the resulting detour surcharge (0 for the common case).
  pickupLat?: number;
  pickupLng?: number;
  pickupAddress?: string;
  deviationSurchargePesewas?: number;
  heavyCargo?: boolean;
  createdAt: string;
  trip?: import('./trip.types').Trip;
}

export interface CreateBookingRequest {
  tripId: string;
  seatId: string;
  seatNumber?: number;
  paymentMethod: 'MOMO' | 'CARD' | 'WALLET';
  pickupStopId?: string;
  guestName?: string;
  guestPhone?: string;
  // Group-hub joiner's own pickup point when it differs from the trip's main
  // pickup (e.g. friends booked via invite link scattered across town) — a
  // large detour adds a deviation surcharge, computed server-side.
  pickupLat?: number;
  pickupLng?: number;
  pickupAddress?: string;
}

export interface RatingRequest {
  rating: number;
  comment?: string;
}

export interface GroupBooking {
  id: string;
  inviteToken: string;
  inviteLink: string;
  hostBookingId: string;
  members: GroupMember[];
  maxSize: number;
  /** Whether the group's lead passenger is settling every seat on the trip. */
  isCoverAll: boolean;
  /**
   * What the requesting rider owes for this trip, added up by the server from the
   * exact booking rows `POST /payments/initiate` will charge for.
   *
   * Every field is integer pesewas. Do NOT multiply `perSeatPesewas` by anything
   * to reach a total — a per-seat price cannot carry a per-booking surcharge, and
   * deriving the total that way is what made the group hub show a figure the
   * heavy-cargo toggle could not move. `totalPesewas` IS the total.
   */
  fare: RiderTripFare;
}

export interface RiderTripFare {
  currency: 'GHS';
  /** THE number: what this rider owes / has paid for this trip. Pesewas. */
  totalPesewas: number;
  /** How many seats that total covers. */
  seatCount: number;
  /** `totalPesewas` with the surcharges taken back out, per seat. */
  perSeatPesewas: number;
  cargoSurchargePesewas: number;
  deviationSurchargePesewas: number;
  /** Seats with money behind them — paid outright, or a confirmed cash seat. */
  committedSeatCount: number;
  paidSeatCount: number;
  /** Seats still only RESERVED. Nothing has been charged for these. */
  heldSeatCount: number;
  coveredSeatCount: number;
  seatNumbers: number[];
  isCoverAll: boolean;
  seatsCoveredForOthers: number;
}

export interface GroupMember {
  bookingId: string;
  passengerName: string;
  avatarUrl: string | null;
  seatNumber: number;
  joinedAt: string;
}
