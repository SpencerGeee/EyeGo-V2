import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient } from '@eyego/api';

const QUEUE_KEY = '@eyego_offline_sync_queue';

export interface QueuedAction {
  id: string;
  type: 'SOS' | 'RATING' | 'PROMO';
  url: string;
  method: 'POST' | 'PATCH' | 'PUT';
  data: any;
  createdAt: string;
  retries: number;
}

export const offlineQueue = {
  /**
   * Enqueue a critical action for background/offline sync
   */
  async enqueue(type: QueuedAction['type'], url: string, method: QueuedAction['method'], data: any) {
    try {
      const stored = await AsyncStorage.getItem(QUEUE_KEY);
      const queue: QueuedAction[] = stored ? JSON.parse(stored) : [];
      
      const newAction: QueuedAction = {
        id: `action-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type,
        url,
        method,
        data,
        createdAt: new Date().toISOString(),
        retries: 0,
      };
      
      queue.push(newAction);
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
      console.log(`[OfflineQueue] Enqueued ${type} action successfully.`);
      
      // Attempt immediate flush in case network recovered
      this.flushQueue();
    } catch (e) {
      console.error('[OfflineQueue] Failed to enqueue action', e);
    }
  },

  /**
   * Drain and execute queued actions sequentially
   */
  async flushQueue() {
    try {
      const stored = await AsyncStorage.getItem(QUEUE_KEY);
      if (!stored) return;
      
      const queue: QueuedAction[] = JSON.parse(stored);
      if (queue.length === 0) return;
      
      console.log(`[OfflineQueue] Flashing queue with ${queue.length} items...`);
      const remaining: QueuedAction[] = [];
      
      for (const action of queue) {
        try {
          if (action.method === 'POST') {
            await apiClient.post(action.url, action.data);
          } else if (action.method === 'PATCH') {
            await apiClient.patch(action.url, action.data);
          } else if (action.method === 'PUT') {
            await apiClient.put(action.url, action.data);
          }
          console.log(`[OfflineQueue] Successfully synced action ${action.id} (${action.type})`);
        } catch (error: any) {
          // If it is a 4xx client error (e.g. invalid code), do not retry indefinitely
          const status = error?.response?.status;
          if (status && status >= 400 && status < 500) {
            console.warn(`[OfflineQueue] Discarding action ${action.id} due to 4xx response:`, status);
            continue;
          }
          
          // Network errors or 5xx server errors get retried
          action.retries += 1;
          if (action.retries < 5) {
            remaining.push(action);
          } else {
            console.warn(`[OfflineQueue] Action ${action.id} exceeded max retries. Discarding.`);
          }
        }
      }
      
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
    } catch (e) {
      console.error('[OfflineQueue] Failed to flush queue', e);
    }
  }
};
