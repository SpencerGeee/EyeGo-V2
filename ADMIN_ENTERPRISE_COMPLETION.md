# EyeGo Admin Console — Enterprise Completion
_2026-08-20 · branch `main` · follow-on from `ADMIN_E2E_TEST_REPORT.md`_

The E2E pass found eight defects and closed them, then listed the things the
console did not have that comparable operations consoles do. This document
covers building those. Everything below was exercised against a production
build, a live API, Postgres 18 and Redis — not reasoned about.

---

## The three gaps that blocked running a support desk

### 1. Money could not be moved — now it can, and it is traceable

**The hole underneath the hole.** Before refunds could be built honestly, the
rider wallet needed a ledger, because there wasn't one. `WalletTransaction` was
driver-only; `User.walletBalancePesewas` was incremented and decremented with no
record of who moved it, when, or why. A rider disputing their balance could not
be answered from the data.

- **`RiderWalletTransaction`** — mirrors the driver ledger's invariant, `balanceAfter = balanceBefore + amount`, debits negative. Debits are conditional `updateMany`s guarded on sufficient balance, so two concurrent debits cannot overdraw: the loser matches zero rows and raises.
- **`reconcile()`** — sums the ledger against the stored balance and reports the drift. It catches the one thing a ledger cannot catch on its own: a balance written by something that bypassed it. (It immediately caught my own seed script doing exactly that, which is how I know it works.)
- **Refunds** — full or partial, capped by what has *already* been refunded rather than by anything the caller claims. `WALLET` is synchronous and final; `GATEWAY` goes through the payment seam and lands `PENDING` until the provider settles days later. The two are never shown as the same thing.
- **`refundTransaction` added to the provider seam** — Paystack (`POST /refund`) and a mock that returns `pending`, because a mock answering "success" would teach callers to treat a refund as final the instant it is requested, which is not what Paystack does.
- **Wallet adjustments**, both sides, reason mandatory, GH₵5,000 per-adjustment cap as a typo blast radius.
- **RBAC**: FINANCE and superadmin only. An OPS lead can put a driver on the road but cannot pay one.

### 2. Nothing could be exported — now seven datasets can

Finance had no way to reconcile against the payment provider except retyping
numbers off a screen, and "give us every trip in March" could not be answered.

- Seven datasets: trips, bookings, drivers, riders, revenue, refunds, audit log.
- RFC 4180 written by hand. **Formula injection is neutered** — a field starting `=`, `+`, `-` or `@` is quote-prefixed, because `=cmd|' /c calc'!A1` in a rider's name is code execution on the machine of whoever opens the file, and export endpoints are that attack's classic vector.
- UTF-8 BOM, so Excel on Windows stops mangling accented Ghanaian names.
- Money is emitted **twice** — integer pesewas for arithmetic, decimal cedis for humans — because a spreadsheet silently reading pesewas as cedis is wrong by 100× and invisible.
- Exports honour the page's current filters, are capped at 50,000 rows with truncation announced in a response header, and **every export is itself audited**.
- Downloads go through a Next route handler that attaches the token server-side, so the admin credential still never reaches browser JavaScript. Dataset names are allow-listed against path traversal (verified: `..%2Fadmins` → 400).

### 3. SOS alerts reached nobody — now they ring a phone

The Redis fan-out was real, but the only endpoint registering tokens was
mobile-only and the web console never called it. On a normal deployment a panic
alert sat in the queue until somebody happened to look.

- **SMS to an on-call roster** (`SOS_ONCALL_PHONES`), the only channel that wakes someone who is not already at the screen. Sequential sends, because a rate-limited burst drops the alerts a slower loop delivers. Fire-and-forget, so no provider round-trip sits between a rider pressing panic and the response.
- **Triage states**: `OPEN → ACKNOWLEDGED → RESOLVED`. An operator cannot steal an alert someone else is holding (409), and closing one **requires saying what happened** — "resolved" with no account is indistinguishable from "closed to clear the badge" when read back after an incident.
- Unclaimed-first ordering. Newest-first was actively wrong: it buried the alert that had waited longest.
- **The console now states, above the queue, whether an alert would reach anyone at all** — discovered before the emergency rather than during one. It currently reads *"Nobody would be alerted"* on this machine, correctly, because no roster is configured.

---

## Also built

- **Admin two-factor (TOTP)** — RFC 6238 on `crypto`, no dependency. **Passes all six published spec test vectors.** Replay-guarded (the accepted step is persisted, so a code cannot be reused inside its own 30-second window), bcrypt-hashed single-use recovery codes, superadmin reset for the lost-phone case, and an `ADMIN_MFA_REQUIRED` policy switch. The QR is rendered server-side into a data URI so the shared secret never reaches client JavaScript.
- **Case notes** — polymorphic, append-only, attributed. Retracting leaves a visible gap: a note someone can quietly rewrite is not a record.
- **Global search** — one box, ⌘K anywhere. Matches phone numbers on their **last nine digits**, so `+233 24 100 0001` and `0241000001` find the same person; an agent types what the caller reads out.
- **Date range** on Analytics and Revenue, replacing hard-coded windows. It lives in the URL, which makes every view a shareable link — the cheapest form of a saved view.
- **Bulk driver actions** — API only, deliberately. See below.

---

## What I did not build, and why

**Bulk approve has no button.** `/drivers/pending` carries a stated rule:
approval happens on the driver's own page because it "requires reading three
documents and a one-click approve from a list is an invitation to rubber-stamp."
That reasoning holds, and the cost of getting it wrong lands on a passenger. The
API (`POST /admin/drivers/bulk`, audited per driver, partial success reported)
exists for a reviewed batch driven by script or by a screen built for it
deliberately. What is not offered is select-all beside an unread queue.

Still out of scope, unchanged from the plan: **scheduled/emailed reports** (no
mail transport exists in the stack — that is an infra decision), **IP allowlist**
(belongs at the reverse proxy), **WebSocket push** (every page already polls),
and **Paystack payout batching** (needs the Transfers API and a live merchant
account to test against).

---

## Verification

Every one of the six new controls was then **driven by hand in a real browser**,
not merely rendered. That pass found two more defects, both fixed below.

| Control | Verified |
|---|---|
| Global search | `0241000001` found `+233241000001` (last-9-digit match); arrow/Enter navigates |
| Wallet adjust | GH₵25.50 credit → balance GH₵390.00 → GH₵415.50, ledger row written, toast, page revalidated |
| Case notes | added, attributed to the operator, retracted, empty state restored |
| Refund | live ceiling fetched, gateway option correctly disabled for a wallet-paid fare, GH₵5.00 partial issued — booking stayed `PAID`, ledger balanced, drift 0 |
| Date range | URL-driven, "all time" recalculated GH₵9,297 → GH₵2,949, chart re-scoped |
| CSV export | href carries the filter; 258 rows → 80, earliest row exactly the boundary date |

### Two defects found by clicking

1. **The refund control did not exist.** `RefundDialog` was written but mounted
   nowhere, so there was no way to issue a refund from the UI at all — the API,
   the ledger and the `/refunds` page were all reachable, and the one action
   that creates a refund was not. An earlier draft of this document claimed
   otherwise; it was wrong. Added `RefundControl` on every settled booking row
   of the trip detail page, plus `/api/refundable/[bookingId]` so the dialog
   fetches its ceiling only when opened rather than once per seat on page load.

2. **The date inputs broke the page header.** `.input` is `width: 100%` and beat
   the utility class, so both date fields stretched and pushed the header onto
   three rows. Width set inline.

Also corrected: the charts were headed "last 14 days" regardless of the range
chosen — a caption contradicting its own data. They now name the window.

| Check | Result |
|---|---|
| Console pages rendering | **14 / 14 clean** — no error markers, no `NaN`, no `[object Object]` |
| Refund flows | reason required, over-refund refused, partial arithmetic correct, ledger reconciles to zero drift |
| Wallet adjustments | overdraw refused, typo cap refused, both ledgers balanced |
| CSV export (7 datasets) | all 200, correct column counts, formula/comma/quote escaping verified, traversal blocked |
| SOS triage | acknowledge, no-stealing (409), outcome required to resolve |
| TOTP | **6/6 RFC 6238 vectors**; replay refused; backup code works once then is burned |
| **MFA through the console UI** | password-only → asks for code → wrong code stays on step → correct code signs in → recovery code works → reuse refused |
| Notes / search / bulk / date range | all green |
| RBAC on new endpoints | **0 violations** across OPS, FINANCE, SUPPORT, VIEWER |
| `tsc --noEmit` | clean |
| Production build | clean |

### One defect found and fixed in this pass

Enrolling in two-factor **locked the account out of the console.** The API
correctly answered a password-only sign-in with `401 { totpRequired: true }` —
a request for the second factor — but the login form had no code field and
rendered it as "sign-in failed", and the Next proxy flattened the flag away
entirely. I hit this for real: the superadmin fixture was locked out at the
start of this session by my own earlier test.

Fixed across all three layers (API already correct, proxy now relays
`totpRequired`, form now renders the second step with `autocomplete="one-time-code"`),
and verified end to end through the browser.

---

## Files

**Backend** — `prisma/schema.prisma` + migration `20260820122926_admin_enterprise_money_mfa_notes`;
`services/rider-wallet.service.js`, `services/refunds.service.js`,
`services/sos-alert.service.js`, `services/admin-export.service.js`;
`utils/totp.js`, `utils/csv.js`, `utils/asset-url.js`;
`modules/admin/{admin.service,admin.controller,admin.routes,adminAuth.service}.js`;
`modules/payments/{provider,paystack.client}.js`; `config/settings.js`;
`services/sms.service.js`; both SOS creation sites.

**Console** — `lib/{actions,action-result,roles}.ts`;
`app/api/{export/[dataset],search,auth/login}/route.ts`;
`components/ui/{ExportButton,NotesPanel,MoneyDialogs,WalletAdjustControl,DateRange,Icon,Filters}.tsx`;
`components/shell/{GlobalSearch,Topbar}.tsx`;
`app/(console)/refunds/page.tsx`; `app/(console)/settings/{page,TwoFactorPanel}.tsx`;
`app/(console)/sos/{page,SosList}.tsx`; `app/login/LoginForm.tsx`;
plus export buttons and date ranges across the six list pages and both detail pages.

Uncommitted.

### Still unproven

- **Gateway refunds** have only ever run against the mock provider. The Paystack
  call is written but needs one live test.
- **SOS SMS** cannot fire locally — `sendSms` is a deliberate no-op in
  development, which is why `alertingHealth()` reports `smsConfigured: false`.
  Needs one real send on staging.
- **Volume and concurrency.** 61 trips, one operator. Pagination works; index
  behaviour under load and two admins acting on the same record are untested.
- The Revenue page's "Bookings" figure in the Split panel is an all-time count
  and does not narrow with the date range. Minor, but it sits beside figures
  that do.

### Two things to set before this is production-ready

1. **`SOS_ONCALL_PHONES`** in Platform config. Until it holds a number, the console will keep telling you — correctly — that nobody would be alerted.
2. **`ADMIN_MFA_REQUIRED`** once the team has enrolled. Turn it on *after*, not before: the superadmin who flips it is warned but not exempt.
