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
