'use strict';
/*
 * Background removal + app-asset generation for the EyeGo logos.
 *
 * The source JPEGs sit on a dark navy GRADIENT, and the logo's own inner circle
 * is also dark navy — so we cannot "delete dark pixels" (that punches a hole in
 * the logo). Instead we EDGE FLOOD-FILL: starting from the border, we clear only
 * background-connected navy within a colour tolerance. The enclosed inner circle
 * is unreachable from the border (the bright ring blocks it), so it's preserved.
 * A light feather pass softens the cut edge to avoid a navy halo.
 *
 * Outputs per app: logo.png (transparent), icon.png (opaque navy, iOS-safe — iOS
 * flattens alpha to black), adaptive-icon.png (transparent fg), splash-icon.png,
 * and favicon.png (rider).
 */
const Jimp = require('jimp');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const APPS = [
  { src: path.join(ROOT, 'rider.jpeg'),  out: path.join(ROOT, 'eyego/apps/rider/assets'),  favicon: true },
  { src: path.join(ROOT, 'driver.jpeg'), out: path.join(ROOT, 'eyego/apps/driver/assets'), favicon: false },
];

const TOL = 46;       // base colour distance treated as background
const FEATHER = 26;   // extra band over which alpha ramps 1→0 (soft edge)

function dist(r1, g1, b1, r2, g2, b2) {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

// Average colour over a small corner patch.
function sampleCorner(img, x0, y0, s) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y0 + s; y++) {
    for (let x = x0; x < x0 + s; x++) {
      const i = (img.bitmap.width * y + x) << 2;
      r += img.bitmap.data[i]; g += img.bitmap.data[i + 1]; b += img.bitmap.data[i + 2]; n++;
    }
  }
  return [r / n, g / n, b / n];
}

async function removeBackground(srcPath) {
  const img = await Jimp.read(srcPath);
  const { width: W, height: H, data } = img.bitmap;

  // Background reference = mean of the four corners (handles the gradient decently).
  const c = [sampleCorner(img, 0, 0, 6), sampleCorner(img, W - 6, 0, 6),
             sampleCorner(img, 0, H - 6, 6), sampleCorner(img, W - 6, H - 6, 6)];
  const bg = [0, 1, 2].map((k) => c.reduce((s, p) => s + p[k], 0) / 4);

  const visited = new Uint8Array(W * H);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const p = y * W + x;
    if (visited[p]) return;
    visited[p] = 1;
    stack.push(p);
  };
  // Seed from every border pixel.
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }

  while (stack.length) {
    const p = stack.pop();
    const x = p % W, y = (p / W) | 0;
    const i = p << 2;
    const d = dist(data[i], data[i + 1], data[i + 2], bg[0], bg[1], bg[2]);
    if (d > TOL + FEATHER) continue; // hit the logo — stop spreading here
    if (d <= TOL) {
      data[i + 3] = 0; // solid background → fully transparent
    } else {
      // feather band: ramp alpha so the cut edge isn't a hard navy line
      const t = (d - TOL) / FEATHER; // 0→1
      data[i + 3] = Math.round(255 * t);
    }
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }

  img.autocrop({ cropOnlyFrames: false, tolerance: 0.0002 });
  return { img, bg };
}

// Centre `logo` into a square canvas of `size`, scaled to `frac` of the square.
function squareWith(logo, size, frac, bgColorInt) {
  const canvas = new Jimp(size, size, bgColorInt);
  const scaled = logo.clone();
  const target = Math.round(size * frac);
  if (scaled.bitmap.width >= scaled.bitmap.height) scaled.resize(target, Jimp.AUTO);
  else scaled.resize(Jimp.AUTO, target);
  const x = Math.round((size - scaled.bitmap.width) / 2);
  const y = Math.round((size - scaled.bitmap.height) / 2);
  canvas.composite(scaled, x, y);
  return canvas;
}

(async () => {
  for (const app of APPS) {
    const { img: logo, bg } = await removeBackground(app.src);
    const navy = Jimp.rgbaToIntCSS
      ? null
      : null;
    const navyInt = (Math.round(bg[0]) << 24) | (Math.round(bg[1]) << 16) | (Math.round(bg[2]) << 8) | 0xff;
    const transparent = 0x00000000;

    // Transparent logo for in-app use + splash (Expo paints splash backgroundColor behind it)
    await logo.clone().writeAsync(path.join(app.out, 'logo.png'));
    await squareWith(logo, 1024, 0.8, transparent).writeAsync(path.join(app.out, 'splash-icon.png'));

    // iOS app icon must be opaque → composite onto the brand navy.
    await squareWith(logo, 1024, 0.72, navyInt >>> 0).writeAsync(path.join(app.out, 'icon.png'));

    // Android adaptive icon foreground (transparent; config sets backgroundColor). 0.62 keeps it in the safe zone.
    await squareWith(logo, 1024, 0.62, transparent).writeAsync(path.join(app.out, 'adaptive-icon.png'));

    if (app.favicon) {
      await squareWith(logo, 48, 0.82, navyInt >>> 0).writeAsync(path.join(app.out, 'favicon.png'));
    }

    const hex = '#' + [bg[0], bg[1], bg[2]].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    console.log(`${path.basename(app.src)} → logo ${logo.bitmap.width}x${logo.bitmap.height}, navy ${hex}`);
  }
  console.log('done');
})().catch((e) => { console.error(e); process.exit(1); });
