import { apiClient } from './client';
import type { ApiResponse } from '@eyego/types';

export interface CallInitResponse {
  sessionId: string;
  relayToken: string;
  relayNumber: string;
  counterpartName: string;
  callInstruction: string;
}

export const contactApi = {
  initiateCall: (data: { tripId: string; calleeRole: 'DRIVER' | 'PASSENGER' }) =>
    apiClient.post<ApiResponse<CallInitResponse>>('/contact/call', data),

  endCall: (callId: string) =>
    apiClient.post<ApiResponse<{ session: any }>>(`/contact/call/${callId}/end`),
};
