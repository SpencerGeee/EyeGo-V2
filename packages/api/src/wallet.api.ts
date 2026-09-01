import { apiClient } from './client';
import { WalletBalanceSchema, WalletTransactionSchema, assertShape, parseEach } from './schemas';
import type { ApiResponse } from '@eyego/types';

export interface WalletBalance {
  balancePesewas: number;
  currency: string;
  lastUpdated: string;
}

export interface WalletTransaction {
  id: string;
  // Matches the literal values actually written by drivers.service.js /
  // wallet.service.js walletTransaction.create calls — not a generic CREDIT/DEBIT.
  type: 'TRIP_EARNING' | 'EARNINGS_CREDIT' | 'QUEST_BONUS' | 'COMMISSION_DEDUCTION' | 'TOP_UP' | 'WITHDRAWAL' | 'WITHDRAWAL_REVERSAL';
  amountPesewas: number;
  description: string;
  reference?: string;
  createdAt: string;
}

export interface TopUpRequest {
  amountPesewas: number;
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
    apiClient.get<ApiResponse<WalletBalance>>('/wallet/balance').then((res) => {
      // A balance is what the rider decides whether they can afford a ride on.
      // Wrong-and-plausible is the failure to prevent here, not missing.
      assertShape(WalletBalanceSchema, res.data?.data, 'walletBalance');
      return res;
    }),

  getTransactions: (params?: { page?: number; limit?: number }) =>
    apiClient
      .get<ApiResponse<{ transactions: WalletTransaction[]; total: number; page: number; totalPages: number }>>(
        '/wallet/transactions',
        { params },
      )
      .then((res) => {
        // Deliberately NOT fatal. One malformed row must not blank a rider's
        // whole payment history — a history missing a line is recoverable, an
        // empty screen over a wallet with money in it is a support ticket.
        const page = res.data?.data;
        if (page && Array.isArray(page.transactions)) {
          page.transactions = parseEach<WalletTransaction>(WalletTransactionSchema, page.transactions);
        }
        return res;
      }),

  topUp: (data: TopUpRequest, idempotencyKey?: string) =>
    apiClient.post<ApiResponse<{ reference: string; authorizationUrl?: string }>>(
      '/wallet/topup',
      data,
      { headers: { 'Idempotency-Key': idempotencyKey ?? makeIdempotencyKey('topup') } }
    ),

  // Send Money / Scan & Pay — wallet-to-wallet transfer by recipient phone.
  sendMoney: (data: { recipientPhone: string; amountPesewas: number }, idempotencyKey?: string) =>
    apiClient.post<ApiResponse<{ reference: string; recipientName: string }>>(
      '/wallet/send',
      data,
      { headers: { 'Idempotency-Key': idempotencyKey ?? makeIdempotencyKey('p2p') } }
    ),

  // NOTE: rider wallets have no withdraw — POST /v1/wallet/withdraw does not
  // exist on the server (only drivers cash out, via driverApi.withdraw →
  // /driver/wallet/withdraw). A withdraw() here previously pointed at that
  // nonexistent rider route and would always 404.

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
