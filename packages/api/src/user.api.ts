import { apiClient } from './client';
import type { ApiResponse, User, UpdateProfileRequest } from '@eyego/types';

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

  deleteAccount: () =>
    apiClient.delete<ApiResponse<null>>('/user/account'),
};
