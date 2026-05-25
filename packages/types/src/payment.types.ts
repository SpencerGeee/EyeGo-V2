export type PaymentMethod = 'MOMO' | 'CARD';
export type PaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'ABANDONED';

export interface InitializePaymentRequest {
  bookingId: string;
  method: PaymentMethod;
  momoPhone?: string; // required for MOMO
  email?: string;     // required for CARD (Paystack)
}

export interface PaymentInitResponse {
  reference: string;
  authorizationUrl?: string; // for CARD — Paystack checkout URL
  accessCode?: string;
  status: PaymentStatus;
}

export interface PaymentVerifyResponse {
  reference: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  paidAt?: string;
}
