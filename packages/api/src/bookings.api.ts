import { apiClient } from './client';
import type {
  ApiResponse,
  PaginatedResponse,
  Booking,
  CreateBookingRequest,
  RatingRequest,
  GroupBooking,
} from '@eyego/types';

export const bookingsApi = {
  create: (data: CreateBookingRequest) =>
    apiClient.post<ApiResponse<Booking>>('/bookings', data),

  getById: (id: string) =>
    apiClient.get<ApiResponse<Booking>>(`/bookings/${id}`),

  getActive: () =>
    apiClient.get<ApiResponse<Booking | null>>('/bookings/active'),

  getHistory: (params?: { page?: number; limit?: number; status?: string }) =>
    apiClient.get<PaginatedResponse<Booking>>('/bookings', { params }),

  cancel: (id: string) =>
    apiClient.delete<ApiResponse<Booking>>(`/bookings/${id}`),

  rate: (id: string, data: RatingRequest) =>
    apiClient.post<ApiResponse<Booking>>(`/bookings/${id}/rating`, data),

  generateInvite: (id: string) =>
    apiClient.post<ApiResponse<{ inviteToken: string; inviteLink: string }>>(
      `/bookings/${id}/invite`
    ),

  getGroup: (id: string) =>
    apiClient.get<ApiResponse<GroupBooking>>(`/bookings/${id}/group`),

  joinGroup: (token: string) =>
    apiClient.post<ApiResponse<{ trip: import('@eyego/types').Trip }>>(
      `/bookings/join/${token}`
    ),

  applyPromo: (bookingId: string, code: string) =>
    apiClient.post<ApiResponse<any>>(`/bookings/${bookingId}/apply-promo`, { code }),

  tip: (bookingId: string, data: { amount: number; phone?: string }) =>
    apiClient.post<ApiResponse<{ reference: string }>>(`/bookings/${bookingId}/tip`, data),
};
