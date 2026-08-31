import { Linking, Platform } from 'react-native';

import { notify } from '../notify/notice';

/**
 * DIALLING THE EMERGENCY SERVICES, WITHOUT A SILENT FAILURE.
 *
 * ── WHAT WAS THERE ──────────────────────────────────────────────────────────
 * Five call sites across the two apps, all shaped like this:
 *
 *     Linking.openURL('tel:112').catch(() => {});
 *
 * Every other swallowed `.catch` in this codebase sits behind a toast or an
 * offline queue, so the failure is recoverable and the user is told. These five
 * did not. If the dialler refused to open — no telephony on the device, a
 * permissions refusal, an Android intent with no handler, a tablet — the rider
 * pressed the panic button, the promise rejected, and the app said nothing at
 * all. The one screen in the product where a silent failure is unacceptable was
 * the one screen that had five of them.
 *
 * ── WHAT REPLACES IT ────────────────────────────────────────────────────────
 * A rejection becomes a persistent notice that CONTAINS THE NUMBER. That last
 * part is the point: someone in trouble whose dialler will not open still needs
 * the digits, and "could not place the call" without them is only a politer way
 * of failing. The notice persists because it is a fact that dismissing does not
 * change, and it carries no auto-dismiss timer to race the user reading it.
 *
 * `canOpenURL` is deliberately NOT consulted. On Android it needs the scheme in
 * the manifest's `queries` block and returns false when it is missing, which
 * would refuse to dial on a device that dials perfectly well. Attempting the
 * open and handling the rejection is both simpler and more permissive.
 */

/** Digits, and the handful of dial-string characters a tel: URI may carry. */
const DIALLABLE = /^[0-9+#*()\-\s]{3,20}$/;

/**
 * Place a call. Resolves `true` when the dialler was handed the number.
 *
 * Never rejects: the failure path is the notice, so callers can fire this from
 * an `onPress` without a `.catch` of their own — which is what produced the
 * original bug.
 */
export async function callNumber(
  number: string | null | undefined,
  opts: { label?: string } = {},
): Promise<boolean> {
  const label = opts.label ?? 'that number';
  const trimmed = (number ?? '').trim();

  if (!trimmed || !DIALLABLE.test(trimmed)) {
    notify('Cannot place the call', `No usable number for ${label}.`, {
      tone: 'error',
      persist: true,
    });
    return false;
  }

  try {
    await Linking.openURL(`tel:${trimmed}`);
    return true;
  } catch {
    notify('Could not open the dialler', `Call ${trimmed} directly.`, {
      tone: 'error',
      persist: true,
    });
    return false;
  }
}

/**
 * Open the SMS composer, pre-filled. Same contract as `callNumber`: resolves a
 * boolean, never rejects, and a failure names the number and keeps the message
 * on screen so it can still be sent by hand.
 *
 * iOS separates the body with `&` only when the URL already has a query, which
 * it never does here, so both platforms want `?` — except that Android is the
 * one that historically wanted `?body=` and iOS `&body=`. Both accept `?body=`
 * on every version these apps support.
 */
export async function messageNumber(
  number: string | null | undefined,
  body: string,
  opts: { label?: string } = {},
): Promise<boolean> {
  const label = opts.label ?? 'that contact';
  const trimmed = (number ?? '').trim();

  if (!trimmed || !DIALLABLE.test(trimmed)) {
    notify('Cannot send the message', `No usable number for ${label}.`, {
      tone: 'error',
      persist: true,
    });
    return false;
  }

  const separator = Platform.OS === 'ios' ? '&' : '?';
  try {
    await Linking.openURL(`sms:${trimmed}${separator}body=${encodeURIComponent(body)}`);
    return true;
  } catch {
    notify('Could not open messages', `Text ${trimmed} directly.`, {
      tone: 'error',
      persist: true,
    });
    return false;
  }
}
