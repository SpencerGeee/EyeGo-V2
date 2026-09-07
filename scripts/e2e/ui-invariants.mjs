/**
 * ── THE PERFORMANCE RULES, ENFORCED AS RULES ────────────────────────────────
 *
 * "The driver app was super laggy" was not one bug. It was a default that 33
 * of 34 call sites had to remember to override, a device tier that could never
 * fire on iOS, and three blurs sitting over a live map. Every one of them was
 * invisible to `tsc`, invisible to the API harness, and would come back the
 * first time somebody copied a neighbouring screen.
 *
 * So they are pinned here instead. This suite reads SOURCE, not a server: it
 * needs no stack, no database and no device, and it runs in about a second.
 *
 *   node scripts/e2e/ui-invariants.mjs
 *
 * A failure here is not a style complaint. Each rule below is a defect that
 * was actually reported by somebody holding a phone.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { section, pass, fail, info, summary } from './lib.mjs';

/**
 * A SYNCHRONOUS `check`, deliberately not the one in lib.mjs.
 *
 * lib's version is async because every other suite awaits HTTP. Every rule
 * here reads a file off disk, so awaiting nothing would still return a promise
 * — and a `process.exit(summary())` that fires before those promises settle
 * reports one check and exits green with the rest unrun. That is a harness
 * that lies, which is worse than no harness.
 */
function check(what, fn) {
  try {
    const detail = fn();
    pass(what, typeof detail === 'string' ? detail : '');
    return true;
  } catch (e) {
    fail(what, e.message?.slice(0, 400));
    return false;
  }
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');
const read = (p) => readFileSync(p, 'utf8');

/** Every source file in an app, excluding its node_modules. */
function appFiles(app) {
  return [
    ...walk(join(ROOT, 'apps', app, 'app')),
    ...walk(join(ROOT, 'apps', app, 'components')),
    ...walk(join(ROOT, 'apps', app, 'hooks')),
    ...walk(join(ROOT, 'apps', app, 'utils')),
  ];
}

function main() {
  section('1 · one animated background in each app');

  /**
   * `AppBackground` renders a full-screen Skia raymarch, and `useShaderSlot`
   * hands the single live canvas to the most recently FOCUSED instance. So a
   * pushed screen that asks for `variant="animated"` takes the canvas and
   * starts raymarching — over the tracking map, over the dispatch offer, over
   * whatever the driver is actually trying to read.
   *
   * The default is now `'static'`, and exactly one mount per app opts in.
   */
  for (const app of ['rider', 'driver']) {
    check(`${app}: exactly one <AppBackground variant="animated">`, () => {
      const hits = [];
      for (const f of appFiles(app)) {
        const src = read(f);
        const re = /<AppBackground[^>]*variant\s*=\s*["'{]?\s*animated/g;
        if (re.test(src)) hits.push(rel(f));
      }
      if (hits.length === 0) {
        throw new Error(
          'no animated background at all — the app has lost its ambient shader entirely and every screen ' +
            'will render a frozen frame.',
        );
      }
      if (hits.length > 1) {
        throw new Error(
          `${hits.length} animated backgrounds: ${hits.join(', ')}. Only the root layout may animate — ` +
            'see the note on AppBackgroundProps and shaderSlot.ts.',
        );
      }
      if (!/app\/_layout\.tsx$/.test(hits[0])) {
        throw new Error(`the animated background is in ${hits[0]}, not the root layout`);
      }
      return hits[0];
    });
  }

  check("AppBackground's default variant is 'static'", () => {
    const src = read(join(ROOT, 'packages', 'ui', 'src', 'effects', 'AppBackground.tsx'));
    if (!/variant\s*=\s*'static'/.test(src)) {
      throw new Error(
        "the default is not 'static'. It was 'animated', and the driver app never overrode it on any of " +
          'its 34 mounts — which is the whole of the reported lag.',
      );
    }
    return "default = 'static'";
  });

  section('2 · the device tier can actually fire');

  /**
   * The tier only ever degraded on Android API < 31, so every iPhone — an
   * iPhone 12 included — was handed the full raymarch budget, the 30fps clock
   * and full noise. It is now measured, and there is a 'mid' rung between the
   * two extremes for a device that is merely working hard.
   */
  const tierSrc = read(join(ROOT, 'packages', 'ui', 'src', 'effects', 'usePerformanceTier.ts'));

  check("a 'mid' tier exists", () => {
    if (!/'high'\s*\|\s*'mid'\s*\|\s*'low'/.test(tierSrc)) {
      throw new Error(
        "PerformanceTier has no 'mid' rung. AppBackground and LightPillarBackground both branch on " +
          "`tier === 'high'` to pick a cheaper setting, and without 'mid' that branch is unreachable.",
      );
    }
    return "'high' | 'mid' | 'low'";
  });

  check('the tier is measured, not assumed from the platform alone', () => {
    if (!/requestAnimationFrame/.test(tierSrc)) {
      throw new Error(
        'no frame probe. Without one the tier is a guess, and on iOS the guess was always "high" — the ' +
          'iPhone 12 in the report got the same budget as the newest hardware.',
      );
    }
    if (!/AppState/.test(tierSrc)) {
      throw new Error(
        'the probe does not watch AppState. A backgrounded app produces enormous frame gaps and would be ' +
          'misread as a catastrophically slow device.',
      );
    }
    return 'rAF probe, AppState-guarded';
  });

  check('the probe can only lower the tier, never raise it', () => {
    if (!/ceiling/.test(tierSrc)) {
      throw new Error(
        'no ceiling. An Android device pinned to `low` by its API level must not be able to measure its ' +
          'way back up to a full-screen raymarch.',
      );
    }
    return 'downgrade-only';
  });

  section("3 · 'mid' is actually cheaper than 'high'");

  const cheaper = [
    ['LightPillarBackground.tsx', /tier === 'high' \? EFFECT_HIGH : EFFECT_LOW/, 'the cheap raymarch kernel'],
    ['GlassSurface.tsx', /tier === 'high' \? intensity : 'low'/, 'reduced blur'],
    ['GradientGlowBorder.tsx', /tier !== 'high'/, 'no ring rotation'],
  ];
  for (const [file, re, what] of cheaper) {
    check(`${file}: 'mid' gets ${what}`, () => {
      const src = read(join(ROOT, 'packages', 'ui', 'src', 'effects', file));
      if (!re.test(src)) {
        throw new Error(
          `this still branches only on 'low', so a 'mid' device pays the full 'high' cost — the tier ` +
            'exists but buys nothing.',
        );
      }
      return what;
    });
  }

  section('4 · no raw blur over a live map');

  /**
   * A blur samples whatever is behind it, so a blur over a MapView being panned
   * by GPS is recomputed on every frame for the whole trip. `ChromeBlur` drops
   * to a flat fill below the top tier; a raw `<BlurView>` cannot.
   */
  const MAP_SCREENS = [
    'apps/driver/app/(trip)/tracking/[id].tsx',
    'apps/driver/app/(trip)/dispatch/[id].tsx',
    'apps/driver/app/(tabs)/_layout.tsx',
  ];
  for (const f of MAP_SCREENS) {
    check(`${f}: no raw <BlurView>`, () => {
      let src;
      try {
        src = read(join(ROOT, f));
      } catch {
        info(`${f} not found — skipped`);
        return 'skipped';
      }
      if (/<BlurView/.test(src)) {
        throw new Error(
          'a raw <BlurView> sits over a live map. It bypasses the performance tier entirely, so it runs at ' +
            'full strength on every device. Use ChromeBlur.',
        );
      }
      return 'clean';
    });
  }

  section('5 · the dispatch screen lets the driver see the map');

  check('the top chrome auto-hides', () => {
    const src = read(join(ROOT, 'apps/driver/app/(trip)/dispatch/[id].tsx'));
    if (!/chromeVisible/.test(src) || !/wakeChrome/.test(src)) {
      throw new Error(
        'the back control, the "Held for you" pill and their scrim are permanent again. They sit over the ' +
          'narrow strip of map the driver has ~45s to read.',
      );
    }
    return 'fades on idle, returns on map interaction';
  });

  check('the offer card itself does NOT auto-hide', () => {
    const src = read(join(ROOT, 'apps/driver/app/(trip)/dispatch/[id].tsx'));
    // The card is rendered under `offer ?`, never under the chrome flag.
    if (/chromeVisible\s*&&[\s\S]{0,400}<DispatchOfferCard/.test(src)) {
      throw new Error(
        'the offer card is gated on the chrome timer. Hiding the thing the driver is deciding about is a ' +
          'worse bug than the crowding it was meant to fix.',
      );
    }
    return 'always visible';
  });

  section('6 · the party size reaches the quote');

  check('RequestStage quotes with the same seat count it requests', () => {
    const src = read(join(ROOT, 'apps/rider/components/trip/stages/RequestStage.tsx'));
    if (!/const chosenSeats\s*=/.test(src)) {
      throw new Error('no single `chosenSeats` value — the quote and the request can drift apart again.');
    }
    const quoteCall = src.match(/ridesApi\.quote\(\{[\s\S]*?\}\)/);
    if (!quoteCall || !/seatCount/.test(quoteCall[0])) {
      throw new Error(
        'the quote is sent WITHOUT seatCount, so the server signs a party of one while the request sends ' +
          'the real number. Every party of 2+ 409s as FARE_EXPIRED — "Couldn\'t request ride".',
      );
    }
    return 'quote and request share `chosenSeats`';
  });

  section('7 · Scan & Pay pays');

  check('a scanned trip code goes to the pay sheet, not the booking screen', () => {
    const src = read(join(ROOT, 'apps/rider/app/profile/scan-pay.tsx'));
    const tripBranch = src.match(/parsed\.kind === 'trip'[\s\S]{0,1400}?\n {4}\}/);
    if (!tripBranch) throw new Error("could not find the 'trip' branch of handleScan");
    if (!/\/pay\/trip\/\[id\]/.test(tripBranch[0])) {
      throw new Error(
        "a driver's trip code does not route to /pay/trip/[id]. If it goes to /ride/[id] the feature is a " +
          'booking flow with a camera in front of it, which is the reported bug.',
      );
    }
    return 'routes to /pay/trip/[id]';
  });

  check('the pay sheet exists and charges exactly once', () => {
    const p = join(ROOT, 'apps/rider/app/pay/trip/[id].tsx');
    let src;
    try {
      src = read(p);
    } catch {
      throw new Error('apps/rider/app/pay/trip/[id].tsx is missing — the scanner routes nowhere.');
    }
    if (!/bookingsApi\.create/.test(src) || !/paymentsApi\.initialize/.test(src)) {
      throw new Error('the sheet does not both book a seat and charge for it');
    }
    // A Pay button that can be pressed twice is two seats and two charges.
    if (!/disabled=\{paying \|\| paid\}/.test(src)) {
      throw new Error('the Pay button is not disabled once pressed — it can charge twice');
    }
    // Back must not return to a live Pay button.
    if (!/router\.replace/.test(src)) {
      throw new Error('the sheet pushes instead of replacing, so Back returns to a Pay button that charges again');
    }
    return 'books, charges, disables, replaces';
  });

  section('8 · the rider is told how far away the driver is');

  check('SearchingPanel takes and renders an ETA', () => {
    const src = read(join(ROOT, 'apps/rider/components/trip/SearchingPanel.tsx'));
    if (!/etaSeconds\?: number \| null/.test(src)) {
      throw new Error('SearchingPanel has no etaSeconds prop');
    }
    if (!/min away/.test(src)) {
      throw new Error(
        '"asking driver 2 of 5" says the search is moving but not whether it is moving towards anything ' +
          'worth waiting for. The ETA is the part a rider can act on.',
      );
    }
    return 'renders "N min away"';
  });

  check('RequestStage passes the ETA the server already sends', () => {
    const src = read(join(ROOT, 'apps/rider/components/trip/stages/RequestStage.tsx'));
    if (!/etaSeconds=\{dispatch\?\.etaSeconds/.test(src)) {
      throw new Error(
        'the ETA is on every DISPATCH_PROGRESS frame and in the store, but nothing passes it to the panel.',
      );
    }
    return 'wired';
  });

  process.exit(summary());
}

main();
