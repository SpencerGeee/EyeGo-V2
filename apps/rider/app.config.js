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

  return {
    ...baseConfig.expo,
    android: {
      ...baseConfig.expo.android,
      ...(hasGoogleServices ? { googleServicesFile: './google-services.json' } : {}),
    },
    ios: {
      ...baseConfig.expo.ios,
      ...(hasGoogleServicesInfo ? { googleServicesFile: './GoogleService-Info.plist' } : {}),
    },
  };
};
