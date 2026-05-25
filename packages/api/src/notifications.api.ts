import { apiClient } from './client';
import type { ApiResponse, PaginatedResponse } from '@eyego/types';

export interface Notification {
  id: string;
  title: string;
  body: string;
  type: 'booking' | 'payment' | 'driver' | 'promo' | 'system';
  read: boolean;
  createdAt: string;
  data?: Record<string, string>;
}

export const notificationsApi = {
  getAll: (params?: { page?: number; limit?: number }) =>
    apiClient.get<PaginatedResponse<Notification>>('/notifications', { params }),

  markRead: (id: string) =>
    apiClient.patch<ApiResponse<Notification>>(`/notifications/${id}/read`),

  markAllRead: () =>
    apiClient.patch<ApiResponse<{ updated: number }>>('/notifications/read-all'),

  getUnreadCount: () =>
    apiClient.get<ApiResponse<{ count: number }>>('/notifications/unread-count'),
};
