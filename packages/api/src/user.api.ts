import { apiClient } from './client';
import type { ApiResponse, User, UpdateProfileRequest } from '@eyego/types';

export interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
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

  updateFcmToken: (data: { fcmToken: string }) =>
    apiClient.post<ApiResponse<void>>('/user/fcm-token', data),

  deleteAccount: () =>
    apiClient.delete<ApiResponse<null>>('/user/me'),

  getEmergencyContacts: () =>
    apiClient.get<ApiResponse<{ contacts: EmergencyContact[] }>>('/user/me/emergency-contacts'),

  syncEmergencyContacts: (contacts: { name: string; phone: string }[]) =>
    apiClient.put<ApiResponse<{ contacts: EmergencyContact[] }>>('/user/me/emergency-contacts', { contacts }),
};
