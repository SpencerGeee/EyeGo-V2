import { apiClient } from './client';
import type { ApiResponse, Trip, Seat, FareEstimate, SearchTripsParams } from '@eyego/types';

export const tripsApi = {
  search: (params: SearchTripsParams) =>
    apiClient.get<ApiResponse<{ trips: Trip[]; total: number; page: number; totalPages: number }>>('/trips', { params }),

  getById: (id: string) =>
    apiClient.get<ApiResponse<Trip>>(`/trips/${id}`),

  // Driver phone is excluded from the trip payload for privacy (trip listings
  // are visible pre-booking) — this narrow, auth-gated lookup only succeeds
  // for a rider with an active booking on the trip. Powers the chat call button.
  getContact: (tripId: string) =>
    apiClient.get<ApiResponse<{ phone: string }>>(`/trips/${tripId}/contact`),

  getSeats: (tripId: string) =>
    apiClient.get<ApiResponse<Seat[]>>(`/trips/${tripId}/seats`),

  // Persists "I'm paying for everyone" — marks this rider as the group's lead
  // passenger so their payment settles every held seat on the trip, not just
  // their own. Previously nothing on the client ever called this endpoint,
  // so the toggle had no backend effect at all.
  createGroup: (tripId: string, isCoverAll: boolean) =>
    apiClient.post<ApiResponse<{ group: unknown }>>(`/trips/${tripId}/group`, { isCoverAll }),

  getFareEstimate: (params: {
    originLat: number;
    originLng: number;
    destinationLat: number;
    destinationLng: number;
  }) =>
    apiClient.get<ApiResponse<FareEstimate[]>>('/trips/fare-estimate', { params }),

  getActiveTrip: () =>
    apiClient.get<ApiResponse<Trip | null>>('/trips/active'),

  // Group-hub joiner previewing the deviation surcharge for picking their own
  // pickup point instead of the trip's main pickup.
  getDeviationEstimate: (tripId: string, lat: number, lng: number) =>
    apiClient.get<ApiResponse<{ extraKm: number; surcharge: number }>>(`/trips/${tripId}/deviation-estimate`, { params: { lat, lng } }),

  requestTrip: (params: {
    destination: string;
    scheduledAt: string;
    seatCount: number;
    /** Only meaningful when seatCount > 1: true = pay for the whole party in one bundled charge, false = book just your own seat and let others join+pay via the group invite link. */
    coverAll?: boolean;
    pickupLat?: number;
    pickupLng?: number;
    destLat?: number;
    destLng?: number;
  }) =>
    apiClient.post<ApiResponse<{ requestId: string; message: string }>>('/trips/request', params),

  getTripRequest: (requestId: string) =>
    apiClient.get<ApiResponse<{ id: string; status: string; matchedTripId: string | null }>>(`/trips/request/${requestId}`),

  /**
   * Approximate positions of available drivers near a point, for the ambient
   * pins on the "looking for a driver" map. Coarse by design — see the endpoint.
   */
  getNearbyDrivers: (latitude: number, longitude: number, radiusKm = 6) =>
    apiClient.get<ApiResponse<Array<{ id: string; latitude: number; longitude: number }>>>(
      '/trips/nearby-drivers',
      { params: { lat: latitude, lng: longitude, radiusKm } },
    ),

  cancelTripRequest: (requestId: string) =>
    apiClient.delete<ApiResponse<{ id: string; status: string }>>(`/trips/request/${requestId}`),

  schedule: (params: {
    destination: string;
    scheduledAt: string;
    seatCount?: number;
    pickupLat: number;
    pickupLng: number;
    destLat?: number;
    destLng?: number;
    pickupName?: string;
  }) =>
    apiClient.post<ApiResponse<{ id: string; routeId: string; scheduledAt: string; seatCount: number }>>('/trips/schedule', params),

  getScheduledRides: () =>
    apiClient.get<ApiResponse<{ intents: Array<{
      id: string;
      scheduledAt: string;
      seatCount: number;
      status: string;
      matchedTripId: string | null;
      route: { originName: string; destinationName: string; distanceKm: number };
      matchedTrip: {
        tier: string;
        farePerSeat: number;
        driverName: string | null;
        vehicleLabel: string | null;
      } | null;
    }> }>>('/trips/scheduled'),

  cancelScheduledRide: (id: string) =>
    apiClient.delete<ApiResponse<{ id: string; status: string }>>(`/trips/scheduled/${id}`),

  // iOS Live Activity (ActivityKit) — registers the per-device push token
  // yielded by Activity.pushTokenUpdates so the backend can push lock-screen
  // updates directly via APNs (separate channel from the FCM device token).
  // No-ops safely server-side if APNs isn't configured yet.
  submitLiveActivityToken: (tripId: string, params: { pushToken: string; activityId?: string }) =>
    apiClient.post<ApiResponse<{ bookingId: string }>>(`/trips/${tripId}/live-activity-token`, params),
};
