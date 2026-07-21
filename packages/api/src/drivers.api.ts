import { apiClient } from './client';
import type { ApiResponse } from '@eyego/types';
import type { TripDriver } from '@eyego/types';

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
  ratingCount: number;
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
  theme?: 'dark' | 'light';
  notificationsEnabled?: boolean;
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
  type: 'DRIVERS_LICENSE' | 'VEHICLE_INSURANCE' | 'VEHICLE_REGISTRATION' | 'PROFILE_PHOTO' | 'GHANA_CARD';
  status: 'PENDING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED' | 'MISSING';
  expiresAt?: string;
  url?: string;
  rejectionReason?: string;
}

export interface CreateTripPayload {
  routeId: string;
  departureTime: string;
  availableSeats: number;
  tier?: 'ECONOMY' | 'COMFORT' | 'PREMIUM';
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
  // Real per-seat commission split, computed server-side (attachFarePerSeat) —
  // use these instead of guessing a commission rate/split client-side.
  commissionRate?: number;
  driverEarningsPerSeat?: number;
  baseFare: number;
  status: 'SCHEDULED' | 'FILLING' | 'DRIVER_EN_ROUTE' | 'ARRIVED_AT_PICKUP' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
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

  // Single trip detail by ID
  getTripById: (tripId: string) =>
    apiClient.get<ApiResponse<{ trip: DriverTrip }>>(`/driver/trips/${tripId}`),

  // Availability
  goOnline: (data: { lat?: number; lng?: number }) =>
    apiClient.post<ApiResponse<{ isOnline: boolean }>>('/driver/go-online', data),

  goOffline: () =>
    apiClient.post<ApiResponse<{ isOnline: boolean }>>('/driver/go-offline'),

  getFareEstimate: (params: { distanceKm: number; tier?: string; availableSeats?: number }) =>
    apiClient.get<ApiResponse<{ fareEstimate: { farePerPerson: number; totalTripCost: number; driverEarningsPerSeat: number }; surgeMultiplier: number }>>('/driver/fare-estimate', { params }),

  // Trip management
  createTrip: (data: CreateTripPayload) =>
    apiClient.post<ApiResponse<{ trip: DriverTrip }>>('/driver/trips', data),

  getTrips: (params?: { page?: number; limit?: number }) =>
    apiClient.get<ApiResponse<{ trips: DriverTrip[]; total: number; page: number; totalPages: number }>>('/driver/trips', { params }),

  getActiveTrip: () =>
    apiClient.get<ApiResponse<{ trip: DriverTrip } | null>>('/driver/trips/active'),

  startTrip: (tripId: string) =>
    apiClient.post<ApiResponse<DriverTrip>>(`/driver/trips/${tripId}/start`),

  // DH2: transition DRIVER_EN_ROUTE → ARRIVED_AT_PICKUP
  arriveAtPickup: (tripId: string) =>
    apiClient.post<ApiResponse<DriverTrip>>(`/driver/trips/${tripId}/arrive-at-pickup`),

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
  cancelTrip: (tripId: string, reason?: string, note?: string) =>
    apiClient.post<ApiResponse<DriverTrip>>(`/driver/trips/${tripId}/cancel`, { reason, note }),

  // Whole-trip driver no-show (nobody boarded) — dedicated endpoint under the
  // trips module: correct pre-departure state guard + refund + rider push
  // copy ("driver no-show"), instead of reusing the generic cancel action.
  driverNoShow: (tripId: string) =>
    apiClient.post<ApiResponse<{ tripId: string; refundedCount: number }>>(`/trips/${tripId}/driver-no-show`),

  // Admin dispatch — accept or decline an assigned trip
  acceptDispatch: (tripId: string) =>
    apiClient.post<ApiResponse<DriverTrip>>(`/driver/trips/${tripId}/accept`),

  declineDispatch: (tripId: string, reason?: string) =>
    apiClient.post<ApiResponse<{ declined: boolean }>>(`/driver/trips/${tripId}/decline`, { reason }),

  // On-demand trip requests — first driver to accept becomes the owning driver
  acceptTripRequest: (requestId: string) =>
    apiClient.post<ApiResponse<{ trip: DriverTrip }>>(`/driver/trip-requests/${requestId}/accept`),

  // Push notifications — register/update FCM device token.
  // Backend validates body('fcmToken') (drivers.routes.js) — sending { token }
  // returned 400 and the driver's token never registered.
  updateFcmToken: (token: string) =>
    apiClient.post<ApiResponse<void>>('/driver/fcm-token', { fcmToken: token }),

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

  // SOS — creates a real SosEvent, notifies admin + trip riders, and SMS's the
  // driver's saved emergency contact (not just a bare `tel:191` dialer call).
  emergencyAlert: (tripId: string, data: { latitude?: number; longitude?: number; timestamp?: string }) =>
    apiClient.post<ApiResponse<{ alertReceived: boolean }>>(`/driver/trips/${tripId}/emergency`, data),

  // App preferences — navigation app choice, theme, notifications, etc
  // (merged JSON blob server-side, read back via getMe())
  updatePreferences: (data: { navigationApp?: 'google_maps' | 'waze' | 'apple_maps'; theme?: 'dark' | 'light'; notificationsEnabled?: boolean }) =>
    apiClient.patch<ApiResponse<void>>('/driver/preferences', data),

  // Rate a passenger after trip completion (driver rates rider)
  ratePassenger: (bookingId: string, data: { stars: number; comment?: string }) =>
    apiClient.post<ApiResponse<{ ratingId: string }>>(`/driver/rate-passenger/${bookingId}`, data),

  // ── Driver wallet (DISTINCT from the rider /wallet/* routes) ──────────────
  // The driver earnings ledger lives at /driver/wallet/*. Using the shared
  // walletApi (which targets /wallet/*) made withdraw 404 and earnings read the
  // wrong (rider) ledger.
  getWalletBalance: () =>
    apiClient.get<ApiResponse<{ balance: number }>>('/driver/wallet/balance'),

  getWalletTransactions: (params?: { page?: number; limit?: number }) =>
    apiClient.get<ApiResponse<{ transactions: Array<{ id: string; type: string; amount: number; description: string; createdAt: string }> }>>(
      '/driver/earnings/transactions',
      { params },
    ),

  // Derived notification history (trip completed/cancelled + payments) —
  // backfills what the live socket-driven store missed while the app was killed.
  getNotifications: (params?: { limit?: number }) =>
    apiClient.get<ApiResponse<{ notifications: Array<{ id: string; type: string; title: string; body: string; tripId?: string; createdAt: string }> }>>(
      '/driver/notifications',
      { params },
    ),

  withdraw: (data: { amount: number }) =>
    apiClient.post<ApiResponse<{ reference: string; message: string }>>('/driver/wallet/withdraw', data),

  // Support tickets — backend already had /driver/support-tickets wired
  // (drivers.routes.js) but no client ever called it; the driver app's help
  // screen saved "tickets" to AsyncStorage only, so nothing ever reached
  // support/admin despite the confirmation message telling the driver it had.
  getSupportTickets: () =>
    apiClient.get<ApiResponse<{ tickets: DriverSupportTicket[] }>>('/driver/support-tickets'),

  createSupportTicket: (data: { subject: string; category: string; description: string }) =>
    apiClient.post<ApiResponse<{ ticket: DriverSupportTicket }>>('/driver/support-tickets', data),

  replyToTicket: (ticketId: string, data: { message: string }) =>
    apiClient.post<ApiResponse<void>>(`/driver/support-tickets/${ticketId}/reply`, data),
};

export interface DriverSupportTicket {
  id: string;
  subject: string;
  category: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  messages: Array<{ id: string; text: string; senderRole: string; createdAt: string }>;
}
