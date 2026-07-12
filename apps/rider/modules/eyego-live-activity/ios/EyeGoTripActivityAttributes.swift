import ActivityKit
import Foundation

// ─────────────────────────────────────────────────────────────────────────
// DUAL-TARGET FILE — keep byte-identical to:
//   apps/rider/targets/live-activity/EyeGoTripActivityAttributes.swift
// See the comment header in that file for why two copies exist and how to
// collapse them into one via Xcode target membership once you have Xcode
// open locally. This copy compiles into the HOST APP target (via this
// Expo Module's podspec) so EyeGoLiveActivityModule.swift below can call
// Activity<EyeGoTripAttributes>.request/.update/.end.
// ─────────────────────────────────────────────────────────────────────────

struct EyeGoTripAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var status: String
        var statusText: String
        var etaMinutes: Int?
        var distanceKm: Double?
        var driverLat: Double?
        var driverLng: Double?
        var updatedAt: Double
    }

    var routeName: String
    var driverName: String
    var driverPhotoURL: String?
    var vehicleDescription: String
    var tripShortId: String
}
