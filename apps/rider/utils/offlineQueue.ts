import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient } from '@eyego/api';

const QUEUE_KEY = '@eyego_offline_sync_queue';

export interface QueuedAction {
  id: string;
  type: 'SOS' | 'RATING' | 'PROMO' | 'CHAT' | 'BOOKING_STATUS' | 'TRIP_COMPLETE';
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
  /** BUGFIX: Concurrent flush lock — prevents multiple parallel flushQueue() calls
   * from processing the same items simultaneously. This race condition occurred
   * because enqueue() calls flushQueue() without awaiting, and rapid enqueues
   * could start parallel flushes that both read the same queue state.
   */
  _flushing: false,

  async flushQueue() {
    if (this._flushing) {
      console.log('[OfflineQueue] Already flushing, skipping...');
      return;
    }
    this._flushing = true;
    try {
      const stored = await AsyncStorage.getItem(QUEUE_KEY);
      if (!stored) return;
      
      const queue: QueuedAction[] = JSON.parse(stored);
      if (queue.length === 0) return;
      
      // Atomic read-and-clear: get the current queue and immediately set it empty
      // so parallel flushes don't process the same items
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([]));
      
      console.log(`[OfflineQueue] Flushing queue with ${queue.length} items...`);
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
      
      // Append remaining (retries) back to queue — don't overwrite newly enqueued items
      const currentRemaining = JSON.parse(await AsyncStorage.getItem(QUEUE_KEY) || '[]');
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([...currentRemaining, ...remaining]));
    } catch (e) {
      console.error('[OfflineQueue] Failed to flush queue', e);
    } finally {
      this._flushing = false;
    }
  },

  /**
   * Periodically retry flushing the queue when the app is active.
   * Call this during app initialization with an interval.
   */
  _intervalRef: null as ReturnType<typeof setInterval> | null,

  /**
   * Start periodic queue flushing at the given interval (default 60 seconds).
   * Cleans up any previous interval before starting a new one.
   */
  startPeriodicFlush(intervalMs: number = 60000) {
    this.stopPeriodicFlush();
    this._intervalRef = setInterval(() => {
      this.flushQueue();
    }, intervalMs);
    console.log(`[OfflineQueue] Started periodic flush every ${intervalMs / 1000}s`);
  },

  /**
   * Stop periodic queue flushing. Safe to call multiple times.
   */
  stopPeriodicFlush() {
    if (this._intervalRef !== null) {
      clearInterval(this._intervalRef);
      this._intervalRef = null;
      console.log('[OfflineQueue] Stopped periodic flush');
    }
  },
};

