import { apiClient } from './client';
import type { ApiResponse } from '@eyego/types';

export interface WalletBalance {
  balance: number;
  currency: string;
  lastUpdated: string;
}

export interface WalletTransaction {
  id: string;
  // Matches the literal values actually written by drivers.service.js /
  // wallet.service.js walletTransaction.create calls — not a generic CREDIT/DEBIT.
  type: 'TRIP_EARNING' | 'EARNINGS_CREDIT' | 'QUEST_BONUS' | 'COMMISSION_DEDUCTION' | 'TOP_UP' | 'WITHDRAWAL' | 'WITHDRAWAL_REVERSAL';
  amount: number;
  description: string;
  reference?: string;
  createdAt: string;
}

export interface TopUpRequest {
  amount: number;
  method: 'MOMO' | 'CARD';
  momoPhone?: string;
  email?: string;
}

export interface SavedCard {
  id: string;
  last4: string;
  brand: string;
  expMonth: string;
  expYear: string;
  cardholderName?: string;
  isDefault: boolean;
  type: 'card';
  createdAt: string;
}

// A per-attempt idempotency key. Not cryptographically strong — it only needs
// to be unique per submission so retries of the SAME attempt collapse to one
// top-up/withdrawal while a deliberate new attempt gets a fresh key.
function makeIdempotencyKey(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export const walletApi = {
  getBalance: () =>
    apiClient.get<ApiResponse<WalletBalance>>('/wallet/balance'),

  getTransactions: (params?: { page?: number; limit?: number }) =>
    apiClient.get<ApiResponse<{ transactions: WalletTransaction[]; total: number; page: number; totalPages: number }>>('/wallet/transactions', { params }),

  topUp: (data: TopUpRequest, idempotencyKey?: string) =>
    apiClient.post<ApiResponse<{ reference: string; authorizationUrl?: string }>>(
      '/wallet/topup',
      data,
      { headers: { 'Idempotency-Key': idempotencyKey ?? makeIdempotencyKey('topup') } }
    ),

  // Send Money / Scan & Pay — wallet-to-wallet transfer by recipient phone.
  sendMoney: (data: { recipientPhone: string; amount: number }, idempotencyKey?: string) =>
    apiClient.post<ApiResponse<{ reference: string; recipientName: string }>>(
      '/wallet/send',
      data,
      { headers: { 'Idempotency-Key': idempotencyKey ?? makeIdempotencyKey('p2p') } }
    ),

  withdraw: (data: { amount: number }, idempotencyKey?: string) =>
    apiClient.post<ApiResponse<{ reference: string; message: string }>>(
      '/wallet/withdraw',
      data,
      { headers: { 'Idempotency-Key': idempotencyKey ?? makeIdempotencyKey('withdraw') } }
    ),

  getPaymentMethods: async (): Promise<SavedCard[]> => {
    const res = await apiClient.get<ApiResponse<{ methods: SavedCard[] }>>('/wallet/payment-methods');
    return (res.data as any)?.data?.methods ?? [];
  },

  deletePaymentMethod: (id: string) =>
    apiClient.delete<ApiResponse<null>>(`/wallet/payment-methods/${id}`),

  initializeCardSave: () =>
    apiClient.post<ApiResponse<{ reference: string; authorizationUrl: string }>>(
      '/wallet/payment-methods/initialize',
      {}
    ),

  verifyCardSave: (reference: string) =>
    apiClient.post<ApiResponse<{ card: Pick<SavedCard, 'id' | 'last4' | 'brand' | 'expMonth' | 'expYear'> }>>(
      '/wallet/payment-methods/verify',
      { reference }
    ),
};
