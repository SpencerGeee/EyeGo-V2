# EyeGo V2 — Production Roadmap

This document maps the 16 gaps identified in the production-hardening analysis to
their current status.  Items marked **Already done** were verified against the
codebase.  Items under **This session** were implemented in the current batch.
Items under **Deferred** are considered premature for the current sandbox stage;
each carries a rationale for the deferral.

---

## Already Done (verified in codebase)

| # | Item | Evidence |
|---|------|----------|
| 1 | **Async safety** – `express-async-errors` catches rejected promises | `require('express-async-errors')` at the top of `app.js` |
| 2 | **Global error handler** – single `AppError` hierarchy with `isOperational` flag | `middleware/errorHandler.js` + `utils/errors.js` |
| 3 | **Zod env validation** – app refuses to start when vars are missing | `config/env.js` runs `envSchema.safeParse` and calls `process.exit(1)` on failure |
| 4 | **Singleton PrismaClient** – no connection leak | `config/database.js` caches the instance |
| 5 | **Serializable transactions** – `$transaction` with `isolationLevel: 'Serializable'` on seat/wallet | `bookings.service.js` bookSeat; `payments.service.js` confirmPayment |
| 6 | **Redis GEOSEARCH dispatch** – spatial driver matching, not naive haversine | `services/dispatch.service.js` uses `redis.georadius` |
| 7 | **Graceful shutdown** – SIGTERM/SIGINT drains sockets & Prisma | `server.js` has `process.on('SIGTERM'…')` |
| 8 | **Winston logging** – structured, daily-rotate files | `utils/logger.js` configures `winston-daily-rotate-file` |
| 9 | **express-validator** – request validation enforced on routes | `validate` middleware used across all module routes |

---

## This Session (implemented)

| # | Item | Files |
|---|------|-------|
| 10 | **Crash/error tracking (backend)** – Sentry with DSN guard, no-op when unset | `config/sentry.js`, wired into `app.js` + `middleware/errorHandler.js` |
| 11 | **Crash/error tracking (apps)** – JS-level `captureException` in rider + driver, global handler + ErrorBoundary | `lib/sentry.ts` in both apps; `_layout.tsx` + `ErrorBoundary.tsx` / `AppErrorBoundary` |
| 12 | **Remove mock fallbacks** – no fake data reaches users; EmptyState + real errors | `payment.tsx`, `seat.tsx`, `ride/[id].tsx`, `ride/select.tsx`, `profile/business.tsx` |
| 13 | **Payment idempotency** – `Idempotency-Key` header scoped by userId+endpoint, 24h TTL, 409 on concurrent dupes | `middleware/idempotency.js`, `prisma/schema.prisma` (`IdempotencyKey` model), `payments.routes.js` |
| 14 | **Per-user rate limiting** – `bookingCreateLimiter` + `paymentInitiateLimiter` keyed by `req.user.id` | `middleware/rateLimiter.js`, `bookings.routes.js`, `payments.routes.js` |
| 15 | **Demand heat map** – GET `/v1/heatmap` returns bucketed demand cells combined with Redis GEOSEARCH supply | `modules/heatmap/` (controller, routes, service), `apps/driver/components/DemandOverlay.tsx`, homepage integration |
| 16 | **Quest / bonus system** – `DriverQuest` + `DriverQuestProgress` models; auto-credit wallet on completion | `prisma/schema.prisma`, `modules/quests/` (controller, routes, service), hooks in `trips.service.js` completeTrip, `apps/driver/app/(tabs)/quests.tsx` |
| 17 | **Anonymized contact relay** – POST `/v1/contact/call`, placeholder relay number, phone stripped from serializers | `prisma/schema.prisma` (`CallSession`), `modules/contact/` (controller, routes, service) |
| 18 | **Ride-check / route-deviation safety** – `distanceToPolyline`, stopped-too-long detection, `safety:check` socket event | `utils/geo.js`, `sockets/driver.socket.js`, `safetyState` Map, `apps/rider/components/SafetyCheckModal.tsx` |

---

## Deferred (post-launch)

| # | Item | Rationale |
|---|------|-----------|
| 19 | **Kafka / event bus** – pub-sub for async flows | A modular monolith with Prisma transactions and Socket.io is correct and sufficient for sandbox-stage. Kafka adds operational complexity (ZooKeeper/KRaft, partitioning, consumer-group management) with zero benefit at current scale (< 1K daily trips). Defer until the platform processes > 10K trips/day or we need replay for non-trivial downstream consumers. |
| 20 | **Microservices decomposition** – break monolith into independent services | Premature. A well-structured modular monolith (separate route modules, shared middleware, transaction boundaries) outperforms fragmented services in iteration speed, debugging, and deployment complexity at sandbox stage. Defer until the team grows to 3+ squads or we hit a demonstrable scaling bottleneck. |
| 21 | **S2 / H3 geospatial indexing** – Uber H3 hexagonal grid for dispatch | Redis GEOSEARCH (backed by `GEOADD` + `GEORADIUS`) already provides sub-millisecond spatial queries at thousands of concurrent drivers. H3 is valuable for analytics/pricing zones but is premature for dispatch routing at sandbox scale. Revisit when driver count exceeds 5,000 in a single city. |
| 22 | **Fraud ML pipeline** – model-based fraud detection for payments/rides | Rule-based guards (idempotency keys, rate limits, duplicate-reference detection in webhooks) catch the vast majority of accidental double-charges and abuse patterns. A fraud ML model requires labelled historical data, feature engineering, and a feedback loop that doesn't exist yet. Defer until the platform has 6+ months of transaction history. |
| 23 | **Ops dashboard** – operations/admin UI for real-time monitoring | The admin SPA (`/admin`) already covers basic trip/payment overview. A full ops dashboard (driver-approval workflow, dispute resolution, heat-map analytics) is scope-creep for the current sandbox phase. Build when the first batch of real drivers is onboarded. |
| 24 | **A/B feature flags** – gradual roll-out of new features | Feature flags add testing/QA overhead (variant assignment, metric pipeline, cleanup). At sandbox stage, every user runs the same code. Defer until the platform has > 1,000 MAU and we need to validate a UX change. |
| 25 | **Audio recording** – in-cabin audio for safety disputes | Recordings require data-privacy review (Ghana's Data Protection Act), consent flows, secure storage, and a playback UI — all non-trivial. The existing SOS screen + route-deviation checks provide a safety baseline. Defer as a post-launch premium safety feature. |
| 26 | **Multi-stop trip booking** – riders book multiple destinations on one trip | The current seat-based model (point A → point B with optional en-route stops from virtual stops) covers > 90 % of shared-transit use cases. Multi-stop requires a v2 route-engine redesign. Defer until rider feedback confirms demand. |

---

## Key Principles

- **Correctness before scale.**  Every payment flow runs inside Serializable
  transactions; idempotency keys prevent double-charges; real errors surface
  instantly instead of being hidden behind mock data.
- **Safety-first architecture.**  Route-deviation detection, stopped-too-long
  alerts, and an SOS screen with live-location sharing work even in sandbox.
- **Measured growth.**  Driver quests and demand heat maps give organic growth
  levers without building a full gamification or surge-pricing engine.
- **Honest sandbox.**  No fake data ever ships to real users.  Missing
  integrations (Twilio voice, real payouts) are documented placeholders, not
  silent fallbacks.
