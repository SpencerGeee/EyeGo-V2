import { apiClient } from './client';
import type { ApiResponse } from '@eyego/types';

export interface Notification {
  id: string;
  title: string;
  body: string;
  type: 'booking' | 'payment' | 'driver' | 'promo' | 'system';
  read: boolean;
  createdAt: string;
  data?: Record<string, string>;
  bookingId?: string;
  tripId?: string;
}

export const notificationsApi = {
  getAll: (params?: { page?: number; limit?: number }) =>
    apiClient.get<ApiResponse<{ notifications: Notification[]; total: number; page: number; totalPages: number }>>('/notifications', { params }),

  markRead: (id: string) =>
    apiClient.patch<ApiResponse<Notification>>(`/notifications/${id}/read`),

  markAllRead: () =>
    apiClient.patch<ApiResponse<{ updated: number }>>('/notifications/read-all'),

  getUnreadCount: () =>
    apiClient.get<ApiResponse<{ count: number }>>('/notifications/unread-count'),
};
