# State — Stress Test Sweep 2026-08-17 (21 items)

## Current Goal
Work the user's 21-item stress-test list across rider, driver, backend and admin.

## Plan Status

All 20 reported items addressed. `tsc --noEmit` green: rider, driver, admin. API files parse clean.

| # | Item | Fix |
|---|------|-----|
| 1 | Driver never shows the dispatch offer | `resweep()` re-offers timed-out candidates + supply re-entry nudge |
| 2 | Search stage sits on a bright map | map layer crossfades to 0 on non-map stages; Skia ground shows |
| 3 | Live card opens the request page then bounces home | `/rides/active` verdict wins over the stored id |
| 4 | Activity shows "Unknown → Unknown" | fall back to `trip.pickupAddress`/`dropoffAddress` |
| 5 | Tapping it says "trip not found" | dead-status alert + no-tripId guard |
| 6 | Live card vanishes silently | cleared explicitly, with a toast saying why |
| 7 | Suggested-for-you ring is always green | ring palette follows the tier |
| 8 | No alert when a passenger books | root-level `onPassengerJoined` listener + FCM push |
| 9 | Pickup change invisible to driver; blank ETA | `trip:pickup_changed` event/push; ETA reads the Redis position |
| 10 | Cover-all duplicates the payer | seat map names the payer once; rating deduped per person |
| 11 | 14 seats became 12 | silent clamp replaced by an explicit error; client no longer guesses capacity |
| 12 | Recentre button does nothing | `recenter()` clears the fitBounds memo |
| 13 | Safety page auto-raised an SOS | trail gated on an existing alert + a dedicated Send-SOS button |
| 14 | Admin SOS shows coordinates | reverse-geocoded `address`, coords as fallback/tooltip |
| 15 | Tracking card clipped left/right | sheet padding moved off the surface onto a content wrapper |
| 16 | 14.5 km quoted as 22 min | `realisticDurationMin` floor on every ETA source |
| 17 | Per-seat fare too low | tier base/per-km raised ~30%, floor 3.00 → 4.00 |
| 18 | Complete page showed one seat's fare | receipt row now optional; fare from `getTripFareForRider` |
| 19 | Added email, checkup card unchanged | invalidate + refetch the checklist on focus |
| 20 | Light mode broken | white cards on a toned ground, ring gaps themed, wave un-dimmed |

## Decisions
- Item 1 root cause: `resweep()` filtered fresh candidates with `!seen.has(id)` where `seen` was the whole
  walked list, so a driver who missed one 45 s offer was NEVER re-offered. Resweep now rebuilds the queue
  from live supply minus explicit declines and rewinds `state.index` to 0.
- `supply.upsertDriver` now returns `{ ok, rejoined }`; the driver socket nudges `notifySupplyAvailable`
  only on the absent→present edge, so the same-handset app-switch case re-runs a parked search at once.
- Absolutely positioned children are laid out against the parent's PADDING box. That is items 15 and the
  earlier aurora-clip: moving the node did nothing, the padding had to move.
- Light mode inverts the ELEVATION DIRECTION, not just the numbers: cards are pure white and the page
  carries the tone. Copying dark mode's "card lighter than page" onto white gives a 3% step in the wrong
  direction, which is the whole "washed out" report.
- Pricing (item 17) is a policy change the operator asked for; all six knobs are runtime-tunable through
  `PlatformSetting`, so the defaults in `env.js` are a starting point, not the authority.

## Evidence
- `tsc --noEmit` clean for apps/rider, apps/driver, apps/admin. All modified `eyego-api` files parse.
- NOTHING device-tested. No migration needed; no schema change.

## Open Issues
- Item 16's floor (`ETA_MAX_AVG_KMH`, default 32) is a judgement call — retune once real trips land.
- Item 1's fix is inferred from the code path, not from a reproduced offer; watch the server log for
  "Dispatch re-sweeping supply" to confirm a second offer actually reaches the phone.
- Previous state.md (single-scene motion architecture) backed up to `state.prev.md`.
