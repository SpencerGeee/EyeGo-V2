import { apiClient } from './client';
import type { ApiResponse } from '@eyego/types';

/**
 * DIRECT: masking is off — dial `phone`. CALLBACK: EyeGo is ringing the caller
 * now and will bridge them (Africa's Talking voice); `message` says so.
 */
export interface CallInitResponse {
  sessionId: string;
  mode: 'DIRECT' | 'CALLBACK';
  phone?: string;
  counterpartName: string;
  message?: string;
}

export const contactApi = {
  initiateCall: (data: { tripId: string; calleeRole: 'DRIVER' | 'PASSENGER'; calleeBookingId?: string }) =>
    apiClient.post<ApiResponse<CallInitResponse>>('/contact/call', data),

  endCall: (callId: string) =>
    apiClient.post<ApiResponse<{ session: any }>>(`/contact/call/${callId}/end`),
};
