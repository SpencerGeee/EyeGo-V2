/**
 * ── THE WHOLE HARNESS, ONE COMMAND ──────────────────────────────────────────
 *
 * Runs every suite against a live stack, in an order chosen so that a failure
 * tells you something:
 *
 *   1. the surfaces that need nothing (health, geo, config)
 *   2. the happy paths, which prove the loop works at all
 *   3. the feature suites
 *   4. the edges — money, payloads, terminal states, silent failures
 *
 * Running the edges first would bury a broken server under forty confusing
 * assertions; running them last means that when the happy path is green and an
 * edge is red, the edge is the finding.
 *
 *   node scripts/e2e/run-all.mjs                 # everything
 *   node scripts/e2e/run-all.mjs wallet geo      # only suites matching a word
 *   E2E_BASE=http://127.0.0.1:5020 node ...      # point it somewhere else
 *
 * Exit code is the number of FAILED SUITES, so CI can gate on it. Each suite
 * runs in its own process: one crashing suite must not take the run with it,
 * and per-suite isolation is also what keeps their fixture users apart.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:5020';

/**
 * Every suite, in running order. `why` is printed in the report so a red line
 * says what capability is broken, not just which file failed.
 */
const SUITES = [
  // First, and deliberately: it reads source, needs no stack, and runs in a
  // second. If the performance rules have been broken, that is worth knowing
  // before forty HTTP assertions scroll past.
  ['ui-invariants.mjs', 'the performance + layout rules no type-check can see'],
  ['conditional-hooks.mjs', 'the crash React reports as "rendered more hooks than last render"'],
  ['motion-invariants.mjs', 'loops nobody cancels and sensors opened once per screen'],
  ['ux-invariants.mjs', 'failures that lie, unlabelled controls, text that will not scale'],
  ['maestro-selectors.mjs', 'every E2E selector is rendered by the app it targets'],
  ['h3-index.mjs', 'the hex grid dispatch searches — pure, exact, no stack needed'],
  ['scheduled-rides.mjs', 'the ride booked for later — the lifecycle nobody can sit through'],
  ['geo-routing.mjs', 'the polyline, the geocoder and the ETA every map depends on'],
  ['rider-happy-path.mjs', 'request → dispatch → accept → drive → complete → pay'],
  ['driver-happy-path.mjs', 'the driver-created group trip, end to end'],
  ['rider-features.mjs', 'saved places, scheduling, invites, disputes, support'],
  ['driver-features.mjs', 'earnings, quests, documents, destination mode'],
  ['rider-settings.mjs', 'profile, preferences, notifications, account'],
  ['release-surfaces.mjs', 'the release gate, consent, receipts, SOS, payments, the admin door'],
  ['rider-edges.mjs', 'the rider paths that are not the happy one'],
  ['dispatch-payload.mjs', 'the offer contract — every field the driver card reads'],
  ['wallet-commission.mjs', 'the cash float: warned at the offer, charged at boarding'],
  ['lifecycle-edges.mjs', 'cancellations, races, no-shows, terminal states'],
  ['silent-failures.mjs', 'writes that do not write, and 200s that mean nothing'],
  ['completion-pass.mjs', 'the 2026-09-07 two-device findings: multi-seat, walking route, dispatch board'],
];

const filters = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const selected = filters.length
  ? SUITES.filter(([file]) => filters.some((f) => file.includes(f)))
  : SUITES;

if (selected.length === 0) {
  console.error(`No suite matches ${filters.join(', ')}. Known suites:`);
  for (const [file] of SUITES) console.error(`  ${file}`);
  process.exit(2);
}

function runSuite(file) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [join(HERE, file)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let out = '';
    child.stdout.on('data', (d) => {
      const s = d.toString();
      out += s;
      process.stdout.write(s);
    });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      out += s;
      process.stderr.write(s);
    });
    child.on('close', (code) => {
      // The suites print "N/M checks passed"; lift the numbers so the roll-up
      // can report checks and not only suites.
      const m = out.match(/(\d+)\/(\d+) checks passed/);
      resolve({
        file,
        code: code ?? 1,
        passed: m ? Number(m[1]) : 0,
        total: m ? Number(m[2]) : 0,
        ms: Date.now() - started,
        // Every "  ✗ ..." line, so the roll-up can name the failures.
        failures: [...out.matchAll(/^\s*\[31m✗\[0m (.+)$/gm)].map((x) =>
          x[1].replace(/\[[0-9;]*m/g, '').trim(),
        ),
      });
    });
  });
}

const bar = (s) => `\x1b[1m${s}\x1b[0m`;

async function main() {
  console.log(bar(`\nEyeGo E2E — ${selected.length} suite(s) against ${BASE}\n`));
  if (!/127\.0\.0\.1|localhost/.test(BASE) && !process.env.E2E_ALLOW_REMOTE) {
    console.error('\x1b[31mRefusing to run against a non-local BASE without E2E_ALLOW_REMOTE=1.\x1b[0m');
    console.error('This harness creates users, trips and money rows.');
    process.exit(2);
  }

  const runs = [];
  for (const [file, why] of selected) {
    console.log(bar(`\n══ ${file} — ${why}`));
    // Serial on purpose. The suites share one dispatch pool and one Redis; two
    // running at once make each other's offers non-deterministic, which shows
    // up as flake and gets the harness distrusted.
    // eslint-disable-next-line no-await-in-loop
    const r = await runSuite(file);
    runs.push({ ...r, why });
  }

  const totalChecks = runs.reduce((n, r) => n + r.total, 0);
  const passedChecks = runs.reduce((n, r) => n + r.passed, 0);
  const badSuites = runs.filter((r) => r.code !== 0);

  console.log(bar('\n\n══════════ ROLL-UP ══════════'));
  for (const r of runs) {
    const mark = r.code === 0 ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(`${mark} ${r.file.padEnd(26)} ${String(r.passed).padStart(3)}/${String(r.total).padEnd(3)} ${(r.ms / 1000).toFixed(1)}s  \x1b[90m${r.why}\x1b[0m`);
  }
  console.log(bar(`\n${passedChecks}/${totalChecks} checks · ${runs.length - badSuites.length}/${runs.length} suites`));

  if (badSuites.length) {
    console.log('\n\x1b[31mFAILING CHECKS\x1b[0m');
    for (const r of badSuites) {
      console.log(`\n  \x1b[1m${r.file}\x1b[0m`);
      if (r.failures.length === 0) {
        console.log('    (suite crashed before it could report — see its output above)');
      }
      for (const f of r.failures) console.log(`    · ${f}`);
    }
    console.log(
      '\n\x1b[90mA failing suite is a finding, not a flake. Read the check text: each one says what the user\n' +
        'would experience, not just which assertion tripped.\x1b[0m',
    );
  }

  process.exit(badSuites.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
