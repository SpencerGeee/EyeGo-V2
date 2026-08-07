import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import type { User, AuthTokens } from '@eyego/types';
import { forceDisconnectSocket } from '@eyego/api';
import { useRideStore } from './ride.store';

/**
 * Cleanup callbacks registered by the app root (e.g. clearing the React Query
 * cache, resetting Sentry user). auth.store cannot import the module-scoped
 * queryClient directly, so the root registers a teardown fn here. Runs on every
 * logout — including the 401-triggered logout in _layout.tsx — so a logged-out
 * or swapped user never inherits the prior user's cached data.
 */
let logoutCleanup: (() => void) | null = null;
export function registerLogoutCleanup(fn: () => void) {
  logoutCleanup = fn;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isLoggedIn: boolean;
  isLoading: boolean;

  login: (user: User, tokens: AuthTokens) => Promise<void>;
  refreshTokens: (tokens: AuthTokens) => void;
  updateUser: (user: User) => void;
  mergeUser: (patch: Partial<User>) => void;
  logout: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
}

const KEYS = {
  accessToken: 'eyego_access_token',
  refreshToken: 'eyego_refresh_token',
  user: 'eyego_user',
};

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  isLoggedIn: false,
  isLoading: true,

  login: async (user, tokens) => {
    // Defensive: clear any residual ride state from a prior session before the
    // new user's data loads. Guards against a stale activeBooking/trip surviving
    // a crash-without-logout into the next sign-in.
    useRideStore.getState().clearRideState();
    // Set in-memory state FIRST (synchronous) — mirrors the driver store's
    // login(), which documents the exact bug this used to have: awaiting the
    // SecureStore writes before calling set() left a ~50ms window where the
    // store's getRefreshToken() still returned the OLD refresh token. The
    // backend rotates refresh tokens on every use (old one is revoked the
    // instant a new one is issued), so any request that 401'd and triggered a
    // second refresh during that window sent the already-revoked token,
    // server-rejected it, and forced a real logout — exactly what "anything
    // that connects to the backend logs me out" looks like from the outside,
    // especially with several queries refetching in parallel on reconnect.
    set({
      user,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      isLoggedIn: true,
    });
    // Persist after — fire-and-forget is fine, the in-memory store (which the
    // API client actually reads from) is already correct.
    SecureStore.setItemAsync(KEYS.accessToken, tokens.accessToken).catch((e) =>
      console.error('[AuthStore] Failed to persist accessToken:', e)
    );
    SecureStore.setItemAsync(KEYS.refreshToken, tokens.refreshToken).catch((e) =>
      console.error('[AuthStore] Failed to persist refreshToken:', e)
    );
    SecureStore.setItemAsync(KEYS.user, JSON.stringify(user)).catch((e) =>
      console.error('[AuthStore] Failed to persist user:', e)
    );
  },

  /**
   * Swap in a rotated token pair. This is NOT a sign-in and must never be
   * routed through `login()`.
   *
   * BUGFIX ("the tracking page shows placeholder pickup and destination", "the
   * map is frozen and it says reconnecting"). The 401 refresh interceptor used
   * to call `login(user, tokens)`, and `login()` opens with
   * `clearRideState()` — a deliberate guard against a stale booking surviving
   * a crash into the NEXT sign-in. Refresh is not the next sign-in. It is the
   * same session, ~15 minutes in, and it fires while the rider is sitting on
   * the tracking screen watching a driver approach. So a routine token
   * rotation wiped activeBooking, selectedTrip, the seat, the driver location
   * and the fare out from under a live trip, and the screen fell back to its
   * empty-state placeholders with nothing left to render on the map.
   *
   * Rotation touches exactly two fields. `user`, `isLoggedIn` and every ride
   * store are none of its business. (The driver store has always had this
   * method; only the rider was routed through `login`.)
   */
  refreshTokens: (tokens) => {
    SecureStore.setItemAsync(KEYS.accessToken, tokens.accessToken).catch((e) =>
      console.error('[AuthStore] Failed to persist accessToken:', e)
    );
    SecureStore.setItemAsync(KEYS.refreshToken, tokens.refreshToken).catch((e) =>
      console.error('[AuthStore] Failed to persist refreshToken:', e)
    );
    set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
  },

  updateUser: (user) => {
    SecureStore.setItemAsync(KEYS.user, JSON.stringify(user)).catch(e =>
      console.error('[AuthStore] Failed to persist user:', e)
    );
    set({ user });
  },

  /**
   * Reconcile the cached user with a fresher server copy.
   *
   * BUGFIX ("I set my name during onboarding but the profile page is blank and
   * asks me to save it again"): `user` was a WRITE-ONCE cache. It was written
   * by `login()` — whose payload is issued at OTP time, before onboarding has
   * collected a name — and after that only by the two `updateUser` call sites.
   * Nothing ever reconciled it against `/user/me`, so a name that was sitting
   * in the database rendered as "Set your name" locally, and signing in again
   * overwrote the good local copy with the name-less login payload. The
   * profile tab even fetched the fresh server profile already and used it for
   * nothing but `.rating`.
   *
   * Merging rather than replacing matters: the login payload and `/user/me`
   * carry different subsets of the user, so a replace in either direction
   * drops fields. Undefined values in the patch are ignored for the same
   * reason — a partial response must never blank a field we already know.
   *
   * BUGFIX ("i finished onboarding and the profile page still says set your
   * name, and it asks for name and DOB again every time i reopen the app").
   * Filtering only `undefined` was not enough, because `name` is NOT NULL in
   * Prisma: the row created at OTP time carries an EMPTY STRING until
   * onboarding fills it in. So the blank arrives as `''`, not `undefined`, and
   * sailed straight through the filter. React Query holds `['user','profile']`
   * for 60s, so the copy fetched moments before onboarding — the one that
   * still says `name: ''` — was re-merged over the name that had just been
   * saved. `index.tsx` gates on `!user?.name || user.name === ''`, so the
   * store blanking itself sent the rider back to the register screen, on a
   * loop, forever.
   *
   * The rule this encodes: a patch may fill a field in, and it may change one
   * value to another value, but it may never turn a known value back into
   * nothing. "I don't have this" must never outrank "I have this". Server
   * fields that are legitimately clearable are cleared through `updateUser`,
   * which replaces wholesale and is called from the screens that own them.
   */
  mergeUser: (patch) => {
    const current = get().user;
    if (!current) return;
    const isBlank = (v: unknown) =>
      v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    const defined = Object.fromEntries(
      Object.entries(patch).filter(
        ([k, v]) => !isBlank(v) || isBlank((current as any)[k])
      )
    ) as Partial<User>;
    const next = { ...current, ...defined };
    // Skip the write when nothing actually changed — this runs on every
    // profile refetch and SecureStore writes are not free.
    const changed = Object.keys(defined).some(
      (k) => (current as any)[k] !== (next as any)[k]
    );
    if (!changed) return;
    SecureStore.setItemAsync(KEYS.user, JSON.stringify(next)).catch(e =>
      console.error('[AuthStore] Failed to persist user:', e)
    );
    set({ user: next });
  },

  logout: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(KEYS.accessToken),
      SecureStore.deleteItemAsync(KEYS.refreshToken),
      SecureStore.deleteItemAsync(KEYS.user),
    ]);
    set({ user: null, accessToken: null, refreshToken: null, isLoggedIn: false });

    // SECURITY: full teardown so the next user inherits nothing from this one.
    // 1) Wipe persisted ride state (AsyncStorage: eyego_ride_storage —
    //    activeBooking/selectedTrip/seat/driverLocation/fare).
    useRideStore.getState().clearRideState();
    // 2) Hard-drop the socket even if screens still hold connectSocket() refs,
    //    so we don't stay joined to the prior user's trip room.
    forceDisconnectSocket();
    // 3) Clear React Query cache + reset Sentry user (registered by app root).
    logoutCleanup?.();
  },

  loadFromStorage: async () => {
    try {
      const [accessToken, refreshToken, userJson] = await Promise.all([
        SecureStore.getItemAsync(KEYS.accessToken),
        SecureStore.getItemAsync(KEYS.refreshToken),
        SecureStore.getItemAsync(KEYS.user),
      ]);
      if (accessToken && refreshToken && userJson) {
        set({
          accessToken,
          refreshToken,
          user: JSON.parse(userJson),
          isLoggedIn: true,
        });
      }
    } catch {
      // Storage read failed — stay logged out
    } finally {
      set({ isLoading: false });
    }
  },
}));
