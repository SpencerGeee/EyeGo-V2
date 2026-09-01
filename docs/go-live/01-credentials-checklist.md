# Credentials checklist — what to buy, and where each value goes

_Draft, 2026-08-31. Nothing on this list exists yet; it is deliberately the last
money the client spends. The code is written so that every one of these is a
value to paste, not an integration to build._

Work top to bottom. Anything marked **BLOCKER** stops a store submission.

---

## 1. Apple — BLOCKER

| What | Notes |
|---|---|
| Apple Developer Program | **Organization**, not Individual. A ride-hailing app is published by a company, and an Individual account puts a person's legal name on the listing. Needs a **D-U-N-S number** for the business — free, but Apple's verification takes days to weeks, so start it first. |
| App Store Connect records | Two apps: `com.eyego.rider`, `com.eyego.driver`. |
| App Store Connect API key (`.p8`) | Lets EAS submit without a human. Upload to EAS as a secret. |

Then:

```
ASC_APP_ID        -> eas.json  submit.production.ios.ascAppId
APPLE_TEAM_ID     -> eas.json  submit.production.ios.appleTeamId
```

**Apple's clock is the long pole.** Organization enrolment plus D-U-N-S can run
two to four weeks before you can even create the app records. Start here.

---

## 2. Google Play — BLOCKER

| What | Notes |
|---|---|
| Play Console account | One-off fee. Developer **identity verification** is now mandatory before a first publish and takes days. |
| Service-account JSON | For EAS submit. Save at the repo root as `google-play-service-account.json` — already gitignored. |

```
google-play-service-account.json  -> eas.json submit.production.android.serviceAccountKeyPath
```

> If the Play account is registered to an **individual** rather than an
> organisation, Google requires **12 testers running a closed test for 14
> consecutive days** before production access is granted. An organisation
> account is exempt. Register as the company.

**We do not need the background-location declaration.** The driver app was
deliberately built on a foreground service instead — see §2.3 of the
production-readiness plan. That removes the demo video and the policy review
that most often strands a driver app.

---

## 3. Paystack (Ghana) — BLOCKER for real money

| What | Notes |
|---|---|
| Live secret + public keys | Test keys work for everything up to launch. |
| Business verification | Certificate of incorporation, TIN, director ID. |
| **Mobile Money collection** | MTN, Telecel, AirtelTigo. This is how Ghana pays — card is the minority rail. |
| **Transfers / payouts enabled** | Usually a separate approval. Without it no driver can withdraw. |
| Settlement bank account | Where the platform's own money lands. |

```
PAYSTACK_SECRET_KEY   -> .env
PAYSTACK_PUBLIC_KEY   -> .env
PAYMENT_PROVIDER=paystack   (the API REFUSES to boot with `mock` in production)
```

Webhook: `https://api.eyego.app/v1/payments/webhook` — set it in the Paystack
dashboard. It is HMAC-verified, so it does not need auth, but it does need to
be reachable before the first live charge.

---

## 4. Domain and DNS — BLOCKER

`eyego.app`, with these records pointing at the production box:

```
api.eyego.app      A -> <box IP>
admin.eyego.app    A -> <box IP>
eyego.app          A -> <box IP>
www.eyego.app      A -> <box IP>
```

DNS must resolve **before** first boot: Caddy requests certificates on startup
and Let's Encrypt rate-limits five failures per domain per week.

Pages that must be live and reachable (both stores check the privacy URL):

- `https://eyego.app/privacy` — the apps already link to it
- `https://eyego.app/terms`
- `https://eyego.app/delete-account` — **Google Play requires a WEB route to
  request account deletion**, not only the in-app one. This is the item most
  often missed.

---

## 5. Push — BLOCKER for dispatch

Without push, a driver does not learn a ride was offered to them.

| What | Where it goes |
|---|---|
| Firebase project | |
| `google-services.json` | `apps/driver/`, `apps/rider/` |
| `GoogleService-Info.plist` | both apps |
| Service-account JSON | `FIREBASE_PROJECT_ID`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL` |
| APNs auth key (`.p8`) | `APNS_AUTH_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID` |
| Live Activity topic | `APNS_LIVE_ACTIVITY_TOPIC` — `com.eyego.rider.push-type.liveactivity` |

Set `APNS_ENVIRONMENT=production` for store builds. A sandbox key against a
production build fails silently, which is the worst way for push to be broken.

---

## 6. The server

| What | Notes |
|---|---|
| VPS | 4 vCPU / 8 GB is ample to start. **Region matters less than colocation** — the API, Postgres and Redis must be on the same box. That is what closed a 281 ms per query gap. |
| Object storage | Backblaze B2 or Cloudflare R2. Both speak S3 and both are far cheaper than S3 for this. |
| Cloudinary | Already in `.env.example`; driver documents and avatars. |

```
BACKUP_S3_BUCKET        -> scripts/ops/backup.sh
BACKUP_ENCRYPTION_KEY   -> a long random passphrase. STORE IT IN A PASSWORD
                           MANAGER, NOT ONLY ON THE BOX. A backup encrypted with
                           a key that only exists on the machine the backup
                           protects you from losing is not a backup.
AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_ENDPOINT_URL
```

---

## 7. Set before taking a single real ride

These are `PlatformSetting` rows, edited in the admin console. They are not env
vars and they have safe defaults — except the first, which has no safe default.

| Setting | Why |
|---|---|
| **`SOS_ONCALL_PHONES`** | **Empty means a panic alert reaches nobody.** The API logs an error at boot when it is unset and `/v1/admin/sos-events/alerting-health` reports it. Nothing else will stop you launching without it. |
| `SUPPORT_PHONE` | Shown in-app on the help screen. |
| `EMERGENCY_NUMBER` | Defaults to `112`, Ghana's unified line. Only change for another market. |
| `TERMS_VERSION`, `PRIVACY_VERSION` | Must match the published documents. Bumping either re-prompts every user. |
| `TERMS_URL`, `PRIVACY_URL` | Must resolve. |
| `STORE_URL_*` (×4) | The upgrade screen has nowhere to send people without them. |
| `MIN_SUPPORTED_VERSION_*` | Leave **empty** at launch. It is the recall lever; setting it before you need it only strands people. |

---

## 8. Sentry (optional, strongly recommended)

```
SENTRY_DSN, SENTRY_ENV=production, SENTRY_TRACES_SAMPLE_RATE=0.1
```

The API and both apps degrade to a no-op without a DSN, so this is safe to add
late.

**The admin console reports too**, using its own variables:

```
SENTRY_DSN, SENTRY_ENV=production, SENTRY_TRACES_SAMPLE_RATE=0
SENTRY_RELEASE=<git sha>       # set this, or every issue reads "unknown"
SENTRY_DIST=                   # only when rebuilding the same commit
```

Note what these are NOT: `NEXT_PUBLIC_`. The console's two client error
boundaries POST to `/api/client-error` and the server forwards the report, so
the DSN never enters the browser bundle — correct for an internal tool, where a
public DSN is an open pipe into your quota. Reports are tagged
`service: admin-console`, so one Sentry project for the whole platform is fine.

It uses `@sentry/node` rather than `@sentry/nextjs`. The latter is a build-time
integration that rewrites the webpack build, and the console failing to build is
a worse outcome than the console not reporting. The cost of that choice is one
thing: **no automatic sourcemap upload.** Production stack traces are minified
until you add a `sentry-cli sourcemaps upload` step to the deploy pipeline
against the same `SENTRY_RELEASE`. Worth doing; not required to launch.

---

## Order of operations

1. Apple organization enrolment + D-U-N-S — **start today, it is the long pole**
2. Play Console + identity verification
3. Company registration → Paystack business verification
4. Domain + DNS + the three legal pages
5. VPS + object storage → deploy (`09-deploy-runbook.md`)
6. Firebase + APNs → first real push test
7. Paystack live keys → first real cedi
8. Store listings, screenshots, review notes → submit
