import { NextRequest, NextResponse } from 'next/server';

import { captureServerException } from '@/lib/observability';

/**
 * WHERE THE BROWSER'S FAILURES GO.
 *
 * The console's two error boundaries — `app/global-error.tsx` and
 * `app/(console)/error.tsx` — post here. Reporting through the server rather
 * than from the page keeps the Sentry DSN out of the browser bundle, which
 * matters for an internal tool: a DSN in public JavaScript is an open pipe into
 * the project's quota.
 *
 * It also means one place decides what a client error looks like in Sentry,
 * instead of two boundaries drifting apart.
 */

export const runtime = 'nodejs';

/** Anything longer than this is a paste, not a stack. */
const MAX_FIELD = 4000;

function clamp(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length === 0) return undefined;
  return v.slice(0, MAX_FIELD);
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // A malformed report is still a signal that something broke; it just
    // cannot say what. Answer 204 either way — the boundary that sent it is
    // already rendering an error and must not be given a second one.
    return new NextResponse(null, { status: 204 });
  }

  const message = clamp(body.message) ?? 'Unknown client error';
  const err = new Error(message);
  err.name = 'ConsoleClientError';
  // The browser's stack, not this route's — the route's would name this file
  // for every report ever filed.
  const stack = clamp(body.stack);
  if (stack) err.stack = `${err.name}: ${message}\n${stack}`;

  captureServerException(err, {
    tags: {
      where: 'client',
      // Which boundary caught it: the root layout failing is a different
      // problem from one page failing, and they page different people.
      boundary: clamp(body.boundary) === 'global' ? 'global' : 'segment',
    },
    extra: {
      // Next's server-side error id. It is the only way to join a redacted
      // production client error to the full stack in the server logs.
      digest: clamp(body.digest),
      path: clamp(body.path),
      userAgent: clamp(req.headers.get('user-agent') ?? undefined),
    },
  });

  return new NextResponse(null, { status: 204 });
}
