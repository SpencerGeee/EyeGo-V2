/**
 * Every `field: true` the API selects exists on SOME model in the schema.
 *
 * Prisma rejects an unknown field at RUNTIME, and only on the path that runs
 * it. `publishSeatUpdate` selected `Booking.seatHeldUntil` (the column is
 * `holdExpiresAt`) for weeks: every call threw, a catch swallowed it, and the
 * live seat-update push silently never went out. Static, no stack needed.
 *
 *   node scripts/e2e/prisma-fields.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { section, pass, fail, summary } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const schema = fs.readFileSync(path.join(ROOT, 'eyego-api/prisma/schema.prisma'), 'utf8');

const fields = new Set(['_count', '_sum', '_avg', '_min', '_max']);
for (const m of schema.matchAll(/^model \w+ \{([\s\S]*?)^\}/gm)) {
  for (const line of m[1].split('\n')) {
    const f = line.trim().match(/^([a-zA-Z_]\w*)\s+\S/);
    if (f && !f[1].startsWith('@@')) fields.add(f[1]);
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
const unknown = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  // Only inside select:/include: objects (any depth), where `x: true` names a
  // column or relation. Braces are matched, not regexed — nesting is arbitrary.
  for (const m of src.matchAll(/\b(select|include)\s*:\s*\{/g)) {
    let i = m.index + m[0].length;
    let depth = 1;
    const start = i;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
    }
    const body = src.slice(start, i - 1);
    for (const k of body.matchAll(/\b([a-zA-Z_]\w*)\s*:\s*true\b/g)) {
      if (!fields.has(k[1])) {
        const line = src.slice(0, m.index).split('\n').length;
        unknown.push(`${path.relative(ROOT, f).replace(/\\/g, '/')}:${line} ${k[1]}`);
      }
    }
  }
}
if (unknown.length) {
  fail('every selected field exists in the schema', 'Prisma throws on these at runtime:\n    ' + [...new Set(unknown)].join('\n    '));
} else {
  pass('every selected field exists in the schema', `${files.length} files, ${fields.size} schema field names`);
}
process.exit(summary());
