# Rival UX spec: finding-driver, fare boost, no-drivers, saved places

2026-10-06 · Desk research (help centres, newsrooms, developer docs, trade press). **[C]** = confirmed by the linked source. **[I]** = observed/inferred, no primary source found. Verify [I] items on a phone in Accra; all four operate in Ghana.

## 1. Rider "finding your driver"

### 1a. Searching state
- [C] **Uber**: the request goes to "eligible drivers"; the rider sees "an estimated time to be matched"; on accept, driver location and ETA appear ([Uber help](https://help.uber.com/riders/article/how-to-request-a-ride?nodeId=67f41961-e0aa-4670-af32-58be02c7c492)). The bottom bar reads **"Finding your ride"**; tap it → **Cancel** → **"No" / "Yes, cancel"**; fees apply only after a match ([Uber help](https://help.uber.com/h/56270015-1d1d-4c08-a460-3b94a090de23)). Pickup edit: drag inside a grey circle (~200 m), once, "no need to cancel"; not on shared rides ([Uber](https://www.uber.com/en-GB/ride/how-uber-works/adjust-location), [Uber](https://www.uber.com/us/en/ride/how-it-works/pickups/)).
- [C] **UberX Share (Ghana page)**: a pre-match **"Waiting Room"**; one seat only; no destination edits or added stops ([Uber GH](https://www.uber.com/gh/en/ride/uberpool/)).
- [C] **Bolt**: cancel via "the slider on the home screen" ([Bolt](https://bolt.eu/en/support/articles/115003240354/)); VoiceOver users report they cannot reach it ([AppleVis](https://mail.applevis.com/forum/ios-ipados/cancelling-bolt-rides)). Fee only if you cancel >3 min after acceptance; a warning shows at cancel time ([Bolt](https://bolt.eu/en/support/articles/66676/)).
- [C] **Yandex Go** (Yango's platform) hides its shared tariff when a co-rider is unlikely ([Habr/Yandex](https://habr.com/ru/companies/yandex/articles/735172)).
- [C] Trust risk: Uber was reported (2015) to draw "phantom" car icons as a visual effect ([BGR](https://www.bgr.com/general/uber-app-lying-cars-visual-effect/)).
- [I] No rival documents radar rings, gliding cars, route lines, a highlighted "asked" car, camera framing or haptics: EyeGo's design is new, not parity.

**EyeGo spec**
- Map: pickup centred (z≈16, bottom padding = sheet height); two rings, 2 s period, opacity 0.35→0; Reduce Motion → one static ring; stop loops off-screen. Cars: only real available drivers with a fix ≤30 s old, interpolated glide, never fabricated. Asked car: accent colour + halo, no name or plate. Route: 1.5 px at 40% opacity.
- Sheet: "Finding your driver" + "Usually matched in ~2 min"; pickup → drop-off as landmarks; tier · seats · GH₵ fare · payment chip; actions **Edit pickup** (≤200 m, once, search keeps running), **Share status**, **Cancel** as a real button.
- Cancel: free; confirm sheet with "Keep searching" (primary) and "Cancel request".
- Announce state changes via a live region.

### 1b. Fare boost
- [C] **inDrive**: rider taps "Offer your fare" against a recommended minimum; while waiting they can "make a new offer" or take a driver's counter-offer; the fare cannot change once agreed ([inDrive GH](https://indrive.com/en-gh/help/passengers/how-fares-are-calculated)). Offers are compared by arrival time, rating and fare ([inDrive](https://indrive.com/en-in/help/passengers/how-to-request-an-indrive-ride)).
- [C] **Bolt Nigeria** (May 2024) "flexible pricing" lets passengers "offer higher fares" at peak; the **standard commission still applies** to the extra ([TechCabal](https://techcabal.com/2024/05/24/bolt-introduces-bidding-system-to-ease-ride-shortages/)). A full negotiate pilot (Nov 2024–Feb 2025) was shelved ([TechCabal](https://techcabal.com/2025/05/19/bolt-fare-negotiation/)). **UK Bolt Flex** (2026): a suggested fare raised or lowered "within a predefined range" **before** submitting; drivers accept, reject or counter; "does not guarantee a booking" ([TaxiPoint](https://www.taxi-point.co.uk/post/what-is-bolt-flex-operator-lets-passengers-haggle-over-fares-as-flex-pricing-rolled-out-across-29-a)).
- [C] **Yango**: no rider boost documented; it sells fixed upfront prices ([Graphic GH](https://graphic.com.gh/business/business-news/ghana-news-yango-rolls-out-fixed-price-feature.html); "No bargains" launch headline, [ProPakistani](https://propakistani.pk/2025/05/26/no-bargains-just-better-rides-yango-launches-in-multan-with-safer-affordable-mobility/)). Its scarcity tools are a green→red demand badge ([iPhones.ru](https://www.iphones.ru/iNotes/v-yandeks-go-poyavilsya-indeks-sprosa-on-obyasnit-pochemu-taksi-stoit-dorozhe-02-03-2022)) and a "The Fastest" any-class option ([App Store](https://apps.apple.com/gh/app/yango-taxi-food-delivery/id1437157286)).
- [C] **Uber** sells speed as a tier picked before requesting: Priority "moves you ahead in the driver queue", not guaranteed ([Uber IN](https://www.uber.com/in/en/blog/uber-priority-rides-during-peak-hours/)).
- [I] No public source shows any rival's chip placement, copy or confirmation. inDrive's waiting screen is commonly seen keeping the offer visible with a stepped raise control; record it on a device first.

**EyeGo spec**: a row under the fare line, shown after ~20 s or at "Still looking". Label "Raise fare to find faster". Chips carry the new total: "+10% · GH₵46", "+20% · GH₵50", "+30% · GH₵55"; hide any chip past +50% cumulative. Tap → inline confirm (no modal): ~~GH₵42~~ **GH₵46** · "All GH₵4 goes to your driver" · [Offer GH₵46]. On confirm the fare line animates to the new total, the headline becomes "Offering GH₵46 · finding your driver", the search continues without restarting, and the driver being asked gets the raised offer. Boosts only go up; at the cap show "Maximum boost reached".

### 1c. No drivers
- [C] **Uber**: "the app will suggest an alternate ride type" or "notify you if no drivers are available" ([Uber help](https://help.uber.com/riders/article/how-to-request-a-ride?nodeId=67f41961-e0aa-4670-af32-58be02c7c492)); the API status is `no_drivers_available`, "unfulfilled because no drivers were available" ([Uber dev](https://developer.uber.com/docs/riders/ride-requests/tutorials/api/best-practices)). For Reserve, integrators must show "Medium availability" and recommend another product, or block booking ([Uber dev](https://developer.uber.com/docs/guest-rides/guest-ride-api-build-guide/fulfillment-indicator)).
- [C] **Bolt**: a scheduled ride with no driver gets an SMS ([Bolt](https://bolt.eu/en/support/articles/40343/)); outside the zone the copy is "Bolt is not yet available here" ([Bolt](https://bolt.eu/en/support/articles/360017280519/)). [I] On-demand wording is undocumented.

**EyeGo spec**: the map stays (rings stop, cars remain). Sheet: "No drivers available right now" / "Drivers near Osu are all busy." Buttons: **Try again** (primary; keeps boost), **Schedule this ride**, **Book a seat on a group bus · next 07:40 · 6 seats left**, shown only when a route serves the pickup (Yandex hides shared options it can't fill). Never auto-dismiss.

### 1d. Match
[C] The matched card shows name, photo, car colour and model, and plate ([Uber](https://www.uber.com/us/en/ride/how-it-works/pickups/)). [I] Success haptic; sheet morphs into the driver card; camera fits driver + pickup.

## 2. Saved places (Home/Work)
- [C] **Uber is search-first**: Account → Settings → Favourites (Home / Work / More Saved Places) → "+" → "Enter the address" → Save. Remove: menu icon → Remove. A "Save this destination" card appears after a trip ([Uber help](https://help.uber.com/riders/article/how-to-addremove-saved-places?nodeId=92f13cb2-bab2-4c88-a19e-9d52533496c3), [Android](https://help.uber.com/riders/article/adding-saved-places-on-android?nodeId=4a53fa02-37c6-4487-8c0a-2e4fb3bd4ae5)). Tapping "Where to?" lists Saved Places first ([Uber](https://www.uber.com/us/en/newsroom/were-redesigning-the-uber-app-just-for-you/)).
- [C] **Bolt** has favourite Home/Work ([Bolt blog](https://bolt.eu/en/blog/best-bolt-app-features-business-travel/), search-indexed, now 404). [I] Its add/edit flow is undocumented.
- [C] **Yandex Maps** (Yango's sibling) is **map-first**: "Add" next to Home/Work → "Select a point on the map" → Done ([Yandex](https://yandex.com/support/m-maps/en/save-places.md)). Yango keeps favourite addresses per account ([Yango GH](https://yango.com/en_gh/support/taxi-all-app-yango/popular-question/how-to-use/account/)) and offers "home" on weekday evenings ([App Store](https://apps.apple.com/gh/app/yango-taxi-food-delivery/id1437157286)).
- [C] Hybrid precedent: Transit's one screen lets you "search for the address or move the map to place the pin" ([Transit](https://help.transitapp.com/article/95-save-your-favorite-locations)).
- [I] Where-to row: icon + bold label ("Work") + one grey address line; a tap fills the destination and jumps to ride options.

**EyeGo spec**: one editor. Search field on top, map below with a fixed centre pin. Picking a result moves the map; dragging re-geocodes; "Use current location" sits under the field; Save stays disabled until the pin settles. Home/Work are fixed slots: empty → "Add work"; set → **Work** / "Ring Road Central, Osu" (street or landmark + area, never bare "Accra"). Tap → ride options; ⋯ → Edit / Remove.

## 3. Driver request card (light)
- [C] **Uber**: *Exclusive* offers (only you, time-limited, blue **Accept**, count toward acceptance rate) vs *Trip Radar* (several drivers, **Match**, multi-select, no penalty) ([Uber](https://www.uber.com/us/en/blog/trip-radar/)); upfront fare plus the cross streets nearest pickup and drop-off ([Uber help](https://help.uber.com/en/driving-and-delivering/article/upfront-fares?nodeId=bc83ed7e-6725-41de-afcb-72d263e5589f)); a "Long trip" label; a decline goes to another driver ([Uber NG](https://www.uber.com/ng/en/drive/basics/how-to-take-trips/)); expiry counts as a decline ([Uber](https://www.uber.com/us/en/blog/understanding-acceptance-and-cancellation-rates/)); the ~10 s window was piloted at ~15 s ([RSG](https://therideshareguy.com/uber-extends-offer-acceptance-time-ping-for-drivers/)); the Oct 2025 card adds time and extra-stop detail ([Uber](https://www.uber.com/us/en/newsroom/onlyonuber25/)).
- [C] **Bolt**: upfront fare before accepting ([Bolt GH](https://bolt.eu/en/driver/earn/ghana/)); an orange border marks an optional order; Auto Accept filters on pickup distance, price/km and payment method ([Bolt](https://bolt.eu/en/support/articles/37263/)).
- [C] **Yango Pro**: orders arrive automatically and chain during trips ([App Store](https://apps.apple.com/gh/app/yango-pro-taximeter-driver/id1561369989)); an Activity score drops on skips ([Yandex Pro](https://pro.yandex.com/am-en/knowledge-base/delivery/couriers/activity-delivery-courier)).
- **EyeGo**: draining bar; GH₵ earnings with "+GH₵4 rider boost · 100% yours"; payment badge; pickup and trip time/distance as area names; seats; one tap Accept. [I] Missed-offer history is undocumented.

## 4. Wallet (light)
- [C] Uber Cash: balance, Add funds, auto-refill, applied first ([Uber](https://www.uber.com/en-EG/ride/how-it-works/uber-cash/)); in Ghana, MoMo top-ups and cash change loaded to the balance ([Graphic](https://www.graphic.com.gh/business/business-news/uber-launches-app-uber-cash-in-ghana.html)). Bolt Balance can go negative and is hidden at zero ([Bolt](https://bolt.eu/en/support/articles/360019507720/)). Yango: switch payment beside the pickup; cash→card mid-ride only ([Yango GH](https://yango.com/en_gh/support/taxi-all-app-yango/popular-question/how-to-order/payment-method/)).
- [I] No rival documents loading or caching. **EyeGo**: show the cached balance with "Updated 2 min ago"; skeleton only on first load; never a GH₵0.00 placeholder; on error keep it and offer retry.

## 5. Home (light)
- [C] Uber rider: "Where to?" opens Saved Places + suggestions; Services tab; Activity hub ([Uber](https://www.uber.com/us/en/newsroom/were-redesigning-the-uber-app-just-for-you/)); car-and-clock schedule icon ([Uber GH](https://www.uber.com/gh/en/ride/how-it-works/)). Uber driver: Go, hourly trends, preferences, Safety shield, tappable busy-area map ([Uber](https://www.uber.com/us/en/drive/driver-app/)); the 2025 heatmap shows shortest waits red→orange→yellow, surge purple ([Uber](https://www.uber.com/us/en/newsroom/onlyonuber25/)). Bolt: red demand areas ([Bolt](https://bolt.eu/en/support/articles/4405582174994/)) and a pause icon ([Bolt](https://bolt.eu/en/support/articles/37263/)). Yandex/Yango Pro: a big "Go online" button; tap the online circle → Busy ([Yandex Pro](https://pro.yandex.com/ky-ru/osh/knowledge-base/taxi/app/yandexpro-how-to)).

## Differences → EyeGo
| | Uber | Bolt | Yango | EyeGo |
|---|---|---|---|---|
| Speed lever | Priority tier, before request | fare offer (NG), range (UK); commission on the extra | none (fixed price) | +10/20/30% chips, cap +50%, all to driver |
| No drivers | alternate tier | SMS (scheduled) | any-class option | Try again / Schedule / Group-bus seat |
| Saved place | search-first | undocumented | map-first | hybrid search + pin |

## Gaps
No primary source covers searching-screen animation, boost-chip UI, Bolt's on-demand no-driver copy, Bolt's saved-place editor, missed-offer history or wallet loading. Yango Ghana help pages blocked us (403).

---

# Part 2 — every other page (added 2026-10-07)

Same tags. Help centres describe what is ON a page well and how it LOOKS poorly, so layout notes are mostly [I]. Each entry ends with the EyeGo target, built with the shared page kit (ScreenHeader · ListSection · ListRow · ScreenState) under "Onyx + restraint": one glow per screen at most.

## 0. The page template (applies everywhere)
- [I] Uber/Bolt secondary pages: back arrow top-left, large left-aligned title that shrinks into the bar on scroll, flat rows (leading icon · title · grey subtitle · trailing value or chevron) separated by hairlines, small bold section labels, destructive actions last and red. No cards around lists, no decoration.
- **EyeGo**: exactly that. Loading = skeleton rows matching the real layout; empty = icon + one sentence + one action; error = message + Retry, never a blank page or a GH₵0.00 placeholder.

## 6. Rider — Account tab
- [C] Wallet, Activity, Help, Settings, Family and Privacy Checkup all hang off **Account** ([Uber](https://www.uber.com/us/en/ride/how-it-works/family-profiles/), [Uber security](https://medium.com/@ubersecurity/introducing-ubers-privacy-checkup-and-more-ac2d07b43131)); Activity is reached by tapping Account → Activity ([Tailride](https://tailride.so/blog/how-to-get-a-receipt-from-uber)).
- [I] Header = name, photo, rating; a row of three big tiles (Help · Wallet · Activity); then a plain list.
- **EyeGo**: header (avatar, name, ★ rating, Edit). Tiles: **Wallet** (live balance) · **Activity** · **Help**. Sections: *Rides* (Saved places, Scheduled rides, Promotions, Business) · *Money* (Payment methods, Send money, Scan & pay) · **Settings ›**. Log out last.

## 7. Rider — Settings hub
- [C] Privacy controls live together under Settings (location, notifications, account deletion) and a Privacy Centre (download / explore your data) ([Uber newsroom](https://www.uber.com/newsroom/your-privacy-settings-all-in-one-place-and-easier-to-use-2), [VentureBeat](https://venturebeat.com/mobile/uber-simplifies-privacy-controls-to-better-manage-what-data-is-shared)).
- [C] **Safety Preferences**: one page for audio recording, PIN verification, Share My Trip and RideCheck, each set to always / at night / by place ([Daily Hive](https://dailyhive.com/vancouver/uber-ride-hailing-app-safety-preferences)).
- [C] Home/Work and extra shortcuts are edited under Settings ([Guiding Tech](https://www.guidingtech.com/delete-saved-places-uber)).
- **EyeGo** (replaces settings + privacy + safety splits): *Account* (name, phone, email → Edit profile) · *Saved places* · *Appearance* (Dark / Light / System) · *Notifications* · *Privacy* (location, data) · *Safety* (trusted contacts, safety preferences) · *Legal* (Terms, Privacy policy) · **Delete account** (red, last). One delete flow only.

## 8. Rider — Wallet & payment methods
- [C] Account → Wallet → *Payment Methods* list → **Add Payment Method**; *Add funds* → amount → method → Purchase, balance updates at once; optional auto-refill below a threshold ([Ridester](https://www.ridester.com/how-to-use-uber-cash/), [Uber](https://www.uber.com/co/en/ride/how-it-works/uber-cash/)).
- **EyeGo**: balance hero (the page's one glow) + **Top up**; *Payment methods* rows with a check on the default + "Add payment method"; *Send money* and *Scan & pay* as rows; transactions grouped by day, signed amounts, pending/failed in grey. Cached balance + "Updated 2 min ago" (§4).

## 9. Rider — Activity & trip receipt
- [C] Tapping a trip shows date/time, pickup and drop-off, full fare breakdown (base, taxes, tolls); the receipt sits below the map and the rating; resend receipt by email, get help, or dispute from the trip; history filterable by date or by Personal/Business ([Tailride](https://tailride.so/blog/how-to-get-a-receipt-from-uber)).
- [I] List rows carry a small static route map, place name, date, price.
- **EyeGo**: *Upcoming* (scheduled + booked seats) then *Past* grouped by month; row = route thumbnail · destination · date · GH₵ · status chip if not completed. Detail: static map header → date/time → driver + vehicle → route timeline → fare breakdown → payment → **Get help** · **Receipt** · **Rebook**.

## 10. Rider — Help
- [C] Articles plus "send a message" to support ([Uber GH](https://www.uber.com/en-GH/blog/in-app-support-help-at-the-tap-of-a-button-5/)); driver Help has search on top and topic lists ([RSD](https://www.ridesharingdriver.com/every-feature-in-uber-driver-app/)).
- **EyeGo**: search field top → "Your last trip" row with Get help → topics → *Your conversations* (tickets with status).

## 11. Rider — Safety (profile + in-trip)
- [C] In-trip shield opens the toolkit: contact a safety agent (call or silent text), Emergency button showing live location + trip details for the dispatcher, Share My Trip with trusted contacts, RideCheck on long unexpected stops ([Uber safety](https://www.uber.com/au/en-au/ride/safety)).
- **EyeGo**: profile/safety = Safety preferences (toggles with *always / at night*) + Trusted contacts + PIN verification. In-trip SOS keeps its red emergency bar; location + plate shown big enough to read aloud.

## 12. Rider — Notifications, Promotions, Scheduled rides
- [I] Inbox lists newest first with an unread dot; promotions sit in the Wallet with a code field; reserved rides appear under Activity → Upcoming.
- **EyeGo**: Notifications grouped *Today / Earlier*, unread dot, tap → the thing it's about. Promotions: code field top, active promos with expiry, used ones collapsed. Scheduled rides = the same rows as Activity → Upcoming.

## 13. Rider — Driver-created trips (browse)
- [C] **Uber Shuttle**: choose Shuttle, enter pickup + drop-off, see the routes between them, pick a route then a boarding time, up to 5 seats, book up to a week ahead and until 2 min before departure, then track the bus live ([Uber help via search](https://help.uber.com/en/riders/article/airport-shuttle-faq?nodeId=303ceaf8-e1db-4adf-a44d-1e774d768bcd), [Uber](https://www.uber.com/us/en/ride/uber-shuttle)).
- [I] Explore surfaces put the map full-screen with the list in a draggable sheet; pins cluster when zoomed out.
- **EyeGo**: full map + sheet (peek/half/full); "Where to?" field narrows to trips heading there; sort Soonest / Nearest pickup / Cheapest; rows = walk time to pickup · live countdown · destination · driver ★ + vehicle · seat dots · GH₵/seat; *Leaving soon* strip pinned on top with one-tap Reserve; seat counts update live; empty state offers **Notify me** for that destination, Request now, Schedule.

## 14. Rider — Sign-in & onboarding
- [I] Phone → OTP (auto-read, resend timer) → name → terms; one field per screen, keyboard-pinned Continue.
- **EyeGo**: same; no decoration beyond the logo; errors inline under the field.

## 15. Driver — Home
- [C] Big **Go** button; map with demand shading, surge areas and airport queues; Trip Planner tab (promotions, ride-type preferences); destination filter ([RSD](https://www.ridesharingdriver.com/every-feature-in-uber-driver-app/)).
- **EyeGo**: already built; restraint pass only — today's earnings pill top, Go button the single glow.

## 16. Driver — Earnings
- [C] Daily earnings, time online, trips completed and expected deposit for the week; trip list where each trip opens details + Help (fare issue, rider behaviour, lost item, accident); *More ways to earn* (promotions); tap balance → itemised transactions; progress trackers toward promotions with expiry; cash out from Earnings ([RSD](https://www.ridesharingdriver.com/every-feature-in-uber-driver-app/), [Uber](https://www.uber.com/us/en/newsroom/refining-the-earnings-experience-2/)).
- **EyeGo**: week switcher + daily bars → totals row (online time · trips · GH₵) → **Withdraw** → *Weekly goal* (moved from Performance) → *More ways to earn* (quests) → trips list.

## 17. Driver — Ratings & performance (merge of performance + ratings)
- [C] Uber Pro shows points/tier, star rating, cancellation rate and benefits, plus higher-tier benefits; tiers by points over a 3-month period plus quality bars (≥4.85★, ≤4% cancellation) ([Uber Pro](https://www.uber.com/at/en/drive/uber-pro/), [TripLog](https://triplog.net/blog/uber-pro-explained-everything-drivers-need-to-know)).
- [C] Acceptance rate = last 100 exclusive requests; cancellation = cancels ÷ accepted; tap a rate to see how many requests it's based on ([Uber](https://www.uber.com/blog/understanding-acceptance-and-cancellation-rates)). Rating page: distribution graph of the last 500 ratings, feedback from sub-4★ trips, compliments and achievements ([RSD](https://www.ridesharingdriver.com/every-feature-in-uber-driver-app/)).
- **EyeGo**: big ★ rating (the one glow) → three rates (rating · acceptance · cancellation), each tappable with "Based on your last N" → 1–5★ distribution bars → compliments → tier card with points to next tier and what it unlocks.

## 18. Driver — Account, documents, vehicle, payout, settings, help
- [C] Account holds Vehicles (add vehicle), Documents (tap to re-upload; expiry dates with colour-coded warnings), Payment (active payout method, edit), Tax info, Insurance ([RSD](https://www.ridesharingdriver.com/every-feature-in-uber-driver-app/)); Bolt asks for an expiry date on each document upload ([Bolt FAQ](https://bolt.eu/en-sa/driver/guide/faq/)).
- [C] Settings: Sounds & voice, Navigation (in-app vs Google Maps/Waze, voice on/off), Accessibility (screen flash / vibration for requests), Communication (call or chat), Night mode, Follow my ride, Emergency contact, Speed limit alerts ([RSD](https://www.ridesharingdriver.com/every-feature-in-uber-driver-app/)).
- [C] Help: search + topics *Trips · Account & app · Earnings · Guides* + chat with support ([RSD](https://www.ridesharingdriver.com/every-feature-in-uber-driver-app/)).
- **EyeGo**: Account = *Vehicle* · *Documents* (each row shows status + expiry; amber ≤30 days, red expired) · *Payout account* · **Ratings & performance ›** · **Settings ›** · Help. Settings sections: Navigation app · Requests (sound, vibration) · Communication · Appearance · Safety (emergency contact) · Legal · Delete account (red, last).

## 19. Driver — Inbox & trip history
- [C] Inbox = account notices, feature news, promotions ([RSD](https://www.ridesharingdriver.com/every-feature-in-uber-driver-app/)).
- **EyeGo**: Notifications grouped *Today / Earlier*; Trips tab rows = date · route · seats filled · GH₵ earned → detail with **Get help**.

## Part 2 gaps
Uber's rider Account tile row and the visual style of section headers are [I]: the redesign page returned HTTP 406 and help pages describe content, not layout. Bolt's driver settings layout is undocumented beyond the paths above. Verify [I] layouts on a phone.
