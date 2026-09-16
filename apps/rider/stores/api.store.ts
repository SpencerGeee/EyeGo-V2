import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'eyego_api_base_url';

/**
 * Read the persisted API base URL from SecureStore.
 * Returns null if nothing has been saved yet.
 */
export async function getStoredApiUrl(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Persist a new API base URL to SecureStore.
 * The caller should also call setApiBaseUrl() on @eyego/api to apply it.
 */
export async function setStoredApiUrl(url: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(STORAGE_KEY, url);
  } catch {
    console.warn('[ApiStore] Failed to persist API URL');
  }
}
