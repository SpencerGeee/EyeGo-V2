import ExpoModulesCore
import ActivityKit
import Foundation

/// Thin bridge from JS (apps/rider/modules/eyego-live-activity/index.ts) to
/// ActivityKit. Deliberately minimal — all trip-domain logic (when to
/// start/update/end, throttling, debouncing) lives on the JS side in
/// apps/rider/utils/liveActivity.ts. This module only knows how to talk to
/// ActivityKit.
///
/// UNTESTED: written against the documented ActivityKit API surface (iOS 16.2+)
/// but has never been compiled — this repo has no Mac/Xcode available. Expect
/// to fix minor Swift compile errors on first `pod install` / Xcode build.
public class EyeGoLiveActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("EyeGoLiveActivityModule")

    Events("onPushTokenUpdate", "onActivityEnded")

    // Whether this device/OS version can run Live Activities at all —
    // JS should check this before doing any of the below (iOS < 16.2,
    // or the user disabled Live Activities in Settings, both return false).
    Function("areActivitiesEnabled") { () -> Bool in
      if #available(iOS 16.2, *) {
        return ActivityAuthorizationInfo().areActivitiesEnabled
      }
      return false
    }

    // attributes / contentState are plain JS objects (Records), matching
    // EyeGoTripAttributes / EyeGoTripAttributes.ContentState field-for-field.
    // Returns the native activity id (String) to store in JS state.
    AsyncFunction("startActivity") { (attributes: [String: Any], contentState: [String: Any]) -> String in
      guard #available(iOS 16.2, *) else {
        throw Exception(name: "UNSUPPORTED_OS", description: "Live Activities require iOS 16.2+")
      }

      let attrs = try Self.decode(EyeGoTripAttributes.self, from: attributes)
      let state = try Self.decode(EyeGoTripAttributes.ContentState.self, from: contentState)

      let activity = try Activity<EyeGoTripAttributes>.request(
        attributes: attrs,
        content: .init(state: state, staleDate: nil),
        pushType: .token
      )

      observePushToken(for: activity)
      return activity.id
    }

    AsyncFunction("updateActivity") { (activityId: String, contentState: [String: Any]) -> Void in
      guard #available(iOS 16.2, *) else { return }
      guard let activity = Activity<EyeGoTripAttributes>.activities.first(where: { $0.id == activityId }) else {
        throw Exception(name: "ACTIVITY_NOT_FOUND", description: "No running activity with id \(activityId)")
      }
      let state = try Self.decode(EyeGoTripAttributes.ContentState.self, from: contentState)
      await activity.update(.init(state: state, staleDate: nil))
    }

    AsyncFunction("endActivity") { (activityId: String, finalContentState: [String: Any]) -> Void in
      guard #available(iOS 16.2, *) else { return }
      guard let activity = Activity<EyeGoTripAttributes>.activities.first(where: { $0.id == activityId }) else {
        return // already gone — nothing to do
      }
      let state = try Self.decode(EyeGoTripAttributes.ContentState.self, from: finalContentState)
      await activity.end(.init(state: state, staleDate: nil), dismissalPolicy: .default)
    }

    // Ends every currently-running EyeGo Live Activity — used as a safety
    // net on app cold-start in case the JS side lost track of an activityId
    // (e.g. app was killed mid-trip).
    AsyncFunction("endAllActivities") { () -> Void in
      guard #available(iOS 16.2, *) else { return }
      for activity in Activity<EyeGoTripAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }
  }

  // MARK: - Push token observation

  // Instance method (not static) so it can capture `self` weakly and call
  // the Module's own `sendEvent` — this is the token that
  // apps/rider/utils/liveActivity.ts forwards to
  // tripsApi.submitLiveActivityToken() for direct-APNs delivery.
  @available(iOS 16.2, *)
  private func observePushToken(for activity: Activity<EyeGoTripAttributes>) {
    Task { [weak self] in
      for await tokenData in activity.pushTokenUpdates {
        let tokenHex = tokenData.map { String(format: "%02x", $0) }.joined()
        self?.sendEvent("onPushTokenUpdate", [
          "activityId": activity.id,
          "pushToken": tokenHex,
        ])
      }
    }
  }

  // MARK: - JSON <-> Codable bridge
  // Records/dictionaries arrive from JS as [String: Any]; ActivityKit wants
  // strongly-typed Codable structs. Round-tripping through JSONSerialization
  // is the simplest correct way to handle optional fields without hand
  // writing a decoder for every property.
  private static func decode<T: Decodable>(_ type: T.Type, from dict: [String: Any]) throws -> T {
    let data = try JSONSerialization.data(withJSONObject: dict, options: [])
    return try JSONDecoder().decode(T.self, from: data)
  }
}
