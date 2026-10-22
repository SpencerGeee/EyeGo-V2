/**
 * The sign-in scene's exit, callable from the screens inside it.
 *
 * On success the scene plays its departure — the form fades, the sheet slides
 * away, the van glides off to the right — and only THEN does the app move on,
 * so arriving home reads as the scene opening onto it rather than a cut. The
 * layout registers the animation here; a screen hands over "what to do next".
 * Outside the scene (no registration) the next step simply runs.
 */
type Exit = (then: () => void) => void;
let exit: Exit | null = null;

export function registerAuthExit(fn: Exit | null): void {
  exit = fn;
}

export function leaveAuthScene(then: () => void): void {
  if (exit) exit(then);
  else then();
}

/** "24 123 4567" from the nine local digits. */
export function formatGhLocal(d: string): string {
  const x = d.replace(/\D/g, '').slice(0, 9);
  return [x.slice(0, 2), x.slice(2, 5), x.slice(5)].filter(Boolean).join(' ');
}

/** "+233 24 *** 4567" — enough to recognise, not enough to read off a screen. */
export function maskPhone(e164: string): string {
  const d = e164.replace(/\D/g, '').replace(/^233/, '');
  if (d.length < 9) return e164;
  return `+233 ${d.slice(0, 2)} *** ${d.slice(5)}`;
}

/**
 * The sign-in sheet's surface tokens — dark frosted glass by default. A light
 * variant (a white sheet, like the reference) is a change here and nowhere else.
 */
export const AUTH_SHEET = {
  fill: 'rgba(18,20,22,0.78)',
  border: 'rgba(255,255,255,0.08)',
  field: 'rgba(255,255,255,0.05)',
  fieldBorder: 'rgba(255,255,255,0.08)',
  text: '#F4F6F8',
  textDim: 'rgba(244,246,248,0.62)',
};
