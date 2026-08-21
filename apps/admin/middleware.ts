import { decodeJwt } from 'jose';
import { NextResponse, type NextRequest } from 'next/server';

import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  accessCookieOptions,
  refreshCookieOptions,
  clearedCookieOptions,
} from './lib/cookies';
import { can, rolesForPath, type Role } from './lib/roles';

/**
 * Two jobs, both of which have to happen before a page renders.
 *
 * 1. Keep the session alive. Access tokens live 15 minutes; without silent
 *    rotation an admin gets bounced to the login screen mid-shift. Middleware is
 *    the only place in Next that can both read the old cookie and write the new
 *    one on the same response — a server component can read cookies but not set
 *    them, so refresh-on-401 inside a page render cannot persist anything.
 *
 * 2. Gate routes by role, so an OPS user does not load the finance pages and
 *    then watch every panel fail with a 403. This is a UX guard. The real
 *    enforcement is requireRole() on the API, because anyone can bypass a
 *    frontend by calling the API directly.
 *
 * The JWT is decoded, not verified, on purpose. Verifying would mean giving the
 * console a copy of JWT_ACCESS_SECRET, and the only decision made here is which
 * page to draw — the API verifies the signature on every actual data call. A
 * forged cookie would therefore let someone load an empty shell of a page whose
 * every request 401s, which is not a privilege.
 */

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/logout'];

/** Rotate this early so a request never lands on the API with a just-expired token. */
const REFRESH_SKEW_SECONDS = 120;

type AccessClaims = { adminId?: string; role?: Role; exp?: number; type?: string };

function decode(token: string | undefined): AccessClaims | null {
  if (!token) return null;
  try {
    return decodeJwt(token) as AccessClaims;
  } catch {
    return null;
  }
}

function isExpiringOrExpired(claims: AccessClaims | null): boolean {
  if (!claims?.exp) return true;
  return claims.exp - REFRESH_SKEW_SECONDS <= Math.floor(Date.now() / 1000);
}

function redirectToLogin(req: NextRequest, reason?: string) {
  const url = new URL('/login', req.url);
  const target = req.nextUrl.pathname + req.nextUrl.search;
  if (target && target !== '/') url.searchParams.set('next', target);
  if (reason) url.searchParams.set('reason', reason);

  const res = NextResponse.redirect(url);
  res.cookies.set(ACCESS_COOKIE, '', clearedCookieOptions());
  res.cookies.set(REFRESH_COOKIE, '', clearedCookieOptions());
  return res;
}

async function rotate(refreshToken: string): Promise<{ accessToken: string; refreshToken: string } | null> {
  const base = (process.env.EYEGO_API_URL || 'http://localhost:5020').replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/v1/admin/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (!body?.success || !body?.data?.accessToken) return null;
    return { accessToken: body.data.accessToken, refreshToken: body.data.refreshToken };
  } catch {
    // A refresh that fails because the API is briefly unreachable must not
    // destroy the session — the caller keeps the existing cookies and the page
    // itself will surface the outage.
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const access = req.cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;

  let claims = decode(access);
  let response: NextResponse | null = null;

  const isNavigation =
    req.headers.get('sec-fetch-mode') === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  /**
   * ROTATE FOR ANYTHING THAT WILL RENDER, NOT JUST FOR NAVIGATIONS.
   *
   * BUGFIX — "when I'm logged in and I go inactive for about 10 minutes, when I
   * come back it's logged me out."
   *
   * Rotation used to require `isNavigation`. The intent was sound — don't fire
   * a refresh for every prefetch — but the test caught far more than
   * prefetches. `router.refresh()` sends an RSC data request: `sec-fetch-mode:
   * cors`, `accept: text/x-component`. Neither branch matches, so it was
   * treated as a background poll and skipped.
   *
   * The console refreshes itself on a timer from two places (`Filters`, and
   * `FleetMap` every five seconds). So an admin who leaves the tab open is
   * generating a steady stream of requests that CANNOT rotate the cookie, and
   * none that can. Fifteen minutes later the access token expires; `decode()`
   * does not check `exp`, so `claims.adminId` is still truthy and the request
   * sails through to a render; that render calls `getAdmin()` with a dead
   * token, the API answers 401, and the console layout redirects to
   * `/login?reason=session`. The session did not time out — it was never
   * allowed to renew.
   *
   * An RSC refresh renders server components and therefore needs a live token
   * exactly as much as a navigation does. What genuinely must not rotate is a
   * PREFETCH, which Next labels explicitly — so that is what we exclude, rather
   * than inferring it from a header that also describes legitimate traffic.
   */
  const isPrefetch =
    req.headers.get('next-router-prefetch') === '1' ||
    req.headers.get('purpose') === 'prefetch' ||
    req.headers.get('x-purpose') === 'prefetch' ||
    req.headers.get('x-moz') === 'prefetch';
  const isRscRender = req.headers.get('rsc') === '1' || req.headers.get('next-router-state-tree') !== null;
  const mayRotate = !isPrefetch && (isNavigation || isRscRender);

  if ((!claims || isExpiringOrExpired(claims)) && refreshToken && mayRotate) {
    const rotated = await rotate(refreshToken);
    if (rotated) {
      response = NextResponse.next();
      response.cookies.set(ACCESS_COOKIE, rotated.accessToken, accessCookieOptions());
      response.cookies.set(REFRESH_COOKIE, rotated.refreshToken, refreshCookieOptions());
      claims = decode(rotated.accessToken);
    } else if (!claims) {
      return redirectToLogin(req, 'expired');
    }
  }

  if (!claims?.adminId || claims.type !== 'admin_access') {
    // No usable session at all. Non-navigation requests get a 401 instead of a
    // redirect, so a prefetch cannot silently rewrite the user's location.
    if (!isNavigation && !isRscRender) return new NextResponse(null, { status: 401 });
    return redirectToLogin(req);
  }

  /**
   * A TOKEN THAT IS ALREADY DEAD MUST NOT REACH A RENDER.
   *
   * `decode()` reads the claims without checking `exp`, which is what let an
   * expired cookie satisfy the `adminId` check above and hand a 401-guaranteed
   * token to `getAdmin()`. If we get here holding one, rotation either was not
   * attempted (a prefetch) or failed (the API was unreachable) — in both cases
   * the honest answer is to stop, not to render a page whose every panel will
   * fail and whose layout will bounce the admin to /login anyway.
   *
   * Measured WITHOUT the skew: the skew exists to rotate early, not to accept
   * tokens the API will refuse.
   */
  let trulyExpired = !claims.exp || claims.exp <= Math.floor(Date.now() / 1000);
  if (trulyExpired && refreshToken) {
    // Rotate unconditionally here — `mayRotate` exists to keep prefetches from
    // stampeding a token that still works, and this one demonstrably does not.
    const rotated = await rotate(refreshToken);
    if (rotated) {
      response = response ?? NextResponse.next();
      response.cookies.set(ACCESS_COOKIE, rotated.accessToken, accessCookieOptions());
      response.cookies.set(REFRESH_COOKIE, rotated.refreshToken, refreshCookieOptions());
      claims = decode(rotated.accessToken) ?? claims;
      trulyExpired = !claims.exp || claims.exp <= Math.floor(Date.now() / 1000);
    }
  }
  if (trulyExpired) {
    if (!isNavigation && !isRscRender) return new NextResponse(null, { status: 401 });
    return redirectToLogin(req, 'expired');
  }

  const required = rolesForPath(pathname);
  if (required && !can(claims.role, required)) {
    const url = new URL('/', req.url);
    url.searchParams.set('denied', pathname);
    return NextResponse.redirect(url);
  }

  return response ?? NextResponse.next();
}

export const config = {
  // Everything except Next internals and static assets. The console has no
  // public pages, so the default is protected and /login is the exception.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
