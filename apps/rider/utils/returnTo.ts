/**
 * One-shot "after signing in, come back here".
 *
 * A group-invite link opened by someone who is signed out sent them through
 * phone → code → (register → setup) and then to Home, with the invite they
 * came for gone. The link sets this before sending them to sign in; whichever
 * screen finishes sign-in consumes it. Consuming clears it, so a stale target
 * never hijacks a later sign-in. Same pattern as placePickerResult.
 */
let pending: string | null = null;

export function setReturnTo(path: string) {
  pending = path.startsWith('/') ? path : null;
}

export function consumeReturnTo(): string | null {
  const path = pending;
  pending = null;
  return path;
}
