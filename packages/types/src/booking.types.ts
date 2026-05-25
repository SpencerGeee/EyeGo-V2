export type BookingStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'BOARDED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REFUNDED';

export interface Booking {
  id: string;
  tripId: string;
  passengerId: string;
  seatId: string;
  seatNumber: number;
  status: BookingStatus;
  fare: number;
  currency: string;
  paymentMethod: 'MOMO' | 'CARD' | 'CASH';
  paymentStatus: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  boardingOtp?: string;
  inviteToken?: string;
  groupId?: string;
  rating?: number;
  ratingComment?: string;
  createdAt: string;
  trip?: import('./trip.types').Trip;
}

export interface CreateBookingRequest {
  tripId: string;
  seatId: string;
  paymentMethod: 'MOMO' | 'CARD';
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
