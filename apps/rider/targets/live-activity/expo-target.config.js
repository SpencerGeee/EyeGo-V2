/**
 * @bacons/apple-targets config for the EyeGo Live Activity widget extension.
 *
 * This folder is picked up automatically by the "@bacons/apple-targets"
 * config plugin (see apps/rider/app.config.js) during `expo prebuild`.
 * EAS Build runs prebuild in the cloud, so this is enough to ship the
 * extension WITHOUT anyone needing a local Mac/Xcode — Xcode is only
 * needed to iterate on the SwiftUI views locally or run on a physical
 * device for the first manual verification pass (see report for details).
 *
 * @type {import('@bacons/apple-targets/app.plugin').ConfigFunction}
 */
module.exports = (config) => ({
  type: 'widget',
  name: 'EyeGoLiveActivity',
  // Bundle id becomes com.eyego.rider.EyeGoLiveActivity — this MUST match
  // APNS_LIVE_ACTIVITY_TOPIC in eyego-api/.env exactly, since that's the
  // `apns-topic` header value Apple uses to route the push to this extension.
  bundleIdentifier: `${config.ios.bundleIdentifier}.EyeGoLiveActivity`,
  deploymentTarget: '16.2', // ActivityKit's minimum supported iOS version
  frameworks: ['SwiftUI', 'ActivityKit', 'WidgetKit'],
  entitlements: {
    // No app-group entitlement is required here: the extension never reads
    // host-app storage directly — all data arrives via ActivityKit's own
    // start/update/end payloads (from the JS bridge) or via APNs pushes.
  },
  colors: {
    // Referenced from EyeGoLiveActivityViews.swift as Color("AccentGreen").
    // apple-targets writes this into the generated asset catalog for the
    // widget target — matches EyeGo's brand accent (see app.json
    // notification.color / #4be277).
    AccentGreen: '#4be277',
  },
});
