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
};
