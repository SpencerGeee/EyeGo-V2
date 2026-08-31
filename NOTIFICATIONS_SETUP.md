# Push Notifications Setup (EyeGo Rider + Driver)

Both apps use **native FCM/APNs push** via Firebase Cloud Messaging. The backend
sends through Firebase Admin (`admin.messaging().send`), so the apps must register
the **native device token** (not an Expo push token) and the Android build must
include `google-services.json`.

This was the cause of two problems:
1. **"Use the native one instead" error / pushes never arriving** — the apps were
   registering an Expo push token (`getExpoPushTokenAsync`) while the backend
   targets FCM. Fixed: both apps now call `getDevicePushTokenAsync()`.
2. **App installs but crashes instantly on open (Android)** — the driver app was
   missing the `expo-notifications` config plugin, and neither app referenced
   `google-services.json`. Fixed: `expo-notifications` is now registered in both
   (`app.config.js`), and the Firebase file is referenced **conditionally**.

## What the code now does

| Concern | Rider | Driver |
|---|---|---|
| Token type | `getDevicePushTokenAsync()` (FCM/APNs native) | `getDevicePushTokenAsync()` |
| Backend endpoint | `POST /users/fcm-token` `{ fcmToken }` | `POST /driver/fcm-token` `{ fcmToken }` |
| Android channel | `eyego_default` (matches backend payload) | `eyego_default` |
| `expo-notifications` plugin | present | added via `app.config.js` |
| `google-services.json` | referenced only if file exists | referenced only if file exists |

The Android **channel id `eyego_default`** must match
`android.notification.channelId` in `eyego-api/.../push.service.js`, or Android 8+
silently drops the notification.

## One-time setup before you build for Android

1. In the [Firebase Console](https://console.firebase.google.com/), create (or open)
   the project, then add an **Android app** for each package:
   - Rider: `com.eyego.rider`
   - Driver: `com.eyego.driver`
2. Download each `google-services.json` and place it at:
   - `eyego/apps/rider/google-services.json`
   - `eyego/apps/driver/google-services.json`
   (Both are gitignored. The build auto-detects them — no config edit needed.)
3. (iOS) Add an iOS app per bundle id, download `GoogleService-Info.plist`, place it
   next to each app's `app.json`. Upload your APNs key in Firebase → Cloud Messaging.
4. On the backend, set the Firebase Admin service-account credentials
   (`FIREBASE_*` / `GOOGLE_APPLICATION_CREDENTIALS`) so `admin.messaging()` can send.

## Build & verify

```bash
# from eyego/apps/rider (and again in driver)
eas build --profile development --platform android
```

- Until `google-services.json` is present, the build still succeeds and the app
  runs — push registration simply no-ops (it's wrapped in try/catch). It will
  **not** crash on launch.
- With the file present, on first launch (granting the permission prompt) the app
  registers an FCM token with the backend. Trigger a server push (e.g. assign a
  trip) and confirm the banner appears foreground and background.

## Important

- Push tokens require a **dev client or EAS build on a real device** — they do not
  work in Expo Go or simulators.
- Never use `getExpoPushTokenAsync` here; the backend cannot deliver to Expo tokens.
