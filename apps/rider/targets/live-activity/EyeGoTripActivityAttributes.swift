import ActivityKit
import Foundation

// ─────────────────────────────────────────────────────────────────────────
// IMPORTANT — DUAL-TARGET FILE
// ─────────────────────────────────────────────────────────────────────────
// ActivityKit requires the SAME ActivityAttributes type to be compiled into
// BOTH the host app target (which calls Activity<T>.request/.update/.end
// from EyeGoLiveActivityModule.swift) AND this widget extension target
// (which renders the UI). Xcode does not share source between targets by
// default.
//
// An identical copy of this file lives at:
//   apps/rider/modules/eyego-live-activity/ios/EyeGoTripActivityAttributes.swift
//
// After `npx expo prebuild`, if you'd rather have ONE source of truth,
// open ios/EyeGoRider.xcworkspace in Xcode and add this file to BOTH the
// "EyeGoRider" and "EyeGoLiveActivity" target memberships (File Inspector →
// Target Membership), then delete the duplicate. Until you do that, keep
// the two copies byte-identical whenever you change the schema.
// ─────────────────────────────────────────────────────────────────────────

struct EyeGoTripAttributes: ActivityAttributes {
    /// Fields that never change for the lifetime of the Activity.
    public struct ContentState: Codable, Hashable {
        /// Trip lifecycle status — mirrors the backend's Trip.status enum for
        /// the subset of states a rider ever sees a Live Activity for:
        /// DRIVER_EN_ROUTE, IN_PROGRESS, COMPLETED, CANCELLED.
        var status: String
        /// Human-readable status line shown under the title (e.g. "Driver is
        /// on the way"). Computed server-side (see driver.socket.js
        /// LIVE_ACTIVITY_STATUS_TEXT) and on-device as a fallback.
        var statusText: String
        /// Minutes until arrival — nil once status is COMPLETED/CANCELLED.
        var etaMinutes: Int?
        /// Remaining distance in km, shown as a secondary detail.
        var distanceKm: Double?
        /// Driver's last-known coordinates — kept for a possible future mini
        /// map treatment; the current view only uses etaMinutes/distanceKm.
        var driverLat: Double?
        var driverLng: Double?
        /// Epoch millis of this content-state — lets the widget show
        /// "Updated Xs ago" style staleness if desired.
        var updatedAt: Double
    }

    // ── Static (non-changing) trip info ────────────────────────────────
    var routeName: String          // e.g. "Achimota → Circle"
    var driverName: String
    var driverPhotoURL: String?    // remote URL; widget extension has no
                                    // network access at render time for
                                    // arbitrary URLs without AsyncImage, so
                                    // this is best-effort (see view comments)
    var vehicleDescription: String // e.g. "Toyota HiAce · GT 4521-20"
    var tripShortId: String        // for deep-linking back into the app
}
