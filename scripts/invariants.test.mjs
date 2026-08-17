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
 * React Native's Pressable. A grep cannot tell which JSX element a style belongs
 * to, so this checks the one case where there is no ambiguity: a file that
 * imports RN's Pressable and imports NOTHING from `@eyego/ui`. Any function
 * style in such a file is on the broken one by elimination.
 *
 * Files importing both are outside this check by construction. Migrating them —
 * and the plain-object cases — is a cleanup tracked in the triage doc.
 */
test('React Native Pressable is never used with a function style', () => {
  const hits = [];
  for (const file of files(['.tsx'])) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    // The shared library is where the wrapper itself lives, so it is allowed to
    // import the primitive it wraps.
    if (rel.startsWith('packages/ui/')) continue;
    const src = readFileSync(file, 'utf8');
    if (!src.includes('Pressable')) continue;

    const importsRnPressable = /import\s*\{[^}]*\bPressable\b[^}]*\}\s*from\s*['"]react-native['"]/.test(src);
    if (!importsRnPressable) continue;
    // Both imported: cannot attribute a style to an element by text. Skipped
    // deliberately rather than guessed at.
    if (/from\s*['"]@eyego\/ui['"]/.test(src)) continue;

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
