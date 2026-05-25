import { apiClient } from './client';
import type { ApiResponse, PaginatedResponse } from '@eyego/types';
import type { TripDriver } from '@eyego/types';

// ── Passenger-facing (used by rider app) ─────────────────────────────────────
export const driversApi = {
  getById: (id: string) =>
    apiClient.get<ApiResponse<TripDriver>>(`/drivers/${id}`),

  getByTrip: (tripId: string) =>
    apiClient.get<ApiResponse<TripDriver>>(`/trips/${tripId}/driver`),
};

// ── Driver-facing (used by driver app) ───────────────────────────────────────
export interface DriverProfile {
  id: string;
  name: string;
  phone: string;
  profilePhoto?: string;
  avatarUrl?: string;       // alias for profilePhoto, populated by backend
  dateOfBirth?: string;
  status: string;
  rating: number;
  totalTrips: number;
  totalEarned: number;
  walletBalance: number;
  isOnline: boolean;
  isActive: boolean;
  profileComplete: boolean;
  createdAt: string;
  ghanaCardNumber?: string;
  emergencyContact?: { name: string; phone: string; relationship: string };
  navigationApp?: 'google_maps' | 'waze' | 'apple_maps';
  vehicles?: Array<{
    id: string;
    make: string;
    model: string;
    year: number;
    plateNumber: string;
    seaterCount: number;
    tier: string;
    isVerified: boolean;
    isActive: boolean;
  }>;
}

export interface DriverPerformance {
  acceptanceRate: number;
  completionRate: number;
  cancellationRate: number;
  onlineHoursThisWeek: number;
  tripsThisWeek: number;
  earningsThisWeek: number;
  level: 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';
  weeklyGoal: number;
  weeklyGoalProgress: number;
}

export interface DriverRatings {
  average: number;
  total: number;
  breakdown: { stars: number; count: number; percentage: number }[];
  compliments: { label: string; count: number; icon: string }[];
  recent: { tripId: string; stars: number; comment?: string; createdAt: string }[];
}

export interface DriverDocument {
  id: string;
  type: 'DRIVERS_LICENSE' | 'VEHICLE_INSURANCE' | 'VEHICLE_REGISTRATION' | 'PROFILE_PHOTO';
  status: 'PENDING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED' | 'MISSING';
  expiresAt?: string;
  url?: string;
  rejectionReason?: string;
}

export interface CreateTripPayload {
  routeId: string;
  departureTime: string;
  availableSeats: number;
  tier?: 'ECONOMY' | 'COMFORT';
  vehicleId?: string;
}

export interface DriverTrip {
  id: string;
  shortId?: string;
  routeId: string;
  route: {
    id: string;
    name: string;
    originName: string;
    destinationName: string;
    originLat: number;
    originLng: number;
    destLat: number;
    destLng: number;
    distanceKm: number;
  };
  departureTime: string;
  departedAt?: string;
  arrivedAt?: string;
  maxSeats: number;
  confirmedSeats: number;
  // UI convenience alias — equals baseFare from backend
  farePerSeat: number;
  baseFare: number;
  status: 'SCHEDULED' | 'FILLING' | 'DRIVER_EN_ROUTE' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  totalEarnings?: number;
  bookings?: Array<{
    id: string;
    userId?: string;
    seatNumber?: number;
    fareAmount: number;
    paymentStatus: string;
    status: string;
    isOffline: boolean;
    user?: { name: string; phone: string; profilePhoto?: string };
  }>;
  vehicle?: { plateNumber: string; make: string; model: string; tier: string };
  createdAt: string;
}

export const driverApi = {
  // Profile
  getMe: () =>
    apiClient.get<ApiResponse<DriverProfile>>('/driver/me'),

  updateMe: (data: Partial<Pick<DriverProfile, 'name' | 'avatarUrl' | 'dateOfBirth' | 'profilePhoto'>>) =>
    apiClient.patch<ApiResponse<DriverProfile>>('/driver/me', data),

  // Dev-only: immediately activate a PENDING_REVIEW account
  devActivate: () =>
    apiClient.post<ApiResponse<DriverProfile>>('/driver/dev-activate'),

  // All non-cancelled trips with route data (for the trips tab segments)
  getAllTrips: () =>
    apiClient.get<ApiResponse<{ trips: DriverTrip[] }>>('/driver/trips/all'),

  // Availability
  goOnline: (data: { lat: number; lng: number }) =>
    apiClient.post<ApiResponse<{ isOnline: boolean }>>('/driver/go-online', data),

  goOffline: () =>
    apiClient.post<ApiResponse<{ isOnline: boolean }>>('/driver/go-offline'),

  getFareEstimate: (params: { distanceKm: number; tier?: string }) =>
    apiClient.get<ApiResponse<{ fareEstimate: { farePerPerson: number; totalTripCost: number; driverEarningsPerSeat: number }; surgeMultiplier: number }>>('/driver/fare-estimate', { params }),

  // Trip management
  createTrip: (data: CreateTripPayload) =>
    apiClient.post<ApiResponse<{ trip: DriverTrip }>>('/driver/trips', data),

  getTrips: (params?: { page?: number; limit?: number }) =>
    apiClient.get<PaginatedResponse<DriverTrip>>('/driver/trips', { params }),

  getActiveTrip: () =>
    apiClient.get<ApiResponse<{ trip: DriverTrip } | null>>('/driver/trips/active'),

  startTrip: (tripId: string) =>
    apiClient.post<ApiResponse<DriverTrip>>(`/driver/trips/${tripId}/start`),

  departTrip: (tripId: string) =>
    apiClient.post<ApiResponse<DriverTrip>>(`/driver/trips/${tripId}/depart`),

  arriveTrip: (tripId: string) =>
    apiClient.post<ApiResponse<DriverTrip & { earningsThisTrip: number }>>(`/driver/trips/${tripId}/arrive`),

  // Offline passenger boarding
  addOfflinePassenger: (tripId: string, data: { seatNumber: number; phone: string }) =>
    apiClient.post<ApiResponse<{ bookingId: string }>>(`/driver/trips/${tripId}/add-offline-passenger`, data),

  addCashPassenger: (tripId: string, data: { seatNumber: number }) =>
    apiClient.post<ApiResponse<{ bookingId: string }>>(`/driver/trips/${tripId}/add-cash-no-phone`, data),

  verifyPassengerOtp: (tripId: string, data: { bookingId: string; otp: string }) =>
    apiClient.post<ApiResponse<{ verified: boolean }>>(`/driver/trips/${tripId}/verify-otp`, data),

  boardPassenger: (tripId: string, bookingId: string) =>
    apiClient.post<ApiResponse<{ boarded: boolean }>>(`/driver/trips/${tripId}/board/${bookingId}`),

  // Cancel a self-created trip (only allowed before COMPLETED/CANCELLED)
  cancelTrip: (tripId: string) =>
    apiClient.post<ApiResponse<DriverTrip>>(`/driver/trips/${tripId}/cancel`),

  // Admin dispatch — accept or decline an assigned trip
  acceptDispatch: (tripId: string) =>
    apiClient.post<ApiResponse<DriverTrip>>(`/driver/trips/${tripId}/accept`),

  declineDispatch: (tripId: string, reason?: string) =>
    apiClient.post<ApiResponse<{ declined: boolean }>>(`/driver/trips/${tripId}/decline`, { reason }),

  // Push notifications — register/update FCM/Expo token
  updateFcmToken: (token: string) =>
    apiClient.patch<ApiResponse<void>>('/driver/fcm-token', { token }),

  // Performance stats — acceptance/completion rates, online hours, level
  getPerformance: () =>
    apiClient.get<ApiResponse<DriverPerformance>>('/driver/performance'),

  // Ratings — star breakdown + compliments + recent trip ratings
  getRatings: () =>
    apiClient.get<ApiResponse<DriverRatings>>('/driver/ratings'),

  // KYC documents — list all with status
  getDocuments: () =>
    apiClient.get<ApiResponse<DriverDocument[]>>('/driver/documents'),

  // Upload a KYC document (multipart/form-data)
  uploadDocument: (type: string, formData: FormData) =>
    apiClient.post<ApiResponse<{ id: string; status: string }>>('/driver/documents', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),

  // Emergency contact
  updateEmergencyContact: (data: { name: string; phone: string; relationship: string }) =>
    apiClient.patch<ApiResponse<void>>('/driver/emergency-contact', data),

  // App preferences — navigation app choice
  updatePreferences: (data: { navigationApp?: 'google_maps' | 'waze' | 'apple_maps' }) =>
    apiClient.patch<ApiResponse<void>>('/driver/preferences', data),
};
