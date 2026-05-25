import { apiClient } from './client';
import type { ApiResponse, AuthTokens, User, OtpRequest, OtpVerify } from '@eyego/types';

export interface SocialLoginRequest {
  provider: 'google' | 'apple';
  idToken: string;
  appleToken?: string;
}

export const authApi = {
  sendOtp: (data: OtpRequest) =>
    apiClient.post<ApiResponse<{ message: string; _dev_otp?: string }>>('/auth/request-otp', data),

  verifyOtp: (data: OtpVerify) =>
    apiClient.post<ApiResponse<{ user: User; tokens: AuthTokens; isNewUser: boolean }>>(
      '/auth/verify-otp',
      data
    ),

  refreshToken: (refreshToken: string) =>
    apiClient.post<ApiResponse<AuthTokens>>('/auth/refresh', { refreshToken }),

  logout: () => apiClient.post<ApiResponse<null>>('/auth/logout'),

  socialLogin: (data: SocialLoginRequest) =>
    apiClient.post<ApiResponse<{ user: User; tokens: AuthTokens; isNewUser: boolean }>>(
      '/auth/social',
      data
    ),
};

// ── Driver auth (separate OTP endpoints) ─────────────────────────────────────
export const driverAuthApi = {
  requestOtp: (data: OtpRequest) =>
    apiClient.post<ApiResponse<{ message: string; _dev_otp?: string }>>('/auth/driver/request-otp', data),

  verifyOtp: (data: OtpVerify) =>
    apiClient.post<ApiResponse<{ tokens: AuthTokens; isNewDriver: boolean }>>(
      '/auth/driver/verify-otp',
      data
    ),

  refreshToken: (refreshToken: string) =>
    apiClient.post<ApiResponse<AuthTokens>>('/auth/driver/refresh', { refreshToken }),
};
