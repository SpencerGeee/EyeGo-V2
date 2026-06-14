import { apiClient } from './client';
import type { ApiResponse } from '@eyego/types';

export interface HeatmapCell {
  lat: number;
  lng: number;
  weight: number;
  driversNearby: number;
  demandSupplyRatio: number;
}

export interface HeatmapResponse {
  cells: HeatmapCell[];
  centre: { lat: number; lng: number };
  radiusKm: number;
}

export const heatmapApi = {
  getDemand: (lat: number, lng: number, radius = 5) =>
    apiClient.get<ApiResponse<HeatmapResponse>>('/heatmap', {
      params: { lat, lng, radius },
    }),
};
