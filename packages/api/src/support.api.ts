import { apiClient } from './client';

export interface SupportTicket {
  id: string;
  subject: string;
  message: string;
  category: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  relatedBookingId?: string;
  createdAt: string;
  updatedAt: string;
}

export const supportTicketsApi = {
  create: (data: { subject: string; message: string; category: string; relatedBookingId?: string }) =>
    apiClient.post<{ id: string; status: string }>('/user/me/support-tickets', data),

  getAll: () =>
    apiClient.get<{ tickets: SupportTicket[] }>('/user/me/support-tickets'),

  getById: (id: string) =>
    apiClient.get<SupportTicket>(`/user/me/support-tickets/${id}`),

  addMessage: (id: string, data: { text: string }) =>
    apiClient.post(`/user/me/support-tickets/${id}/messages`, data),
};
