/**
 * Every field the API selects exists — on the MODEL it is selected from.
 *
 * Prisma rejects an unknown field at RUNTIME, and only on the path that runs
 * it. Two of these hid for weeks behind catch-and-warn:
 *   - publishSeatUpdate selected Booking.seatHeldUntil (column: holdExpiresAt):
 *     no live seat-update push was ever sent;
 *   - midRideAvailableDriverIds selected Route.destinationLat (column: destLat):
 *     no mid-ride driver was ever offered their next ride.
 * The second is a real field on ANOTHER model (Driver), so a name check is not
 * enough: this resolves the model from `prisma.<model>.<op>(` and walks nested
 * relation selects with the schema's own relation types. Static, no stack.
 *
 *   node scripts/e2e/prisma-fields.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { section, pass, fail, summary } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const schema = fs.readFileSync(path.join(ROOT, 'eyego-api/prisma/schema.prisma'), 'utf8');

// model -> Map(field -> type name)
const models = new Map();
for (const m of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
  const fields = new Map();
  for (const line of m[2].split('\n')) {
    const f = line.trim().match(/^([a-zA-Z_]\w*)\s+([A-Za-z_]\w*)/);
    if (f) fields.set(f[1], f[2]);
  }
  models.set(m[1], fields);
}
const allFields = new Set([...models.values()].flatMap((f) => [...f.keys()]));
const byClientName = new Map([...models.keys()].map((n) => [n[0].toLowerCase() + n.slice(1), n]));

/** Index just past the bracket matching src[open]. Skips strings and comments. */
function matchClose(src, open) {
  const pairs = { '{': '}', '(': ')', '[': ']' };
  const stack = [pairs[src[open]]];
  for (let i = open + 1; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) return src.length; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === stack[stack.length - 1]) { stack.pop(); if (!stack.length) return i + 1; }
  }
  return src.length;
}

/** Top-level `key: value` entries of an object literal's inner text. */
function entries(inner) {
  const out = [];
  let i = 0;
  while (i < inner.length) {
    const km = /^[\s,]*(?:\.\.\.[^,]*|([A-Za-z_]\w*)\s*:\s*)/.exec(inner.slice(i));
    if (!km) break;
    i += km[0].length;
    if (!km[1]) continue; // spread or shorthand — not statically knowable
    let j = i;
    const vStart = i;
    for (; j < inner.length; j++) {
      const c = inner[j];
      if ('{(['.includes(c)) { j = matchClose(inner, j) - 1; continue; }
      if (c === '"' || c === "'" || c === '`') { for (j++; j < inner.length && inner[j] !== c; j++) if (inner[j] === '\\') j++; continue; }
      if (c === ',') break;
    }
    out.push([km[1], inner.slice(vStart, j).trim()]);
    i = j + 1;
  }
  return out;
}

const problems = [];
function checkSelect(inner, model, where) {
  const fields = models.get(model);
  if (!fields) return;
  for (const [k, v] of entries(inner)) {
    if (k === '_count') continue;
    if (!fields.has(k)) {
      problems.push(`${where} ${model}.${k}`);
      continue;
    }
    const rel = fields.get(k);
    if (v.startsWith('{') && models.has(rel)) {
      for (const [k2, v2] of entries(v.slice(1, -1))) {
        if ((k2 === 'select' || k2 === 'include') && v2.startsWith('{')) checkSelect(v2.slice(1, -1), rel, where);
      }
    }
  }
}

const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.js')) files.push(p);
  }
};
walk(path.join(ROOT, 'eyego-api/src'));

section('prisma field names');
let calls = 0;
const OPS = 'findMany|findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow|create|update|upsert|delete|createMany|updateMany';
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  // Model-aware: prisma.<model>.<op>({ ... select/include ... })
  for (const m of src.matchAll(new RegExp(`\\b(?:prisma|tx|db|client)\\.(\\w+)\\.(?:${OPS})\\(\\s*\\{`, 'g'))) {
    const model = byClientName.get(m[1]);
    if (!model) continue;
    calls++;
    const open = m.index + m[0].length - 1;
    const arg = src.slice(open + 1, matchClose(src, open) - 1);
    const line = src.slice(0, m.index).split('\n').length;
    for (const [k, v] of entries(arg)) {
      if ((k === 'select' || k === 'include') && v.startsWith('{')) checkSelect(v.slice(1, -1), model, `${rel}:${line}`);
    }
  }
  // Fallback for detached select objects (const SELECT = {...}): name must exist SOMEWHERE.
  for (const m of src.matchAll(/\b(select|include)\s*:\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    const body = src.slice(open + 1, matchClose(src, open) - 1);
    for (const k of body.matchAll(/\b([a-zA-Z_]\w*)\s*:\s*true\b/g)) {
      if (!allFields.has(k[1])) problems.push(`${rel}:${src.slice(0, m.index).split('\n').length} ?.${k[1]}`);
    }
  }
}

const unique = [...new Set(problems)];
if (unique.length) {
  fail('every selected field exists on its model', 'Prisma throws on these at runtime:\n    ' + unique.join('\n    '));
} else {
  pass('every selected field exists on its model', `${files.length} files, ${calls} model-resolved calls, ${models.size} models`);
}
process.exit(summary());
