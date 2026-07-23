export type BookingStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'BOARDED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'SEAT_HELD';

export interface Booking {
  id: string;
  tripId: string;
  passengerId: string;
  seatId: string;
  seatNumber: number;
  status: BookingStatus;
  fare: number;
  fareAmount?: number;
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
  commissionAmount?: number;
  // A group-hub joiner's own pickup point when it differs from the trip's
  // main pickup, and the resulting detour surcharge (0 for the common case).
  pickupLat?: number;
  pickupLng?: number;
  pickupAddress?: string;
  deviationSurcharge?: number;
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
