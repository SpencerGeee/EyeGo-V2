import { apiClient } from './client';
import type { ApiResponse } from '@eyego/types';

export interface DriverQuest {
  id: string;
  title: string;
  description: string;
  type: 'RIDES_COUNT' | 'EARNINGS';
  target: number;
  rewardAmount: number;
  periodStart: string;
  periodEnd: string;
  isActive: boolean;
  progress: {
    current: number;
    completed: boolean;
    rewardedAt: string | null;
  };
}

export interface QuestHistoryItem {
  questId: string;
  title: string;
  description: string;
  type: string;
  target: number;
  rewardAmount: number;
  current: number;
  rewardedAt: string;
}

export const questsApi = {
  // Quests are mounted at /v1/quests (driver-authed), NOT under the driver router.
  // Calling /driver/quests* 404'd, so the quests tab never loaded real data.
  listActive: () =>
    apiClient.get<ApiResponse<{ quests: DriverQuest[] }>>('/quests'),

  listHistory: () =>
    apiClient.get<ApiResponse<{ history: QuestHistoryItem[] }>>('/quests/history'),

  claim: (questId: string) =>
    apiClient.post<ApiResponse<{ rewardAmount: number; title: string }>>(`/quests/${questId}/claim`),
};
