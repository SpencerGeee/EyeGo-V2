import { apiClient } from './client';
import type { ApiResponse } from '@eyego/types';

export interface Route {
  id: string;
  name: string;
  originName: string;
  destinationName: string;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  distanceKm: number;
  isActive: boolean;
}

export const routesApi = {
  getAll: () =>
    apiClient.get<ApiResponse<Route[]>>('/routes'),

  getById: (id: string) =>
    apiClient.get<ApiResponse<Route>>(`/routes/${id}`),

  search: (params: { origin?: string; destination?: string }) =>
    apiClient.get<ApiResponse<Route[]>>('/routes/search', { params }),
};
