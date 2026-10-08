/**
 * ── EVERY PHONE PRINTS THE SAME MONEY AND THE SAME TIME ─────────────────────
 *
 * `toLocaleString` answers from each platform's ICU data and the device's
 * 12/24-hour setting, so one departure read "18:40" on an iPhone and "6:40 pm"
 * on an Android, and money grouping depended on Hermes' Intl build. Both apps
 * now format by hand in packages/utils (dates.ts, money.ts). This suite pins
 * the exact strings, and fails if any screen goes back to toLocale*.
 *
 *   node scripts/e2e/formatters.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { section, check, summary } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(ROOT, 'package.json'));
const ts = require('typescript');

function load(rel) {
  const src = readFileSync(join(ROOT, rel), 'utf8');
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', out)(m, m.exports, () => ({}));
  return m.exports;
}

function eq(actual, expected) {
  if (actual !== expected) throw new Error(`got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  return actual;
}

async function main() {
  const d = load('packages/utils/src/dates.ts');
  const m = load('packages/utils/src/money.ts');
  const t = new Date(2026, 5, 15, 18, 40); // Mon 15 Jun 2026, 6:40 PM local

  section('dates');
  await check('clock is 12-hour with AM/PM, no leading zero', () =>
    [eq(d.clockTime(t), '6:40 PM'), eq(d.clockTime(new Date(2026, 5, 15, 0, 5)), '12:05 AM'), eq(d.clockTime(new Date(2026, 5, 15, 12, 0)), '12:00 PM')].join(' / '));
  await check('dates', () =>
    [eq(d.dayMonth(t), '15 Jun'), eq(d.shortDateTime(t), 'Mon 15 Jun · 6:40 PM'), eq(d.longDate(t), 'Monday 15 June'), eq(d.dayMonthYear(t), '15 Jun 2026')].join(' / '));
  await check('relative day follows the calendar, not 24-hour blocks', () =>
    [
      eq(d.relativeDay(t, new Date(2026, 5, 15, 1, 0)), 'Today'),
      eq(d.relativeDay(t, new Date(2026, 5, 14, 23, 0)), 'Tomorrow'),
      eq(d.relativeDay(t, new Date(2026, 5, 10)), 'Mon 15 Jun'),
    ].join(' / '));
  await check('garbage renders a dash, never "Invalid Date"', () => [eq(d.clockTime('nope'), '—'), eq(d.dayMonth(null), '—')].join(' / '));

  section('money');
  await check('grouping and decimals', () =>
    [eq(m.formatGhs(123456789), 'GH₵1,234,567.89'), eq(m.formatGhs(2550), 'GH₵25.50'), eq(m.formatGhs(-100050), '−GH₵1,000.50'), eq(m.formatGhs(99950, { showDecimals: false }), 'GH₵1,000')].join(' / '));

  section('no screen formats through the platform');
  await check('no toLocaleTimeString / toLocaleDateString / toLocaleString in either app', () => {
    const hits = [];
    const walk = (dir) => {
      if (!existsSync(dir)) return;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', '.expo', 'android', 'ios'].includes(e.name)) continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && /\.toLocale(Time|Date)?String\(/.test(readFileSync(p, 'utf8'))) hits.push(relative(ROOT, p));
      }
    };
    for (const r of ['apps/rider/app', 'apps/rider/components', 'apps/driver/app', 'apps/driver/components', 'packages/ui/src']) walk(join(ROOT, r));
    if (hits.length) throw new Error(`use @eyego/utils dates/money instead: ${hits.join(', ')}`);
    return 'none';
  });
}

main().finally(() => process.exit(summary() ? 1 : 0));
