import ActivityKit
import SwiftUI
import WidgetKit

// EyeGo's dark accent green from apps/rider/app.json (expo-notifications
// plugin `color`). Hardcoded as a hex fallback in case the "AccentGreen"
// asset-catalog color (declared in expo-target.config.js) fails to resolve
// in a given build — Live Activities render on a system-controlled
// background so a hardcoded fallback avoids ever showing invisible text.
private let eyegoGreen = Color(red: 0x4B / 255, green: 0xE2 / 255, blue: 0x77 / 255)
private let eyegoDeepBg = Color(red: 0x0A / 255, green: 0x0A / 255, blue: 0x0B / 255)

private func etaText(_ state: EyeGoTripAttributes.ContentState) -> String {
    guard let eta = state.etaMinutes else { return state.statusText }
    if eta <= 1 { return "Arriving now" }
    return "\(eta) min away"
}

private func statusIcon(_ status: String) -> String {
    switch status {
    case "DRIVER_EN_ROUTE": return "car.fill"
    case "IN_PROGRESS": return "location.fill"
    case "COMPLETED": return "checkmark.circle.fill"
    case "CANCELLED": return "xmark.circle.fill"
    default: return "car.fill"
    }
}

// ── Lock screen / banner view ───────────────────────────────────────────
struct EyeGoLockScreenView: View {
    let context: ActivityViewContext<EyeGoTripAttributes>

    var body: some View {
        let state = context.state

        HStack(alignment: .center, spacing: 12) {
            ZStack {
                Circle()
                    .fill(eyegoGreen.opacity(0.16))
                    .frame(width: 44, height: 44)
                Image(systemName: statusIcon(state.status))
                    .foregroundStyle(eyegoGreen)
                    .font(.system(size: 18, weight: .semibold))
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(context.attributes.driverName)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                Text(context.attributes.routeName)
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.6))
                    .lineLimit(1)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 2) {
                Text(etaText(state))
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(eyegoGreen)
                if let km = state.distanceKm {
                    Text(String(format: "%.1f km", km))
                        .font(.system(size: 11))
                        .foregroundStyle(.white.opacity(0.5))
                }
            }
        }
        .padding(16)
        .activityBackgroundTint(eyegoDeepBg)
        .activitySystemActionForegroundColor(.white)
    }
}

// ── Dynamic Island ──────────────────────────────────────────────────────
struct EyeGoLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: EyeGoTripAttributes.self) { context in
            EyeGoLockScreenView(context: context)
        } dynamicIsland: { context in
            let state = context.state

            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 6) {
                        Image(systemName: statusIcon(state.status))
                            .foregroundStyle(eyegoGreen)
                        Text(context.attributes.driverName)
                            .font(.caption)
                            .foregroundStyle(.white)
                            .lineLimit(1)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(etaText(state))
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(eyegoGreen)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(context.attributes.routeName)
                            .font(.caption2)
                            .foregroundStyle(.white.opacity(0.7))
                        Text(context.attributes.vehicleDescription)
                            .font(.caption2)
                            .foregroundStyle(.white.opacity(0.5))
                    }
                }
            } compactLeading: {
                Image(systemName: statusIcon(state.status))
                    .foregroundStyle(eyegoGreen)
            } compactTrailing: {
                Text(state.etaMinutes.map { "\($0)m" } ?? "•")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(eyegoGreen)
            } minimal: {
                Image(systemName: statusIcon(state.status))
                    .foregroundStyle(eyegoGreen)
            }
            .widgetURL(URL(string: "eyego://ride/\(context.attributes.tripShortId)/tracking"))
            .keylineTint(eyegoGreen)
        }
    }
}
