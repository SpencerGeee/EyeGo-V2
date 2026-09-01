import * as Contacts from 'expo-contacts';

/**
 * PICK A PERSON, NOT A PHONE NUMBER.
 *
 * Typing a 10-digit number from memory is the slowest and least reliable thing
 * this app asks anyone to do, and it is asked at the two moments where getting
 * it wrong costs the most: sending someone ride credits, and booking a ride for
 * someone else. Emergency contacts and the profile screen already offer the OS
 * picker; these two did not, for no reason other than having been written
 * separately.
 *
 * `presentContactPickerAsync` shows the system's own sheet and returns only the
 * single contact tapped, so there is no READ_CONTACTS permission prompt and the
 * app never sees the address book — unlike `getContactsAsync`, which asks for
 * the lot. Worth keeping that way.
 */
export type PickedContact = {
  name: string | null;
  /** Exactly as the address book stores it — see `normaliseGhPhone`. */
  phone: string;
};

export type PickContactResult =
  | { status: 'picked'; contact: PickedContact }
  | { status: 'cancelled' }
  | { status: 'no-number'; name: string | null }
  | { status: 'unavailable' };

/**
 * Never throws and never notifies — the caller decides what to say, because
 * "that contact has no number" reads differently on a Send Credits screen than
 * on an emergency-contact one.
 */
export async function pickPhoneContact(): Promise<PickContactResult> {
  try {
    const picked = await Contacts.presentContactPickerAsync();
    if (!picked) return { status: 'cancelled' };

    const name = picked.name?.trim() || null;
    const phone = picked.phoneNumbers?.[0]?.number?.trim();
    if (!phone) return { status: 'no-number', name };

    return { status: 'picked', contact: { name, phone } };
  } catch {
    // No picker on this platform, or the sheet failed to present. The manual
    // field is always still there, so this is never fatal.
    return { status: 'unavailable' };
  }
}

/**
 * A Ghana number in the one spelling every screen can compare.
 *
 * Address books store the same subscriber four ways — `0244123456`,
 * `+233 24 412 3456`, `233244123456`, `244123456` — and a contact picked from
 * the sheet arrives with whatever spacing the owner typed years ago. The server
 * already tries every equivalent spelling when it resolves a recipient
 * (`rider.wallet.routes.js`), so this is not what makes a transfer land; it is
 * what stops the app's OWN length and equality checks from rejecting a number
 * that is perfectly valid, and what keeps the confirmation copy legible.
 *
 * Returns the local 0-prefixed form, which is how Ghanaian numbers are written
 * and what the signup flow stores.
 */
export function normaliseGhPhone(input: string | null | undefined): string {
  if (!input) return '';
  const digits = String(input).replace(/[^\d+]/g, '');
  const bare = digits.replace(/^\+/, '');

  // 233244123456 / +233244123456 → 0244123456
  if (bare.startsWith('233') && bare.length >= 12) return `0${bare.slice(3)}`;
  // 244123456 (no trunk prefix) → 0244123456
  if (bare.length === 9 && !bare.startsWith('0')) return `0${bare}`;
  return bare;
}
