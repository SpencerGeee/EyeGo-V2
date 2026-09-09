/**
 * ── EVERY BUTTON, END TO END, WITHOUT PRESSING ANY OF THEM ──────────────────
 *
 * "make sure that all the buttons/functionalities on the rider app and driver
 *  app work end to end. think about the logic and make sure its correctly wired"
 *
 * A button in these apps is wired through exactly three kinds of edge, and all
 * three are decidable from source:
 *
 *   1. it NAVIGATES  — `goDeeper('/trip/x')`. If no file backs that route the
 *      tap does nothing at all. Expo Router fails silently: no crash, no
 *      warning, just a button that appears broken to the user and fine to us.
 *
 *   2. it CALLS THE API — every network call in both apps goes through
 *      `packages/api`. If a path there does not match a mounted express route
 *      the button 404s, and the app's error handling turns most 404s into a
 *      generic "something went wrong" — indistinguishable from a server being
 *      down, which is why this kind of rot survives for months.
 *
 *   3. it RUNS A HANDLER — which must actually contain something.
 *
 * This suite checks all three. It is deliberately static: no device, no server,
 * no database. The runtime suites already prove the happy paths work; this
 * proves nothing has come UNWIRED — which is the failure that hand-testing
 * misses, because nobody presses all 661 controls.
 *
 *   node scripts/e2e/button-wiring.mjs
 */

import { createRequire } from 'node:module';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { section, pass, fail, info, summary } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ts = createRequire(join(ROOT, 'package.json'))('typescript');

const SKIP = new Set(['node_modules', '.expo', 'android', 'ios', 'dist', '.next', 'build', '__tests__']);
const APPS = ['apps/rider', 'apps/driver'];

const rel = (p) => relative(ROOT, p).split(sep).join('/');

function sourceFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) sourceFiles(p, acc);
    } else if (/\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) acc.push(p);
  }
  return acc;
}

// ── 1. NAVIGATION ───────────────────────────────────────────────────────────

/**
 * Every route Expo Router will actually serve for an app.
 *
 * Group segments — `(tabs)` — are transparent in a URL, so `app/(tabs)/home.tsx`
 * answers to BOTH `/(tabs)/home` and `/home` and the codebase uses both forms.
 * Emitting only one would fail perfectly good links.
 */
function routeTable(appDir) {
  const base = join(ROOT, appDir, 'app');
  const out = new Set(['/']);
  const walk = (dir, segs) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('+')) continue; // +not-found, +html — not linkable
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        walk(p, [...segs, e.name]);
        continue;
      }
      if (!/\.tsx?$/.test(e.name)) continue;
      const name = e.name.replace(/\.tsx?$/, '');
      if (name === '_layout') continue;
      const parts = name === 'index' ? segs : [...segs, name];
      let variants = [[]];
      for (const s of parts) {
        const isGroup = /^\(.+\)$/.test(s);
        const next = [];
        for (const v of variants) {
          next.push([...v, s]);
          if (isGroup) next.push([...v]);
        }
        variants = next;
      }
      for (const v of variants) out.add('/' + v.join('/'));
    }
  };
  if (existsSync(base)) walk(base, []);
  return out;
}

/**
 * A navigation target reduced to the path the router will actually match.
 *
 * A placeholder glued to a segment rather than standing as one — the `[x]` in
 * `/ride/[x]/rate-tip[x]` — is an interpolation whose content we cannot see,
 * and in practice it is always an optional query string:
 * `` `/ride/${id}/rate-tip${bookingId ? `?bookingId=${bookingId}` : ''}` ``.
 * The path ends there. Treating it as a literal segment invented four dead
 * routes that all exist, and false positives are how a check gets ignored.
 *
 * Both the dead-link check and the orphan check go through here, so a target
 * cannot count as reaching a screen under one rule and not the other.
 */
const canonical = (target) =>
  target
    .replace(/([^/])\[x\].*$/, '$1')
    .split('?')[0]
    .replace(/\/+$/, '') || '/';

const matchRoute = (table, target) => {
  const clean = canonical(target);
  if (table.has(clean)) return true;
  const segs = clean.split('/').filter(Boolean);
  for (const r of table) {
    const rs = r.split('/').filter(Boolean);
    if (rs.length !== segs.length) continue;
    if (rs.every((s, i) => /^\[.*\]$/.test(s) || s === segs[i])) return true;
  }
  return false;
};

/**
 * The app's real forward verbs, from packages/ui/src/motion/smooth.
 *
 * Bare `replace` and `push` are NOT in the function set on purpose: String
 * .replace is an order of magnitude more common than router.replace, and
 * treating them alike produced nothing but false positives on things like
 * `url.replace('/v1', '')`. Method calls are accepted only on a router object.
 */
const NAV_FN = new Set(['go', 'goDeeper', 'goInstead', 'goOut', 'goLateral', 'goModal']);
const NAV_METHOD = new Set(['push', 'replace', 'navigate', 'dismissTo', 'prefetch']);

/**
 * Peel `'/x' as any`, `'/x' satisfies T` and `('/x')` down to the literal.
 *
 * This matters more than it looks. Expo Router's href type is a union of the
 * routes it knows, so the codebase writes `as any` wherever that inference is
 * inconvenient — 59 navigation targets are written that way. Those are the
 * targets TypeScript is expressly NOT checking, which makes them the likeliest
 * place for a route to have gone stale, and the last place anyone would look.
 */
function unwrap(node) {
  let n = node;
  while (n && (ts.isAsExpression(n) || ts.isParenthesizedExpression(n) || ts.isSatisfiesExpression?.(n) || ts.isTypeAssertionExpression?.(n) || ts.isNonNullExpression(n))) {
    n = n.expression;
  }
  return n;
}

/**
 * Screens no button leads to.
 *
 * The dead-link check asks "does this button go somewhere". This asks the
 * opposite and rarer question: is there a screen the user can never reach?
 * That is how a finished feature quietly stops shipping — the entry point gets
 * refactored away, the screen keeps compiling, keeps passing type-check, keeps
 * being maintained, and no longer exists as far as anyone holding the phone is
 * concerned.
 *
 * Four kinds of screen are legitimately unlinked, and all four are decidable:
 *   · a tab, reached by the tab bar rather than by an href;
 *   · the app's own entry `index`, reached by launching it;
 *   · a group index, reached as the group;
 *   · a `<Redirect>` stub kept alive for deep links already in the wild.
 * Anything else unreachable is a feature that has fallen off the app.
 */
function orphanScreens(appDir, hits) {
  const base = join(ROOT, appDir, 'app');
  const out = [];
  const walk = (dir, segs) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        walk(p, [...segs, e.name]);
        continue;
      }
      if (!/\.tsx?$/.test(e.name)) continue;
      const nm = e.name.replace(/\.tsx?$/, '');
      if (nm === '_layout' || nm.startsWith('+')) continue;
      if (segs.some((s) => s === '(tabs)')) continue; // the tab bar is the link
      if (nm === 'index') continue; // app entry, or the group's own screen
      const parts = [...segs, nm];
      const withGroups = '/' + parts.join('/');
      const bare = '/' + parts.filter((s) => !/^\(.+\)$/.test(s)).join('/');
      const reached = [...hits].some((h) => {
        const hs = h.split('/').filter(Boolean);
        return [withGroups, bare].some((cand) => {
          const cs = cand.split('/').filter(Boolean);
          return cs.length === hs.length && cs.every((s, i) => /^\[.*\]$/.test(s) || hs[i] === s || hs[i] === '[x]');
        });
      });
      if (reached) continue;
      // A stub that only forwards is meant to be unlinked.
      if (/<Redirect\b/.test(readFileSync(p, 'utf8'))) continue;
      out.push(`${rel(p)} (${bare})`);
    }
  };
  if (existsSync(base)) walk(base, []);
  return out;
}

/**
 * The driver's trip advances from exactly one place.
 *
 * The four verbs below ARE the driver's state machine: they decide whether a
 * trip goes en route, arrives, departs or completes. Calling the wrong one for
 * a status does not fail loudly — it moves the trip somewhere neither the
 * driver nor the rider expects.
 *
 * Three screens each owned a copy, and the copies drifted every single time:
 *   · the manage screen accepted DRIVER_ASSIGNED into the mutation but omitted
 *     it when deriving the next status, so a successful swipe did nothing at
 *     all — no cache write, no refetch, no redirect, and the next swipe 409'd;
 *   · the tracking screen sent `departTrip` with no under-minimum
 *     acknowledgement and swallowed the server's 409 in silence, so a group
 *     driver below minimum occupancy swiped and got no response whatsoever;
 *   · an earlier round had one screen knowing four statuses and its sibling six.
 *
 * Hand-syncing three copies is what produced all of that. There is one now.
 */
const ADVANCE_VERBS = ['startTrip', 'arriveAtPickup', 'departTrip', 'arriveTrip'];
const ADVANCE_OWNER = 'apps/driver/components/surface/useTripAdvance.ts';

function strayAdvanceCalls() {
  const out = [];
  for (const file of sourceFiles(join(ROOT, 'apps/driver'))) {
    const r = rel(file);
    if (r === ADVANCE_OWNER) continue;
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      // A comment naming the verb is documentation, not a second machine.
      if (/^\s*(\*|\/\/)/.test(line)) return;
      for (const v of ADVANCE_VERBS) {
        if (line.includes(`driverApi.${v}(`)) out.push(`${r}:${i + 1} calls driverApi.${v}`);
      }
    });
  }
  return out;
}

// ── 2. THE API SURFACE ──────────────────────────────────────────────────────

/** `/rides/${tripId}/accept` → `/rides/:p/accept`, so it can match an express path. */
const normalise = (p) => p.split('?')[0].replace(/\$\{[^}]*\}/g, ':p').replace(/\/+$/, '') || '/';

/** Mounted express routes as `METHOD /v1/...`, params normalised the same way. */
function expressRoutes() {
  const appJs = readFileSync(join(ROOT, 'eyego-api/src/app.js'), 'utf8');

  const required = new Map(); // ident -> module path
  for (const m of appJs.matchAll(/const\s+(\w+)\s*=\s*require\(['"]\.\/([^'"]+)['"]\)/g)) {
    required.set(m[1], m[2]);
  }

  const mounts = []; // [prefix, file]
  for (const m of appJs.matchAll(/app\.use\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)\s*\)/g)) {
    const file = required.get(m[2]);
    if (file) mounts.push([m[1], file]);
  }

  const out = new Set();
  const readRouter = (modPath, prefix, seen = new Set()) => {
    const file = join(ROOT, 'eyego-api/src', modPath.endsWith('.js') ? modPath : `${modPath}.js`);
    if (!existsSync(file) || seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, 'utf8');

    for (const m of src.matchAll(/router\.(get|post|patch|put|delete)\(\s*['"`]([^'"`]+)['"`]/g)) {
      const path = normalise(prefix + (m[2] === '/' ? '' : m[2])).replace(/:[\w]+/g, ':p');
      out.add(`${m[1].toUpperCase()} ${path}`);
    }
    // Nested routers: `router.use('/sub', require('./x'))` or via a local const.
    const localReq = new Map();
    for (const m of src.matchAll(/const\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\)/g)) localReq.set(m[1], m[2]);
    for (const m of src.matchAll(/router\.use\(\s*['"]([^'"]+)['"]\s*,\s*(?:require\(['"]([^'"]+)['"]\)|(\w+))\s*\)/g)) {
      const target = m[2] || localReq.get(m[3]);
      if (!target || !target.startsWith('.')) continue;
      const resolved = join(dirname(modPath), target).split(sep).join('/');
      readRouter(resolved, prefix + (m[1] === '/' ? '' : m[1]), seen);
    }
  };

  for (const [prefix, file] of mounts) readRouter(file, prefix);
  return out;
}

/**
 * The client's baseURL already ends in `/v1` (see packages/api/src/client.ts),
 * so a call written `/rides/active` is really `/v1/rides/active`. Forgetting
 * this makes every single call look missing, which is exactly what it did the
 * first time this suite ran.
 */
const API_PREFIX = '/v1';

const matchApi = (routes, method, path) => {
  const want = normalise(API_PREFIX + path);
  const wantSegs = want.split('/').filter(Boolean);
  for (const r of routes) {
    const [m, p] = r.split(' ');
    if (m !== method) continue;
    const ps = p.split('/').filter(Boolean);
    if (ps.length !== wantSegs.length) continue;
    if (ps.every((s, i) => s === ':p' || wantSegs[i] === ':p' || s === wantSegs[i])) return true;
  }
  return false;
};

/** Every `apiClient.<method>('<path>')` in packages/api, with its call site. */
function apiCalls() {
  const dir = join(ROOT, 'packages/api/src');
  const out = [];
  for (const file of sourceFiles(dir)) {
    const text = readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (n) => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.expression.getText() === 'apiClient' &&
        NAV_METHOD.has(n.expression.name.text) === false &&
        /^(get|post|patch|put|delete)$/.test(n.expression.name.text) &&
        n.arguments.length
      ) {
        const a = n.arguments[0];
        let path = null;
        if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) path = a.text;
        else if (ts.isTemplateExpression(a)) {
          path = a.head.text + a.templateSpans.map((s) => '${x}' + s.literal.text).join('');
        }
        if (path && path.startsWith('/')) {
          out.push({
            method: n.expression.name.text.toUpperCase(),
            path,
            where: `${rel(file)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`,
          });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

// ── 3. THE HANDLERS ─────────────────────────────────────────────────────────

const HANDLER_PROP = /^on(Press|LongPress|Submit|Confirm|Complete|Toggle|Select)/;

function scanApp(appDir, table, findings, hits) {
  let controls = 0;
  let resolvedNav = 0;

  for (const file of sourceFiles(join(ROOT, appDir))) {
    const text = readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const where = (n) => `${rel(file)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;

    // `onPress={handleSave}` is as common as an inline arrow, so the local
    // function has to be resolvable or half the handlers go unchecked.
    const locals = new Map();
    const collect = (n) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
        let init = n.initializer;
        if (ts.isCallExpression(init) && /useCallback/.test(init.expression.getText()) && init.arguments.length) {
          init = init.arguments[0];
        }
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) locals.set(n.name.text, init);
      }
      if (ts.isFunctionDeclaration(n) && n.name && n.body) locals.set(n.name.text, n);
      ts.forEachChild(n, collect);
    };
    collect(sf);

    const visit = (n) => {
      if (ts.isJsxAttribute(n) && n.name && HANDLER_PROP.test(n.name.getText())) {
        const init = n.initializer;
        if (init && ts.isJsxExpression(init) && init.expression) {
          controls++;
          const e = init.expression;
          let fn = null;
          if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) fn = e;
          else if (ts.isIdentifier(e) && locals.has(e.text)) fn = locals.get(e.text);
          if (fn && fn.body && ts.isBlock(fn.body)) {
            const body = fn.body.getText();
            /**
             * An empty handler is not automatically a bug.
             *
             * `onPress={() => {}}` on a modal sheet is the deliberate idiom for
             * swallowing a tap so it cannot reach the backdrop and close the
             * sheet the user is working in. What makes it a bug is announcing
             * it: with an `accessibilityRole`, a screen reader reads out the
             * whole sheet as a control, and activating it does nothing. So the
             * test is not "is it empty" but "is it empty AND advertised".
             */
            const announced = ts.isJsxAttributes(n.parent)
              ? n.parent.properties.some((a) => a.name && a.name.getText() === 'accessibilityRole')
              : false;
            if (fn.body.statements.length === 0 && announced) {
              findings.empty.push(`${where(n)} ${n.name.getText()} — empty, but announced as a control`);
            }
            if (/['"`][^'"`]*(coming soon|not implemented|not yet available)[^'"`]*['"`]/i.test(body)) {
              findings.placeholder.push(`${where(n)} — ${body.replace(/\s+/g, ' ').slice(0, 100)}`);
            }
          }
        }
      }

      if (ts.isCallExpression(n)) {
        const callee = n.expression;
        let isNav = false;
        if (ts.isPropertyAccessExpression(callee)) {
          isNav =
            NAV_METHOD.has(callee.name.text) && /^(router|navigation|nav)$/i.test(callee.expression.getText());
        } else if (ts.isIdentifier(callee)) isNav = NAV_FN.has(callee.text);
        if (isNav && n.arguments.length) {
          const a = unwrap(n.arguments[0]);
          let target = null;
          if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) target = a.text;
          else if (ts.isTemplateExpression(a)) {
            target = a.head.text + a.templateSpans.map((s) => '[x]' + s.literal.text).join('');
          } else if (ts.isObjectLiteralExpression(a)) {
            const p = a.properties.find((x) => x.name && x.name.getText() === 'pathname');
            const pv = p && p.initializer ? unwrap(p.initializer) : null;
            if (pv && (ts.isStringLiteral(pv) || ts.isNoSubstitutionTemplateLiteral(pv))) target = pv.text;
          }
          if (target && target.startsWith('/')) {
            resolvedNav++;
            hits.add(canonical(target));
            if (!matchRoute(table, target)) findings.deadRoute.push(`${where(n)} → ${target}`);
          }
        }
      }

      if (ts.isJsxAttribute(n) && n.name.getText() === 'href' && n.initializer) {
        let target = null;
        const i = n.initializer;
        if (ts.isStringLiteral(i)) target = i.text;
        else if (ts.isJsxExpression(i) && i.expression) {
          const v = unwrap(i.expression);
          if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) target = v.text;
        }
        if (target && target.startsWith('/')) {
          resolvedNav++;
          hits.add(canonical(target));
          if (!matchRoute(table, target)) findings.deadRoute.push(`${where(n)} href → ${target}`);
        }
      }

      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { controls, resolvedNav };
}

// ── RUN ─────────────────────────────────────────────────────────────────────

function main() {
  section('button wiring — navigation, api and handlers');

  const findings = { deadRoute: [], empty: [], placeholder: [] };
  let controls = 0;
  let resolvedNav = 0;

  const orphans = [];
  for (const appDir of APPS) {
    const table = routeTable(appDir);
    const hits = new Set();
    const r = scanApp(appDir, table, findings, hits);
    orphans.push(...orphanScreens(appDir, hits));
    controls += r.controls;
    resolvedNav += r.resolvedNav;
  }

  if (findings.deadRoute.length) {
    fail(
      'every navigation target has a screen behind it',
      'Expo Router fails silently on an unknown href — the tap does nothing and nothing is logged:\n    ' +
        findings.deadRoute.join('\n    '),
    );
  } else {
    pass('every navigation target has a screen behind it', `${resolvedNav} literal target(s)`);
  }

  if (orphans.length) {
    fail(
      'every screen is reachable from somewhere',
      'no button leads here, and these are not redirect stubs — a finished feature that has ' +
        'fallen off the app still compiles and still type-checks:\n    ' +
        orphans.join('\n    '),
    );
  } else {
    pass('every screen is reachable from somewhere', 'no stranded screens');
  }

  const strays = strayAdvanceCalls();
  if (strays.length) {
    fail(
      "the driver's trip advances from one place only",
      `only ${ADVANCE_OWNER} may map a status to an advance verb — every duplicate of this ` +
        'machine has drifted from its siblings:\n    ' + strays.join('\n    '),
    );
  } else {
    pass("the driver's trip advances from one place only", `${ADVANCE_VERBS.length} verbs, one owner`);
  }

  if (findings.empty.length) {
    fail('no control has an empty handler', findings.empty.join('\n    '));
  } else {
    pass('no control has an empty handler', `${controls} control(s) scanned`);
  }

  if (findings.placeholder.length) {
    fail(
      'no shipped control is a placeholder',
      'these tell the user the feature does not exist:\n    ' + findings.placeholder.join('\n    '),
    );
  } else {
    pass('no shipped control is a placeholder', 'no "coming soon" handlers');
  }

  // ── the API edge ──
  let routes;
  try {
    routes = expressRoutes();
  } catch (e) {
    fail('read the express route table', e.message);
    process.exit(summary());
  }

  if (routes.size < 50) {
    fail(
      'the express route table was parsed',
      `only ${routes.size} routes found — the parser has probably stopped matching, which would ` +
        'make every check below pass vacuously',
    );
  } else {
    pass('the express route table was parsed', `${routes.size} mounted route(s)`);
  }

  const calls = apiCalls();
  const missing = calls.filter((c) => !matchApi(routes, c.method, c.path));

  if (missing.length) {
    fail(
      'every API call the apps make hits a mounted route',
      'these 404 at runtime, and the apps render a 404 as a generic failure — so this rot is ' +
        'invisible in hand-testing:\n    ' +
        missing.map((m) => `${m.where}  ${m.method} ${m.path}`).join('\n    '),
    );
  } else {
    pass('every API call the apps make hits a mounted route', `${calls.length} call(s) resolved`);
  }

  info(`${controls} controls · ${calls.length} api calls · ${resolvedNav} literal nav targets`);
  process.exit(summary());
}

main();
