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

  // NOTE: there is no backend /routes/search — the old client stub 404'd
  // (path collides with GET /routes/:id, matching id="search"). No screen
  // calls this; use getAll() and filter client-side, or add real backend
  // search support before wiring a route-search UI.
};
