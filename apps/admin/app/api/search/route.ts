import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import { ACCESS_COOKIE } from '@/lib/cookies';

/**
 * Global search, proxied.
 *
 * The search box types as you go, so it needs a fetchable endpoint rather than
 * a Server Action — and, like every other read in this console, the admin token
 * must not leave the server to make it. Same seam as the export route.
 */

const BASE = (process.env.EYEGO_API_URL || 'http://localhost:5020').replace(/\/$/, '');

export async function GET(request: NextRequest) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ results: [], total: 0 }, { status: 401 });

  const q = request.nextUrl.searchParams.get('q') ?? '';
  if (q.trim().length < 2) return NextResponse.json({ results: [], total: 0 });

  try {
    const upstream = await fetch(
      `${BASE}/v1/admin/search?q=${encodeURIComponent(q)}&limit=5`,
      { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, cache: 'no-store' }
    );
    const body = await upstream.json().catch(() => null);
    if (!upstream.ok || !body?.success) {
      return NextResponse.json({ results: [], total: 0 }, { status: upstream.status });
    }
    return NextResponse.json(body.data);
  } catch {
    // A dead API makes the box quiet rather than noisy — the pages behind it
    // will surface the outage properly.
    return NextResponse.json({ results: [], total: 0 }, { status: 503 });
  }
}
