# State — 2026-09-01

## Current Goal
Ship the 11-item pre-sideload pass. 8 done, 3 partly (see below).

## Plan Status
| # | Item | Status |
|---|---|---|
| — | Driver "I agree" dead button | DONE — wrong endpoint + query-key shape collision |
| 1 | Consent screen redesign + exit transition | DONE |
| 2/10 | Smoothness | DONE — 120Hz cap was the cause; stack audits clean |
| 3 | Saved-place label in destination | DONE — `shortAddress` in `@eyego/utils` |
| 4 | Request-stage map frozen / zoomed / back button | DONE |
| 5 | Bare page transitions | DONE — `goOut` verb, 8 call sites |
| 6 | Consent gate reappears after cancel | DONE — rider key collision |
| 7 | improve-map audit | DONE (static) — no defects found |
| 8 | Scan-to-pay audit | DONE (static) — 1 defect fixed (amount dropped on universal link) |
| 9 | Wallet audit + contacts picker | DONE — wallet clean; picker added to send-money + guest-selection |

## Evidence
- Both apps `tsc --noEmit`: clean.
- `yarn test:maps` 33/33, `yarn test:invariants` 2/2.
- Nothing device-verified — no device access from this session.

## Open Issues
- Needs a NEW native build: `CADisableMinimumFrameDuration` is an Info.plist key, so OTA will not deliver it.
- On deploy: `prisma migrate deploy` — MapReport and trip fee price-lock migrations.
- `usePerformanceTier` still classifies iOS as `high` unconditionally (no `expo-device`); deliberately not changed before a sideload.
- Reviewer consent exemption is dead on the driver side — `isReviewer` is a User column and Driver has none.
