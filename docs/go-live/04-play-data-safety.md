# Play Data Safety — every answer, pre-filled

_Draft, 2026-08-31. Derived from what the code actually collects, not from what
a ride-hailing app usually collects. Verify against the codebase before
submitting — a Data Safety form that disagrees with observed network traffic is
an enforcement matter, not a paperwork error._

Two forms, one per app. They differ; do not paste the same answers into both.

---

## The answers that apply to both apps

**Does your app collect or share any of the required user data types?** Yes.

**Is all of the user data collected by your app encrypted in transit?** Yes.
(TLS 1.2+ everywhere; Caddy terminates, and the apps refuse cleartext — iOS ATS
is on and Android has no cleartext exemption.)

**Do you provide a way for users to request that their data be deleted?** Yes.
In-app *and* at `https://eyego.app/delete-account`.

> The web route is the part most often missed. Play requires a URL a user can
> reach **without installing the app**. An in-app-only flow is a rejection.

**Third parties that receive data.** Neither app contains an advertising SDK or
a third-party analytics SDK — product analytics are recorded on our own server,
which is why "Analytics" purposes below name no third party. Data leaves us only
to:

| Recipient | What | Why |
|---|---|---|
| Paystack | payment identifiers, amount, phone (MoMo) | processing payments |
| Africa's Talking | phone number, message body | OTP, receipts, SOS alerts |
| Firebase Cloud Messaging / APNs | push token | notifications |
| Cloudinary | uploaded photos | document and avatar storage |
| Mapbox / OSM | coordinates for geocoding and routing | maps |
| Sentry (if enabled) | crash stack, device model, app version | crash diagnostics |

---

## Rider app — `com.eyego.rider`

| Category | Data type | Collected | Shared | Purpose | Optional? |
|---|---|---|---|---|---|
| Location | Approximate location | Yes | No | App functionality | Required |
| Location | Precise location | Yes | No | App functionality | Required |
| Personal info | Name | Yes | No | App functionality, Account management | Required |
| Personal info | Email address | Yes | No | Account management | **Optional** |
| Personal info | Phone number | Yes | Yes (SMS gateway) | App functionality, Account management | Required |
| Personal info | Other info (emergency contact) | Yes | No | App functionality (safety) | **Optional** |
| Financial info | Payment info | Yes | Yes (Paystack) | App functionality | Required |
| Financial info | Purchase history | Yes | No | App functionality | Required |
| Photos and videos | Photos | Yes | No | App functionality (profile) | **Optional** |
| Contacts | Contacts | Yes | No | App functionality (emergency contact) | **Optional** |
| App activity | App interactions | Yes | No | Analytics | Required |
| App info | Crash logs | Yes | Yes (Sentry) | Diagnostics | Required |
| Device IDs | Device or other IDs | Yes | Yes (FCM/APNs) | App functionality | Required |

**Location — precise, and why it is required.** Location sets the pickup point
and shows the vehicle approaching. It is collected **only while the app is in
use**. The rider app has no background location permission at all.

**Contacts — the one that draws questions.** Read only when the rider taps "add
an emergency contact", only to populate that picker, and the chosen contact's
number is the only thing stored. The app is fully usable without granting it.

---

## Driver app — `com.eyego.driver`

| Category | Data type | Collected | Shared | Purpose | Optional? |
|---|---|---|---|---|---|
| Location | Approximate location | Yes | No | App functionality | Required |
| Location | Precise location | Yes | No | App functionality | Required |
| Personal info | Name | Yes | No | App functionality, Account management | Required |
| Personal info | Phone number | Yes | Yes (SMS gateway) | App functionality, Account management | Required |
| Personal info | **Government ID** | Yes | No | App functionality (driver verification), Fraud prevention | Required |
| Personal info | Other info (emergency contact) | Yes | No | App functionality (safety) | **Optional** |
| Financial info | Payment info (MoMo/bank for payouts) | Yes | Yes (Paystack) | App functionality | Required |
| Financial info | Purchase history (earnings, commission) | Yes | No | App functionality | Required |
| Photos and videos | Photos | Yes | No | App functionality (documents, profile) | Required |
| Contacts | Contacts | Yes | No | App functionality (emergency contact) | **Optional** |
| App activity | App interactions | Yes | No | Analytics | Required |
| App info | Crash logs | Yes | Yes (Sentry) | Diagnostics | Required |
| Device IDs | Device or other IDs | Yes | Yes (FCM/APNs) | App functionality | Required |

**Government ID is the answer people get wrong.** The app collects the Ghana
Card and a driving licence, so "Government ID" is Yes for the driver app and No
for the rider app. Declaring it correctly is straightforward; failing to declare
it is a policy violation.

**Location while a trip is in progress.** The driver app uses a **foreground
service** with a persistent notification. It does **not** hold
`ACCESS_BACKGROUND_LOCATION`, so the background-location declaration and its
demo video do not apply. If a reviewer asks, the permission list is the
evidence.

---

## Permissions, and the one-line justification for each

### Rider
| Permission | Why |
|---|---|
| `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` | pickup point, nearby vehicles |
| `CAMERA` | profile photo |
| `READ_MEDIA_IMAGES` | choosing a profile photo |
| `READ_CONTACTS` | optional emergency-contact picker |
| `POST_NOTIFICATIONS` | trip status |
| `VIBRATE` | notification feedback |
| `RECEIVE_BOOT_COMPLETED` | restoring notification state after a restart |

### Driver
| Permission | Why |
|---|---|
| `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` | dispatch and navigation |
| `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_LOCATION` | sharing position during a trip |
| `CAMERA` | document and vehicle photos |
| `READ_MEDIA_IMAGES` | uploading documents |
| `READ_CONTACTS` | optional emergency-contact picker |
| `POST_NOTIFICATIONS` | dispatch offers |
| `VIBRATE` | offer alert |

Note there is **no** `ACCESS_BACKGROUND_LOCATION` on either.

---

## Content rating questionnaire

Both apps: no violence, no sexual content, no gambling, no user-generated
content shared publicly. In-app chat exists but is **only between a rider and
their assigned driver for the duration of a trip** — declare it as user
interaction with a limited audience, not as social features.

Expected rating: Everyone / PEGI 3.
