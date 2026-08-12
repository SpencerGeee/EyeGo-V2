import { NextResponse } from 'next/server';

import { apiGet, ApiError, getAdmin } from '@/lib/api';

/**
 * Polling endpoint for the fleet map.
 *
 * The map is the one screen that has to refresh without re-rendering the page,
 * so it needs a browser-callable source. It cannot call eyego-api directly —
 * that would put the admin bearer token in client JavaScript, which is the exact
 * flaw that made the old console unfixable. So the browser talks to this
 * handler, the handler reads the httpOnly cookie, and the token stays server-side.
 *
 * getAdmin() is not decoration here: without it this route would be an
 * unauthenticated proxy that leaks every driver's live position to anyone who
 * knows the URL.
 */
export async function GET() {
  const admin = await getAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  try {
    const data = await apiGet<{ drivers: unknown[] }>('/drivers/live');
    return NextResponse.json(
      { drivers: data.drivers, at: new Date().toISOString() },
      { headers: { 'cache-control': 'no-store' } }
    );
  } catch (err) {
    // Surface the real status so the map can say "the API is down" instead of
    // silently drawing an empty city.
    const status = err instanceof ApiError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load drivers' },
      { status, headers: { 'cache-control': 'no-store' } }
    );
  }
}
