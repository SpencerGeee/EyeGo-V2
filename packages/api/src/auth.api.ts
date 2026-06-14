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
    apiClient.post<ApiResponse<{ accessToken: string; refreshToken: string; isNewUser: boolean; user: User }>>(
      '/auth/verify-otp',
      data
    ),

  refreshToken: (refreshToken: string) =>
    apiClient.post<ApiResponse<AuthTokens>>('/auth/refresh', { refreshToken }),

  logout: () => apiClient.post<ApiResponse<null>>('/auth/logout'),

  // Backend exposes provider-specific endpoints (/auth/google, /auth/apple) that
  // each expect { idToken } and return a flat { accessToken, refreshToken,
  // isNewUser, user } — matching verifyOtp. (Previously this POSTed to a
  // nonexistent /auth/social and expected a { tokens } wrapper, so social login
  // was broken.)
  socialLogin: (data: SocialLoginRequest) =>
    apiClient.post<ApiResponse<{ accessToken: string; refreshToken: string; isNewUser: boolean; user: User }>>(
      `/auth/${data.provider}`,
      { idToken: data.idToken }
    ),
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
