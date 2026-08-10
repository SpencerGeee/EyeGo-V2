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

/** Call immediately before pushing a screen that the trip surface owns. */
export function expectTripSurfaceReturn(): void {
  expectingReturn = true;
}

/** True exactly once per `expectTripSurfaceReturn()`. */
export function consumeTripSurfaceReturn(): boolean {
  const was = expectingReturn;
  expectingReturn = false;
  return was;
}

/**
 * Drop a pending expectation. Used when the surface is left for good, so a
 * flag set but never consumed cannot leak into an unrelated later focus.
 */
export function clearTripSurfaceReturn(): void {
  expectingReturn = false;
}
