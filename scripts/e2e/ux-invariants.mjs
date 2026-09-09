/**
 * ── THE UX RULES THAT CAN BE PROVED ─────────────────────────────────────────
 *
 * A UX audit found four candidate defect classes. Only three of them survived
 * being checked by hand, and only those three are here.
 *
 * The other two are worth writing down as NON-rules, because they looked like
 * findings and were not:
 *
 *   "Alert.alert should be notify()"  — 19 of the 20 call sites pass a buttons
 *   array, i.e. they are real confirmation dialogs, which is exactly what
 *   Alert is for. Only one was informational. A rule here would have failed 19
 *   correct screens.
 *
 *   "screens with TextInput handle the keyboard" — `KeyboardProvider`
 *   (react-native-keyboard-controller) is mounted at the root of BOTH apps, so
 *   the 14 flagged screens are already covered globally.
 *
 * A harness that cries wolf gets ignored, and an ignored harness is worse than
 * no harness — so a rule earns its place by having been verified against the
 * real code first, and by failing on the pre-fix version of it.
 *
 *   node scripts/e2e/ux-invariants.mjs
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { section, pass, fail, summary } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCAN_ROOTS = ['apps/driver', 'apps/rider'];
const SKIP = new Set(['node_modules', '.expo', 'android', 'ios', 'dist', '.next', 'build']);

function screens(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) screens(p, acc);
    } else if (e.name.endsWith('.tsx')) acc.push(p);
  }
  return acc;
}

const rel = (f) => relative(ROOT, f).replace(/\\/g, '/');
const files = SCAN_ROOTS.flatMap((r) => screens(join(ROOT, r)));
const read = (f) => readFileSync(f, 'utf8');

function main() {
  section('ux invariants');

  /**
   * RULE 1 — A FAILED REQUEST MUST NOT BE RENDERED AS "YOU HAVE NOTHING".
   *
   * THE BUGS THIS EXISTS FOR, all three shipped:
   *   trips.tsx           "No upcoming trips"      on a failed history load
   *   scheduled-rides.tsx "No scheduled rides yet" on a failed intents load
   *   pay/trip/[id].tsx   "That code has expired"  on a failed trip load
   *
   * The last is the clearest: a rider standing in front of a driver was told
   * the driver's QR code was invalid, because the request had failed and
   * `!trip` was true for both reasons. A blank screen looks broken; a confident
   * wrong answer gets believed.
   *
   * The mechanism is always the same — `isLoading ? … : isEmpty ? …` with no
   * branch for failure — so the rule is: a screen that renders an EmptyState
   * from query-backed data has to know the difference. `QueryBoundary` counts,
   * because checking error before empty is the whole of what it does.
   */
  const liars = files.filter((f) => {
    const s = read(f);
    if (!/useQuery\(/.test(s)) return false;
    if (!/<EmptyState/.test(s)) return false;
    return !/isError|isLoadingError|QueryBoundary/.test(s);
  });

  if (liars.length) {
    fail(
      'a failed request is never rendered as "you have nothing"',
      'these screens show an EmptyState from data a query provided, but never check whether the query ' +
        'FAILED — so a dropped connection is reported to the user as an empty history, an empty ' +
        'schedule, or an expired code:\n    ' +
        liars.map(rel).join('\n    ') +
        '\n  Wrap the content in <QueryBoundary> (it checks error before empty) or branch on isError first.',
    );
  } else {
    pass('a failed request is never rendered as "you have nothing"', `${files.length} screens parsed`);
  }

  /**
   * RULE 2 — AN ICON ON ITS OWN IS NOT A LABEL.
   *
   * A control whose only content is a glyph reads to a screen reader as
   * "button" and nothing else. The HIG minimum is that every control says what
   * it does; for icon-only controls the accessibilityLabel IS that sentence.
   *
   * Deliberately narrow: only Pressables whose subtree has an icon and NO text.
   * A button with a visible word already announces itself.
   */
  const unlabeled = [];
  for (const f of files) {
    const blocks = [...read(f).matchAll(/<Pressable\b(?:(?!<\/Pressable>)[\s\S])*?<\/Pressable>/g)].map((m) => m[0]);
    for (const b of blocks) {
      if (!/<Ionicons|<MaterialCommunityIcons|<Feather/.test(b)) continue;
      if (/<Text|children/.test(b)) continue;
      if (/accessibilityLabel/.test(b)) continue;
      unlabeled.push(rel(f));
      break;
    }
  }

  if (unlabeled.length) {
    fail(
      'an icon-only control says what it does',
      'a Pressable containing only a glyph announces itself as "button" and nothing else:\n    ' +
        unlabeled.join('\n    ') +
        '\n  Add accessibilityLabel.',
    );
  } else {
    pass('an icon-only control says what it does', 'every icon-only Pressable carries a label');
  }

  /**
   * RULE 3 — TEXT SCALES WITH THE SYSTEM SETTING.
   *
   * `allowFontScaling={false}` opts a string out of Dynamic Type. It is
   * normally reached for to stop a layout breaking, which trades a visual
   * problem for an accessibility one: a rider who has set large text because
   * they need it does not get it, and there is no way for them to notice why.
   *
   * Currently zero — the rule exists to keep it that way, because it is exactly
   * the fix someone reaches for under deadline when a fare overflows its row.
   */
  const noScale = files.filter((f) => /allowFontScaling=\{false\}/.test(read(f)));

  if (noScale.length) {
    fail(
      'text scales with the system setting',
      'allowFontScaling={false} opts these out of Dynamic Type, so a user who needs large text does not ' +
        'get it:\n    ' +
        noScale.map(rel).join('\n    ') +
        '\n  Fix the layout instead — numberOfLines, adjustsFontSizeToFit, or a taller row.',
    );
  } else {
    pass('text scales with the system setting', 'no allowFontScaling={false}');
  }

  process.exit(summary());
}

main();
