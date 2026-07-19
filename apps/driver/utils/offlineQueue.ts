import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient } from '@eyego/api';

// Port of the rider app's offline sync queue — same storage format and
// semantics so behavior stays consistent across both apps.
const QUEUE_KEY = '@eyego_driver_offline_sync_queue';

export interface QueuedAction {
  id: string;
  type: 'SOS' | 'FCM_TOKEN' | 'TRIP_STATUS' | 'RATING';
  url: string;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  data: any;
  createdAt: string;
  retries: number;
}

export const offlineQueue = {
  /**
   * Enqueue a critical action for background/offline sync.
   *
   * `replaceSameType: true` drops any queued action of the same type before
   * adding this one — for last-write-wins syncs (e.g. FCM token) where
   * flushing a stale earlier payload after a newer one would clobber it.
   */
  async enqueue(type: QueuedAction['type'], url: string, method: QueuedAction['method'], data: any, opts?: { replaceSameType?: boolean }) {
    try {
      const stored = await AsyncStorage.getItem(QUEUE_KEY);
      let queue: QueuedAction[] = stored ? JSON.parse(stored) : [];
      if (opts?.replaceSameType) {
        queue = queue.filter((a) => a.type !== type);
      }

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

  /** Concurrent flush lock — enqueue() calls flushQueue() without awaiting,
   * so rapid enqueues could otherwise start parallel flushes over the same
   * queue state. */
  _flushing: false,

  async flushQueue() {
    if (this._flushing) return;
    this._flushing = true;
    try {
      const stored = await AsyncStorage.getItem(QUEUE_KEY);
      if (!stored) return;

      const queue: QueuedAction[] = JSON.parse(stored);
      if (queue.length === 0) return;

      // Atomic read-and-clear so parallel flushes don't process the same items
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([]));

      const remaining: QueuedAction[] = [];

      for (const action of queue) {
        try {
          if (action.method === 'POST') {
            await apiClient.post(action.url, action.data);
          } else if (action.method === 'PATCH') {
            await apiClient.patch(action.url, action.data);
          } else if (action.method === 'PUT') {
            await apiClient.put(action.url, action.data);
          } else if (action.method === 'DELETE') {
            await apiClient.delete(action.url);
          }
          console.log(`[OfflineQueue] Synced action ${action.id} (${action.type})`);
        } catch (error: any) {
          // 4xx client errors don't heal with retries — discard
          const status = error?.response?.status;
          if (status && status >= 400 && status < 500) {
            console.warn(`[OfflineQueue] Discarding action ${action.id} due to 4xx response:`, status);
            continue;
          }
          // Network errors / 5xx get retried
          action.retries += 1;
          if (action.retries < 5) {
            remaining.push(action);
          } else {
            console.warn(`[OfflineQueue] Action ${action.id} exceeded max retries. Discarding.`);
          }
        }
      }

      // Append retries back — don't overwrite newly enqueued items
      const currentRemaining = JSON.parse(await AsyncStorage.getItem(QUEUE_KEY) || '[]');
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([...currentRemaining, ...remaining]));
    } catch (e) {
      console.error('[OfflineQueue] Failed to flush queue', e);
    } finally {
      this._flushing = false;
    }
  },

  _intervalRef: null as ReturnType<typeof setInterval> | null,

  startPeriodicFlush(intervalMs: number = 60000) {
    this.stopPeriodicFlush();
    this._intervalRef = setInterval(() => {
      this.flushQueue();
    }, intervalMs);
  },

  stopPeriodicFlush() {
    if (this._intervalRef !== null) {
      clearInterval(this._intervalRef);
      this._intervalRef = null;
    }
  },
};
