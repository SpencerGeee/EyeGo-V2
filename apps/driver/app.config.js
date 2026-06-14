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

  // The driver uses @maplibre/maplibre-react-native on native (OpenFreeMap tiles,
  // no API key needed) and falls back to react-native-maps in Expo Go. On Android
  // react-native-maps needs a Google Maps API key or it renders BLANK tiles.
  // iOS uses Apple Maps and needs no key. We only inject `android.config.googleMaps`
  // when a key is present so a keyless build still succeeds (blank tiles only
  // affect Expo Go / fallback path on Android until key is set).
  const googleMapsApiKey =
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';

  return {
    ...expo,
    plugins,
    android: {
      ...expo.android,
      ...(hasGoogleServices ? { googleServicesFile: './google-services.json' } : {}),
      ...(googleMapsApiKey
        ? { config: { ...(expo.android?.config ?? {}), googleMaps: { apiKey: googleMapsApiKey } } }
        : {}),
    },
    ios: {
      ...expo.ios,
      ...(hasGoogleServicesInfo ? { googleServicesFile: './GoogleService-Info.plist' } : {}),
    },
  };
};
