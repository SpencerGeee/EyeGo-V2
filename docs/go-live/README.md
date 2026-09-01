# Go-live pack

Everything between "the code is finished" and "the apps are in the stores".

Written on 2026-08-31, when **none of the external accounts existed yet** — no
Apple, no Play, no Paystack live keys, no domain, no server. That was deliberate:
the client buys those last. So the code was built to be *credential-pluggable*,
and this pack exists so the final step is paste-and-pay rather than research.

---

## The documents

| | What it is | Read it when |
|---|---|---|
| [01](01-credentials-checklist.md) | **What to buy, and the exact env var each value lands in** | First. It has the ordering, and Apple's org enrolment is the long pole |
| [02](02-privacy-policy.md) | Privacy policy — **DRAFT, needs counsel** | Before publishing at `/privacy` |
| [03](03-terms-of-service.md) | Terms of service — **DRAFT, needs counsel** | Before publishing at `/terms` |
| [04](04-play-data-safety.md) | Every Play Data Safety answer, pre-filled | Filling the Play form |
| [05](05-apple-privacy-labels.md) | Apple nutrition labels + the privacy manifest | Filling App Store Connect |
| [06](06-app-review-notes.md) | Reviewer credentials and the demo script | Before either submission |
| [07](07-store-listing.md) | Listing copy, keywords, categories | Writing the listings |
| [08](08-screenshots.md) | Required sizes and the shot list | Capturing screenshots |
| [09](09-deploy-runbook.md) | Bare VPS → live, and every deploy after | Deploying |
| [10](10-ghana-compliance.md) | DPC registration, licensing, tax, insurance | **Now** — some of it has lead time |

---

## The five things most likely to cost you a week

1. **Apple Organization enrolment needs a D-U-N-S number.** Two to four weeks
   before you can even create the app records. Start it before anything else.
2. **Register with Ghana's Data Protection Commission.** Act 843 requires it of
   a data controller, and EyeGo is unambiguously one. See [10](10-ghana-compliance.md).
3. **`https://eyego.app/delete-account` must exist as a web page.** Play requires
   a deletion route reachable *without installing the app*. In-app alone is a
   rejection, and this is the single most-missed item on the list.
4. **Run `scripts/seed-reviewer-accounts.mjs` before submitting.** Apple reviews
   from Cupertino, where there are no EyeGo drivers; without a demo account the
   reviewer cannot complete a booking and will reject on core functionality.
5. **Set `SOS_ONCALL_PHONES` before the first real ride.** Empty means a panic
   alert reaches nobody. The API logs an error at boot and the console reports
   it, but nothing prevents launching without it.

---

## What this pack does not cover

- **Nothing here is legal advice.** 02, 03 and 10 are an engineer's reading of
  the codebase, written so counsel has something concrete to correct rather than
  a blank page.
- Marketing, pricing strategy and driver recruitment.
- Anything after launch — the runbook covers deploys and incidents, not growth.
