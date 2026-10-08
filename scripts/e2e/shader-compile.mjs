/**
 * The ambient background's SkSL compiles, and light mode is really light.
 *
 * `Skia.RuntimeEffect.Make` runs at module import; a shader that does not
 * compile kills the app on startup (see the Skia SkSL startup-crash memory).
 * This compiles both kernels with CanvasKit — the same Skia — and renders one
 * light-mode frame to prove the ground is white, not a veil.
 *
 *   node scripts/e2e/shader-compile.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { section, check, summary } from './lib.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const kitDir = path.join(root, 'node_modules/canvaskit-wasm/bin/full');
const src = fs.readFileSync(path.join(root, 'packages/ui/src/effects/LightPillarBackground.tsx'), 'utf8');
const sksl = (name) => src.match(new RegExp('const ' + name + ' = `([\\s\\S]*?)`;'))?.[1];

async function main() {
  section('ambient background shader');
  const CK = await require(path.join(kitDir, 'canvaskit.js'))({ locateFile: (f) => path.join(kitDir, f) });
  const effects = {};
  for (const name of ['SKSL', 'SKSL_LOW']) {
    await check(`${name} compiles`, async () => {
      let err = null;
      const e = CK.RuntimeEffect.Make(sksl(name) ?? '', (m) => (err = m));
      if (!e) throw new Error(err ?? 'no source');
      effects[name] = e;
      return `${e.getUniformCount()} uniforms`;
    });
  }

  await check('light mode: white ground at the edges, brand colour on the wave', async () => {
    const W = 120, H = 260;
    const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    // Uniform order = declaration order in the SkSL.
    const u = [6, W, H, ...rgb('#1a7a3c'), ...rgb('#005321'), 0.9, 0.006, 3, 0.4, 0, 0.3, 1, ...rgb('#FFFFFF'), 1, 1];
    const surface = CK.MakeSurface(W, H);
    const paint = new CK.Paint();
    paint.setShader(effects.SKSL.makeShader(u));
    surface.getCanvas().drawRect(CK.LTRBRect(0, 0, W, H), paint);
    const px = surface.makeImageSnapshot().readPixels(0, 0, {
      width: W, height: H, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB,
    });
    const at = (x, y) => px.slice((y * W + x) * 4, (y * W + x) * 4 + 3);
    const edge = at(2, Math.floor(H / 2));
    if (Math.min(...edge) < 245) throw new Error(`edge pixel ${edge} — the ground is not white`);
    let colourful = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i + 1] - px[i] > 40) colourful += 1;
    if (colourful < W * H * 0.01) throw new Error('no visible wave — light mode switched the effect off');
    return `edge rgb(${edge}) · ${((colourful / (W * H)) * 100).toFixed(1)}% of pixels carry the wave`;
  });
}

main()
  .catch((e) => console.error(e))
  .finally(() => summary());
