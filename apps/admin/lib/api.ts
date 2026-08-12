import 'server-only';

import { cookies } from 'next/headers';
import { cache } from 'react';

import { ACCESS_COOKIE } from './cookies';
import type { Role } from './roles';

/**
 * Server-side client for eyego-api's /v1/admin surface.
 *
 * `server-only` at the top is load-bearing: importing this from a client
 * component becomes a build error rather than a bundle that ships the admin
 * bearer token to the browser. Every read in this console goes through a server
 * component and every write through a Server Action, so the token never leaves
 * the server. That is the whole reason the console is Next and not a SPA — the
 * old vanilla console had to hold ADMIN_SECRET_KEY in browser-reachable code.
 */

const BASE = (process.env.EYEGO_API_URL || 'http://localhost:5020').replace(/\/$/, '');

export const API_ROOT = `${BASE}/v1/admin`;

export class ApiError extends Error {
  status: number;
  /** Present when the API refused on role grounds rather than on input. */
  forbidden: boolean;
  unauthorized: boolean;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.forbidden = status === 403;
    this.unauthorized = status === 401;
  }
}

type Envelope<T> = { success: boolean; message?: string; data: T };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const store = await cookies();
  const token = store.get(ACCESS_COOKIE)?.value;

  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  // The legacy shared secret is a deliberate fallback for local development
  // before the first superadmin is seeded. It is only ever read on the server,
  // and setting it in production defeats the point of per-admin accounts.
  if (!token && process.env.EYEGO_ADMIN_LEGACY_SECRET) {
    headers.set('x-admin-secret', process.env.EYEGO_ADMIN_LEGACY_SECRET);
  }

  let res: Response;
  try {
    res = await fetch(`${API_ROOT}${path}`, {
      ...init,
      headers,
      // Console data is operational: never serve a cached page of the live map.
      cache: 'no-store',
    });
  } catch (err) {
    // A dead API must read as a dead API, not as an empty dataset. Showing
    // "0 active trips" when the backend is unreachable is the failure mode that
    // gets someone hurt.
    throw new ApiError(
      `Cannot reach the EyeGo API at ${BASE}. ${(err as Error).message}`,
      503
    );
  }

  const text = await res.text();
  let body: Partial<Envelope<T>> & { message?: string } = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiError(`API returned non-JSON (${res.status}): ${text.slice(0, 200)}`, res.status);
    }
  }

  if (!res.ok || body.success === false) {
    throw new ApiError(body.message || `Request failed (${res.status})`, res.status);
  }

  return body.data as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' });
}

export function apiPost<T>(path: string, payload?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

export function apiPatch<T>(path: string, payload?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PATCH',
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}

/**
 * Reads a page's data without letting one failed panel blank the whole screen.
 * A dashboard that fans out to ten endpoints should degrade panel by panel —
 * `null` means "this panel could not load", which the UI renders as an error
 * card, not as zero.
 */
export async function apiGetSafe<T>(path: string): Promise<T | null> {
  try {
    return await apiGet<T>(path);
  } catch {
    return null;
  }
}

export type AdminProfile = {
  id: string | null;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  mustChangePassword?: boolean;
  lastLoginAt?: string | null;
  isLegacy?: boolean;
};

/**
 * The authoritative identity for a render. Deliberately asks the API rather
 * than trusting the JWT's claims: a token minted before a demotion still
 * carries the old role, and the API re-reads the row on every request.
 *
 * `cache()` dedupes it across every component in a single render pass, so the
 * layout, the sidebar and the page share one call.
 */
export const getAdmin = cache(async (): Promise<AdminProfile | null> => {
  try {
    const data = await apiGet<{ admin: AdminProfile }>('/auth/me');
    return data.admin;
  } catch {
    return null;
  }
});
