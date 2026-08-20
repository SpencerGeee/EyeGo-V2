# Admin console — enterprise completion

_2026-08-20 · follow-on from `ADMIN_E2E_TEST_REPORT.md`_

Goal: close every gap that stands between this console and one a support desk,
a finance team and a compliance officer could actually run a business on.

## Phase 1 — Money operations  ⬅ the biggest hole

There is **no rider wallet ledger**. `WalletTransaction` is driver-only, so
`User.walletBalancePesewas` moves with no audit trail at all. Refunds cannot be
built honestly on top of that, so the ledger comes first.

- [x] `RiderWalletTransaction` — mirrors the driver ledger's `balanceBefore + amount = balanceAfter` invariant
- [x] `Refund` model — amount, reason, destination (wallet | gateway), actor, booking, state
- [x] `refunds.service` — atomic: ledger row + balance move + booking state, one transaction
- [x] `POST /admin/bookings/:id/refund` (full or partial, idempotent)
- [x] `POST /admin/users/:id/wallet-adjust` and `/admin/drivers/:id/wallet-adjust` (credit or debit, reason mandatory)
- [x] RBAC: FINANCE + SUPERADMIN only; every action audited
- [x] Console: refund control on booking rows + trip detail, wallet adjust on both detail pages, `/refunds` ledger page

## Phase 2 — Data export

- [x] RFC 4180 CSV writer (no dependency), streamed
- [x] `GET /admin/export/:dataset.csv` — trips, bookings, drivers, users, revenue, refunds, audit-logs
- [x] Honours the caller's current filters, capped, and **the export itself is audited** (who took what data, when)
- [x] Console: Export button on every list page, carrying that page's filters

## Phase 3 — SOS: real alerting and real triage

Today the fan-out exists in Redis but only a mobile-only endpoint registers
tokens, so an alert reaches nobody from the web console. And an event has only
`resolvedAt`, so a queue 28 deep with 3-day-old entries is permanently red.

- [x] `SosEvent`: `status` (OPEN | ACKNOWLEDGED | RESOLVED), acknowledged/resolved by whom and when, `outcome` note
- [x] Alert fan-out on creation: FCM multicast to admin tokens **plus SMS to an on-call list** driven by a platform setting
- [x] `POST /admin/sos-events/:id/acknowledge`, richer `/resolve` taking an outcome
- [x] Console: acknowledge → resolve flow showing who holds it, age banding, unacknowledged-first ordering

## Phase 4 — Admin MFA (TOTP)

Password-only on accounts that can reprice the platform. Riders get an OTP;
admins get less.

- [x] RFC 6238 TOTP on `crypto` (no dependency), ±1 step drift, single-use replay guard
- [x] `AdminUser`: `totpSecret`, `totpEnabledAt`, hashed single-use backup codes
- [x] Enrol / verify / disable endpoints; login becomes password → TOTP challenge
- [x] Superadmin can require MFA platform-wide (setting) and reset a locked-out admin's MFA
- [x] Console: enrolment on `/settings` with a QR, backup codes shown once

## Phase 5 — Case notes

- [x] `AdminNote` — polymorphic (`subjectType`/`subjectId`), append-only, author attributed
- [x] Endpoints + a note panel on rider, driver and trip detail

## Phase 6 — Operator leverage

- [x] Date-range control on Analytics and Revenue (replacing hard-coded windows)
- [x] Global search across riders, drivers, trips and bookings — one box, ⌘K, phone numbers matched on their last nine digits
- [x] Saved views via shareable filter URLs — every filter and range lives in the URL, so "the view I am looking at" is a link
- [x] Bulk driver actions — **API only**, deliberately not surfaced on the approvals queue

### Why bulk approval has no button

`/drivers/pending` carries a stated rule: approval happens on the driver's own
page, "because approval requires reading three documents and a one-click approve
from a list is an invitation to rubber-stamp."

That reasoning holds. Bulk-approving drivers whose Ghana Card and licence nobody
opened is how a compliance process becomes a formality — and the failure lands
on a passenger, not on the console. `POST /admin/drivers/bulk` exists, is
audited per driver, and reports partial success, so a genuine reviewed batch can
be pushed through by script or by a later screen built for it deliberately. What
is not offered is a select-all next to an unread queue.

## Out of scope, and why

- **Scheduled/emailed reports** — no mail transport exists in the stack; adding one is an infra decision, not a console one. CSV export covers the need manually.
- **IP allowlist** — belongs at the reverse proxy, not in application code.
- **WebSocket push into the console** — every page already polls on a sensible interval; a socket is an optimisation, not a gap.
- **Paystack payout batching** — needs the Transfers API and a live merchant account to test against.
