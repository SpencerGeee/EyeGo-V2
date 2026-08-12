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

  // Only rotate on real page navigations. Middleware also runs for prefetches
  // and data requests, and rotating on all of them would fire several
  // concurrent refreshes per click — the API tolerates that via its replay
  // grace window, but there is no reason to lean on it.
  const isNavigation =
    req.headers.get('sec-fetch-mode') === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if ((!claims || isExpiringOrExpired(claims)) && refreshToken && isNavigation) {
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
    if (!isNavigation) return new NextResponse(null, { status: 401 });
    return redirectToLogin(req);
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
