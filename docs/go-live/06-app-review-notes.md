# App Review notes — paste into both stores

_Draft, 2026-08-31. Fill the credentials from
`scripts/seed-reviewer-accounts.mjs` before submitting._

---

## Why this document exists

The most common rejection for a ride-hailing app is not a policy violation. It
is a reviewer in Cupertino opening the rider app, requesting a ride, waiting,
and being told no drivers are available — because there are no EyeGo drivers in
California. They then report, accurately, that they could not evaluate the
app's core functionality.

Review notes alone do not fix that; a reviewer is instructed to test the app,
not to read about it. So the platform has a **reviewer account** whose ride is
served by a scripted driver that accepts, drives and completes, through the
real trip state machine. Run this before submitting:

```bash
node scripts/seed-reviewer-accounts.mjs
```

and run it again with `--revoke` once both apps are approved.

---

## Rider app — App Store Connect "Notes for Review"

> **Demo account**
> Phone: `+233 00 000 0002`
> OTP: `<fill from the seed script output>`
>
> EyeGo is a ride-hailing service operating in Accra, Ghana. Because there are
> no live EyeGo drivers near your location, this account is configured so that a
> demonstration driver responds to your ride request. Everything else — pricing,
> the trip lifecycle, notifications and the receipt — behaves exactly as it does
> for a real passenger. No payment is taken.
>
> **To review the core flow**
> 1. Sign in with the phone number above and the OTP.
> 2. On the home screen, tap "Where to?" and choose any destination.
> 3. Choose a ride tier and confirm. Select **Cash** as the payment method.
> 4. A driver accepts within a few seconds and drives to the pickup point, then
>    to the destination. The whole trip takes about 45 seconds.
> 5. The trip completes and the receipt appears under Activity.
>
> **Location.** The app requests location while in use, to set your pickup point
> and show nearby vehicles. It is not used for advertising and is not shared
> with third parties.
>
> **Account deletion** is in Profile → Privacy → Delete account, and also at
> https://eyego.app/delete-account.

## Driver app — "Notes for Review"

> **Demo account**
> Phone: `+233 00 000 0003`
> OTP: `<fill from the seed script output>`
>
> EyeGo Driver is the companion app for drivers on the EyeGo platform in Accra,
> Ghana. The account above is approved and can go online, so you can review the
> dashboard, earnings, documents and safety features. You will not receive a
> real trip offer, because trip offers come from real passengers in Accra.
>
> **Location.** The app uses location while in use, and continues to receive
> location updates via a **foreground service with a persistent notification**
> while a trip is in progress, so passengers can see the vehicle approaching. It
> does **not** request background location permission.
>
> **Account deletion** is in Profile → Account deletion, and also at
> https://eyego.app/delete-account.

---

## Google Play — "App access" / testing instructions

Play has a dedicated **App access** section for login-gated apps. Put the same
credentials there. If it is left blank, review stalls at the sign-in screen.

```
Both apps require a phone number and a one-time code to sign in.

Rider:  +233 00 000 0002    OTP: <fill>
Driver: +233 00 000 0003    OTP: <fill>

The rider account is configured with a demonstration driver so a full trip can
be completed from any location — there are no live EyeGo drivers outside Accra,
Ghana.
```

---

## Questions reviewers actually ask

**"Why does the driver app need location in the background?"**
It does not request background location. It uses a foreground service with a
visible, persistent notification while a trip is in progress. Tracking stops
when the trip ends or the app is closed.

**"Is any of this data used for advertising?"**
No. There is no advertising SDK and no third-party analytics SDK in either app.
Product analytics are recorded on our own server. Nothing is shared with third
parties beyond the payment processor, the SMS gateway, the push provider and
the map tile provider — all listed in `04-play-data-safety.md`.

**"How is payment handled?"**
Paystack, a PCI-DSS Level 1 processor. Card details never reach our servers. The
demo account uses a sandbox path and takes no money.

**"Why do you need contacts?"**
Only to let a rider pick an emergency contact for the safety feature, and only
after they tap that specific button. It is optional and the app works without
it.

---

## Before you submit — the checklist that actually catches things

- [ ] `node scripts/seed-reviewer-accounts.mjs` run against **production**
- [ ] Both demo logins tested from a device on a **non-Ghanaian** network
- [ ] `https://eyego.app/privacy` resolves
- [ ] `https://eyego.app/delete-account` resolves — Play requires the web route
- [ ] Support email answered by a real person
- [ ] `MIN_SUPPORTED_VERSION_*` is **empty** (never gate a build under review)
- [ ] `MAINTENANCE_MODE` is off
- [ ] `SOS_ONCALL_PHONES` set
- [ ] After approval: `node scripts/seed-reviewer-accounts.mjs --revoke`
