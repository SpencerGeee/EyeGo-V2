import { apiClient } from './client';
import type { ApiResponse, User, UpdateProfileRequest } from '@eyego/types';

export interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
}

export interface SafetySettings {
  shareTrip?: boolean;
  rideCheck?: boolean;
  speedAlerts?: boolean;
  nightSafety?: boolean;
  // Cloudinary URL of the uploaded emergency insurance card (stored in the
  // same safetySettings JSON blob server-side; written by uploadInsurance).
  insuranceCardUrl?: string;
}

export interface PrivacySettings {
  locationSharing?: boolean;
  marketingNotifs?: boolean;
  analytics?: boolean;
}

export interface NotificationPrefs {
  driverArriving?: boolean;
  tripStarted?: boolean;
  tripCompleted?: boolean;
  chatMessages?: boolean;
  paymentConfirmations?: boolean;
  promotions?: boolean;
  newFeatures?: boolean;
  safetyAlerts?: boolean;
}

export interface SavedPlace {
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
  icon?: string | null;
}

export const userApi = {
  getProfile: () =>
    apiClient.get<ApiResponse<User>>('/user/me'),

  updateProfile: (data: UpdateProfileRequest) =>
    apiClient.patch<ApiResponse<User>>('/user/me', data),

  uploadAvatar: async (uri: string): Promise<string> => {
    const formData = new FormData();
    const filename = uri.split('/').pop() ?? 'avatar.jpg';
    const match = /\.(\w+)$/.exec(filename);
    const type = match ? `image/${match[1]}` : 'image/jpeg';
    formData.append('avatar', { uri, name: filename, type } as unknown as Blob);

    const response = await apiClient.post<ApiResponse<{ avatarUrl: string }>>(
      '/user/avatar',
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
    return response.data.data.avatarUrl;
  },

  uploadInsurance: async (uri: string): Promise<string> => {
    const formData = new FormData();
    const filename = uri.split('/').pop() ?? 'insurance.jpg';
    const match = /\.(\w+)$/.exec(filename);
    const type = match ? `image/${match[1]}` : 'image/jpeg';
    formData.append('card', { uri, name: filename, type } as unknown as Blob);

    const response = await apiClient.post<ApiResponse<{ insuranceCardUrl: string }>>(
      '/user/me/insurance',
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
    return response.data.data.insuranceCardUrl;
  },

  updateFcmToken: (data: { fcmToken: string }) =>
    apiClient.post<ApiResponse<void>>('/user/fcm-token', data),

  deleteAccount: () =>
    apiClient.delete<ApiResponse<null>>('/user/me'),

  getEmergencyContacts: () =>
    apiClient.get<ApiResponse<{ contacts: EmergencyContact[] }>>('/user/me/emergency-contacts'),

  syncEmergencyContacts: (contacts: { name: string; phone: string }[]) =>
    apiClient.put<ApiResponse<{ contacts: EmergencyContact[] }>>('/user/me/emergency-contacts', { contacts }),

  getNotificationPrefs: () =>
    apiClient.get<ApiResponse<{ prefs: NotificationPrefs }>>('/user/me/notifications'),

  updateNotificationPrefs: (prefs: NotificationPrefs) =>
    apiClient.patch<ApiResponse<{ prefs: NotificationPrefs }>>('/user/me/notifications', prefs),

  getSafetySettings: () =>
    apiClient.get<ApiResponse<{ settings: SafetySettings }>>('/user/me/safety-settings'),

  updateSafetySettings: (settings: SafetySettings) =>
    apiClient.put<ApiResponse<{ settings: SafetySettings }>>('/user/me/safety-settings', settings),

  getPrivacySettings: () =>
    apiClient.get<ApiResponse<{ settings: PrivacySettings }>>('/user/me/privacy-settings'),

  updatePrivacySettings: (settings: PrivacySettings) =>
    apiClient.put<ApiResponse<{ settings: PrivacySettings }>>('/user/me/privacy-settings', settings),

  getSavedPlaces: () =>
    apiClient.get<ApiResponse<{ places: SavedPlace[] }>>('/user/me/saved-places'),

  createSavedPlace: (place: Omit<SavedPlace, 'id'>) =>
    apiClient.post<ApiResponse<{ place: SavedPlace }>>('/user/me/saved-places', place),

  deleteSavedPlace: (placeId: string) =>
    apiClient.delete<ApiResponse<Record<string, never>>>(`/user/me/saved-places/${placeId}`),
};
