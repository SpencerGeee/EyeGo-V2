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
}

export interface GroupMember {
  bookingId: string;
  passengerName: string;
  avatarUrl: string | null;
  seatNumber: number;
  joinedAt: string;
}
