export type PaymentMethod = 'MOMO' | 'CARD' | 'CASH' | 'WALLET';
export type PaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'ABANDONED';

export interface InitializePaymentRequest {
  bookingId: string;
  method: PaymentMethod;
  momoPhone?: string; // required for MOMO
  email?: string;     // required for CARD (Paystack)
  savedCardId?: string; // optional: one-tap charge using a previously-saved card
}

export interface PaymentInitResponse {
  reference: string;
  authorizationUrl?: string; // for CARD — Paystack checkout URL
  accessCode?: string;
  status: PaymentStatus;
  method: PaymentMethod;
  // true when confirmation happens out-of-band (MoMo prompt / card checkout) and
  // the client must poll verify or await the payment:confirmed socket event.
  // false when the booking is already confirmed synchronously (WALLET / CASH).
  requiresVerification: boolean;
}

export interface PaymentVerifyResponse {
  reference: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  paidAt?: string;
}
