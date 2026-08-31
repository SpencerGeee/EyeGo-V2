# Apple privacy labels + the privacy manifest

_Draft, 2026-08-31. The nutrition-label answers for App Store Connect, and the
manifest that already ships in both apps._

---

## The short version

**Neither app tracks.** No advertising SDK, no third-party analytics SDK, no
data broker, no cross-app or cross-site linkage. So:

- **"Data Used to Track You" → nothing.**
- **App Tracking Transparency (ATT) is not required**, and neither app should
  call it. `NSUserTrackingUsageDescription` is deliberately absent — asking for
  tracking permission you do not use is itself a rejection.
- `NSPrivacyTracking` is `false` and `NSPrivacyTrackingDomains` is empty in both
  privacy manifests.

Everything below is therefore either **Data Linked to You** or **Data Not
Linked to You**. Nothing is "Used to Track You".

---

## Rider — `com.eyego.rider`

### Data Linked to You

| Category | Types | Purposes |
|---|---|---|
| Contact Info | Name, Phone Number, Email Address | App Functionality |
| Location | Precise Location | App Functionality |
| Financial Info | Payment Info, Purchase History | App Functionality |
| Contacts | Contacts | App Functionality |
| User Content | Photos (profile) | App Functionality |
| Identifiers | User ID, Device ID | App Functionality |
| Usage Data | Product Interaction | Analytics |

### Data Not Linked to You

| Category | Types | Purposes |
|---|---|---|
| Diagnostics | Crash Data, Performance Data | App Functionality |

---

## Driver — `com.eyego.driver`

Same as the rider, plus the one that matters:

| Category | Types | Purposes |
|---|---|---|
| Contact Info | Name, Phone Number | App Functionality |
| **Sensitive Info** | **Government ID (Ghana Card, driving licence)** | App Functionality |
| Location | Precise Location | App Functionality |
| Financial Info | Payment Info (payout account), Purchase History | App Functionality |
| Contacts | Contacts | App Functionality |
| User Content | Photos (documents, vehicle, profile) | App Functionality |
| Identifiers | User ID, Device ID | App Functionality |
| Usage Data | Product Interaction | Analytics |
| Diagnostics | Crash Data | App Functionality (not linked) |

Apple files government ID under **Sensitive Info**. Declare it. It is a normal
answer for a driver app and an abnormal thing to omit.

---

## The privacy manifest — already in the repo

`ios.privacyManifests` is set in both `app.json` files, so Expo emits
`PrivacyInfo.xcprivacy` at prebuild. Apple has rejected submissions without one
since spring 2024, and neither app had one before this pass.

Four required-reason APIs, which is what any React Native + Expo app touches:

| API category | Reason | What actually uses it |
|---|---|---|
| `UserDefaults` | `CA92.1` | AsyncStorage, expo-secure-store |
| `FileTimestamp` | `C617.1` | expo-file-system, the image cache |
| `SystemBootTime` | `35F9.1` | animation and timing |
| `DiskSpace` | `E174.1` | checking space before caching map tiles |

`CA92.1` means "access only to data written by this app itself", which is the
truthful reason here — nothing reads another app's defaults.

---

## Permission strings, as they appear on device

These are the sentences a user actually reads. Vague ones get rejected; each of
these says what is collected and why.

### Rider
- **Location (When In Use)** — "EyeGo uses your location to set your pickup
  point, show nearby drivers and follow your trip."
- **Camera** — "EyeGo needs camera access to update your profile photo."
- **Photo Library** — "EyeGo needs photo library access to update your profile
  photo."
- **Contacts** — "Allow EyeGo to access your contacts to add an emergency
  contact."

### Driver
- **Location (When In Use)** — "EyeGo Driver uses your location while the app is
  open so you can go online, receive trip requests and navigate."
- **Location (Always)** — "Allow location while EyeGo Driver is in the
  background so your passengers can keep seeing where you are during a trip,
  even with the app closed. This is only used while you are on a trip."
- **Camera / Photo Library / Contacts** — as above.

> The driver's "Always" string is iOS-only and stays. Android took the
> foreground-service route instead and requests no background permission at all
> — the platforms genuinely differ here, and Apple reviews `UIBackgroundModes:
> [location]` for a rideshare app without ceremony.

---

## Encryption — `ITSAppUsesNonExemptEncryption`

Set to `false` in both apps. Both use only HTTPS/TLS, which is exempt. That
answer removes the export-compliance questionnaire from every single upload; a
missing or wrong value makes each build wait on a manual answer.

---

## Before submitting

- [ ] Privacy Policy URL set in App Store Connect and resolving
- [ ] Nutrition labels match the tables above
- [ ] **No** ATT prompt, and no `NSUserTrackingUsageDescription`
- [ ] `PrivacyInfo.xcprivacy` present in the build (check the archive)
- [ ] Government ID declared on the **driver** app
- [ ] Demo account in "Notes for Review" (`06-app-review-notes.md`)
