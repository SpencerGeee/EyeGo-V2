# Visual & Motion Teardown — Uber, Bolt, Yango (2026-10-29)

Static evidence only: compiled resource tables (`aapt2 dump resources`), bundled animation assets, and class /
string inventories. **What the files cannot show is feel** — exact curves defined in code and how gestures
hand off. Screen recordings would close that gap (frame-by-frame with ffmpeg).

## 1. Motion tokens (durations, ms)

| Token | Uber (Base) | Bolt | Yango |
|---|---|---|---|
| Fast | `ub__animation_fast_ms` **250** | — | button press **100** (after 100 delay) |
| Default | `ub__animation_default_ms` **400** | fragment transition **400** | fragment anim **200** |
| Slow | `ub__animation_slow_ms` **600** | activity transition **200** | splash logo rise **300** (+100 reveal delay) |
| Sheet slide (material default) | 150 | 150 | 150 (`ya_eats_flex_bottomsheet_anim_duration_ms` 200) |
| Trip status tracker switch | **500** | — | — |
| Tooltips | 250 | — | 150 |
| Error toast in/out · shown | 350 · 3500 | — | — |
| Nav guidance collapse · fade · reveal | 583 · 183 · 350 | — | — |
| Status assistant loop | 4000 (go-offline 850) | — | — |
| Logo | delay 500, duration 1000 | — | — |

## 2. Layout tokens (dp)

**Uber Base:** 8 dp grid (`ui__spacing_unit_1x` = 8, 0.5x = 4 … 16x = 128) · elevation low 4 / medium 8 / high 16 ·
sheet elevation normal **24** / high **32** · divider 1 · sheet corner **16** (2x).
**Uber rider sheet, 2024+ "glowup":** corner 16 → **32** · picker row corner 12 → **16** · row margins 16 h / 8 v ·
selected border 3 → **2** · unselected border 2 → **1** · first row top margin 16 · header divider 1 ·
drop shadow 16 → 8 · scroll-shadow inset 40 · main view offset 56.
**Uber driver offers:** countdown = rounded **bar** (`ui__timer_corner_radius` 4, progress inset 2) · browse stack
primary card 200, focus card 300, gap 10, stroke 2 · offer map padding 72, map card corner 12 · directed-dispatch
PIN **6 cells** · dispatch animation icon 80.

**Bolt:** ride-type row **76** · category selection top peek offset **46** · rounded sheet top margin 56 · drag
indicator **48 × 6**, margin 9 · active-order header min height 82, driver avatar 64, rating icon 16, car image
min width 100 · story card radius 12.

**Yango:** card corner **20**, card elevation 8 (big card 6) · bottom sheet corner 16, peek min **132** · flex/
discovery container corner 24–32 · handle **34 × 4**, touch target **96 × 48**, handle bottom margin 4 · searchbar
corner 32 · default button corner 16 · dialog corner 24, dialog enter Y offset 15 · address picker sheet corner 32,
height 316 · chips 100 (pill).

## 3. Bundled animation assets
- Yango (Lottie): **radar_animation** (searching for a driver), **walk_animation**, **found_companion**, **ride_card**,
  wave_animation, ic_loading_animation, confetti (green/blue), eye, nfc, courier, logo reveal (light/dark).
  Plus `RemoteLottieAnimation` — Lottie delivered by the server, cached.
- Uber/Bolt: raw folders are mostly sounds/data; their motion is code-driven.

## 4. Where the smoothness lives (class evidence)
**Yango** (Compose animation + Views; no physics library): `OrderTransitionCoordinator`,
**`RideCardInlineTransitionCoordinator` + `InlineRideCardTransitionPhase`** (ride card changes phase inside one card),
`RideCardDriverSectionTransition`, `CardTransitionDirection`, `DynamicSearchTimelineAnimatable` (server-driven
searching timeline), `LayersObjectsAnimationParams` (map object animation tuned from server),
`CameraAnimationUpdateType/FinishType`, `OrderAnimatedBubbleIntersection` (map bubbles avoid overlap),
`PlacesSearchbarAnimator` / `SuperappSearchbarAnimator` (search bar morph), `PrintAnimationTextView` (typewriter
text), skeleton shimmer (`OrderCardShimmeringView`, `MaskedShimmeringBar`), `ExplorerAnimatedBorderView`,
`LazyColumnSelectedItemBackgroundAnimated` (selected row background animates), `TariffRedirectAnimation`.

## 5. Yango, code level (decompiled motion packages)

**The ride card is one card that changes phase in place** — `InlineRideCardTransitionPhase`:
`COMPACT → LOADING_DETAILS → OPENING → DETAILS → CLOSING → COMPACT`.
- Details are **loaded before any motion starts** (`LOADING_DETAILS`). The open animation never runs over an
  empty or half-mounted view.
- Closing is **gated**: the compact content waits for its target (`CompactContentGate` UNCONFIGURED →
  WAITING_FOR_TARGET → OPEN) and is applied in stages (`CompactContentStage` WAITING → APPLYING → APPLIED), so
  content is never swapped mid-animation.
- Open = a 0→1 `ValueAnimator`, **240 ms**, custom easing (obfuscated class; not recovered).

**Every state pair has its own transition** — `RideCardDriverSectionTransition`, 16 named transitions over four
driver-section states: SEARCHING · WAITING_RESPONSE (a driver is considering) · REJECTED · ASSIGNED_DRIVER, e.g.
SEARCHING_TO_ASSIGNED_DRIVER, WAITING_RESPONSE_TO_REJECTED, REJECTED_TO_SEARCHING, plus
WAITING_RESPONSE_CANDIDATE_CHANGE / ASSIGNED_DRIVER_CONTENT_CHANGE / PLAIN_CONTENT_CHANGE.

**How a section appears** (`DriverSectionView`): one 0→1 animator drives **height (0 → row height) and opacity
together**, the title rides in on translateY; disappearing is the exact reverse. **300 ms**, linear by default,
**overshoot** available for arrivals. Nothing pops — content grows into place and pushes the card.

**Progress bar:** 500 ms, linear.

**Ride-selection sheet** (`summary`, Compose, anchored-draggable): states COLLAPSED · **ANCHORED** ·
**ANCHORED_SCROLLED** · EXPANDED · FULLSCREEN · MINIMIZED · HIDDEN; `COLLAPSE_TO_ANCHOR`; a fullscreen threshold
fraction; emits **`anchoredHeightRatioUpdated`** continuously so the map reframes with the sheet's live height,
not just on settle.

## 6. EyeGo today vs the three apps

| Area | EyeGo (state.md 10-22) | Uber / Bolt / Yango | Gap |
|---|---|---|---|
| Stage change | ONE generic fade-through for every stage | Yango: a named transition per state pair (16) | **Big** — add a transition matrix |
| Card → details | MorphProvider clone flies card→screen; target can time out; "box arrived empty" history | Yango: expand **inside the card**, preload first, gated close | **Big** — this is the morph bug's real fix |
| Content appearing | fade | height + opacity coupled, 300 ms | Medium |
| Sheet detents | peek / half / full measured from sections | collapsed / anchored / expanded / fullscreen + "scrolled in anchored" + fullscreen threshold | Medium — add ANCHORED_SCROLLED handoff + threshold |
| Map vs sheet | map padding is a native prop updated on detent | map reacts to live height ratio | Medium |
| Look | glass, aurora glows, gradient rings | flat surfaces, 16–32 dp corners, 1–2 dp borders, 8 dp grid | **Big** (G3) |
| Ride-type row | tier cards | 76 dp rows, outlined selection (2 dp / 1 dp), animated selected background, per-row CTA | **Big** (G3) |
| Loading | spinners/skeleton mix | skeleton shimmer cards everywhere | Small |
| Signature moments | 3D bus, Skia shaders | Lottie: radar search, walk-to-pickup, found, confetti; server-delivered Lottie | Medium |
| Driver countdown | ring | rounded bar (Uber) | Small |

## 7. Proposed EyeGo Motion & Card Spec v2 (for approval)

**Durations:** press 100 · micro (chips, tooltips) 150 · sheet / small swap 200 · inline expand **240** · section
reveal **300** · default **400** · status-tracker switch 500 · slow 600. Uber's 250/400/600 ladder for anything
not listed.

**Easing:** decelerate in, accelerate out; overshoot only for "driver/bus found"; springs stay critically damped
(existing `springs.*` tokens) for gesture-driven motion.

**Transition matrix:** one named transition per rider-phase pair (searching → assigned, searching → no bus,
assigned → arriving, arriving → on board, on board → completed, any → cancelled) plus `CONTENT_CHANGE`. Default
when unnamed = the current fade-through.

**Inline expansion replaces card→screen flights for ride cards:** phases COMPACT · LOADING · OPENING · DETAILS ·
CLOSING; data first, then motion; gated close. MorphProvider stays only for true screen changes.

**Reveal:** height + opacity together (300 ms); removal reversed; never a pop.

**Sheet:** COLLAPSED · ANCHORED · ANCHORED_SCROLLED · EXPANDED · FULLSCREEN (threshold 0.9) · HIDDEN on the
existing SnapSheet engine; publish a live height ratio for the map camera.

**Look (G3):** flat solid surfaces, 8 dp grid, sheet corner 24 (32 on the home sheet), row corner 16, row height
76, selected outline 2 dp brand / unselected 1 dp hairline, selected row background animates in, elevation
4 / 8 / 16 (sheet 24), handle 36 × 4 with a 96 × 48 touch target, no glass/aurora/glow rings on sheets.

**Signature moments (Lottie, small, one at a time):** searching radar · walk to the stop · bus found · seat
booked confetti; Lottie files can be swapped from the server later.

**Driver:** countdown as a rounded bar on the offer card's top edge; 6-cell PIN for walk-up boarding.

## 8. What still needs eyes
Exact easing curves defined in code (Yango `i9m`, Compose specs) and gesture hand-offs can't be recovered
statically. A 30–60 s screen recording of each flow (Yango ride selection → search → driver found; Uber product
list → request; Bolt category list → confirm pickup; Uber Driver offer) lets those be measured frame by frame.
