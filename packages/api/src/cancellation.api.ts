import { apiClient } from './client';

export const cancellationApi = {
  getFee: (bookingId: string) =>
    apiClient.get<{ fee: number; reason: string; eligible: boolean }>(`/cancellation/${bookingId}/fee`),

  cancelWithFee: (bookingId: string, data: { reason: string; note?: string }) =>
    apiClient.post<{ cancellationFee?: number; status: string }>(`/cancellation/${bookingId}/cancel`, data),

};
