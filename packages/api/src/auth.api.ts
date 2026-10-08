import { apiClient } from './client';
import type { ApiResponse, AuthTokens, User, OtpRequest, OtpVerify } from '@eyego/types';

export const authApi = {
  sendOtp: (data: OtpRequest) =>
    apiClient.post<ApiResponse<{ message: string; _dev_otp?: string }>>('/auth/request-otp', data),

  verifyOtp: (data: OtpVerify) =>
    apiClient.post<ApiResponse<{ accessToken: string; refreshToken: string; isNewUser: boolean; user: User }>>(
      '/auth/verify-otp',
      data
    ),

  refreshToken: (refreshToken: string) =>
    apiClient.post<ApiResponse<AuthTokens>>('/auth/refresh', { refreshToken }),

  logout: () => apiClient.post<ApiResponse<null>>('/auth/logout'),
  // No socialLogin: /auth/google and /auth/apple verify FIREBASE ID tokens and
  // the app has no Firebase credential exchange, so the call could only fail.
  // Restore it together with that exchange if social sign-in is ever built.
};

// ── Driver auth (separate OTP endpoints) ─────────────────────────────────────
export const driverAuthApi = {
  requestOtp: (data: OtpRequest) =>
    apiClient.post<ApiResponse<{ message: string; _dev_otp?: string }>>('/auth/driver/request-otp', data),

  verifyOtp: (data: OtpVerify) =>
    apiClient.post<ApiResponse<{ accessToken: string; refreshToken: string; isNewDriver: boolean }>>(
      '/auth/driver/verify-otp',
      data
    ),

  refreshToken: (refreshToken: string) =>
    apiClient.post<ApiResponse<AuthTokens>>('/auth/driver/refresh', { refreshToken }),
};
