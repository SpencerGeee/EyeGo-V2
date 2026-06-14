import { apiClient } from './client';

export const referralsApi = {
  getMyCode: () =>
    apiClient.get<{ code: string; shareLink: string; earnings: number; referrals: number }>('/referrals/my-code'),

  getHistory: () =>
    apiClient.get<{ referrals: Array<{ id: string; name: string; joinedAt: string; bonus: number }> }>('/referrals/history'),

  claimEarnings: () =>
    apiClient.post<{ claimed: number; newBalance: number }>('/referrals/claim'),
};
