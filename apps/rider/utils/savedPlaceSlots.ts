/**
 * Which saved place counts as "Home" and which counts as "Work".
 *
 * ── Why this is shared ───────────────────────────────────────────────────────
 * "the option to add home address should now be your primary home address."
 *
 * It wasn't, and the reason was that two screens answered the question
 * differently. The saved-places screen decided a home already existed with
 * `p.label.toLowerCase() === 'home'` — an EXACT match — so a place saved as
 * "Home Address", "home " or "My Home" left the "Add Home" prompt sitting
 * directly above the home address it was asking the rider to add. Meanwhile
 * Where To picked its icon with `label.includes('home')`, so the very same row
 * was already wearing a house.
 *
 * A slot is not a label; it is what a label MEANS. Both screens now ask here,
 * so there is one answer and the prompt disappears the moment the address it
 * asks for exists — whatever the rider called it.
 */

/** Does this label claim the Home slot? */
export function isHomeLabel(label: string): boolean {
  return label.trim().toLowerCase().includes('home');
}

/** Does this label claim the Work slot? Offices are work. */
export function isWorkLabel(label: string): boolean {
  const l = label.trim().toLowerCase();
  return l.includes('work') || l.includes('office');
}
