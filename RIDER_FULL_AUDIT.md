# EyeGo V2 — Rider-Centred Full Audit (runtime + static)
_Started 2026-08-20 · branch `main` · local stack: Postgres 18 + Redis 7 (docker) + `eyego-api` on :5020_

This audit is **independent of `PRODUCTION_READINESS_AUDIT.md`**. That one was
100% static and said so. This one leads with the thing that one could not do:
**boot the stack and drive the real endpoints and sockets.** Static reading is
used only where runtime cannot reach (store config, native modules, UI layout).

Legend: `[ ]` not started · `[~]` in progress · `[x]` done · `❌` defect found

---

## 0. HARNESS

- [x] 0.1 Docker Postgres + Redis healthy
- [x] 0.2 `prisma migrate status` clean against local DB (10 migrations)
- [x] 0.3 API boots on :5020, `/health` 200
- [ ] 0.4 Seed a rider, a driver (ACTIVE + vehicle), an admin
- [ ] 0.5 E2E driver script: HTTP + socket.io client for both namespaces

---

## 1. RIDER ↔ BACKEND CONTRACT (runtime)

Every method in `packages/api` called for real against the running server.

- [ ] 1.1 Enumerate every export in `packages/api/src/*.api.ts` → method + path
- [ ] 1.2 Enumerate every mounted route in `eyego-api/src` → method + path
- [ ] 1.3 Diff: client method with no server route (404 class)
- [ ] 1.4 Diff: server route no client reaches (dead surface)
- [ ] 1.5 Response-envelope shape: does each client unwrap match what the server wraps?
- [ ] 1.6 Auth: every rider call with a rider token; confirm no 401/403 surprises

## 2. RIDER LIFECYCLE (runtime E2E)

- [ ] 2.1 Phone → OTP → verify → token; refresh; deactivated-account refusal
- [ ] 2.2 Register/profile; `/user/me` envelope
- [ ] 2.3 Places: search, geocode, saved places (Home/Work slots)
- [ ] 2.4 Quote: fare for each product/tier; determinism; expiry; re-quote
- [ ] 2.5 Book on-demand → dispatch cascade → driver offer → accept
- [ ] 2.6 Socket: rider joins trip room, receives every lifecycle frame, seq contiguous
- [ ] 2.7 Driver arrive → boarding PIN → start → complete
- [ ] 2.8 Rate + tip; receipt
- [ ] 2.9 Cancel at each stage; fee correctness both sides
- [ ] 2.10 Group/seat booking: hold → confirm → release; seat accounting invariants
- [ ] 2.11 Scheduled / reserved ride execution
- [ ] 2.12 Wallet: top-up, send, balance ledger integrity
- [ ] 2.13 Chat rider↔driver both directions
- [ ] 2.14 SOS
- [ ] 2.15 Dispute / trip report
- [ ] 2.16 Account deletion → token revoked → phone reusable

## 3. RIDER APP STATIC (what runtime cannot reach)

- [ ] 3.1 Every screen file → its data source → a real endpoint
- [ ] 3.2 Every mutation has onError + user-visible failure
- [ ] 3.3 Stores: trip.store, auth store — state transitions, stale reads
- [ ] 3.4 Offline/empty/error states
- [ ] 3.5 Deep links / expo-router routes all resolvable
- [ ] 3.6 app.json permissions, ATS, versioning, EAS
- [ ] 3.7 `tsc --noEmit` green

## 4. DRIVER CORRESPONDENCE

- [ ] 4.1 Every rider-visible field the driver writes, and vice-versa
- [ ] 4.2 Status-string contract identical both sides
- [ ] 4.3 Money units identical both sides (pesewas)
- [ ] 4.4 Socket frame shapes identical both sides
- [ ] 4.5 Driver-side E2E half of §2 run for real

## 5. SHARED PACKAGES

- [ ] 5.1 `packages/api` — envelope handling, retry policy, error mapping
- [ ] 5.2 `packages/types` — drift vs prisma schema and vs both apps
- [ ] 5.3 `packages/ui` — components used by both apps behave the same
- [ ] 5.4 `packages/config`, `packages/utils`, `packages/maps`, `packages/map-styles`
- [ ] 5.5 No deep imports past a package root

## 6. MOTION AUDIT (the animation brief)

- [ ] 6.1 Inventory: every animated surface in rider + driver
- [ ] 6.2 `withTiming` on a primary subject (should be spring)
- [ ] 6.3 Interruptibility: gesture mid-flight grabs velocity, never resets
- [ ] 6.4 Property-group coherence: position/size/radius/shadow settle together
- [ ] 6.5 Staggered content reveal inside sheets
- [ ] 6.6 Elevation animated, not binary
- [ ] 6.7 JS-thread stalls in a transition path (await before animate)
- [ ] 6.8 Invariants held (Pressable source, absoluteFill padding box, flex:1,
      scale origin, MapLibre camera imperative, fitBounds guard, runOnJS,
      one Skia canvas)
- [ ] 6.9 `usePerformanceTier` degrades secondary effects before primary

---

## FINDINGS

_(filled in as they are found)_
