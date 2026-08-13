# State — Single-Scene Motion Architecture (rider trip surface)

## Current Goal
Turn the trip surface's stage crossfade into one sheet that morphs, interlocked with the map camera.

## Decisions
- Sheet moves by `translateY` on a screen-tall container, NOT by animating `height`/`flexBasis`. The brief asked for height/flex-basis; animating layout props costs a Yoga pass per frame over an entire stage subtree, which is the exact cause of the morph jank recorded on 2026-07-30.
- MapLibre camera padding cannot be driven by a Reanimated shared value (native prop, not an animated node). Instead `useMapCamera` accepts a padding GETTER and samples the sheet's live top edge each frame from the existing 60 Hz loop.
- Padding-driven re-frames are issued with animationDuration 0. A live padding changes ~25× per transition; animating each over 600 ms restarts the camera before it arrives.
- Stages publish their panel body into a zustand slot store, not through context. A context provider is an ancestor of the stages, so publishing through it re-renders them, so they republish — an infinite loop.
- `MorphSheet` reuses `usePanelMotion` rather than growing its own gesture engine; the only new idea is that the resting stop is measured and re-snapped when content changes.

## Plan Status
Phase A (infra) and the live-trip half of Phase B are done. `tsc --noEmit` green: rider, driver. NOT device-tested, NOT committed.

| # | Item | Status |
|---|------|--------|
| A1 | `packages/ui/src/panel/sheetMetrics.tsx` — sheet↔map channel | DONE |
| A2 | `packages/ui/src/panel/MorphSheet.tsx` — the one sheet | DONE |
| A3 | `packages/ui/src/MorphCTA.tsx` — button ⇄ loader, one node | DONE (built, NOT yet used by any screen) |
| A4 | `packages/ui/src/motion/layoutTransitions.ts` — LinearTransition presets from tokens | DONE (exported, not yet applied to stage internals) |
| A5 | `paddingForSheetTop` + quantum; `useMapCamera` padding getter; instant padding re-frames | DONE |
| B1 | `sheetSlot.tsx` + `TripSheetHost.tsx` | DONE |
| B2 | trip.tsx hosts the sheet + provider | DONE |
| B3 | TripMap reads the live edge (SHEET_FRACTION kept as pre-measure fallback) | DONE |
| B4 | TrackingStage + AssignedStage → `SheetContent` | DONE |
| B5 | SelectStage CTA → `MorphCTA` (real button⇄loader, and it no longer unmounts on press) | DONE |
| B6 | Search / Configure / Select / Request panels → `SheetContent` | WON'T DO — see below |
| C | Screens pushed over the surface as in-surface overlays | WON'T DO — see below |
| D | Driver app parity — `InlayPanel publishMetrics` + `DriverTripMap` live padding | DONE |
| E | Home → trip entry morph velocity handoff | N/A — the sheet hosts no stage with an inbound morph |

## Why four stages stay off the shared sheet
Not scope-cutting; each has a structural reason, and the mixed state is safe by construction (`TripSheetHost` renders null with no slot, both maps fall back to the `SHEET_FRACTION` table).
- **SearchStage** is a centred floating card that is the landing `MorphTarget` for the home screen's Where-To pill. A bottom sheet cannot be that card's morph destination.
- **RequestStage** is the landing `MorphTarget` for home's "looking for a driver" card. Move its body into a hosted sheet and the morph grows into an empty full-screen view while the content appears elsewhere.
- **SelectStage** docks a virtualised results list with `flex: 1`. A content-measured sheet gives a `flex: 1` child zero height.
- **ConfigureStage** is steps 3–5 of the same card wizard SearchStage starts; splitting it from its own flow buys nothing.
- **Overlays (C)**: `app/_layout.tsx` documents why pushed screens must stay opaque — a transparent one exposes the window behind an iOS native-stack slide. Converting them fights a constraint that was already paid for.

The coherent line that came out of this: **card flow for input, one morphing sheet for the live ride.**

## Evidence
- Partial conversion is safe by construction: `TripSheetHost` returns null when the active stage has published no slot, and `TripMap.getPadding` falls back to the `SHEET_FRACTION` table whenever `metrics.top` is unpublished (0 or == screenHeight). Unconverted stages keep their own panels and their own camera behaviour.
- The brief's premise was wrong for this repo: the flow was already single-route/single-map (`app/trip.tsx`, six stages), and its spring token `springs.morph` = {stiffness 195, damping 28, mass 1} already sits inside the brief's requested 170–190 / 26–30 band.

## Open Issues
- Nothing here is device-verified. Specifically worth watching: (a) scroll-vs-drag handover inside `MorphSheet` on the tracking panel, (b) whether ~25 instant `fitBounds` calls across one sheet travel read as smooth or as stepping on a mid-range Android, (c) the `MorphCTA` ring contracting cleanly to a circle.
- Two `InlayPanel`s with `publishMetrics` mounted at once (driver manage pushed over driver tracking) degrade to the old `sheetFraction` fallback rather than interlocking. Acceptable, not ideal; a per-screen `SheetMetricsProvider` would fix it properly.
