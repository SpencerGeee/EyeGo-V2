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

  const googleServicesPath = path.join(__dirname, 'google-services.json');
  const hasGoogleServices = fs.existsSync(googleServicesPath);
  const googleServicesInfoPath = path.join(__dirname, 'GoogleService-Info.plist');
  const hasGoogleServicesInfo = fs.existsSync(googleServicesInfoPath);

  // Maps run entirely on @maplibre/maplibre-react-native v11 + OpenFreeMap
  // tiles (see @eyego/maps) — free, keyless, no Google Maps API key/Cloud
  // Billing account needed on either platform.

  return {
    ...expo,
    plugins,
    android: {
      ...expo.android,
      ...(hasGoogleServices ? { googleServicesFile: './google-services.json' } : {}),
    },
    ios: {
      ...expo.ios,
      ...(hasGoogleServicesInfo ? { googleServicesFile: './GoogleService-Info.plist' } : {}),
    },
  };
};
