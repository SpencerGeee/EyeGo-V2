import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { ACCESS_COOKIE, REFRESH_COOKIE, clearedCookieOptions } from '@/lib/cookies';

/**
 * Sign-out.
 *
 * Revokes the refresh token upstream first, then clears the cookies. Order
 * matters: clearing cookies alone would leave a live server-side session that a
 * copied token could keep using for the rest of its 7-day window.
 *
 * The cookies are cleared even when the upstream call fails, because an operator
 * who clicked "sign out" must end up signed out of this browser regardless.
 */

const BASE = (process.env.EYEGO_API_URL || 'http://localhost:5020').replace(/\/$/, '');

export async function POST() {
  const store = await cookies();
  const token = store.get(ACCESS_COOKIE)?.value;

  if (token) {
    try {
      await fetch(`${BASE}/v1/admin/auth/logout`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: '{}',
        cache: 'no-store',
      });
    } catch {
      // Swallowed on purpose: see the note above.
    }
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ACCESS_COOKIE, '', clearedCookieOptions());
  res.cookies.set(REFRESH_COOKIE, '', clearedCookieOptions());
  return res;
}
