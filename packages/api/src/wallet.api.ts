import { apiClient } from './client';
import type { ApiResponse, PaginatedResponse } from '@eyego/types';

export interface WalletBalance {
  balance: number;
  currency: string;
  lastUpdated: string;
}

export interface WalletTransaction {
  id: string;
  type: 'CREDIT' | 'DEBIT';
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

export const walletApi = {
  getBalance: () =>
    apiClient.get<ApiResponse<WalletBalance>>('/driver/wallet/balance'),

  getTransactions: (params?: { page?: number; limit?: number }) =>
    apiClient.get<PaginatedResponse<WalletTransaction>>('/driver/wallet/transactions', { params }),

  topUp: (data: TopUpRequest) =>
    apiClient.post<ApiResponse<{ reference: string; authorizationUrl?: string }>>('/driver/wallet/topup', data),

  withdraw: (data: { amount: number }) =>
    apiClient.post<ApiResponse<{ reference: string; message: string }>>('/driver/wallet/withdraw', data),
};
