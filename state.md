# State — 2026-10-07 (pass 3)

## Current Goal
User approved: platform funds promo excess, reusable promos (per-rider limit), Try-again keeps boost,
commit + push at the end. Also: finish the audit deeply (false positives), milk the rival spec, both apps.
No subagents (user: "do everything yourself"). ALL work still uncommitted.

## Done in pass 3
- Migration 20261007120000_promo_subsidy_per_user_limit APPLIED locally (Booking.promoSubsidyPesewas,
  Promotion.perUserLimit). Client generate hit EPERM (dev server locks engine DLL) → JS client was
  generated; copied prisma/schema.prisma into node_modules/.prisma/client so the boot guard passes.
- applyPromoCode: commission absorbs discount, excess → promoSubsidyPesewas; perUserLimit (null = reusable).
  Admin: createPromotion accepts perUserLimit/reusable; PromotionsManager has "Uses per rider" + checkbox.
- completeTrip credits PROMO_SUBSIDY (EARNING_TYPES updated), returns totalEarningsPesewas, ledger chain
  fix, removed duplicate rider push ("You saved GH₵<fare>") + duplicate pubSub (trip-notify owns them),
  retries VERSION_CONFLICT (completeTripOnce wrapper).
- arriveTrip (group completion) now = ownership check + completeTrip (was a drifted 2nd settlement:
  env-rate commission, missed 'MOMO', counted cash holds).
- commissionRateFor(trip) (pinned → live setting) replaces env.PLATFORM_COMMISSION in bookings/offline pax.
- Refunds: state machine terminal release refunds PAID non-cash seats (CANCELLED/EXPIRED/NO_DRIVERS/
  NO_SHOW) via idempotent refundBookingForDriverCancellation (claims PAID→REFUNDED, skips CASH).
  driverNoShow used to write a REFUNDED record and move NO money. cancelRide block removed (machine does it).
- departTrip + start-path unpinned expectedVersion (boarding event race → "moved on" 409).
- Rider: Try again re-applies the carried boost in 30/20/10 steps.
- New e2e: scripts/e2e/money-flows.mjs (registered in run-all) — 9/9 green.

- Account deletion guarded: live ride/trip → hard 409; positive wallet → 409 WALLET_NOT_EMPTY that the
  client confirms and resends with `acknowledgeBalance` (rider wallet has no withdrawal; driver min
  withdrawal GH₵20 — a hard block made deletion impossible); driver debt → hard 409 (top-up clears it).
  Guards used 'REFUNDED' in a TripStatus notIn → 500; now TERMINAL_STATUSES from trip-state.
  Controllers delete THEN blacklist (blacklist-first signed out a refused deletion).
  Driver deletion also clears photo/DOB/emergency contact; KYC kept (retention = legal decision, flagged).
  Driver deletion screen copy was false (auto-cancel, payout transfer, 30-day purge) → rewritten.
- adjustDriverWallet ledger before/after read inside the tx (verified credit/debit/overdraft in-process).
- Checked OK: admin rider adjustments use the ledger; IDOR spot-check fine; quest claim atomic.
- Verified: tsc rider/driver/admin 0; static suites green; driver-features 41/41, money-flows 10/10,
  rider-edges 30/30, rider-settings 83/83.
- ECC continuous-learning hook: ECC_DISABLED_HOOKS had the wrong ids (see memory) → fixed in ~/.claude.

## Next
1. run-all (e2e-runall9 in scratchpad) → commit + push.
2. Open: OTP rate limits, scheduled trips audit; more rival-spec features.
