/**
 * Grep-checkable invariants from EYEGO_FEATURE_INVENTORY.md Part 6.
 *
 * WHY A TEST AND NOT AN ESLINT RULE. The two Expo apps have no ESLint setup at
 * all — no config, no dependency, no script — so a `no-restricted-imports` rule
 * would have been a config file nothing ever ran. `yarn test` already exists and
 * already runs in CI, so putting the guard here means it actually fires.
 *
 * Only invariants a text search can decide belong in this file. "One Skia canvas
 * at a time" and "absoluteFill is laid out against the padding box" are real
 * rules and are not checkable this way; they stay documented.
 *
 * Run: `yarn test:invariants`
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.expo', 'dist', 'build', 'ios', 'android',
  '.next', 'coverage', '.yarn', 'graphify-out', 'patches',
  // A vendored second copy of the API tree that is not what ships.
  'eyego',
  // Agent worktrees and scratch. Stale copies of the app that would otherwise
  // report every finding two or three times over.
  '.claude', '.agent', '.codex', '.vibe',
]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

const files = (exts) => {
  const out = [];
  for (const f of walk(ROOT)) {
    if (exts.some((e) => f.endsWith(e))) out.push(f);
  }
  return out;
};

const report = (hits) =>
  hits.map((h) => `  ${relative(ROOT, h.file)}:${h.line}  ${h.text.trim()}`).join('\n');

/**
 * INVARIANT 17: `Pressable` comes from `@eyego/ui`, never React Native.
 *
 * NativeWind's css-interop registers React Native's `Pressable` and silently
 * drops the `({ pressed }) => style` function form — so every button that uses
 * it renders with no touch feedback, and worse, any row whose layout was
 * expressed as a style function loses its layout entirely. Silent: no warning,
 * no type error, just a screen that looks broken for no visible reason. It has
 * cost this codebase a whole sweep once already.
 *
 * SCOPE. A first pass asserted "never import it from react-native at all" and
 * found 264 sites, which is not a bug list — it is the whole app. The import on
 * its own is harmless: RN's Pressable handles a plain object style perfectly
 * well, and swapping 264 of them blind would be a large untested diff in service
 * of a rule nobody was actually breaking.
 *
 * What breaks is the FUNCTION form specifically, and only when it is attached to
 * React Native's Pressable.
 *
 * ── WHY THIS RULE HAD TO BE TIGHTENED ───────────────────────────────────────
 *
 * The first version of this test carried two exemptions, and BOTH of them were
 * hiding live instances of the exact bug it exists to prevent:
 *
 *   1. It skipped any file that also imported from `@eyego/ui`, on the grounds
 *      that a grep cannot attribute a style to an element when both Pressables
 *      are in scope. True, and it exempted almost every screen in the app —
 *      because almost every screen imports `Text` from the UI package. Four
 *      real breakages sat inside that exemption for months: the driver's Pass
 *      button and Dispatch-blocked CTA (both reported as "does nothing / is not
 *      styled"), the rider's ride-ended sheet, and the trip surface's Home pill.
 *   2. It skipped `packages/ui/` wholesale so the wrapper could import the
 *      primitive it wraps. That exempted `NoticeHost`, the one surface both
 *      apps use for every `notify()`, whose action button was unstyled for the
 *      same reason.
 *
 * The ambiguity that motivated exemption 1 is real but avoidable: it only
 * exists if a file imports RN's Pressable at all. So the rule is now the
 * unambiguous one — a file that uses a function style must not import Pressable
 * from react-native, full stop. That is checkable by text with no guessing, and
 * the whole repo already satisfies it.
 *
 * Only `packages/ui/src/Pressable.tsx`, which IS the wrapper, is exempt.
 */
test('React Native Pressable is never used with a function style', () => {
  const hits = [];
  for (const file of files(['.tsx'])) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    // The wrapper itself — and only it — may import the primitive it wraps.
    if (rel === 'packages/ui/src/Pressable.tsx') continue;
    const src = readFileSync(file, 'utf8');
    if (!src.includes('Pressable')) continue;

    const importsRnPressable = /import\s*\{[^}]*\bPressable\b[^}]*\}\s*from\s*['"]react-native['"]/.test(src);
    if (!importsRnPressable) continue;

    src.split('\n').forEach((text, i) => {
      // `style={({ pressed }) => ...}` or `style={(state) => ...}` — the arrow is
      // what NativeWind's css-interop drops.
      if (/\bstyle=\{\s*\(\s*(\{[^}]*\}|\w+)?\s*\)?\s*=>/.test(text)) {
        hits.push({ file, line: i + 1, text });
      }
    });
  }
  assert.equal(
    hits.length,
    0,
    `Function styles (({ pressed }) => style) require Pressable from '@eyego/ui'. ` +
      `NativeWind's css-interop registers React Native's Pressable and silently drops ` +
      `the function form, so the element renders with no style at all — no warning, ` +
      `no type error.\n${report(hits)}`,
  );
});

/**
 * Every `eta.<fn>(` call names a function `eta.service.js` actually exports.
 *
 * `driver-availability.js` called `eta.etaMinutes`, which never existed. The
 * TypeError was swallowed by a defensive catch, so mid-ride ("queued") offers
 * silently never fired. A swallowed catch makes a missing export invisible at
 * runtime; a text check makes it loud at test time.
 */
test('eta.* calls name real eta.service exports', () => {
  const svc = readFileSync(join(ROOT, 'eyego-api/src/services/eta.service.js'), 'utf8');
  const exported = new Set(
    (svc.match(/module\.exports\s*=\s*\{([^}]*)\}/)?.[1] ?? '')
      .split(',').map((s) => s.trim().split(':')[0].trim()).filter(Boolean),
  );
  const hits = [];
  for (const file of files(['.js'])) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    if (!rel.startsWith('eyego-api/src/')) continue;
    const src = readFileSync(file, 'utf8');
    if (!/require\(['"][./]*(services\/)?eta\.service['"]\)/.test(src)) continue;
    src.split('\n').forEach((text, i) => {
      for (const m of text.matchAll(/\beta\.([A-Za-z_]\w*)\s*\(/g)) {
        if (!exported.has(m[1])) hits.push({ file, line: i + 1, text });
      }
    });
  }
  assert.ok(exported.size > 0, 'could not read eta.service exports');
  assert.equal(hits.length, 0, `eta.* call to a function eta.service does not export:\n${report(hits)}`);
});

/**
 * Seat capacity on a bus trip is decided per STRETCH, by utils/segment-seats.
 *
 * Client meeting 2026-10-29: a bus that left Kasoa full is half empty by
 * Kaneshie, and that freed seat must be sold to the rider at Odorkor. Counting
 * occupying booking rows against `maxSeats` calls the bus full for the whole
 * road — the exact bug Phase A removed from bookSeat. A future "quick capacity
 * check" written that way would quietly bring it back.
 */
test('bus capacity is never a row count against maxSeats in the booking path', () => {
  const file = join(ROOT, 'eyego-api/src/modules/bookings/bookings.service.js');
  const src = readFileSync(file, 'utf8');
  const hits = [];
  src.split('\n').forEach((text, i) => {
    if (/booking\.count\(/.test(text) && /seatOccupyingWhere/.test(src.split('\n').slice(i, i + 3).join(' '))) {
      hits.push({ file, line: i + 1, text });
    }
    if (/>=\s*trip\.maxSeats/.test(text)) hits.push({ file, line: i + 1, text });
  });
  assert.ok(src.includes('freeSeatsOnSpan('), 'bookSeat must decide capacity with freeSeatsOnSpan');
  assert.equal(hits.length, 0, `Capacity must come from utils/segment-seats freeSeatsOnSpan:\n${report(hits)}`);
});

/**
 * Every full-route seat price comes from fare.calculator `seatFareData`.
 *
 * A corridor-pinned bus (D5, "Kasoa → Shiashie is ₵28") charges the pinned
 * price. A surface that calls calculateFare/estimateFare for a seat on its own
 * would show the computed price while bookSeat charges the corridor price.
 */
test('seat prices in bookings/trips services go through seatFareData', () => {
  const hits = [];
  for (const rel of ['eyego-api/src/modules/bookings/bookings.service.js', 'eyego-api/src/modules/trips/trips.service.js']) {
    const file = join(ROOT, rel);
    readFileSync(file, 'utf8').split('\n').forEach((text, i) => {
      if (/\b(calculateFare|estimateFare)\(\{/.test(text)) hits.push({ file, line: i + 1, text });
    });
  }
  assert.equal(hits.length, 0, `Use seatFareData(trip) for a seat price:\n${report(hits)}`);
});

/**
 * `Driver.status` approved is 'ACTIVE'. Never 'APPROVED'.
 *
 * The column is a free-form String and eligibility compares it exactly, so
 * writing 'APPROVED' removes a driver from dispatch with no error anywhere.
 * 'APPROVED' is the trap because it IS the correct value for per-document
 * review — anyone reading the documents code reaches for it and is wrong.
 *
 * See eyego-api/src/utils/driver-status.js.
 */
test("Driver.status is never compared or written as 'APPROVED'", () => {
  const hits = [];
  const DRIVER_FILES = /(driver|dispatch|admin|fleet)/i;
  for (const file of files(['.js', '.ts', '.tsx'])) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    if (!DRIVER_FILES.test(rel)) continue;
    // The canonicaliser's whole job is knowing about the bad values.
    if (rel.endsWith('utils/driver-status.js')) continue;
    const src = readFileSync(file, 'utf8');
    if (!src.includes('APPROVED')) continue;
    src.split('\n').forEach((text, i) => {
      // `status` and 'APPROVED' on the same line, in a comparison or an
      // assignment. Document review uses its own `review[type].status`, which
      // reads as `status: 'PENDING'|'VERIFIED'` and does not match this.
      if (/\bstatus\b\s*(===|!==|==|:)\s*['"]APPROVED['"]/.test(text)) {
        hits.push({ file, line: i + 1, text });
      }
    });
  }
  assert.equal(
    hits.length,
    0,
    `Driver.status approved is 'ACTIVE'. 'APPROVED' silently removes the driver from ` +
      `dispatch — driver-availability.js compares the string exactly.\n${report(hits)}`,
  );
});

test('the rider booking path has no seat picking (client 2026-10-29, D1)', () => {
  // A trotro is boarded, not assigned: the rider chooses HOW MANY and the
  // server counts `seats` on their stretch. A seat map back in the path
  // re-creates the "pick a seat that is taken mid-route" problem.
  const seat = readFileSync(join(ROOT, 'apps/rider/app/ride/[id]/seat.tsx'), 'utf8');
  assert.ok(!/from ['"][^'"]*seat\/Cabin3D['"]/.test(seat), 'seat.tsx imports Cabin3D again');
  const pay = readFileSync(join(ROOT, 'apps/rider/app/ride/[id]/payment.tsx'), 'utf8');
  assert.ok(/seats:\s*seatsWanted/.test(pay), 'payment.tsx no longer sends the seat count to POST /bookings');
});
