import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { ACCESS_COOKIE } from '@/lib/cookies';

/**
 * How much of a booking is still refundable.
 *
 * A route handler rather than a server component read, because the refund
 * dialog asks for this the moment it opens — one booking at a time, only when
 * somebody actually intends to refund. Same seam as the export and search
 * proxies: the admin token is attached here and never reaches the browser.
 */

const BASE = (process.env.EYEGO_API_URL || 'http://localhost:5020').replace(/\/$/, '');

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ bookingId: string }> }
) {
  const { bookingId } = await params;
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ message: 'Your session has expired.' }, { status: 401 });
  }

  try {
    const upstream = await fetch(
      `${BASE}/v1/admin/bookings/${encodeURIComponent(bookingId)}/refundable`,
      { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, cache: 'no-store' }
    );
    const body = await upstream.json().catch(() => null);
    if (!upstream.ok || !body?.success) {
      return NextResponse.json(
        { message: body?.message ?? 'Could not read the refundable amount.' },
        { status: upstream.status || 502 }
      );
    }
    return NextResponse.json(body.data);
  } catch {
    return NextResponse.json({ message: `Cannot reach the EyeGo API at ${BASE}.` }, { status: 503 });
  }
}
