/**
 * Converts a `#rgb`/`#rrggbb` hex color into an `rgba(r, g, b, alpha)` string.
 * A worklet so animated styles can call it: without the directive the first
 * frame works (computed on JS) and the first UI-thread update aborts the app with
 * "Object is not a function" — the rider's fresh-install crash on the phone
 * screen (2026-11-22, eyego-testers smoke run 45074864001).
 */
export function withOpacity(hex: string, alpha: number): string {
  'worklet';
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const bigint = parseInt(full, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
