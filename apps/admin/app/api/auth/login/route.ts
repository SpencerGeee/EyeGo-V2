import { NextResponse } from 'next/server';

import { ACCESS_COOKIE, REFRESH_COOKIE, accessCookieOptions, refreshCookieOptions } from '@/lib/cookies';

/**
 * Sign-in proxy.
 *
 * The browser posts credentials here; this handler calls eyego-api and puts the
 * returned tokens into httpOnly cookies. The tokens themselves never reach client
 * JavaScript, so an XSS in the console cannot lift an admin session — which is
 * the whole reason this is a route handler and not a fetch from the login form.
 */

const BASE = (process.env.EYEGO_API_URL || 'http://localhost:5020').replace(/\/$/, '');

export async function POST(request: Request) {
  let email = '';
  let password = '';
  let totpCode = '';

  try {
    const body = await request.json();
    email = String(body?.email ?? '');
    password = String(body?.password ?? '');
    // Absent on the first pass; supplied once the API has asked for it.
    totpCode = String(body?.totpCode ?? '');
  } catch {
    return NextResponse.json({ ok: false, message: 'Malformed request.' }, { status: 400 });
  }

  if (!email || !password) {
    return NextResponse.json({ ok: false, message: 'Enter your email and password.' }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${BASE}/v1/admin/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        // Forwarded so the API's per-account lockout and its audit row record
        // the operator's address rather than the console server's.
        'x-forwarded-for': request.headers.get('x-forwarded-for') ?? '',
        'user-agent': request.headers.get('user-agent') ?? 'eyego-console',
      },
      body: JSON.stringify({ email, password, ...(totpCode ? { totpCode } : {}) }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { ok: false, message: `Cannot reach the EyeGo API at ${BASE}. Is it running?` },
      { status: 503 }
    );
  }

  const body = await upstream.json().catch(() => null);

  if (!upstream.ok || !body?.success) {
    // `totpRequired` is a REQUEST for the second factor, not a refusal — the
    // password was already correct. It has to survive this hop or the form
    // cannot tell "show the code field" from "wrong password", and every
    // MFA-enrolled admin is locked out.
    if (body?.totpRequired) {
      return NextResponse.json(
        { ok: false, totpRequired: true, code: body.code, message: body.message },
        { status: 401 }
      );
    }
    // The upstream message is passed through as-is. It is written to be safe to
    // show — a wrong password and an unknown email produce the same wording, so
    // this cannot be used to discover which console emails exist.
    return NextResponse.json(
      { ok: false, message: body?.message || 'Sign-in failed.' },
      { status: upstream.status || 401 }
    );
  }

  const { accessToken, refreshToken, admin } = body.data ?? {};
  if (!accessToken || !refreshToken) {
    return NextResponse.json(
      { ok: false, message: 'The API did not return a session. Check its configuration.' },
      { status: 502 }
    );
  }

  const res = NextResponse.json({
    ok: true,
    message: 'Signed in',
    mustChangePassword: !!admin?.mustChangePassword,
  });
  res.cookies.set(ACCESS_COOKIE, accessToken, accessCookieOptions());
  res.cookies.set(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  return res;
}
