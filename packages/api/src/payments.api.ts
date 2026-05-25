import { apiClient } from './client';
import type {
  ApiResponse,
  InitializePaymentRequest,
  PaymentInitResponse,
  PaymentVerifyResponse,
} from '@eyego/types';

export const paymentsApi = {
  initialize: (data: InitializePaymentRequest) =>
    apiClient.post<ApiResponse<PaymentInitResponse>>('/payments/initialize', data),

  verify: (reference: string) =>
    apiClient.get<ApiResponse<PaymentVerifyResponse>>(`/payments/verify/${reference}`),

  pollStatus: async (
    reference: string,
    intervalMs = 3000,
    maxAttempts = 20
  ): Promise<PaymentVerifyResponse> => {
    for (let i = 0; i < maxAttempts; i++) {
      const { data } = await paymentsApi.verify(reference);
      if (data.data.status === 'SUCCESS' || data.data.status === 'FAILED') {
        return data.data;
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error('Payment verification timed out');
  },
};
