/**
 * ── PROVE THE MAESTRO SELECTORS BEFORE A DEVICE IS INVOLVED ─────────────────
 *
 * The single most common cause of a flaky mobile E2E suite is a flow that
 * refers to something the app does not render — a testID that was renamed, a
 * button whose copy changed, a screen that was restructured. The failure comes
 * back as a 20-second timeout on a device, which is slow to get, easy to blame
 * on the emulator, and quick to start ignoring.
 *
 * All of that is decidable from source. Every `id:` in a flow must exist as a
 * `testID` somewhere in the app, and every text selector must exist as a string
 * the app can actually render. This suite checks exactly that, in about a
 * second, with no device, no emulator and no Maestro installed.
 *
 * It does NOT claim the flows pass — only that they cannot fail for the
 * stupidest reason. Running them still needs a device.
 *
 *   node scripts/e2e/maestro-selectors.mjs
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { section, pass, fail, info, summary } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FLOW_DIR = join(ROOT, '.maestro', 'flows');
const SKIP = new Set(['node_modules', '.expo', 'android', 'ios', 'dist', '.next', 'build']);

/** Which app each `appId` maps to, so a selector is looked for in the right tree. */
const APP_FOR_ID = {
  'com.eyego.driver': 'apps/driver',
  'com.eyego.rider': 'apps/rider',
};

function sourceFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) sourceFiles(p, acc);
    } else if (/\.tsx?$/.test(e.name)) acc.push(p);
  }
  return acc;
}

/** Source for an app, plus the shared UI package it renders through. */
function corpusFor(appDir) {
  const files = [...sourceFiles(join(ROOT, appDir)), ...sourceFiles(join(ROOT, 'packages/ui/src'))];
  return files.map((f) => readFileSync(f, 'utf8')).join('\n');
}

/** Minimal reader — enough for the subset of YAML these flows use. */
function parseFlow(text) {
  const appId = (text.match(/^appId:\s*(\S+)/m) || [])[1] || null;
  const ids = [...text.matchAll(/^\s*id:\s*"([^"]+)"/gm)].map((m) => m[1]);
  const texts = [
    // `visible: "Some copy"` / `notVisible: "Some copy"` / `tapOn: "Some copy"`
    ...[...text.matchAll(/^\s*(?:visible|notVisible|tapOn):\s*"([^"]+)"/gm)].map((m) => m[1]),
  ];
  return { appId, ids, texts };
}

function main() {
  section('maestro selectors');

  if (!existsSync(FLOW_DIR)) {
    fail('the flows directory exists', `${relative(ROOT, FLOW_DIR)} is missing`);
    process.exit(summary());
  }

  const flows = readdirSync(FLOW_DIR).filter((f) => f.endsWith('.yaml'));
  if (!flows.length) {
    fail('there is at least one flow', 'no .yaml files under .maestro/flows');
    process.exit(summary());
  }

  const corpusCache = new Map();
  const missingIds = [];
  const missingText = [];
  const badAppIds = [];
  let idCount = 0;
  let textCount = 0;

  for (const file of flows) {
    const text = readFileSync(join(FLOW_DIR, file), 'utf8');
    const { appId, ids, texts } = parseFlow(text);

    const appDir = APP_FOR_ID[appId];
    if (!appDir) {
      badAppIds.push(`${file}: appId "${appId}" is not one of ${Object.keys(APP_FOR_ID).join(', ')}`);
      continue;
    }
    if (!corpusCache.has(appDir)) corpusCache.set(appDir, corpusFor(appDir));
    const corpus = corpusCache.get(appDir);

    for (const id of ids) {
      idCount++;
      // A testID may be a literal or forwarded through a prop; both leave the
      // literal string somewhere in the app's source.
      if (!corpus.includes(`"${id}"`) && !corpus.includes(`'${id}'`)) {
        missingIds.push(`${file}: id "${id}" is not rendered anywhere in ${appDir}`);
      }
    }
    for (const t of texts) {
      textCount++;
      if (!corpus.includes(t)) {
        missingText.push(`${file}: text "${t}" does not appear in ${appDir}`);
      }
    }
  }

  if (badAppIds.length) {
    fail('every flow targets a real app', badAppIds.join('\n    '));
  } else {
    pass('every flow targets a real app', `${flows.length} flow(s)`);
  }

  if (missingIds.length) {
    fail(
      'every id selector is rendered by the app',
      'these would time out on a device for the dumbest possible reason — nothing renders them:\n    ' +
        missingIds.join('\n    '),
    );
  } else {
    pass('every id selector is rendered by the app', `${idCount} id selector(s) resolved`);
  }

  if (missingText.length) {
    fail(
      'every text selector exists in the app',
      'copy changed, or the flow guessed at wording:\n    ' + missingText.join('\n    '),
    );
  } else {
    pass('every text selector exists in the app', `${textCount} text selector(s) resolved`);
  }

  info('selectors only — running the flows still needs a device or emulator');
  process.exit(summary());
}

main();
