/**
 * Cookie contract, shared by middleware, route handlers and server actions.
 *
 * Both tokens are httpOnly so no client script can read them, and SameSite=Lax
 * so a cross-site form post cannot ride an admin's session (the console has no
 * legitimate cross-site navigation that needs Strict relaxed further).
 *
 * Kept free of node/next imports so edge middleware and route handlers can both
 * use it.
 */

export const ACCESS_COOKIE = 'eyego_admin_at';
export const REFRESH_COOKIE = 'eyego_admin_rt';
export const THEME_COOKIE = 'eyego_admin_theme';

/** Matches the API's 7-day admin refresh window. */
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60;

/**
 * Access-cookie lifetime intentionally exceeds the 15-minute token lifetime.
 * The cookie is a carrier, not the authority — the API rejects an expired JWT,
 * and middleware rotates it well before then. Matching them exactly would mean
 * a browser that slept through the expiry loses the refresh token too, which
 * turns a silent renewal into a surprise logout.
 */
const ACCESS_MAX_AGE = REFRESH_MAX_AGE;

type CookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
};

function base(maxAge: number): CookieOptions {
  return {
    httpOnly: true,
    // Off in local development, where the console is served over plain http.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  };
}

export const accessCookieOptions = () => base(ACCESS_MAX_AGE);
export const refreshCookieOptions = () => base(REFRESH_MAX_AGE);

/** Expiring options used to clear a cookie on sign-out. */
export const clearedCookieOptions = () => ({ ...base(0), maxAge: 0 });
