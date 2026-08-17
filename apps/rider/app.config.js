// app.config.js enables Firebase / FCM for push notifications conditionally.
//
// IMPORTANT: Set EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY in EAS secrets for production builds.
// See .env.example for all required EXPO_PUBLIC_ variables.
const baseConfig = require('./app.json');
const fs = require('fs');
const path = require('path');
// Required by relative path rather than by package name: @eyego/config points
// its main at TypeScript sources for Metro, and this file is plain CJS run by
// node during prebuild.
const withFirebaseAppDelegate = require('../../packages/config/plugins/withFirebaseAppDelegate');
const withFirebasePods = require('../../packages/config/plugins/withFirebasePods');

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

  // KEEP googleServicesFile OUT OF app.json. Both keys below are spread from
  // app.json first and only conditionally re-added, so a value written there
  // survives the existsSync check and prebuild dies copying a file that is not
  // in the repo — which is what happens on a CI runner, since both files are
  // gitignored. This is the single place either path may be named.

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
      // THE FIREBASE PLUGINS ARE CONDITIONAL, and must stay out of app.json.
      // @react-native-firebase/app does not skip a build that has no Firebase
      // files — its mods throw outright ("Path to GoogleService-Info.plist is
      // not defined"), which kills prebuild on any machine that does not have
      // the gitignored files, CI included. Listing it only when a file exists
      // is what makes Firebase genuinely optional rather than nominally so.
      //
      // Either file is enough, because each mod is platform-scoped: the plist
      // mod runs only during an iOS prebuild and google-services.json's only
      // during an Android one. The messaging plugin ships Android mods alone
      // and is harmless either way, but travels with app to keep the pair
      // legible.
      ...(hasGoogleServicesInfo || hasGoogleServices
        ? ['@react-native-firebase/app', '@react-native-firebase/messaging']
        : []),
      // Injects the EyeGoLiveActivity widget-extension Xcode target from
      // apps/rider/targets/live-activity/ during `expo prebuild`. Runs in
      // EAS Build's cloud prebuild too — no local Xcode required to SHIP
      // this, only to iterate on the SwiftUI views or run on a device.
      '@bacons/apple-targets',
      // After @react-native-firebase/app, whose own AppDelegate mod no longer
      // finds its anchor in the SDK 54 template and gives up with a warning.
      // See the plugin; it is a no-op unless ios.googleServicesFile is set.
      withFirebaseAppDelegate,
      // NOT conditional, unlike the two above: the Firebase pods come from
      // autolinking and are installed whether or not Firebase is configured,
      // and pod install refuses to integrate them without modular headers.
      withFirebasePods,
    ],
  };
};
