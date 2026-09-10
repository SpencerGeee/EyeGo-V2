/**
 * "I am opening one of my own child screens, so expect me back."
 *
 * THE PROBLEM. The trip surface enforces a rule the user asked for: Where-To is
 * an entrance, not a destination, so regaining focus on a client-owned stage
 * ('search' / 'select') means the rider backed into it from something
 * downstream — payment, invite, guest selection — and they should be sent home
 * instead of being dropped on a search sheet behind a booking they already made.
 *
 * That rule was too broad. The Where-To sheet ALSO pushes children of its own —
 * the place picker, saved places, the schedule screen — and returning from one
 * of those is not "backing into" anything. It is the sheet's own round trip. So
 * tapping the destination field, picking a place, and coming back bounced the
 * rider to the home screen, losing the search they were in the middle of:
 *
 *   "when you click on something like a field to select the location for the
 *    destination, when you go back, it takes you to the homepage. this is wrong
 *    ... when you even confirm the location, it takes you to the homepage"
 *
 * A focus guard cannot tell the two apart by looking at the stage, because the
 * stage is identical in both cases. The difference is intent, and only the
 * screen that navigated knows it — so it says so. One-shot: the flag is
 * consumed by the very next focus, and anything else still goes home.
 */
let expectingReturn = false;

/**
 * Has the surface actually lost focus since the expectation was set?
 *
 * BUGFIX ("i chose to select the pickup point and when i set it and clicked
 * confirm, it brought me back to the homepage and i had to go back to the set
 * your trip page again even though i was just there").
 *
 * The expectation used to be consumed by the NEXT focus, whatever it was. But
 * the trip surface is a transparentModal, and a screen pushed over one of those
 * does not reliably blur the screen underneath — so the surface can receive a
 * focus event while its child is still on top, eat the flag, and then have
 * nothing left to consume when the rider genuinely comes back. The next focus
 * is the real return, the flag is already false, and the guard does exactly
 * what it is designed to do to someone who backed in from downstream: sends
 * them home, mid-search.
 *
 * That is why the destination field was reported fixed and the pickup field was
 * reported broken by the same rider on the same screen — it is a race, not a
 * missing call, so which field loses depends on timing rather than on code.
 *
 * An expectation is now only consumable once the surface has genuinely been
 * away. A focus with no blur before it cannot spend it.
 */
let sawBlur = false;

/** Call immediately before pushing a screen that the trip surface owns. */
export function expectTripSurfaceReturn(): void {
  expectingReturn = true;
  sawBlur = false;
}

/** Called from the trip surface's focus-effect cleanup, i.e. on blur. */
export function noteTripSurfaceBlur(): void {
  sawBlur = true;
}

/**
 * True exactly once per `expectTripSurfaceReturn()`, and only on a focus that
 * genuinely follows a blur.
 */
export function consumeTripSurfaceReturn(): boolean {
  if (!expectingReturn) return false;
  // Focus without an intervening blur is not the rider coming back — the child
  // is still up. Keep the expectation for the real return.
  if (!sawBlur) return true;
  expectingReturn = false;
  sawBlur = false;
  return true;
}

/**
 * Drop a pending expectation. Used when the surface is left for good, so a
 * flag set but never consumed cannot leak into an unrelated later focus.
 */
export function clearTripSurfaceReturn(): void {
  expectingReturn = false;
}
