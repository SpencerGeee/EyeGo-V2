// app.config.js enables Firebase / FCM for push notifications conditionally.
//
// IMPORTANT: Set EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY in EAS secrets for production builds.
// See .env.example for all required EXPO_PUBLIC_ variables.
const baseConfig = require('./app.json');
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  // ── Firebase / FCM (push notifications) ──────────────────────────────────
  // The backend pushes via Firebase Admin (FCM), so the native Android build
  // needs google-services.json to mint an FCM device token. We reference it
  // ONLY when the file actually exists on disk: that way `eas build` succeeds
  // even before you've added the file (notifications simply no-op until then),
  // and FCM activates automatically the moment you drop the file in.
  // Get it from Firebase Console → Project settings → Android app, then place
  // it at eyego/apps/rider/google-services.json (gitignored). See
  // NOTIFICATIONS_SETUP.md.
  const googleServicesPath = path.join(__dirname, 'google-services.json');
  const hasGoogleServices = fs.existsSync(googleServicesPath);
  const googleServicesInfoPath = path.join(__dirname, 'GoogleService-Info.plist');
  const hasGoogleServicesInfo = fs.existsSync(googleServicesInfoPath);

  // ── iOS Live Activity (ActivityKit) ───────────────────────────────────────
  // Apple Team ID is required by @bacons/apple-targets to sign the widget
  // extension target it generates. Find yours at
  // https://developer.apple.com/account → Membership details, or in Xcode
  // under Signing & Capabilities once you've opened the project once.
  // Safe to leave unset for now — `expo prebuild` still succeeds, you'll
  // just need to set the team manually in Xcode before the extension will
  // codesign for a physical-device build.
  const appleTeamId = process.env.EXPO_APPLE_TEAM_ID;

  return {
    ...baseConfig.expo,
    android: {
      ...baseConfig.expo.android,
      ...(hasGoogleServices ? { googleServicesFile: './google-services.json' } : {}),
    },
    ios: {
      ...baseConfig.expo.ios,
      ...(hasGoogleServicesInfo ? { googleServicesFile: './GoogleService-Info.plist' } : {}),
      ...(appleTeamId ? { appleTeamId } : {}),
      infoPlist: {
        ...baseConfig.expo.ios.infoPlist,
        // Required for ActivityKit — without this the app cannot start any
        // Live Activity, even from the widget extension target itself.
        NSSupportsLiveActivities: true,
        // Opt in to more frequent background pushed updates (still subject
        // to Apple's budget — see live-activity-push.service.js comments).
        NSSupportsLiveActivitiesFrequentUpdates: true,
      },
    },
    plugins: [
      ...baseConfig.expo.plugins,
      // Injects the EyeGoLiveActivity widget-extension Xcode target from
      // apps/rider/targets/live-activity/ during `expo prebuild`. Runs in
      // EAS Build's cloud prebuild too — no local Xcode required to SHIP
      // this, only to iterate on the SwiftUI views or run on a device.
      '@bacons/apple-targets',
    ],
  };
};
