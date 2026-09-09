import { create } from 'zustand';
import type { SheetChrome } from '@eyego/ui';

/**
 * THE DRIVER'S HOME SURFACE, AS STAGES.
 *
 * BUGFIX ("tapping the live dispatch card, the morphing effect is super laggy…
 * this is the 7th time I'm talking about this meaning you need to take a new
 * approach on this") and ("you need to redesign the dispatch page again cuz I
 * can't see the difference").
 *
 * ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
 *
 * The morph had been rewritten four times at the ANIMATION layer — raw layout
 * properties swapped for transforms, inverse scale on the clone, morph ids
 * keyed on the same entity both sides. Each was a real fix and none of them
 * moved the complaint, which is the signal that the animation was never the
 * cost.
 *
 * The cost was the destination. Tapping a live request pushed
 * `(trip)/dispatch/[id]` — a thousand-line screen that mounts a native MapView,
 * kicks off two road-leg fetches and puts a Skia canvas on top. No transform
 * can hold 60fps while the JS thread is building that, so the flight was
 * smooth in principle and stuttering in fact.
 *
 * So the offer stopped being a destination. Home already owns a full-bleed map
 * and a bottom sheet; an offer is that same surface wearing different sheet
 * content and a different camera. Tapping a request is a STAGE CHANGE:
 *
 *   - nothing navigates,
 *   - the MapView is already mounted and simply re-frames,
 *   - the sheet swaps its body on the existing crossfade spring.
 *
 * There is no mount to hide, which is why this cannot lag rather than merely
 * being faster. The pushed route survives for push-notification and cold-start
 * entry, where a real screen genuinely has to be built.
 */
export type DriverStage = 'idle' | 'offer';

/**
 * Per-stage sheet chrome, in the same shape the rider's table uses so the two
 * surfaces stay legibly related.
 *
 * `idle` is glass: the sheet is mostly a list of things to do, and glass lets
 * the ambient field read through the space below the content — which is where
 * the Skia identity lives on a map screen now that the map owns the background.
 *
 * `offer` is solid and taller. It carries money and a countdown, and nothing
 * behind a fare should compete with it. 0.52 is deliberately less than the old
 * home panel's 0.56 resting height: an offer is the one moment the driver most
 * needs to see WHERE the pickup is.
 */
export const DRIVER_SHEET_CHROME: Record<DriverStage, SheetChrome> = {
  idle: { radius: 32, glass: true, collapsed: 0.42 },
  offer: { radius: 28, glass: false, collapsed: 0.52, aurora: 0.14 },
};

/** The ceiling for a dragged sheet. Matches D9's "tall" detent. */
export const DRIVER_SHEET_MAX_PCT = 0.78;

interface DriverSurfaceState {
  /**
   * The trip whose offer the driver is looking at ON THE HOME SURFACE, or null
   * for the idle board.
   *
   * Deliberately only a SELECTION, not a copy of the offer. The offer's own
   * data already lives in `trip.store` (`offer`, `pendingRequests`) and is kept
   * current by socket frames; duplicating it here would create a second copy to
   * drift, which is the bug shape that produced "it brings up the request again
   * with a fresh counter". The stage is derived from this id plus that store.
   */
  focusedTripId: string | null;
  openOffer: (tripId: string) => void;
  closeOffer: () => void;
}

export const useDriverSurface = create<DriverSurfaceState>((set) => ({
  focusedTripId: null,
  openOffer: (tripId) => set({ focusedTripId: tripId }),
  closeOffer: () => set({ focusedTripId: null }),
}));

/**
 * The visible stage is DERIVED, never stored.
 *
 * Same rule the rider's request screen settled on: there is no local stage
 * state that can disagree with the trip, because there is no local stage state.
 * The only stored thing is which row the driver tapped, and even that is
 * overridden the moment the ride it points at stops being offerable.
 *
 * @param focusedTripId what the driver tapped, if anything
 * @param offerable     whether that trip is still a live thing to decide on —
 *                      the caller derives it from `trip.store`, because only it
 *                      knows about held offers, revokes and expiry.
 */
export function deriveDriverStage(
  focusedTripId: string | null,
  offerable: boolean,
): DriverStage {
  return focusedTripId != null && offerable ? 'offer' : 'idle';
}
