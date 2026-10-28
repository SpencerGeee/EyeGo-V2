/**
 * Let expo-notifications' notification colour win the Android manifest merge.
 *
 * WHAT BREAKS WITHOUT THIS. `:app:processReleaseMainManifest` fails:
 *
 *   Manifest merger failed : Attribute meta-data#com.google.firebase.messaging
 *   .default_notification_color@resource value=(@color/notification_icon_color)
 *   is also present at [:react-native-firebase_messaging] value=(@color/white).
 *
 * expo-notifications writes the meta-data into the app manifest and
 * @react-native-firebase/messaging ships its own in the library manifest.
 * `tools:replace` tells the merger the app's value is the one to keep.
 *
 * REGISTER IT FIRST in the plugins array. Mods run last-registered-first, so
 * the first plugin's mod runs last — after expo-notifications has written the
 * element this one annotates.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

const NAME = 'com.google.firebase.messaging.default_notification_color';

module.exports = function withNotificationColorReplace(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    for (const app of manifest.application ?? []) {
      for (const item of app['meta-data'] ?? []) {
        if (item.$['android:name'] === NAME) item.$['tools:replace'] = 'android:resource';
      }
    }
    return cfg;
  });
};
