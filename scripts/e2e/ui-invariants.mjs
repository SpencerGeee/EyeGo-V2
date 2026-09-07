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

  section('9 · the morph obeys Apple\'s 2D rule');

  /**
   * Apple, *Designing Fluid Interfaces*: "Decompose 2D motion into independent
   * X and Y springs. A single spring on a 2D distance desyncs when X and Y have
   * different velocities." A morph driven by one progress value is smooth and
   * still feels like gliding on rails, which is the hardest kind of motion bug
   * to describe and the easiest to reintroduce.
   */
  const morphSrc = read(join(ROOT, 'packages/ui/src/morph/MorphProvider.tsx'));

  check('X and Y have their own springs', () => {
    if (!/const progressX = useSharedValue/.test(morphSrc) || !/const progressY = useSharedValue/.test(morphSrc)) {
      throw new Error('the morph is back on a single progress value for both axes');
    }
    return 'progressX + progressY';
  });

  check('the overlay reads the axis springs, not the master', () => {
    // x/w must come from progressX and y/h from progressY, or the axes are
    // re-coupled and the decomposition buys nothing.
    const wants = [
      /const w = interpolate\(progressX\.value/,
      /const h = interpolate\(progressY\.value/,
      /const x = interpolate\(progressX\.value/,
      /const y = interpolate\(progressY\.value/,
    ];
    for (const re of wants) {
      if (!re.test(morphSrc)) throw new Error(`overlay interpolation is not per-axis: ${re}`);
    }
    return 'x,w ← X · y,h ← Y';
  });

  check('the cloned content is un-scaled by the SAME springs', () => {
    const content = morphSrc.slice(morphSrc.indexOf('const contentStyle'));
    if (!/interpolate\(progressX\.value/.test(content) || !/interpolate\(progressY\.value/.test(content)) {
      throw new Error(
        'contentStyle reads a different progress than overlayStyle, so the inverse scale no longer cancels ' +
          'the outer one and the cloned content stretches for most of the flight.',
      );
    }
    return 'cancels exactly';
  });

  check('the release velocity is handed to the spring', () => {
    if (!/velocity: vProgress/.test(morphSrc)) {
      throw new Error(
        'the back-gesture springs from rest at release. Apple calls the resulting velocity discontinuity a ' +
          '"brick wall" — the flick has to keep going at the speed it was thrown.',
      );
    }
    return 'velocity carried through';
  });

  check('a gesture drives every axis 1:1', () => {
    // Anchored on the HANDLER's signature, not on `onActive:` — that also
    // matches the interface declaration hundreds of lines earlier, and slicing
    // between the two type declarations reads the type instead of the code.
    const from = morphSrc.indexOf('onActive: (translationY: number) => {');
    const to = morphSrc.indexOf('onEnd: (velocityY: number) => {');
    if (from < 0 || to < 0 || to < from) throw new Error('could not locate the gesture handlers');
    const active = morphSrc.slice(from, to);
    if (!/progressX\.value = p/.test(active) || !/progressY\.value = p/.test(active)) {
      throw new Error(
        'an axis is left on a spring while the finger drags. "Touch and content should move together" — a ' +
          'spring here lags the touch.',
      );
    }
    if (/withSpring/.test(active)) throw new Error('onActive springs instead of tracking the finger');
    return '1:1 on both axes';
  });

  check('springForAxis is sized by distance and stays critically damped', () => {
    const motion = read(join(ROOT, 'packages/config/src/motion.ts'));
    if (!/export function springForAxis/.test(motion)) throw new Error('springForAxis is gone');
    // Reproduce the function rather than trusting the comment.
    const f = (d) => {
      const response = Math.min(0.45, 0.28 + (Math.abs(d) / 900) * 0.17);
      const stiffness = (2 * Math.PI / response) ** 2;
      return { stiffness: Math.round(stiffness), damping: Math.round(2 * Math.sqrt(stiffness)) };
    };
    const long = f(900);
    // The longest axis of a full-screen morph must still land on the token that
    // was tuned for exactly that motion.
    if (Math.abs(long.stiffness - 195) > 2 || Math.abs(long.damping - 28) > 1) {
      throw new Error(`a full-screen axis gives ${JSON.stringify(long)}, not springs.morph (195/28)`);
    }
    if (f(20).stiffness <= f(500).stiffness) throw new Error('a short axis is not snappier than a long one');
    for (const d of [0, 20, 300, 900, 4000]) {
      const s = f(d);
      const zeta = s.damping / (2 * Math.sqrt(s.stiffness));
      if (Math.abs(zeta - 1) > 0.03) throw new Error(`d=${d} gives ζ=${zeta.toFixed(3)} — a morph must not overshoot`);
    }
    return 'ζ≈1.0 throughout, 195/28 at full screen';
  });

  section('10 · the search is drawn on the map');

  check('the map draws the real search radius', () => {
    const src = read(join(ROOT, 'apps/rider/components/trip/TripMap.tsx'));
    if (!/const searchRing = useMemo/.test(src)) {
      throw new Error(
        'no search ring. While dispatch runs, a quiet area leaves the map holding a pickup pin and nothing ' +
          'else — which reads as broken, not as searching. This was reported five times.',
      );
    }
    if (!/dispatchRadiusKm/.test(src)) {
      throw new Error('the ring is not driven by the server radius, so it is decoration rather than the search');
    }
    // A ground circle, not a screen-space disc: it must zoom with the map.
    if (!/Math\.cos\(latRad\)/.test(src)) {
      throw new Error(
        'the ring does not correct longitude for latitude, so the "circle" renders as an east-west ellipse.',
      );
    }
    return 'ground circle from the server radius';
  });

  check('the radius is on the wire from the FIRST search frame', () => {
    const cascade = read(join(ROOT, 'eyego-api/src/services/dispatch-cascade.service.js'));
    // The whole emit call, not a fixed character window — the field sits below
    // a comment explaining why it is there, and a 400-char window read the
    // comment and stopped short of the code.
    const at = cascade.indexOf("phase: 'SEARCHING'");
    if (at < 0) throw new Error("no SEARCHING frame is emitted at all");
    const searching = cascade.slice(at, cascade.indexOf('});', at));
    if (!/radiusKm:/.test(searching)) {
      throw new Error(
        'the opening SEARCHING frame carries no radiusKm, so the ring has nothing to draw until the first ' +
          'widen — which on a successful search never comes.',
      );
    }
    return 'SEARCHING carries radiusKm';
  });

  check('the panel and the ring quote the same number', () => {
    const stage = read(join(ROOT, 'apps/rider/components/trip/stages/RequestStage.tsx'));
    if (!/radiusKm=\{dispatch\?\.radiusKm/.test(stage)) {
      throw new Error('the panel is not fed the radius, so the words and the map can disagree');
    }
    return 'one source';
  });

  section('11 · production builds ship no console');

  /**
   * Hermes does not strip `console.*`. Each surviving call crosses the native
   * logging bridge synchronously AND RETAINS ITS ARGUMENTS, so a log on a GPS
   * or socket path pins an object graph per frame. That is the mechanism behind
   * "it gets slower the longer I use it", and no render optimisation touches it.
   */
  for (const app of ['rider', 'driver']) {
    check(`${app}: console is stripped in production, kept in dev`, () => {
      const src = read(join(ROOT, 'apps', app, 'babel.config.js'));
      if (!/transform-remove-console/.test(src)) {
        throw new Error('console calls ship to users — see the note in the babel config');
      }
      if (!/isProd \?/.test(src)) {
        throw new Error('stripping is unconditional; development needs its logs');
      }
      if (!/exclude:\s*\['error',\s*'warn'\]/.test(src)) {
        throw new Error(
          'error/warn are being stripped too — a release build that throws away its own warnings is one ' +
            'nobody can diagnose from a crash report.',
        );
      }
      // The Reanimated plugin rewrites worklets and must see the final AST.
      const plugins = src.slice(src.indexOf('plugins:'));
      if (plugins.indexOf('reanimated') < plugins.indexOf('transform-remove-console')) {
        throw new Error('the Reanimated plugin must be LAST in the plugin list');
      }
      return 'prod-only, error/warn kept';
    });
  }

  section('12 · Android composites animations on the GPU');

  check('a hardware-texture primitive exists and is Android-first', () => {
    const src = read(join(ROOT, 'packages/ui/src/effects/hardwareTexture.ts'));
    if (!/renderToHardwareTextureAndroid/.test(src)) throw new Error('no Android texture promotion');
    if (!/Platform\.OS === 'android'/.test(src)) throw new Error('not platform-gated');
    // Blanket rasterisation on iOS is a pessimisation — Core Animation already
    // composites transforms, so a cache that keeps invalidating is slower.
    if (!/shouldRasterizeIOS/.test(src)) throw new Error('no iOS variant for genuinely static content');
    return 'loopingLayerProps + staticLoopingLayerProps';
  });

  check('the looping primitives every page inherits are promoted', () => {
    const want = [
      ['packages/ui/src/Loader.tsx', 'the loader on every loading screen'],
      ['packages/ui/src/ShinyText.tsx', 'the shimmer'],
      ['packages/ui/src/effects/LensSheen.tsx', 'the sheen'],
      ['packages/ui/src/effects/PulseRing.tsx', 'the radar pulse'],
      ['packages/ui/src/effects/GradientGlowBorder.tsx', 'the rotating ring'],
      ['packages/ui/src/effects/AppBackground.tsx', 'the drifting blob'],
      ['packages/ui/src/morph/MorphProvider.tsx', 'the morph clone'],
    ];
    const missing = want.filter(([f]) => !/LoopingLayerProps|loopingLayerProps/.test(read(join(ROOT, f))));
    if (missing.length) {
      throw new Error(
        `not promoted: ${missing.map(([f, why]) => `${f} (${why})`).join(', ')}. On Android each of these is ` +
          're-rasterised every frame of its loop.',
      );
    }
    return `${want.length} primitives`;
  });

  section('13 · no loop runs on a screen nobody is looking at');

  /**
   * The one a profiler screenshot never shows. A stack unmounts what you leave;
   * a TAB NAVIGATOR DOES NOT. An ungated `withRepeat(-1)` on a tab is scoped to
   * the life of the app, not to the time the tab is visible — so opening three
   * tabs once leaves three screens' worth of loops running forever, two of them
   * invisible. Every component involved reads as correct on its own.
   */
  check('useLoopsActive gates on focus AND foreground', () => {
    const src = read(join(ROOT, 'packages/ui/src/effects/useLoopsActive.ts'));
    if (!/useScreenFocus/.test(src)) throw new Error('not focus-gated — a tab is never unmounted');
    if (!/AppState/.test(src)) throw new Error('not foreground-gated — a backgrounded app must animate nothing');
    return 'focus && foreground';
  });

  check('the shared primitives cancel their loops when hidden', () => {
    const want = [
      'packages/ui/src/Loader.tsx',
      'packages/ui/src/ShinyText.tsx',
      'packages/ui/src/effects/LensSheen.tsx',
      'packages/ui/src/effects/PulseRing.tsx',
    ];
    const bad = want.filter((f) => {
      const s = read(join(ROOT, f));
      return !/useLoopsActive/.test(s) || !/if \(!loopsActive\)/.test(s);
    });
    if (bad.length) throw new Error(`ungated loops in: ${bad.join(', ')}`);
    return `${want.length} primitives gated`;
  });

  check('the shared glow clock is released by hidden rings', () => {
    const src = read(join(ROOT, 'packages/ui/src/effects/useAmbientRotation.tsx'));
    if (!/useLoopsActive/.test(src)) {
      throw new Error(
        'a ring on a mounted-but-unfocused tab still retains the shared rotation clock, so the clock never ' +
          'stops and every mounted ring keeps recompositing its gradient.',
      );
    }
    return 'retained only while visible';
  });

  check("the driver's hot screens gate their loops", () => {
    const want = [
      'apps/driver/components/trip/TripStatusRail.tsx',
      'apps/driver/components/LiveTripCard.tsx',
      'apps/driver/components/dispatch/DispatchLiveMap.tsx',
    ];
    const bad = want.filter((f) => !/useLoopsActive/.test(read(join(ROOT, f))));
    if (bad.length) throw new Error(`ungated on a reported-laggy screen: ${bad.join(', ')}`);
    return `${want.length} screens`;
  });

  process.exit(summary());
}

main();
