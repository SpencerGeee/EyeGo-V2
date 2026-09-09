# Driver Premium Pass — 2026-09-09

17 reported items. Decisions confirmed with the user before any code was touched.

## Confirmed decisions

| # | Decision | Chosen |
|---|---|---|
| D1 | Morph strategy | Warm destination + rasterized snapshot flight. JS thread idle during flight. |
| D2 | Driver redesign scope | Map-first Uber-style shell for home / dispatch / tracking. |
| D3 | Pass semantics | **Pass = permanent** for that driver. **Timeout = retryable** (cascade may return). |
| D4 | Delivery | Finish everything, verify, then one push. |
| D5 | Destination gating | Offer map frames driver→pickup ONLY. Dropoff survives as **text** (area name + trip distance/duration). Dropoff hits the map only once the ride starts. |
| D6 | Rider scope | Motion + transitions + polish only. **No structural rework of rider layouts.** |
| D7 | Transitions | Depth-based iOS system motion. Push = parent recedes (scale→.94 + dim). Lateral = slide, no fade. Modal = spring rise + backdrop blur. Morph only where a shared element genuinely exists. |

## Grill round 2 — decisions that changed the shape of the work

| # | Decision | Chosen |
|---|---|---|
| D8 | Shell ownership | **Lift** rider's `TripSheetHost`/`sheetSlot`/detent logic into `packages/ui` as a generic map+sheet shell. Both apps consume it. Rider imports change; rider layout does not. |
| D9 | Driver tab bar | **Stays, all 6 tabs.** Home sheet detents dock above it: peek `.18` / half `.42` / tall `.78`. |
| D10 | Offer surface | **Hot path is a STAGE CHANGE, not navigation.** From home, tapping a live request swaps sheet content and reframes the already-mounted map. Zero mount, so it physically cannot lag. `(trip)/dispatch/[id]` survives only as the push-notification / cold-start deep link, rendering the same shell. |
| D11 | Stage depth | **Full lifecycle on one surface**: `idle → offer → enroute → arrived → intrip → complete`. The driver's map never unmounts from go-online to drop-off. `(trip)/active` and `(trip)/tracking` become thin deep-link wrappers. |
| D12 | Exhausted pool | A pass removes that driver permanently, but the **search stays alive** for its full window so later supply still gets offered. Only at window end → `NO_DRIVERS_FOUND`. |
| D13 | Skia vs map | On map screens the **map is the identity** — shader paused, no wasted full-screen blend over live GL. Skia runs full-strength on every non-map surface (quests/earnings/trips/notifications/profile — precisely the white ones), and survives on map screens as the sheet's glass tint + a soft top-edge bleed. |
| D14 | Native deps | User is rebuilding natively regardless, so OTA-safety is **not** a constraint. New deps allowed where clearly better — but not added gratuitously. |
| D15 | Verification | tsc (all) → docker stack up → `prisma migrate` → **full `scripts/e2e` 340-check harness** → diff read-back → push. |

### D10 supersedes half of D1
D1 chose snapshot-flight because the destination mount was the cost. D10 removes the destination
entirely on the common path — there is nothing to mount, so nothing to hide. Snapshot-flight is
therefore scoped down to the **cold path only** (push-notification entry), where a real route push
still happens. This is a strictly better answer to item 8 than the one originally chosen.

### D1 amendment (technical, no user decision needed)
`react-native-view-shot` is **not** installed. A native snapshot would force a new EAS build.
Not needed: RN's built-in `shouldRasterizeIOS` / `renderToHardwareTextureAndroid` promotes the
flying layer to a GPU texture with zero new dependencies, and the repo already has the helper at
`packages/ui/src/effects/hardwareTexture.ts`. Combined with a frozen (`memo(() => true)`) clone
that holds no store subscriptions, the flight carries no JS work. Identical outcome to D1.

---

## Root causes proven in code before writing anything

| Item | Root cause | Evidence |
|---|---|---|
| 1 — white background on quests/etc | driver `(tabs)/_layout.tsx` never sets `sceneStyle:{backgroundColor:'transparent'}`; rider does (its line 206). Tab scenes default to the opaque theme background. `home.tsx` hides it by mounting its own `AppBackground`; quests/earnings/trips/notifications do not. | `grep sceneStyle` on both tab layouts |
| 10 — blue-black on create-trip | `shaderSlot` awards the single Canvas to the highest priority claim. Root layout claims `ANIMATED`(1) and **never relinquishes** — it is outside the navigator so `useScreenFocus()` is permanently true. A pushed screen's `STATIC`(0) claim can therefore never win, so it renders only its flat `backgroundDeep` fallback = blue-black. The root is `paused` under a detail screen but still **owns** the slot. | `shaderSlot.ts` `currentOwner()`; `_layout.tsx:654` |
| 2 — toast undismissable / dead button | `DispatchBlockedBanner` has no dismiss state at all. `Check now` fires `beatPresenceNow()` + invalidates `['driver']` with no await, no feedback, and possibly not the key the banner reads. | `grep dismiss` → 0 hits |
| 8 — morph lag | Fixed 4× at the animation layer (layout→transform, inverse-scale, id keying) and still reported. The cost is the **destination mount**: `dispatch/[id].tsx` is 1056 lines + native MapView + road-leg fetches + Skia. | session-log lines 147/168/179 |

---

## Phases

- **P1 Background system** — items 1, 10.
- **P2 Dispatch banner** — item 2.
- **P3 Morph engine** — items 8, 15.
- **P4 Transition system** — item 17 (motion half).
- **P5 Dispatch lifecycle** — items 5, 6, 7, 9 (pass permanent, expiry purge, no fresh counter, dedupe, rider retry).
- **P6 Offer map gating** — item 3 (per D5).
- **P7 Redesigns** — items 4, 12, 16 (map-first driver shell).
- **P8 create-trip hooks crash** — item 11.

Verification gate before push: both apps `tsc` green (`node node_modules/typescript/lib/tsc.js`, `npx` is broken in this sandbox), plus the `scripts/e2e` harness.
