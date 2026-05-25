import axios, { AxiosInstance, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';

/**
 * Resolve the API base URL at runtime.
 *
 * In development Expo always knows the machine's current IP through its dev-server
 * host URI (e.g. "192.168.1.42:8081"). We strip the port and attach the API port
 * so the URL stays correct even when your Wi-Fi IP changes between sessions.
 *
 * Priority:
 *   1. Auto-detected from Expo dev-server host (DEV only)
 *   2. EXPO_PUBLIC_API_URL env var
 *   3. localhost fallback
 */
function resolveBaseUrl(): string {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    try {
      // expo-constants is available in every Expo app at runtime
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Constants = require('expo-constants').default;
      const hostUri: string | undefined =
        Constants.expoConfig?.hostUri ??
        (Constants.manifest2 as any)?.extra?.expoGo?.debuggerHost ??
        (Constants.manifest as any)?.debuggerHost;

      if (hostUri) {
        const host = hostUri.split(':')[0]; // "192.168.1.42:8081" → "192.168.1.42"
        if (host && host !== 'localhost' && host !== '127.0.0.1') {
          const port = process.env.EXPO_PUBLIC_API_PORT ?? '3000';
          return `http://${host}:${port}/v1`;
        }
      }
    } catch (_) {
      // Not running inside Expo (unit tests, SSR) — fall through
    }
  }
  return process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/v1';
}

const BASE_URL = resolveBaseUrl();

// Token storage callbacks — set by the app on boot
let getAccessToken: (() => string | null) = () => null;
let getRefreshToken: (() => string | null) = () => null;
let onTokenRefreshed: ((tokens: { accessToken: string; refreshToken: string }) => void) = () => {};
let onLogout: (() => void) = () => {};
let getRefreshUrl: (() => string) = () => '/auth/refresh';

export function configureApiClient(opts: {
  getAccessToken: () => string | null;
  getRefreshToken: () => string | null;
  onTokenRefreshed: (tokens: { accessToken: string; refreshToken: string }) => void;
  onLogout: () => void;
  getRefreshUrl?: () => string;
}) {
  getAccessToken = opts.getAccessToken;
  getRefreshToken = opts.getRefreshToken;
  onTokenRefreshed = opts.onTokenRefreshed;
  onLogout = opts.onLogout;
  if (opts.getRefreshUrl) getRefreshUrl = opts.getRefreshUrl;
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

// Attach JWT to every request
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Token refresh on 401 — Promise-based lock prevents duplicate refresh calls
// when multiple requests 401 simultaneously (avoids refresh token rotation race).
let refreshPromise: Promise<string> | null = null;

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config as AxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;

      // If a refresh is already in-flight, piggyback on it instead of starting another.
      if (!refreshPromise) {
        refreshPromise = (async (): Promise<string> => {
          const storedRefresh = getRefreshToken();
          if (!storedRefresh) throw new Error('No refresh token available');
          const { data } = await axios.post(`${BASE_URL}${getRefreshUrl()}`, {
            refreshToken: storedRefresh,
          });
          const { accessToken, refreshToken: newRefresh } = data.data;
          onTokenRefreshed({ accessToken, refreshToken: newRefresh });
          return accessToken;
        })().finally(() => {
          refreshPromise = null;
        });
      }

      try {
        const newToken = await refreshPromise;
        if (original.headers) original.headers.Authorization = `Bearer ${newToken}`;
        return apiClient(original);
      } catch {
        onLogout();
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  }
);
