/**
 * ── THE FLUIDITY RULES, ENFORCED WITH A PARSER ──────────────────────────────
 *
 * "Make it such that when the user opens the app, every animation, effect or
 * transition is butter fluid."
 *
 * None of the things that were actually costing frames were animations. They
 * were always-on work: loops nobody cancelled, device sensors subscribed once
 * per mounted component, and a poll writing new object identities into a store
 * twice a second. Every one was invisible to `tsc`, invisible to the API
 * harness, and every one would come back the first time somebody copied a
 * neighbouring file.
 *
 * So they are pinned here. Like `conditional-hooks.mjs`, this walks the
 * TypeScript AST rather than matching patterns: the difference between a
 * `withRepeat` that is cancelled and one that is not is a question about
 * scopes, and a regex cannot answer it. Reads source only — no stack, no
 * device.
 *
 *   node scripts/e2e/motion-invariants.mjs
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { section, pass, fail, summary } from './lib.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ts = require(join(ROOT, 'node_modules', 'typescript'));

const SCAN_ROOTS = ['apps/driver', 'apps/rider', 'packages/ui/src'];
const SKIP = new Set(['node_modules', '.expo', 'android', 'ios', 'dist', '.next', 'build']);

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

const parse = (file) =>
  ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

const rel = (f) => relative(ROOT, f).replace(/\\/g, '/');

/** Is this call `withRepeat(x, -1, ...)` — i.e. genuinely infinite? */
function isInfiniteRepeat(node) {
  if (!ts.isCallExpression(node)) return false;
  const e = node.expression;
  const name = ts.isIdentifier(e) ? e.text : null;
  if (name !== 'withRepeat') return false;
  const arg = node.arguments[1];
  if (!arg) return false;
  // -1 parses as a prefix minus on the literal 1.
  return (
    ts.isPrefixUnaryExpression(arg) &&
    arg.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(arg.operand) &&
    arg.operand.text === '1'
  );
}

function containsCall(node, fnName) {
  let found = false;
  (function rec(n) {
    if (found) return;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === fnName) {
      found = true;
      return;
    }
    n.forEachChild(rec);
  })(node);
  return found;
}

/**
 * RULE 1 — an endless loop must be cancelled by the effect that started it.
 *
 * A `-1` repeat is a UI-thread frame callback that Reanimated keeps driving
 * until something cancels it. Unmounting the component does NOT: the loop goes
 * on running, invisibly, for the rest of the session. Two of these were live —
 * the onboarding glow and four in the rider splash — and the splash's got worse
 * when it became an overlay over a booting app rather than a screen instead of
 * one.
 */
function endlessLoopsWithoutCancel(file) {
  const sf = parse(file);
  const bad = [];
  (function visit(node) {
    // Only effects can own a cleanup, so that is the unit we check.
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === 'useEffect' || node.expression.text === 'useLayoutEffect')
    ) {
      const body = node.arguments[0];
      if (body && (ts.isArrowFunction(body) || ts.isFunctionExpression(body))) {
        if (containsRepeat(body) && !containsCall(body, 'cancelAnimation')) {
          bad.push(sf.getLineAndCharacterOfPosition(node.getStart()).line + 1);
        }
      }
    }
    node.forEachChild(visit);
  })(sf);
  return bad;

  function containsRepeat(n) {
    let found = false;
    (function rec(x) {
      if (found) return;
      if (isInfiniteRepeat(x)) {
        found = true;
        return;
      }
      x.forEachChild(rec);
    })(n);
    return found;
  }
}

/**
 * RULE 2 — device sensors are acquired once for the app, not once per component.
 *
 * `watchPositionAsync` and `watchHeadingAsync` each open a hardware subscription.
 * They lived inside `useDriverLocation`'s component body, and three mounted
 * consumers — home (a tab, mounted all session), active and tracking — meant
 * three GPS subscriptions and three compass subscriptions on one device. Because
 * the position handler also emits to the socket, the driver reported their
 * location to the server twice for every fix.
 *
 * The fix was a ref-counted module-scope resource (`sharedWatch`,
 * `compassSub`). This keeps it that way: these calls may appear only in
 * module-scope functions, never inside a hook or a component.
 */
const SENSOR_CALLS = new Set(['watchPositionAsync', 'watchHeadingAsync', 'startLocationUpdatesAsync']);

/**
 * Deliberate exceptions, each with a reason. Narrow on purpose.
 *
 * The rule exists because a HOOK that several mounted screens call ends up with
 * one hardware subscription per screen. A single screen that mounts once, owns
 * its subscription and tears it down on unmount is not that, and wrapping it in
 * a ref-counted shared resource would add indirection with nothing to share it
 * with.
 *
 *   sos.tsx — the emergency screen streams a high-frequency fine position for
 *   as long as it is open. It is the only rider surface that watches position,
 *   it cannot be mounted twice, and its watcher is removed in the same effect's
 *   cleanup. Making it shared would mean building a rider-side location layer
 *   whose only consumer is this screen.
 */
const SENSOR_EXEMPT = new Map([
  ['apps/rider/app/ride/[id]/sos.tsx', 'single-mount emergency stream; sole rider position consumer'],
]);

function sensorsInsideComponents(file) {
  const sf = parse(file);
  const bad = [];
  // Walk with a stack of enclosing function names so we know whether a call
  // sits inside a component/hook or in a plain module-scope helper.
  (function visit(node, holder) {
    let next = holder;
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
      let name = node.name && ts.isIdentifier(node.name) ? node.name.text : null;
      if (!name && node.parent && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
        name = node.parent.name.text;
      }
      // A component or hook OWNS its scope; anything nested inside it inherits.
      if (name && (/^use[A-Z]/.test(name) || /^[A-Z]/.test(name))) next = name;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.name) &&
      SENSOR_CALLS.has(node.expression.name.text) &&
      next // inside a component or hook rather than a module-scope helper
    ) {
      bad.push(`${node.expression.name.text} inside ${next}() on line ${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
    }
    node.forEachChild((c) => visit(c, next));
  })(sf, null);
  return bad;
}

function main() {
  section('motion invariants');

  const files = SCAN_ROOTS.flatMap((r) => sourceFiles(join(ROOT, r)));

  const loopOffenders = [];
  const sensorOffenders = [];
  for (const f of files) {
    for (const line of endlessLoopsWithoutCancel(f)) {
      loopOffenders.push(`${rel(f)}  useEffect on line ${line}`);
    }
    if (SENSOR_EXEMPT.has(rel(f))) continue;
    for (const hit of sensorsInsideComponents(f)) {
      sensorOffenders.push(`${rel(f)}  ${hit}`);
    }
  }

  if (loopOffenders.length) {
    fail(
      'an endless animation is cancelled by the effect that started it',
      'withRepeat(..., -1) is a UI-thread frame callback that outlives unmount unless cancelled, so it ' +
        'runs for the rest of the session behind whatever the user does next:\n    ' +
        loopOffenders.join('\n    ') +
        '\n  Add `return () => cancelAnimation(value)` to the effect.',
    );
  } else {
    pass('an endless animation is cancelled by the effect that started it', `${files.length} files parsed`);
  }

  if (sensorOffenders.length) {
    fail(
      'device sensors are acquired once for the app, not once per component',
      'each of these opens a hardware subscription, and the hook that owns them mounts on several screens ' +
        'at once — so the device ends up with one subscription per mounted consumer:\n    ' +
        sensorOffenders.join('\n    ') +
        '\n  Move it to a module-scope, ref-counted resource (see `sharedWatch` in useDriverLocation).',
    );
  } else {
    pass('device sensors are acquired once for the app, not once per component', 'no per-component sensor subscriptions');
  }

  process.exit(summary());
}

main();
