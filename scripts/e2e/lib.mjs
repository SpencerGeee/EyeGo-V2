/**
 * E2E harness — drives the REAL server over HTTP + socket.io.
 *
 * Exists because every audit before this one was static. Static analysis proves
 * "this cannot work"; only a running server proves "this does". Point it at a
 * local stack (docker compose up + npm start in eyego-api) and it plays a whole
 * rider→dispatch→driver→completion loop against real Postgres and real Redis.
 *
 *   node scripts/e2e/rider-happy-path.mjs
 *
 * Never point BASE at production: it creates users, trips and money rows.
 */

import { io } from 'socket.io-client';

export const BASE = process.env.E2E_BASE || 'http://127.0.0.1:5020';
export const API = `${BASE}/v1`;

if (/(?:^|\/\/)(?!127\.0\.0\.1|localhost)/.test(BASE) && !process.env.E2E_ALLOW_REMOTE) {
  // Deliberately loud. This harness writes rows.
  if (!/127\.0\.0\.1|localhost/.test(BASE)) {
    throw new Error(`Refusing to run against ${BASE}. Set E2E_ALLOW_REMOTE=1 if you really mean it.`);
  }
}

// ── result tracking ─────────────────────────────────────────────────────────

export const results = [];
let currentSection = 'general';

export function section(name) {
  currentSection = name;
  console.log(`\n\x1b[1m── ${name} ──\x1b[0m`);
}

export function pass(what, detail = '') {
  results.push({ section: currentSection, what, ok: true, detail });
  console.log(`  \x1b[32m✓\x1b[0m ${what}${detail ? ` \x1b[90m${detail}\x1b[0m` : ''}`);
}

export function fail(what, detail = '') {
  results.push({ section: currentSection, what, ok: false, detail });
  console.log(`  \x1b[31m✗\x1b[0m ${what}${detail ? ` \x1b[90m${detail}\x1b[0m` : ''}`);
}

export function info(what) {
  console.log(`  \x1b[90m· ${what}\x1b[0m`);
}

/** Run a check, recording pass/fail instead of aborting the whole run. */
export async function check(what, fn) {
  try {
    const detail = await fn();
    pass(what, typeof detail === 'string' ? detail : '');
    return true;
  } catch (e) {
    fail(what, e.message?.slice(0, 300));
    return false;
  }
}

export function summary() {
  const bad = results.filter((r) => !r.ok);
  console.log(`\n\x1b[1m${results.length - bad.length}/${results.length} checks passed\x1b[0m`);
  if (bad.length) {
    console.log('\x1b[31mFAILURES:\x1b[0m');
    for (const b of bad) console.log(`  [${b.section}] ${b.what} — ${b.detail}`);
  }
  return bad.length;
}

// ── http ────────────────────────────────────────────────────────────────────

export class HttpError extends Error {
  constructor(status, body, method, path) {
    const msg = body?.message || body?.error || JSON.stringify(body)?.slice(0, 200);
    super(`${method} ${path} → ${status}: ${msg}`);
    this.status = status;
    this.body = body;
  }
}

export async function req(method, path, { token, body, headers = {}, raw = false } = {}) {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  if (raw) return { status: res.status, body: json };
  if (!res.ok) throw new HttpError(res.status, json, method, path);
  // Every controller replies { success, data } — unwrap once, like the apps do.
  return json?.data !== undefined ? json.data : json;
}

export const GET = (p, o) => req('GET', p, o);
export const POST = (p, body, o) => req('POST', p, { ...o, body });
export const PATCH = (p, body, o) => req('PATCH', p, { ...o, body });
export const PUT = (p, body, o) => req('PUT', p, { ...o, body });
export const DEL = (p, o) => req('DELETE', p, o);

// ── actors ──────────────────────────────────────────────────────────────────

/** A phone number nobody else in the DB owns, stable within one run. */
export function phone(prefix = '23320') {
  return prefix + String(Date.now()).slice(-7) + String(Math.floor(Math.random() * 90) + 10);
}

export async function makeRider(name = 'E2E Rider') {
  const ph = phone();
  const otpRes = await POST('/auth/request-otp', { phone: ph });
  const code = otpRes._dev_otp;
  if (!code) throw new Error('no _dev_otp in response — is NODE_ENV=development?');
  const auth = await POST('/auth/verify-otp', { phone: ph, otp: code });
  const rider = {
    phone: ph,
    token: auth.accessToken,
    refreshToken: auth.refreshToken,
    id: auth.user?.id,
    isNewUser: auth.isNewUser,
  };
  await PATCH('/user/me', { name }, { token: rider.token });
  return rider;
}

export async function makeDriver(opts = {}) {
  const ph = phone('23324');
  const otpRes = await POST('/auth/driver/request-otp', { phone: ph });
  const code = otpRes._dev_otp;
  if (!code) throw new Error('no _dev_otp for driver');
  const auth = await POST('/auth/driver/verify-otp', { phone: ph, otp: code });
  const driver = {
    phone: ph,
    token: auth.accessToken,
    refreshToken: auth.refreshToken,
    id: auth.driver?.id || auth.user?.id,
    isNewUser: auth.isNewUser,
  };
  // The real onboarding call — this is what F1 in the previous audit rewrote.
  await POST(
    '/driver/verify',
    {
      name: opts.name || 'E2E Driver',
      ghanaCardNumber: 'GHA-' + Math.floor(Math.random() * 1e9),
      vehicle: {
        make: 'Toyota',
        model: 'Corolla',
        year: 2019,
        colour: 'Silver',
        plateNumber: 'GT-' + Math.floor(Math.random() * 9000 + 1000) + '-' + Math.floor(Math.random() * 90 + 10),
        seaterCount: opts.seaterCount ?? 4,
        tier: opts.tier || 'ECO',
      },
    },
    { token: driver.token },
  );
  await POST('/driver/dev-activate', {}, { token: driver.token });
  return driver;
}

export async function goOnline(driver, lat, lng) {
  return POST('/driver/go-online', { lat, lng, latitude: lat, longitude: lng }, { token: driver.token });
}

// ── sockets ─────────────────────────────────────────────────────────────────

/**
 * Connect and record every frame. The recorder is the point: a socket bug in
 * this system is almost never "no frame arrived", it is "the frame arrived with
 * seq:null" or "the frame carried a relation-less trip" — both of which are
 * invisible unless you keep the frames and inspect them afterwards.
 */
export function connectSocket(namespace, token) {
  const sock = io(`${BASE}${namespace}`, {
    auth: { token },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
  const frames = [];
  sock.onAny((event, ...args) => frames.push({ event, at: Date.now(), payload: args[0] }));
  sock.frames = frames;
  sock.waitFor = (predicate, timeoutMs = 15000, label = 'frame') =>
    new Promise((resolve, reject) => {
      const found = frames.find((f) => predicate(f));
      if (found) return resolve(found);
      const t = setTimeout(() => {
        sock.offAny(handler);
        reject(new Error(`timeout waiting for ${label} after ${timeoutMs}ms (saw: ${[...new Set(frames.map((f) => f.event))].join(',') || 'nothing'})`));
      }, timeoutMs);
      const handler = (event, ...args) => {
        const f = { event, at: Date.now(), payload: args[0] };
        if (predicate(f)) {
          clearTimeout(t);
          sock.offAny(handler);
          resolve(f);
        }
      };
      sock.onAny(handler);
    });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`socket ${namespace} connect timeout`)), 15000);
    sock.on('connect', () => {
      clearTimeout(t);
      resolve(sock);
    });
    sock.on('connect_error', (e) => {
      clearTimeout(t);
      reject(new Error(`socket ${namespace} connect_error: ${e.message}`));
    });
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll until fn() returns truthy, or throw. Used where no frame exists to wait on. */
export async function until(fn, { timeoutMs = 20000, everyMs = 500, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e.message;
    }
    await sleep(everyMs);
  }
  throw new Error(`timeout waiting for ${label} (last: ${JSON.stringify(last)?.slice(0, 200)})`);
}

// Accra. Two points ~3 km apart on real roads, so routing has something to answer.
export const ACCRA = {
  pickup: { lat: 5.6037, lng: -0.187 },
  dropoff: { lat: 5.5717, lng: -0.2107 },
  nearPickup: { lat: 5.6045, lng: -0.1878 },
};
