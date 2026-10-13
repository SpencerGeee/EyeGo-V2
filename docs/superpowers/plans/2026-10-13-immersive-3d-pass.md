# Immersive 3D pass — 2026-10-13

Grilled with user 2026-10-13. Every decision below is APPROVED. Nothing coded yet.

## Diagnoses (verified, before any code)

1. **Away outcomes repeat** — not a seen-state bug. One open queued 4 facts as 4 sheets:
   3× `SEAT_RELEASED` (Adenta West, Kotobabi ×2) + `SCHEDULED_EXPIRED` for Fri 9 Oct (settled late, 12 Oct 12:52).
   Probe: scratchpad/away_probe.js (read-only `forRider`).
2. **Bus spins before map** — `HeroBus.tsx` Transit:
   - rider: `goFresh` unmounts pay/seat/ride slots; `target()` falls back to an OLDER slot on a dead screen → root
     Transit flies there with a yaw turn, drawn over the tracking map.
   - driver: `drv-away` land slot keeps default `SHOWROOM_YAW`; flight turns to travel heading then BACK to 228° → spin.
3. **Rider map 2D** — `TripMap.tsx:674` `overviewPitch: !snapshot && …` → every live stage has a snapshot → pitch 0.
   Web page also adds `buildings-3d` fill-extrusion (source `openfreemap`, layer `building`); app styles lack it.

## Decisions

| # | Decision |
|---|----------|
| D1 | Away feed: ≥2 facts → ONE "While you were away" summary sheet (rows, newest first, tap → destination). 1 fact → today's sheet. Same ride (tripId / intentId) → one row. |
| D2 | Stage change = bus reacts + content assembles in depth + map camera moves. Whole-page card tip retired. |
| D3 | Two strengths: FULL (rider search→request, ride→seat→payment, driver Create) / LIVE (rider assigned+tracking, driver offer+active trip): faster, bus turns not spins, tighter cascade. |
| D4 | Bus has a home spot per flow (spins in place on stage change: fwd spin / reverse spin back); stages MAY place it elsewhere → it moves on physics. True flights only on role change: lands on pickup pin, drives off on publish, drops into seat cabin. Map stages: the bus IS the 3D map marker. |
| D5 | Movement = glide on physics: UI-thread spring (velocity carried on retarget, soft overshoot); yaw from velocity capped ±35°, straightens as it slows; bank + pitch dip with speed; reaction spin on LANDING, never mid-flight. Literal drives (publish, pickup) face their path. |
| D6 | Accents, once per change, never looping: brand light sweep along sheet top edge (direction of travel); landing ring ripple on perspective floor under the bus. LIVE strength: ring only, dimmer. |
| D7 | Seat page = real 3D cabin: bus flies in → becomes cabin, roof lifts, camera tilts to ¾ view; 3D seats by state; tap = seat rises + glows + ring + camera eases toward it; drag orbits ±40°, springs back. Full-bleed stage, glass header (route + departs), legend = 4 dots, 2-snap sheet (peek: seat+fare+Confirm / half: drop-off map). Low tier / Reduce Motion = static tilted cabin. |
| D8 | Find-your-driver card: 3 snaps. Peek: big headline + one live line, edge sweep = only progress, big rolling fare, ⚡ pill when boost offered. Half: + pickup→drop-off rail, "Tier · seats · Cash" line, tiles Edit pickup/Share/Cancel. Full: + search detail, grouping note, safety/share. Boost = pill → tray (+₵2/+₵5/+₵10, "100% goes to your driver"); FareBoostRow retired. Snap physics = one hook shared with driver DispatchOfferCard. |
| Default | Reduce Motion always wins; `useDepthMotion()` stays the ONE gate (low tier → fades / static). |

## Phases (in order; each = one local commit; push only on user approval)

**P1 — Map parity (item 3)**
- `TripMap.tsx`: drop `!snapshot` from `overviewPitch`; overview pitch 50, follow pitch 56 (web numbers).
- `packages/map-styles/eyego-{light,dark,dark-driver}.json`: add `buildings-3d` fill-extrusion after `building`
  (minzoom 14, opacity fade 14→15.5, colours from tracking/index.html). Web `decorateStyle` already skips if present.
- Check `useMapCamera` fit keeps bearing 0 → optional `overviewBearing` (−16) only if one line.

**P2 — HeroBus fixes (item 2)** `packages/maps/src/three/HeroBus.tsx`
- Flight only when `goal.seq > from.seq`; older goal = rest in place, no flight, hide transit.
- `land` flights hold travel heading to the end (no turn back to showroom yaw).

**P3 — Away summary (item 1)**
- `rideEnded.store`: `enqueue(list)` with ≥2 → one digest notice; group same tripId/intentId (keep most important).
- `OutcomeSheet`: optional `rows` (icon, title, one line, onPress) — rider + driver both use it (driver AwayOutcomesSheet same shape).

**P4 — Motion system** `packages/ui/src/motion/`
- `stageRow(i, strength)` entering / `stageRowExit(i)` Keyframes (new instance per call, memoised — Keyframe.delay mutates).
- `StageSweep` (one-shot on key change), `LandingRing` (flat perspective ripple).
- HeroBus: physics glide (D5), spin direction prop, strength prop; home-slot convention.
- Per-stage camera shots (pitch/bearing/zoom) for rider TripMap + driver map; swoop on stage change.

**P5 — Apply** rider `/trip` (MapSheetHost bodies, ConfigureStage steps), ride/[id] → seat → payment,
driver Create, driver home panels + active-trip stages (LIVE).

**P6 — Request card (D8)** extract `useSnapSheet` from `DispatchOfferCard` into `packages/ui`; rewrite
`SearchingPanel` + RequestStage card per snap; `BoostPill` + tray replaces `FareBoostRow`.

**P7 — Seat cabin (D7)** `models.ts` `cabin(layout, seatStates)`; `Cabin3D` (Skia, `projectModel` hit-test on seat
top faces, orbit gesture, seat-rise frames); `seat.tsx` relayout + 2-snap sheet via `useSnapSheet`.
Risk: seat rise re-draws uncached frames → animate in ≤6 keyframes, not per frame.

## Verification per phase
tsc rider/driver (`node node_modules/typescript/lib/tsc.js`) · `test:maps` · invariants · conditional-hooks ·
motion-invariants · API jest when API touched. Every RN visual = NOT device-verified until user tests.
