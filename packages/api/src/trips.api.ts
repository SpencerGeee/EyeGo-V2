import { apiClient } from './client';
import type { ApiResponse, PaginatedResponse, Trip, Seat, FareEstimate, SearchTripsParams } from '@eyego/types';

export const tripsApi = {
  search: (params: SearchTripsParams) =>
    apiClient.get<PaginatedResponse<Trip>>('/trips', { params }),

  getById: (id: string) =>
    apiClient.get<ApiResponse<Trip>>(`/trips/${id}`),

  getSeats: (tripId: string) =>
    apiClient.get<ApiResponse<Seat[]>>(`/trips/${tripId}/seats`),

  getFareEstimate: (params: {
    originLat: number;
    originLng: number;
    destinationLat: number;
    destinationLng: number;
  }) =>
    apiClient.get<ApiResponse<FareEstimate[]>>('/trips/fare-estimate', { params }),

  getActiveTrip: () =>
    apiClient.get<ApiResponse<Trip | null>>('/trips/active'),

  requestTrip: (params: {
    destination: string;
    scheduledAt: string;
    seatCount: number;
    pickupLat?: number;
    pickupLng?: number;
    destLat?: number;
    destLng?: number;
  }) =>
    apiClient.post<ApiResponse<{ requestId: string; message: string }>>('/trips/request', params),

  getTripRequest: (requestId: string) =>
    apiClient.get<ApiResponse<{ id: string; status: string; matchedTripId: string | null }>>(`/trips/request/${requestId}`),

  cancelTripRequest: (requestId: string) =>
    apiClient.delete<ApiResponse<{ id: string; status: string }>>(`/trips/request/${requestId}`),

  schedule: (params: { routeId: string; scheduledAt: string; seatCount?: number }) =>
    apiClient.post<ApiResponse<{ id: string; routeId: string; scheduledAt: string; seatCount: number }>>('/trips/schedule', params),

  getScheduledRides: () =>
    apiClient.get<ApiResponse<{ intents: Array<{
      id: string;
      scheduledAt: string;
      seatCount: number;
      status: string;
      matchedTripId: string | null;
      route: { originName: string; destinationName: string };
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
