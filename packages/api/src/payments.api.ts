import { apiClient } from './client';
import type {
  ApiResponse,
  InitializePaymentRequest,
  PaymentInitResponse,
} from '@eyego/types';

// A per-attempt idempotency key. Not cryptographically strong — it only needs
// to be unique per payment attempt so retries of the SAME attempt collapse to
// one charge while a deliberate new attempt gets a fresh key.
function makeIdempotencyKey(bookingId: string): string {
  return `pay_${bookingId}_${Date.now()}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export const paymentsApi = {
  // Backend route is POST /payments/initiate. The booking already carries the
  // chosen method; the server branches on it (MoMo / Card / Wallet / Cash).
  // `momoPhone` is forwarded as `phone` for the MoMo charge.
  // An Idempotency-Key header makes retries of a single attempt safe.
  initialize: (data: InitializePaymentRequest, idempotencyKey?: string) =>
    apiClient.post<ApiResponse<PaymentInitResponse>>(
      '/payments/initiate',
      { bookingId: data.bookingId, method: data.method, phone: data.momoPhone },
      { headers: { 'Idempotency-Key': idempotencyKey ?? makeIdempotencyKey(data.bookingId) } }
    ),

  // Backend route is POST /payments/verify/:reference (verifies with Paystack
  // then confirms the booking). Returns the confirmed booking.
  verify: (reference: string) =>
    apiClient.post<ApiResponse<{ booking: { paymentStatus: string; status: string } }>>(
      `/payments/verify/${reference}`
    ),

  // Poll the verify endpoint until the booking is confirmed. A 4xx means the
  // charge has not completed yet (still PENDING), so we swallow it and retry;
  // any other error propagates. Throws if confirmation never arrives.
  pollStatus: async (
    reference: string,
    intervalMs = 3000,
    maxAttempts = 20
  ): Promise<{ status: 'SUCCESS' | 'FAILED' }> => {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const { data } = await paymentsApi.verify(reference);
        const booking = data.data?.booking;
        if (booking?.paymentStatus === 'PAID' || booking?.status === 'CONFIRMED') {
          return { status: 'SUCCESS' };
        }
      } catch (err: any) {
        // PENDING charge → verify throws PaymentError (4xx); keep polling.
        if (!err?.response || err.response.status >= 500) throw err;
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error('Payment verification timed out');
  },
};
