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
