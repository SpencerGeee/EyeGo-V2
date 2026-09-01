# Screenshots — sizes, and the shot list

_Draft, 2026-08-31. Capture these from a real build on a real device. Both
stores reject mock-ups that show features the app does not have._

---

## Sizes you actually need

### iOS — App Store Connect

Apple scales down from the largest, so **two sets cover every device**:

| Set | Size (px) | Capture on |
|---|---|---|
| 6.9" | 1320 × 2868 | iPhone 16 Pro Max / 15 Pro Max |
| 6.5" | 1242 × 2688 | iPhone 11 Pro Max / XS Max |

Up to 10 per set. **The first three are what people see without scrolling** —
put your strongest there.

iPad shots are only required if the app is listed as iPad-compatible. Both apps
set `supportsTablet: false`, so they are not.

### Android — Play Console

| What | Requirement |
|---|---|
| Phone screenshots | 2–8, min 320 px, max 3840 px, 16:9 or 9:16 |
| Feature graphic | **1024 × 500** — required, and the item most often forgotten |
| App icon | 512 × 512 PNG |

Play shows the feature graphic above everything. A listing without one cannot be
published.

---

## Rider — the shot list

Capture in this order; the order is the pitch.

1. **Home, map, "Where to?"**
   The product in one image. Real Accra streets, a few vehicle markers.
   Caption: *Book a ride in seconds*

2. **Choosing a tier, fare visible**
   Economy / Comfort / Premium with real prices in cedis.
   Caption: *See the price before you book*

3. **Driver on the way**
   Live map, driver's card, ETA, vehicle and plate.
   Caption: *Watch your driver arrive*

4. **Payment methods**
   Cash, Mobile Money, card, wallet — MoMo clearly visible. This is the screen
   that tells a Ghanaian user the app is built for them.
   Caption: *Pay with MoMo, cash or card*

5. **Safety**
   Verify My Ride, share trip, SOS, emergency contact.
   Caption: *Safety built in, not bolted on*

6. **Receipt / trip complete**
   Fare breakdown that adds up.
   Caption: *Every trip, every receipt*

7. **Activity history**
   Caption: *All your rides in one place*

## Driver — the shot list

1. **Dashboard, online**
   Today's earnings, the online toggle, the map.
   Caption: *Go online when it suits you*

2. **A trip offer**
   Pickup, destination, and the fare — before accepting.
   Caption: *See the trip before you accept*

3. **Earnings**
   A real chart with real figures, commission itemised.
   Caption: *Every cedi accounted for*

4. **Withdrawal to MoMo**
   Caption: *Cash out to Mobile Money*

5. **Documents, with expiry dates**
   Licence, insurance, roadworthiness — showing the expiry chips.
   Caption: *Never caught out by an expired document*

6. **Navigation during a trip**
   Caption: *Turn-by-turn, built in*

---

## Rules that save a resubmission

**Real screens only.** Screenshots must come from the actual build. Both stores
compare them against the app; a feature shown but not present is a rejection.

**No placeholder data.** No "Lorem ipsum", no `test@test.com`, no `GHS 0.00`, no
"Driver Name". Use plausible Ghanaian names and real Accra destinations —
Osu, East Legon, Kotoka International Airport, Accra Mall.

**Status bar clean.** Full battery, full signal, a sensible time. On iOS,
`xcrun simctl status_bar` sets this on a simulator; on a device, just charge it.

**Consistent theme.** Pick light or dark and keep it across the whole set. A
mixed set looks like screenshots from two different apps.

**Nobody's real data.** No real phone numbers, no real plate numbers, no real
faces without permission. The reviewer accounts from
`06-app-review-notes.md` are the safe way to generate these.

**Text in captions, not baked into the screen.** Both stores let you overlay
text on a screenshot frame. Text baked into the UI cannot be localised later.

---

## Capture, quickly

**iOS simulator** — the reliable route to exact pixel sizes:

```bash
xcrun simctl boot "iPhone 16 Pro Max"
xcrun simctl status_bar booted override --time "9:41" --batteryLevel 100 \
  --batteryState charged --cellularBars 4 --wifiBars 3
xcrun simctl io booted screenshot rider-01-home.png
```

**Android emulator:**

```bash
adb shell screencap -p /sdcard/shot.png && adb pull /sdcard/shot.png
```

A Pixel 8 Pro emulator produces 1344 × 2992, which Play accepts directly.

---

## Before uploading

- [ ] Both iOS sets (6.9" and 6.5"), 6–7 shots each
- [ ] Play phone screenshots, 6–8
- [ ] **Play feature graphic, 1024 × 500** — the one people forget
- [ ] 512 × 512 icon
- [ ] No placeholder or real personal data anywhere
- [ ] Every feature shown exists in the submitted build
- [ ] First three shots are the strongest three
