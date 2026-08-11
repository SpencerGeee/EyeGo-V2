# Driver & Rider feature lists — audit and status

Audited 2026-08-11 against the codebase, not against memory. Every "already
built" line below was verified by finding the field, endpoint or screen.

---

## Already built — no work needed

| Feature | Where it lives |
|---|---|
| Corporate / business profile billing | `User.businessMode`, `businessCompanyName`, `businessTaxId`, `businessExpenseEmail`; `apps/rider/app/profile/business.tsx` |
| Multi-currency wallet | `apps/rider/app/profile/wallet.tsx`, wallet endpoints, `WalletTransaction` |
| Trusted contacts | `emergencyContact` on both User and Driver; `apps/rider/app/profile/emergency-contacts.tsx` |
| Panic button / SOS | `driverApi.emergencyAlert`, rider SOS flow, `offlineQueue.enqueue('SOS', …)` |
| Multi-stop routing | `stops` / waypoint handling in the ride store and `SelectStage` |
| Scheduled rides | `ScheduledRideIntent`, `apps/rider/app/scheduled-rides.tsx`, `scheduled/[id].tsx` |
| Guest ride booking | `Booking.guestName` / `guestPhone`, `/ride/guest-selection` |
| Live tracking share link | `/track/:shortId` public page |

---

## Shipped this session

**Verify My Ride (PIN).** `Booking.boardingPin` / `pinVerifiedAt`,
`User.requireBoardingPin`. Enforced in `boardPassenger`. Rider sees the code on
`AssignedStage`; driver gets a server-driven keypad. Opt-in.

**Pause Requests.** `Driver.requestsPaused`, enforced in
`driver-availability.js`. Toggle on the driver's active-trip screen.

---

## Not built — with the honest cost of each

Ordered by value per unit of risk, which is the order I would build them in.

### 1. Rider comfort & accessibility toggles — SMALL
Silent mode, AC preference, wheelchair access, bike rack, large pets.
Two halves: preference fields on the booking (trivial), and *filtering* on the
accessibility ones (not trivial — a wheelchair filter is only honest if
`Vehicle` records the capability and dispatch excludes vehicles that lack it).
Comfort preferences can ship alone; accessibility filters need the vehicle
attributes first or the toggle is a lie.

### 2. Driver rating filter & demographic opt-outs — SMALL-MEDIUM
`Driver.minRiderRating` plus a filter in `availableDriverWhere`. The blocker is
not the code: a rider's rating is now computed on read (see `getMe`), so
filtering on it per-dispatch means either denormalising the average onto `User`
or a join per candidate. Denormalise, and update it when a `PassengerRating`
is written.
**Ethical/regulatory note:** "demographic toggles" as specified (opting out of
account types) is fine for pet/teen accounts. Do not extend it to any protected
characteristic — that is discrimination law, not a product decision.

### 3. Split Fare Engine — MEDIUM-LARGE
Invite up to 3 co-passengers, split evenly, bill each on completion.
Needs: a `FareSplit` table, invitations with accept/decline, a rule for what
happens when a co-passenger's card fails (the trip has already happened — who
eats it?), and partial-refund handling on cancellation. The money edge cases
are the work; the UI is the easy part. **Do not ship without deciding the
failed-card rule.**

### 4. Driver-initiated destination edit — MEDIUM
Driver fixes the destination when the passenger cannot use their app.
Needs re-quoting mid-trip against the signed-quote system, rider consent for
the new fare (otherwise it is a driver unilaterally raising the price), and a
`TripEvent` recording who changed it. The consent step is mandatory.

### 5. Trip Radar — LARGE
Decided: broadcast first, sequential cascade as fallback.
Needs a claim race that exactly one driver can win (Redis `SET NX` on
`trip:claim:<id>`), a broadcast window (~15s), and a "best-positioned" tiebreak.
Touches `dispatch-cascade.service.js`, which is the core of the product — this
is the single highest-blast-radius item on the list.

### 6. Reckless driving telemetry — LARGE
Gyroscope + GPS → harsh braking / acceleration / speeding scores.
Needs continuous sensor sampling (battery cost on a phone already running GPS
and a map), an ingest endpoint, aggregation, and a weekly report. Scoring
thresholds must be calibrated against real Ghanaian road data or the scores are
noise that penalises drivers for potholes.

### 7. Area preferences / geofencing with a daily time allotment — LARGE
Partial groundwork exists (`geofence`/zone references, 8 files).
The "2 hours per day" allotment is the hard part: it needs a consumption ledger,
enforcement at dispatch time, and a clear rule for what happens when the
allotment expires mid-trip.

### 8. Idle-time digital tasks — LARGE, and a different product
Data-annotation micro-tasks for drivers waiting in queues.
This is a task marketplace with its own supply, quality control, payment rails
and partner integrations. It shares a login with EyeGo and nothing else.
Recommend scoping it as a separate initiative, not a driver-app feature.

---

## Encrypted "Record My Ride" — NOT BUILT, deliberately

Flagged for legal review before any code, per the decision taken this session.
The engineering is the easy part; these are the things that will sink it if
they are decided after the fact rather than before.

**Consent.** Recording a passenger requires their knowledge in most
jurisdictions, and Ghana's Data Protection Act 2012 (Act 843) treats audio of
an identifiable person as personal data. A driver-only toggle is not consent
from the passenger. At minimum this needs an in-app notice to the rider when a
recording-enabled driver accepts, and an in-cabin sticker.

**Key custody.** "Neither the driver nor the platform can view it" is a real
cryptographic requirement, not a policy promise. If the platform holds the key,
the platform can be compelled to produce the content. A workable shape:
encrypt on-device to a key held in the device keystore, and only release it —
re-encrypted to a platform key — when the driver attaches it to a safety report.
Decide who can decrypt at that point, and what a subpoena gets.

**Retention.** Un-submitted recordings need an automatic expiry (24–72h is
typical) or the phone accumulates an indefinite archive of passengers' private
conversations. This is the single most likely source of a serious breach.

**Store review.** Both Apple and Google scrutinise background audio/camera
capture. Expect to justify it in review and to need a privacy-manifest entry
and a clear purpose string. Front-camera capture of an unconsenting passenger
is the version most likely to be rejected.

**Recommendation.** If it is built, build audio-only first, with explicit rider
notification, device-keystore encryption, and a hard retention cap. Get the
consent flow reviewed by a Ghanaian data-protection lawyer before writing the
capture code, not after.
