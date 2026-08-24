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

/**
 * ── SUPERSEDED: THE SLOT IS A COLUMN NOW ────────────────────────────────────
 *
 * Everything above describes the problem correctly and solved it in the wrong
 * place. Inferring the slot from the label made the two features fight: a place
 * named the way a person actually would — "Mum's home", "the office party" —
 * CLAIMED the shortcut, and the server treats a slot claim as an UPDATE. So
 * saving a friend's address silently overwrote the rider's own home, and the
 * screen then showed the new address exactly where it was expected to be.
 *
 * `SavedPlace.slot` ('HOME' | 'WORK' | null) is now a column the rider sets
 * deliberately in the saved-places form. A label is just a name.
 *
 * The two predicates below survive for ONE job: reading rows written before the
 * column existed, on an instance whose migration backfill has not run. Use
 * `slotOfPlace` rather than calling them directly — nothing should ever WRITE a
 * slot from a label again.
 */

/** Does this label claim the Home slot? Legacy read-path only. */
export function isHomeLabel(label: string): boolean {
  return label.trim().toLowerCase().includes('home');
}

/** Does this label claim the Work slot? Offices are work. Legacy read-path only. */
export function isWorkLabel(label: string): boolean {
  const l = label.trim().toLowerCase();
  return l.includes('work') || l.includes('office');
}

/**
 * WHICH SHORTCUT THIS PLACE IS — the column first, the old inference second.
 *
 * The one derivation both screens ask. Column wins; the label is consulted only
 * for a row that has no slot at all, which is what a pre-migration row looks
 * like. Once the backfill has run this never reaches the label branch.
 */
export function slotOfPlace(place: {
  slot?: 'HOME' | 'WORK' | null;
  label: string;
}): 'HOME' | 'WORK' | null {
  if (place.slot) return place.slot;
  if (isHomeLabel(place.label)) return 'HOME';
  if (isWorkLabel(place.label)) return 'WORK';
  return null;
}
