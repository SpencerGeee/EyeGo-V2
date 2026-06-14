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
  dob?: string;
  emergencyContact?: { name: string; phone: string; relationship?: string };
  rating?: number;
  walletBalance?: number;
  notificationPreferences?: {
    driverArriving?: boolean;
    tripStarted?: boolean;
    tripCompleted?: boolean;
    chatMessages?: boolean;
    paymentConfirmations?: boolean;
    promotions?: boolean;
    newFeatures?: boolean;
    safetyAlerts?: boolean;
  };
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
