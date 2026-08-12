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

// In production builds, warn about HTTP (but don't crash — sideloaded dev builds
// on a LAN need HTTP since there's no HTTPS cert for a local IP).
if (typeof __DEV__ !== 'undefined' && !__DEV__ && BASE_URL.startsWith('http://')) {
  console.warn(
    '[EyeGo] API base URL is HTTP. For production App Store builds, set EXPO_PUBLIC_API_URL to an https:// URL.',
  );
}

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
  logoutCalled = false;
}

/**
 * The cold-start gate: hold every request until the session has been read back
 * out of SecureStore.
 *
 * BUGFIX (same report as the query-cache note in the rider's `_layout.tsx`:
 * "reopening the app mid-trip made me sign in again"). Both apps configure this
 * client and THEN call `loadFromStorage()`, which is asynchronous — SecureStore
 * has no synchronous read. For the handful of hundreds of milliseconds in
 * between, `getAccessToken()` and `getRefreshToken()` both answer `null` even
 * though a perfectly valid 30-day session is sitting on disk.
 *
 * Any request that went out in that window carried no Authorization header,
 * came back 401, and hit the refresh path — where "no refresh token available"
 * is classified as a DEFINITIVE rejection (`AuthRefreshRejected`) and logs the
 * user out. A store that had not finished loading was indistinguishable from a
 * store with nothing in it, so the app concluded the session had ended on the
 * strength of not having looked yet.
 *
 * "I have not read it yet" must never be reported as "there is nothing there".
 * The gate is one-shot: once it resolves the reference is dropped, so the steady
 * state costs nothing per request.
 */
let authReady: Promise<void> | null = null;
export function setAuthReadyGate(promise: Promise<void>): void {
  // Never let a rejected/hung bootstrap wedge the whole client: a 5 s ceiling
  // means the worst case is the old behaviour, not a permanently mute app.
  authReady = Promise.race([
    promise.catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 5000)),
  ]).then(() => {
    authReady = null;
  });
}

/**
 * Override the API base URL at runtime (e.g. from SecureStore).
 * Used in sideloaded production builds where the PC LAN IP isn't known at
 * build time. Call before any API requests are made.
 */
export function setApiBaseUrl(url: string): void {
  apiClient.defaults.baseURL = url;
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

// Attach JWT to every request. Async so the auth-ready gate above can hold the
// very first requests of a cold start until the stored session is in memory —
// see setAuthReadyGate for why sending one token-less request is enough to log
// a mid-trip rider out.
apiClient.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  if (authReady) await authReady;
  const token = getAccessToken();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Token refresh on 401 — Promise-based lock prevents duplicate refresh calls
// when multiple requests 401 simultaneously (avoids refresh token rotation race).
let refreshPromise: Promise<string> | null = null;
let logoutCalled = false;

/**
 * Thrown only when the server has definitively refused the refresh token, as
 * opposed to us being unable to reach the server at all. The distinction is the
 * difference between "your session ended" and "you went through a tunnel", and
 * only the former may log the user out.
 */
class AuthRefreshRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthRefreshRejected';
  }
}

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
          if (!storedRefresh) throw new AuthRefreshRejected('No refresh token available');

          // Retry the refresh itself through transient failures. Access tokens
          // live 15 minutes, so this call fires roughly every 15 minutes for the
          // whole session — on a phone that is regularly in and out of signal,
          // on a bus, that is a lot of chances to catch one bad moment.
          let lastErr: unknown;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const { data } = await axios.post(
                `${apiClient.defaults.baseURL}${getRefreshUrl()}`,
                { refreshToken: storedRefresh },
                { timeout: 15000 },
              );
              const { accessToken, refreshToken: newRefresh } = data.data;
              logoutCalled = false;
              onTokenRefreshed({ accessToken, refreshToken: newRefresh });
              return accessToken;
            } catch (e: any) {
              lastErr = e;
              const status = e?.response?.status;
              // The server has actually rejected this refresh token (expired,
              // revoked outside the grace window, malformed). Retrying cannot
              // help and the session really is over.
              if (status === 401 || status === 403) {
                throw new AuthRefreshRejected('Refresh token rejected');
              }
              // Network error, timeout or 5xx — the token is probably still
              // perfectly good, we just could not reach the server.
              if (attempt < 2) {
                await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
              }
            }
          }
          throw lastErr;
        })().finally(() => {
          refreshPromise = null;
        });
      }

      try {
        const newToken = await refreshPromise;
        if (original.headers) original.headers.Authorization = `Bearer ${newToken}`;
        return apiClient(original);
      } catch (refreshError) {
        // BUGFIX ("the app logs me out after some time", reported on both the
        // rider and the driver app). This used to log out on ANY refresh
        // failure. The refresh call fires every ~15 minutes when the access
        // token expires, and a single unreachable-server moment — walking into
        // a lift, a 3s server hiccup, switching from Wi-Fi to mobile data —
        // threw, hit this catch, and wiped SecureStore. The refresh token was
        // valid for 30 days the entire time; nothing about the session had
        // actually ended.
        //
        // A failure to ASK is not an answer of "no". Only tear the session down
        // when the server has genuinely rejected the token; otherwise surface
        // the original error and leave the credentials alone, so the next
        // request (or the next screen focus) simply tries again.
        if (refreshError instanceof AuthRefreshRejected) {
          if (!logoutCalled) {
            logoutCalled = true;
            onLogout();
          }
        }
        return Promise.reject(error);
      }
    }

    // Retry on network error or 5xx (up to 3 times with exponential backoff).
    //
    // ONLY for requests that are safe to send twice. This used to retry every
    // method, which is how one tap on the driver's "Publish trip" button became
    // two trips in the rider's list (one of them wearing the positional "TOP
    // PICK" badge): a POST whose response is lost to a flaky phone network has
    // still been received and committed by the server, and the retry created a
    // second Trip row. Nothing downstream could tell the two apart — they are
    // genuinely distinct trips as far as the database is concerned.
    //
    // A write is only replayable if the server can recognise the replay. That
    // means either the method is idempotent by definition, or the caller sent
    // an Idempotency-Key that middleware/idempotency.js can dedupe against.
    // Everything else fails once and surfaces the error, which the caller can
    // retry deliberately.
    const retryCount = (original as any)._retryCount ?? 0;
    const isNetworkError = !error.response;
    const isServerError = error.response?.status >= 500;
    const method = (original.method ?? 'get').toLowerCase();
    const hasIdempotencyKey = Boolean(
      (original.headers as Record<string, unknown> | undefined)?.['Idempotency-Key']
    );
    const isReplayable =
      method === 'get' || method === 'head' || method === 'options' || hasIdempotencyKey;

    /**
     * "A request with this Idempotency-Key is already being processed."
     *
     * BUGFIX (group pay-for-all failing with exactly that message).
     *
     * This is OUR OWN retry colliding with OUR OWN first attempt. A slow write
     * — pay-for-all charges every booking on the trip and waits on Paystack —
     * outlives the network timeout, we retry after 1s, and the server, entirely
     * correctly, sees the first attempt still in flight and answers 409
     * IDEMPOTENCY_IN_PROGRESS. The rider is shown a raw conflict message for a
     * payment that is at that moment succeeding.
     *
     * Waiting is the right answer, and it is safe for the same reason the retry
     * was allowed at all: the key means the server can recognise the replay.
     * Once the original finishes, the next attempt is served its cached
     * response instead of charging anyone twice.
     */
    const isIdempotencyInFlight =
      error.response?.status === 409 &&
      ((error.response?.data as any)?.code === 'IDEMPOTENCY_IN_PROGRESS' ||
        (error.response?.data as any)?.error?.code === 'IDEMPOTENCY_IN_PROGRESS');

    if (
      isReplayable &&
      (isNetworkError || isServerError || isIdempotencyInFlight) &&
      retryCount < 3 &&
      !original._retry
    ) {
      (original as any)._retryCount = retryCount + 1;
      const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
      await new Promise((resolve) => setTimeout(resolve, delay));
      return apiClient(original);
    }

    return Promise.reject(error);
  }
);
