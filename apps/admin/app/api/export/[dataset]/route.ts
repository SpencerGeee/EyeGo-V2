import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import { ACCESS_COOKIE } from '@/lib/cookies';

/**
 * CSV download proxy.
 *
 * A download has to be a plain navigation — the browser needs to receive the
 * bytes with a `Content-Disposition` and save them, which a Server Action
 * cannot do. But the admin bearer token lives in an httpOnly cookie and must
 * never reach client JavaScript, so the browser cannot call the API directly
 * either.
 *
 * This route is the seam: an ordinary `<a href>` hits it, it attaches the token
 * server-side, and it streams the API's response straight back. The token stays
 * on this side of the wire, exactly as it does for every other read.
 *
 * Query parameters are forwarded verbatim, so the Export button next to a
 * filtered table exports *that* filtered table rather than the whole one.
 */

const BASE = (process.env.EYEGO_API_URL || 'http://localhost:5020').replace(/\/$/, '');

export async function GET(request: NextRequest, { params }: { params: Promise<{ dataset: string }> }) {
  const { dataset } = await params;
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;

  if (!token) {
    return NextResponse.json({ message: 'Your session has expired. Sign in again.' }, { status: 401 });
  }

  // Allow-listed, so this cannot be walked into an arbitrary API path by
  // putting a slash or a traversal sequence in the dataset name.
  if (!/^[a-z-]{1,32}$/.test(dataset)) {
    return NextResponse.json({ message: 'Unknown export.' }, { status: 400 });
  }

  const qs = request.nextUrl.searchParams.toString();
  const url = `${BASE}/v1/admin/export/${dataset}${qs ? `?${qs}` : ''}`;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { authorization: `Bearer ${token}`, accept: 'text/csv' },
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { message: `Cannot reach the EyeGo API at ${BASE}.` },
      { status: 503 }
    );
  }

  if (!upstream.ok) {
    const text = await upstream.text();
    let message = 'The export failed.';
    try {
      message = JSON.parse(text)?.message ?? message;
    } catch {
      /* upstream sent something that is not JSON; keep the generic message */
    }
    return NextResponse.json({ message }, { status: upstream.status });
  }

  const body = await upstream.text();
  const headers = new Headers({
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition':
      upstream.headers.get('content-disposition') ?? `attachment; filename="eyego-${dataset}.csv"`,
    // Operational data: never let a proxy or the browser keep a copy.
    'cache-control': 'no-store, no-cache, must-revalidate',
  });
  // Passed through so the page can warn that the file is capped rather than
  // letting someone reconcile against a silently short export.
  const truncated = upstream.headers.get('x-eyego-truncated');
  if (truncated) headers.set('x-eyego-truncated', truncated);

  return new NextResponse(body, { status: 200, headers });
}
