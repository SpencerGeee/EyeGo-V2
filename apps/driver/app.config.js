// app.config.js extends app.json so we can (a) register the expo-notifications
// config plugin the driver app was missing — without it a native build can crash
// on launch when expo-notifications APIs are called — and (b) reference Firebase's
// google-services.json ONLY when it exists on disk, so `eas build` succeeds even
// before the file is added and FCM activates automatically once it is.
//
// See NOTIFICATIONS_SETUP.md for how to obtain google-services.json.
const baseConfig = require('./app.json');
const fs = require('fs');
const path = require('path');
// Required by relative path rather than by package name: @eyego/config points
// its main at TypeScript sources for Metro, and this file is plain CJS run by
// node during prebuild.
const withFirebaseAppDelegate = require('../../packages/config/plugins/withFirebaseAppDelegate');
const withFirebasePods = require('../../packages/config/plugins/withFirebasePods');

module.exports = () => {
  const expo = baseConfig.expo;

  // Ensure the expo-notifications plugin is present exactly once.
  const hasNotifications = (expo.plugins ?? []).some(
    (p) => p === 'expo-notifications' || (Array.isArray(p) && p[0] === 'expo-notifications'),
  );
  const plugins = [...(expo.plugins ?? [])];
  if (!hasNotifications) {
    plugins.push([
      'expo-notifications',
      {
        icon: './assets/adaptive-icon.png',
        color: '#3B82F6',
      },
    ]);
  }

  // EAS CLOUD BUILDS NEVER SEE THESE FILES. Both are gitignored, and EAS
  // uploads what git tracks — so a store build came out with no Firebase at all
  // and Android never minted an FCM token (no push, silently). On EAS they
  // arrive as FILE environment variables instead, whose value is the path EAS
  // wrote the file to:
  //   eas env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json
  //   eas env:create --name GOOGLE_SERVICE_INFO_PLIST --type file --value ./GoogleService-Info.plist
  // A local file still works for local builds.
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON
    || (fs.existsSync(path.join(__dirname, 'google-services.json')) ? './google-services.json' : null);
  const googleServicesInfoFile = process.env.GOOGLE_SERVICE_INFO_PLIST
    || (fs.existsSync(path.join(__dirname, 'GoogleService-Info.plist')) ? './GoogleService-Info.plist' : null);
  const hasGoogleServices = !!googleServicesFile;
  const hasGoogleServicesInfo = !!googleServicesInfoFile;

  // KEEP googleServicesFile OUT OF app.json. Both keys below are spread from
  // app.json first and only conditionally re-added, so a value written there
  // survives the existsSync check and prebuild dies copying a file that is not
  // in the repo — which is what happens on a CI runner, since both files are
  // gitignored. This is the single place either path may be named.

  // Maps run entirely on @maplibre/maplibre-react-native v11 + OpenFreeMap
  // tiles (see @eyego/maps) — free, keyless, no Google Maps API key/Cloud
  // Billing account needed on either platform.

  // After @react-native-firebase/app, whose own AppDelegate mod no longer finds
  // its anchor in the SDK 54 template and gives up with a warning. See the
  // plugin for the detail; it is a no-op unless ios.googleServicesFile is set.
  // THE FIREBASE PLUGINS ARE CONDITIONAL, and must stay out of app.json.
  // @react-native-firebase/app does not skip a build that has no Firebase
  // files — its mods throw outright ("Path to GoogleService-Info.plist is not
  // defined"), which kills prebuild on any machine that does not have the
  // gitignored files, CI included. Listing it only when a file exists is what
  // makes Firebase genuinely optional rather than nominally so.
  //
  // Either file is enough, because each mod is platform-scoped: the plist mod
  // runs only during an iOS prebuild and google-services.json's only during an
  // Android one.
  if (hasGoogleServicesInfo || hasGoogleServices) {
    plugins.push('@react-native-firebase/app', '@react-native-firebase/messaging');
  }

  plugins.push(withFirebaseAppDelegate);
  // NOT conditional, unlike the two above: the Firebase pods come from
  // autolinking and are installed whether or not Firebase is configured, and
  // pod install refuses to integrate them without modular headers.
  plugins.push(withFirebasePods);

  return {
    ...expo,
    plugins,
    android: {
      ...expo.android,
      ...(hasGoogleServices ? { googleServicesFile } : {}),
    },
    ios: {
      ...expo.ios,
      ...(hasGoogleServicesInfo ? { googleServicesFile: googleServicesInfoFile } : {}),
    },
  };
};
