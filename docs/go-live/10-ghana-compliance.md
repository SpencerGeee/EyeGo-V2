# Ghana — regulatory and legal checklist

_Draft, 2026-08-31. **Written by an engineer, not a lawyer.** Everything here
needs confirming with Ghanaian counsel and with the regulators named. It exists
so the client knows what to ask about, not so they can skip asking._

---

## 1. Data Protection Commission registration — the one people miss

Ghana's **Data Protection Act, 2012 (Act 843)** requires anyone who determines
the purpose and manner of processing personal data to **register with the Data
Protection Commission**. Not a filing after the fact — registration.

EyeGo is squarely a data controller: names, phone numbers, precise location
histories, Ghana Card numbers, driving licences, payment identifiers.

**Action:** register with the DPC (`dataprotection.org.gh`) before launch.
Budget for a fee and processing time. Renewal is periodic.

The Act also gives data subjects rights the product must be able to honour:
access, correction, and deletion. The apps already have deletion in-app and the
platform anonymises rather than hard-deletes where financial records must be
retained — that distinction should be stated in the privacy policy and checked
by counsel, because "we kept your trip records after you asked us to delete your
account" needs a lawful basis, and record-keeping for tax and dispute purposes
usually is one.

---

## 2. Ride-hailing / commercial transport licensing

Regulation of ride-hailing in Ghana has been moving. Confirm current
requirements with:

- **Driver and Vehicle Licensing Authority (DVLA)** — vehicle roadworthiness,
  driver licensing, and the commercial-use classification. A private-use vehicle
  carrying paying passengers is not automatically permitted.
- **Ghana Police Service / MTTD** — commercial passenger vehicle rules.
- **Local assembly permits** — some jurisdictions require an operating permit
  for commercial passenger transport.

Ask specifically:

1. Does the platform itself need an operator's licence, or only the drivers?
2. Must drivers hold a commercial (Class C+) licence rather than a private one?
3. Is commercial passenger insurance mandatory for drivers on the platform, and
   is the platform liable if a driver's has lapsed?

Question 3 is why `DriverDocument` now carries `expiresAt` and blocks a driver
from going online on an expired insurance or roadworthiness certificate.
Whatever the legal answer, dispatching a rider into an uninsured car is an
exposure the operator carries.

---

## 3. Payments

**Paystack is the licensed payment service provider** and handles the regulated
part. EyeGo holds a wallet balance for riders and drivers, which is worth
raising with counsel: depending on how it is structured, holding customer funds
can look like deposit-taking or e-money issuance, both of which the **Bank of
Ghana** regulates.

Points to confirm:

- Does the rider wallet constitute stored value requiring a BoG licence, or is
  it a prepayment for services?
- Driver payouts to mobile money — any reporting obligation?
- Commission and fees: **VAT treatment**, and whether EyeGo's invoice to the
  driver or to the rider is the taxable supply.

Mitigation available in the product today, if it becomes necessary: the rider
wallet can be made a top-up-only balance with no cash-out path, which is a
materially different thing from stored value. That is a settings and policy
change, not a rebuild.

---

## 4. Tax

- **Corporate registration** with the Registrar General.
- **TIN** and **VAT registration** with the GRA where thresholds are met.
- **Driver income.** Drivers are almost certainly independent contractors rather
  than employees — get that written into the driver terms, and confirm it,
  because it is exactly the question that gets litigated in every market where
  ride-hailing has grown. Whether the platform must withhold anything is a GRA
  question.
- Keep the earnings ledger. `PaymentTransaction`, `WalletTransaction` and
  `RiderWalletTransaction` are the record; do not prune them on a retention
  schedule written for personal data.

---

## 5. Insurance

- **Platform liability insurance** — what happens in an accident during a trip.
- **Driver commercial passenger insurance** — mandatory or not, the platform
  now records the certificate and its expiry, and blocks an expired one at
  go-online.
- Whether the platform's cover extends to a passenger while a trip is in
  progress is a question for the broker, and the answer belongs in the terms.

---

## 6. Employment and driver classification

Get the driver agreement drafted properly. The distinction that matters is
control: minimum-occupancy rules, acceptance-rate consequences and cancellation
cooldowns all look like control, and they are all features this platform has.
None of them is wrong to have — they need to be described in a contract that a
Ghanaian employment lawyer has read.

---

## 7. Consumer protection

- Fares must be transparent before the ride is confirmed. They are: the fare
  card is published through `/v1/config/public` and the breakdown adds up to
  what is charged.
- Cancellation fees must be disclosed before they are charged.
- A complaints route must exist — the in-app support tickets are it, and the
  support email on the store listing must reach a person.

---

## 8. Accessibility

Not currently a Ghanaian legal requirement as far as this document's author
knows, but both app stores surface accessibility, and the apps already carry
screen-reader labels and a 1.4× font-scaling cap. Worth keeping.

---

## Ask counsel these, in this order

1. **Do we need to register with the Data Protection Commission before we
   launch, and how long does it take?** (Assume yes; assume it takes longer than
   you want.)
2. Does the platform need a transport operator's licence, or only the drivers?
3. Does the rider wallet need a Bank of Ghana licence?
4. Are our drivers contractors, and does our driver agreement actually say so in
   a way that survives scrutiny?
5. Who is liable in an accident during a trip, and does our insurance match that
   answer?
6. What must we retain after an account-deletion request, and on what basis?

---

**None of this is legal advice.** It is the list of things an engineer reading
the codebase can see will need a lawyer's answer.
