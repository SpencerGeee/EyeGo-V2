/**
 * ── NO CONDITIONAL HOOKS. ENFORCED WITH A PARSER, NOT A REGEX ───────────────
 *
 * THE BUG THIS EXISTS FOR: "I tried creating a trip on the driver app and it's
 * telling me something went wrong and that it rendered more hooks than during
 * the previous render… opening the new manage trip page and the tracking page
 * throws that error."
 *
 * The cause was one line. `apps/driver/app/(trip)/active/[id].tsx` called
 * `useTripStops(trip)` about 115 lines BELOW its `if (isLoading || !trip)`
 * loading guard. That is a conditional hook, and it fires on the most ordinary
 * path the screen has:
 *
 *   render 1  query loading → the guard returns the skeleton, React records N
 *             hooks for this component;
 *   render 2  the trip arrives → the guard no longer fires, execution reaches
 *             `useTripStops`, React counts N+1 and throws.
 *
 * Nothing about it was intermittent. It only looked that way because a warm
 * cache skips render 1 entirely.
 *
 * ── WHY A PARSER ────────────────────────────────────────────────────────────
 *
 * This defect was hunted with THREE separate regex passes before it was found,
 * and all three reported the codebase clean. Regex cannot do it, because
 * telling a component's `return` apart from a `return` inside a `useMemo`
 * callback or an effect cleanup requires knowing the scope you are in — which
 * is exactly what a parser has and a pattern does not. The first two passes
 * missed it by only looking at one brace depth; relaxing that produced 82
 * hits, ~80 of them `return () => {…}` cleanups.
 *
 * So this walks the TypeScript AST, which the repo already depends on. It
 * refuses to descend into nested function expressions, so a hook inside a
 * callback is correctly ignored, and a `return` inside one is not mistaken for
 * the component's own.
 *
 *   node scripts/e2e/conditional-hooks.mjs
 *
 * Needs no stack, no database and no device.
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
const SKIP_DIRS = new Set(['node_modules', '.expo', 'android', 'ios', 'dist', '.next', 'build']);

function sourceFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) sourceFiles(p, acc);
    } else if (/\.tsx?$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const isHook = (n) => /^use[A-Z]/.test(n);

/** Every hook called conditionally, or after the component can already return. */
function violationsIn(file) {
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found = [];
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;

  function nameOf(node) {
    if (node.name && ts.isIdentifier(node.name)) return node.name.text;
    const p = node.parent;
    if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
    return null;
  }

  function analyse(fn, name) {
    const body = fn.body;
    if (!body || !ts.isBlock(body)) return;
    let firstReturn = null;

    // Hooks inside `node`, WITHOUT descending into nested functions — those
    // have their own hook scope and their own rules.
    function hooksIn(node, conditional) {
      const isNestedFn = (n) =>
        ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n);
      (function rec(n) {
        if (n !== node && isNestedFn(n)) return;
        if (ts.isCallExpression(n)) {
          const e = n.expression;
          const nm = ts.isIdentifier(e)
            ? e.text
            : ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name)
              ? e.name.text
              : null;
          if (nm && isHook(nm)) {
            const line = lineOf(n);
            if (conditional) found.push({ name, line, nm, why: 'called inside a branch or loop' });
            else if (firstReturn !== null && line > firstReturn)
              found.push({ name, line, nm, why: `called after the return on line ${firstReturn}` });
          }
        }
        n.forEachChild(rec);
      })(node);
    }

    function statements(list) {
      for (const st of list) {
        if (ts.isReturnStatement(st) && firstReturn === null) firstReturn = lineOf(st);
        if (ts.isIfStatement(st)) {
          for (const branch of [st.thenStatement, st.elseStatement].filter(Boolean)) {
            if (ts.isBlock(branch)) statements(branch.statements);
            else if (ts.isReturnStatement(branch) && firstReturn === null) firstReturn = lineOf(branch);
            else hooksIn(branch, true);
          }
          continue;
        }
        if (
          ts.isForStatement(st) || ts.isForOfStatement(st) ||
          ts.isForInStatement(st) || ts.isWhileStatement(st) || ts.isDoStatement(st)
        ) {
          hooksIn(st, true);
          continue;
        }
        hooksIn(st, false);
      }
    }
    statements(body.statements);
  }

  (function visit(node) {
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
      const n = nameOf(node);
      // Components (PascalCase) and custom hooks (useX) are the two kinds of
      // function React's rules apply to.
      if (n && (/^[A-Z]/.test(n) || isHook(n))) analyse(node, n);
    }
    node.forEachChild(visit);
  })(sf);

  return found;
}

function main() {
  section('conditional hooks');

  const files = SCAN_ROOTS.flatMap((r) => sourceFiles(join(ROOT, r)));
  const offenders = [];
  for (const f of files) {
    for (const v of violationsIn(f)) {
      offenders.push(`${relative(ROOT, f).replace(/\\/g, '/')}  ${v.name}() → ${v.nm}() on line ${v.line}, ${v.why}`);
    }
  }

  if (offenders.length) {
    fail(
      'every hook runs on every render',
      'React counts hooks per render and throws "rendered more hooks than during the previous render" the ' +
        'first time the count changes. That crash is what the driver saw opening manage-trip and tracking:\n    ' +
        offenders.join('\n    ') +
        '\n  Move the hook ABOVE the guard. Hooks are cheap; a hook that runs one frame early costs nothing.',
    );
  } else {
    pass('every hook runs on every render', `${files.length} files parsed, no conditional hooks`);
  }

  process.exit(summary());
}

main();
