export interface User {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: 'PASSENGER' | 'DRIVER' | 'ADMIN';
  isVerified: boolean;
  referralCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface OtpRequest {
  phone: string;
}

export interface OtpVerify {
  phone: string;
  otp: string;
}

export interface UpdateProfileRequest {
  name?: string;
  email?: string;
  avatarUrl?: string;
}
