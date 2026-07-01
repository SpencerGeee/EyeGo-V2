# EyeGo Competitor Feature Checklist
## Uber · Bolt · inDrive · Yango — West Africa / Ghana Focus

> **How to read this table**
> - **Apps**: U = Uber · B = Bolt · I = inDrive · Y = Yango
> - **EyeGo fit**: ✅ Applies directly | 🔄 Adapt for shared-route model | ❌ Not applicable | ⚠️ Partial / conditional
> - **Priority**: CRITICAL → HIGH → MEDIUM → LOW

---

## 1. Onboarding & Auth

| # | Feature | Apps | How it works in competitor apps | EyeGo fit | Priority |
|---|---------|------|--------------------------------|-----------|---------|
| 1.1 | Phone number registration | U B I Y (all) | Primary identifier everywhere. Uber/Bolt allow email + phone. inDrive/Yango are phone-first. | ✅ Phone-first, Ghana numbers (0XX format) | CRITICAL |
| 1.2 | OTP verification via SMS | U B I Y (all) | 6-digit SMS OTP on signup and on each new device login. Bolt also supports WhatsApp OTP fallback in some markets. | ✅ Standard SMS OTP | CRITICAL |
| 1.3 | Social login (Google / Apple) | U B | Uber and Bolt both offer Google Sign-In and Apple Sign-In as a fast onboarding path. inDrive and Yango are phone-only. | 🔄 Nice to have; not essential in Ghana market | MEDIUM |
| 1.4 | Profile setup (name, photo) | U B I Y (all) | All apps collect name + profile photo. Uber/Bolt prompt photo upload during signup. inDrive/Yango allow skipping photo initially. | ✅ Name + photo; photo especially important for driver-to-rider matching at shared stops | HIGH |
| 1.5 | ID / selfie verification (rider) | B | Bolt introduced optional rider selfie verification in 2023–2024 (South Africa pilot, expanding). Uber/inDrive/Yango do not currently verify rider identity at signup. | ⚠️ Could differentiate on trust for EyeGo routes | MEDIUM |
| 1.6 | Driver licence / vehicle check (driver side) | U B Y | All three conduct pre-onboarding background checks on driver identity and vehicle documents. inDrive has lighter vetting, relying more on community ratings. | ✅ Critical for driver onboarding on EyeGo routes | CRITICAL |
| 1.7 | Language selection | Y | Yango supports Twi and Ga (local Ghanaian languages) in addition to English, giving it a notable local advantage. Uber/Bolt/inDrive are English-only in Ghana. | ✅ High impact for Accra market — Twi support | HIGH |
| 1.8 | Referral code entry at signup | U B | Both prompt for optional referral code at sign-up screen, applying discount to first ride. inDrive/Yango have referral schemes but not consistently surfaced at signup. | ✅ Enter at signup → first-ride discount | HIGH |
| 1.9 | Terms & privacy consent | U B I Y (all) | Single checkbox flow. Uber/Bolt show full links; inDrive/Yango condense into one screen. | ✅ Required | CRITICAL |
| 1.10 | Notification permissions prompt | U B I Y (all) | iOS/Android native prompt shown after profile creation. Bolt uses a pre-permission education screen (explains why). | ✅ Show value proposition before OS prompt | HIGH |

---

## 2. Home Screen

| # | Feature | Apps | How it works in competitor apps | EyeGo fit | Priority |
|---|---------|------|--------------------------------|-----------|---------|
| 2.1 | Full-screen map | U B I Y (all) | Google Maps base (Uber, Bolt, inDrive) or Yandex Maps (Yango). Map fills screen; input bar floats at top. | ✅ Show route corridors on map instead of scattered cars | CRITICAL |
| 2.2 | Nearby drivers indicator | U B Y | Animated car icons on map show approximate driver density. inDrive does not show nearby cars (negotiation model means no pre-shown supply). | 🔄 Show upcoming trips on your route, not random cars | HIGH |
| 2.3 | Surge / dynamic pricing indicator | U B Y | Uber shows multiplier badge on ride type (e.g. "1.8x"). Bolt shows "High demand" label. Yango auto-adjusts fare silently with AI. inDrive has no surge — fares are negotiated. | 🔄 EyeGo has fixed route pricing; show "seats filling fast" instead of surge | MEDIUM |
| 2.4 | ETA to nearest pickup point | U B Y | Uber/Bolt show "X min away" in the ride type selector. Yango shows driver ETA in minutes after fare is shown. | 🔄 Show "next trip departs in X min from [stop name]" | CRITICAL |
| 2.5 | Recent trips shortcut | U B I Y (all) | All apps surface the last 1–3 destinations as quick-tap chips below the search bar. | ✅ Show last route taken | HIGH |
| 2.6 | Saved places shortcuts (Home/Work) | U B Y | Uber/Bolt/Yango show Home and Work as persistent quick-tap icons on the home screen. inDrive has saved places in profile but not surfaced on home screen. | ✅ Show saved routes/stops | HIGH |
| 2.7 | Scheduled/upcoming trip card | U B | Uber and Bolt both show a card on the home screen when you have a reserved ride coming up, with countdown. | ✅ "Your next trip on Route 4 departs in 23 min" | HIGH |
| 2.8 | Promo / offer banner | U B I Y (all) | All apps show a dismissible banner or card for active promos. Uber rotates Uber One offers. Bolt shows Ghana-specific promo codes. | ✅ First-ride offer, referral CTA | MEDIUM |
| 2.9 | Service switcher (rides / food / delivery) | B Y | Bolt has bottom tab for Food. Yango has rides + delivery in one app. Uber has Eats as separate tab within the same app. inDrive has city rides + courier + freight in one app. | ❌ EyeGo is rides-only at launch | LOW |
| 2.10 | Offline / poor connectivity state | B Y | Bolt shows a banner when offline; caches last map tile. Yango (Yandex Maps) has strong offline support out of the box. | ✅ Critical for Ghana's intermittent data — cache route shapes locally | HIGH |

---

## 3. Destination Entry

| # | Feature | Apps | How it works in competitor apps | EyeGo fit | Priority |
|---|---------|------|--------------------------------|-----------|---------|
| 3.1 | Text search with autocomplete | U B I Y (all) | Google Places API (Uber/Bolt/inDrive), Yandex Maps (Yango). Results appear after 2+ characters. Yango's autocomplete is tuned to local Ghanaian place names. | ✅ Must support Accra landmarks, areas, and informal names (e.g. "Tema roundabout") | CRITICAL |
| 3.2 | Map pin drop | U B I Y (all) | All apps allow dragging a pin on the map to set pickup or destination when address search fails. Essential for Ghana's informal addressing. | ✅ Critical for Ghana where many locations lack formal addresses | CRITICAL |
| 3.3 | Recent destinations list | U B I Y (all) | Shown immediately when search bar is tapped, before any typing. Ordered by recency. | ✅ | HIGH |
| 3.4 | Saved places (Favourites) | U B Y | Uber/Bolt/Yango allow saving named places (Home, Work, Others). inDrive has saved places in settings. | 🔄 EyeGo: save favourite stops/routes | HIGH |
| 3.5 | Pickup location adjustment | U B I Y (all) | All apps let you drag the pickup pin on the map, or choose a different suggested address before confirming. | 🔄 EyeGo: pickup is a fixed stop — show nearest stop to user's GPS, allow choosing among 2–3 nearby stops | CRITICAL |
| 3.6 | Multi-stop / add stops | U B Y | Uber and Bolt allow adding up to 3 intermediate stops mid-ride (tap "+" in the destination field). Yango allows adding a new stop mid-trip via the app. inDrive does not have a multi-stop feature. | ❌ Fixed routes have defined stops; no arbitrary mid-trip stops | LOW |
| 3.7 | Destination suggestion based on history | Y | Yango's AI proactively suggests likely destinations based on time of day and historical patterns (e.g., offers "Home" on weekday evenings). Uber/Bolt show history; Yango actively predicts. | 🔄 Suggest the user's usual route at their typical travel time | MEDIUM |
| 3.8 | Current location as pickup (auto-detect) | U B I Y (all) | All apps default to GPS location as pickup. Show "Current Location" as top option. | ✅ | CRITICAL |
| 3.9 | Landmark-based search | Y | Yango and Bolt both index local landmarks (markets, hospitals, schools) as first-class search results. Yango is strongest in Ghana for local place names. | ✅ Index Accra landmarks, trotro stations, major junctions | HIGH |

---

## 4. Ride Selection

| # | Feature | Apps | How it works in competitor apps | EyeGo fit | Priority |
|---|---------|------|--------------------------------|-----------|---------|
| 4.1 | Ride tier / category picker | U B Y | Uber: UberX / Comfort / XL / Lux / Reserve (scrollable horizontal list). Bolt: Lite / Comfort / XL. Yango: Start / Economy / Comfort / Fastest. inDrive has no tiers (single class, negotiated price). | 🔄 EyeGo: Route picker showing available routes + departure times + seats left | CRITICAL |
| 4.2 | Upfront fare estimate | U B Y | All show a fixed estimated fare before booking. Uber shows breakdown (base + distance + time). Bolt shows a single figure with a note if surge applies. Yango shows fare with dynamic component. | ✅ Show fixed price per seat per route — no surge | CRITICAL |
| 4.3 | Fare breakdown | U | Uber shows base fare + per-km + per-min + booking fee + surge multiplier. Bolt shows a simpler single fare. inDrive shows the negotiated amount. Yango shows total with minimal breakdown. | ✅ Show: base fare + any route surcharge; keep simple | MEDIUM |
| 4.4 | Promo code / voucher field | U B I Y (all) | All apps have a "Promo code" entry before booking confirmation. Uber and Bolt show it on the fare selection screen. | ✅ | HIGH |
| 4.5 | Seat picker | None natively | No competitor has a seat-selection UI for standard rides. Uber's Route Share allocates one seat per booking with no seat choice. UberX Share matches up to 2–3 riders silently. | ✅ UNIQUE to EyeGo — show a bus-style seat map; let rider pick seat number | CRITICAL |
| 4.6 | Route preview on map | U B | Uber and Bolt show a polyline of the projected route on the map before confirming. inDrive/Yango do not show a pre-booking route preview. | ✅ Show the fixed route polyline with all stops marked | HIGH |
| 4.7 | Available seats / occupancy indicator | None | No competitor exposes remaining seat count before booking. | ✅ UNIQUE — "4 of 7 seats filled" on route card | CRITICAL |
| 4.8 | Departure time picker | None natively | Uber Reserve allows scheduling up to 90 days out. Bolt allows scheduling 30 min to 90 days out. Neither operates on a fixed timetable. Uber Route Share has fixed time windows (6–10am, 4–8pm) but with no user-chosen departure time. | ✅ UNIQUE — Show departure times for the route; rider picks a time slot | CRITICAL |
| 4.9 | Driver / vehicle info before booking | I | inDrive is the standout: before accepting a ride, riders see driver name, car model, plate number, number of completed trips, and can choose among competing driver offers. Uber/Bolt/Yango assign a driver after booking. | 🔄 EyeGo: show driver name/plate/vehicle + route details before seat booking | HIGH |
| 4.10 | Heavy load / luggage option | B | Bolt offers a "heavy item" or "large luggage" tag in some markets that filters for drivers with larger vehicles. Not standard in Ghana. Uber has UberXL for groups. | ⚠️ Low priority at launch; relevant for intercity variants later | LOW |
| 4.11 | Pool / carpool toggle | U | Uber has UberX Share (formerly Pool) as a separate tier. Bolt discontinued Bolt Pool in most markets. Neither operates on fixed routes. | ❌ EyeGo IS the shared product; no toggle needed | N/A |

---

## 5. Booking Confirmation

| # | Feature | Apps | How it works in competitor apps | EyeGo fit | Priority |
|---|---------|------|--------------------------------|-----------|---------|
| 5.1 | Driver assignment screen | U B I Y (all) | After booking, all apps show an animated "finding driver" state, then transition to driver info card. Bolt is typically fastest at matching. | 🔄 EyeGo: "Confirming your seat on Route 4, 8:15am departure" — no waiting for driver | CRITICAL |
| 5.2 | Driver info card (photo / name / plate / rating) | U B I Y (all) | All apps show driver photo, first name, star rating, vehicle make/model, and licence plate prominently. Uber/Bolt also show a "Verify" button for pickup codes. | ✅ Essential for rider safety and confidence | CRITICAL |
| 5.3 | Vehicle photo | U B | Uber and Bolt show the vehicle photo or colour. inDrive shows vehicle model text only. Yango shows colour and model. | ✅ Show vehicle photo + colour for identification at shared stops | HIGH |
| 5.4 | ETA countdown to pickup | U B I Y (all) | Live minute countdown ("Driver arrives in 4 min"). Updates in real time. | 🔄 "Trip departs in 12 min from Osu Junction" — countdown to fixed departure time | CRITICAL |
| 5.5 | Contact driver — in-app call | U B I Y (all) | All apps provide a masked call button (phone number hidden). Bolt/Uber mask both numbers via a relay. inDrive uses direct number in some markets. | ✅ Masked call relay | HIGH |
| 5.6 | Contact driver — in-app chat | U B Y | Uber, Bolt, and Yango all have in-app text messaging to driver. inDrive relies on phone call / WhatsApp. | ✅ Simple text chat between rider and driver | HIGH |
| 5.7 | Cancel booking | U B I Y (all) | All apps allow cancellation within a window (typically 2–5 min free; fee after). Uber charges GHS 5–10 after the free window. Bolt similar. | 🔄 EyeGo: free cancellation up to 15 min before departure; no-show policy for reserved seats | CRITICAL |
| 5.8 | Add stop after booking | U B | Uber/Bolt allow adding a stop after booking is confirmed. inDrive/Yango do not easily support this. | ❌ Fixed routes don't allow arbitrary extra stops | N/A |
| 5.9 | Share ride details (pre-trip) | U B Y | Uber/Bolt/Yango show a "Share trip" button on the driver info card so you can send trip details to someone before you even get in the car. | ✅ | HIGH |

---

## 6. Live Tracking

| # | Feature | Apps | How it works in competitor apps | EyeGo fit | Priority |
|---|---------|------|--------------------------------|-----------|---------|
| 6.1 | Real-time driver location on map | U B I Y (all) | All apps show a live-updating car icon with ~5s GPS refresh. Uber has the smoothest animation (interpolation). | ✅ Show bus/vehicle moving along fixed route | CRITICAL |
| 6.2 | Route polyline on map | U B | Uber shows the full projected route in blue. Bolt shows a simpler route line. Yango/inDrive do not consistently show the full polyline during tracking. | ✅ Show fixed route polyline + all stops; highlight next stop | CRITICAL |
| 6.3 | Live ETA updates | U B I Y (all) | All apps update the "X min away" ETA dynamically. Uber is most accurate (Google Maps + ML model). | ✅ "Arrives at your stop in X min" | CRITICAL |
| 6.4 | Stop-by-stop progress | None natively | No competitor (all are point-to-point). Uber Route Share shows a progress bar. | ✅ UNIQUE — show progress through route stops (like a metro line indicator) | CRITICAL |
| 6.5 | Other rider positions on trip | None | No competitor shows co-passengers on a shared trip. | 🔄 Optional: show number of co-riders aboard; privacy-respecting | LOW |
| 6.6 | Share trip link (live tracking for contacts) | U B I Y (all) | Uber, Bolt, Yango all generate a shareable URL that shows the live car position, driver info, and ETA to a non-app contact. inDrive has share-location button. Bolt's link works via WhatsApp/SMS/Telegram. | ✅ | HIGH |
| 6.7 | SOS / Emergency button | U B I Y (all) | All four apps have an emergency button. Uber/Bolt connect to local emergency services (080 numbers in Ghana). Yango has dedicated SOS button on main trip screen always visible. Bolt's Emergency Assist also notifies Bolt's own Safety Team who makes a welfare call. | ✅ Always-visible SOS connecting to Ghana emergency (191/999) + notify emergency contact | CRITICAL |
| 6.8 | Driver arrived notification | U B I Y (all) | Push notification + in-app screen change ("Your driver has arrived"). Bolt also plays a sound. | 🔄 "Your bus is at Osu Junction — board now!" | CRITICAL |
| 6.9 | Speed alert / overspeeding warning | Y B | Yango compares real GPS speed to road speed limit using navigator data. Bolt has a similar speed-monitoring feature for drivers. Rider-facing: Yango shows a speed alert banner on the trip screen if the driver exceeds limits. | ✅ Important for safety on Accra roads | MEDIUM |
| 6.10 | Audio trip recording | B | Bolt allows the rider to trigger an encrypted audio recording of the trip. Stored on device for 24h, accessible only by Bolt safety team. Only Bolt has this among the four. | 🔄 Consider for EyeGo — high trust-builder in shared vehicle context | MEDIUM |
| 6.11 | Driver approaching notification | U B | Uber sends "Your driver is arriving" push notification ~1 min before arrival. Bolt similar. | 🔄 "Bus approaching your stop — be ready" | HIGH |

---

## 7. Payment

| # | Feature | Apps | How it works in competitor apps | EyeGo fit | Priority |
|---|---------|------|--------------------------------|-----------|---------|
| 7.1 | Cash payment | U B I Y (all) | Cash is the dominant payment method for all four in Ghana. Drivers prefer cash — money goes directly to them. | ✅ Must support cash; it's primary in Accra | CRITICAL |
| 7.2 | MTN Mobile Money | U B Y | Uber supports MTN MoMo, Vodafone Cash, AirtelTigo Money natively. Bolt supports mobile money. Yango supports it. inDrive Ghana is primarily cash; bank transfer feature is early stage. | ✅ MTN MoMo is dominant in Ghana — integrate first | CRITICAL |
| 7.3 | Vodafone Cash / AirtelTigo Money | U B Y | Uber explicitly supports all three Ghanaian mobile money platforms. Bolt and Yango similarly support them. | ✅ All three operators at launch | HIGH |
| 7.4 | Card (Visa / Mastercard) | U B | Uber and Bolt support card payments. In Ghana, many drivers ask riders to pay cash instead because card payments go to the platform first before settlement to driver. Card works but is least preferred by drivers. | ✅ Support cards but set cash/MoMo as default CTA | MEDIUM |
| 7.5 | In-app wallet / Bolt Balance | B | Bolt Balance: referral credits and refunds are stored in-wallet and automatically applied to next ride. Uber removed its wallet credits model. Yango/inDrive do not have an in-app wallet in Ghana. | ✅ EyeGo wallet for pre-loaded route credits, top-up | HIGH |
| 7.6 | Promo code redemption at payment | U B I Y (all) | All apps allow promo code entry at the payment/fare-selection screen, applying discount before ride is confirmed. | ✅ | HIGH |
| 7.7 | Split fare | U | Uber allows splitting the fare equally with others sharing the ride. A "Split fare" button appears once matched with a driver. Each person receives a request via the Uber app. | 🔄 Not needed for EyeGo — each rider pays their own seat price individually | N/A |
| 7.8 | Tip at payment | U B Y | Uber/Bolt/Yango all offer post-trip tipping via in-app (Uber: up to 30 days after trip). Yango has a "default tip" setting. inDrive does not have a formal tip feature. | ✅ Optional tip prompt on post-trip screen | MEDIUM |
| 7.9 | Payment method management | U B I Y (all) | All apps have a Payment section in profile to add/remove cards and mobile money accounts. Bolt and Uber show which is "default." | ✅ | HIGH |
| 7.10 | Fare hold / price lock | U | Uber launched a Price Lock Pass ($2.99/mo) for US users in 2025 — locks price on a specific route for 1hr daily. Not in Ghana yet. | 🔄 Could become a differentiator: "Lock your commute price for the week" | LOW |

---

## 8. Post-Trip

| # | Feature | Apps | How it works in competitor apps | EyeGo fit | Priority |
|---|---------|------|--------------------------------|-----------|---------|
| 8.1 | Mandatory driver rating | U B I Y (all) | All four apps prompt a 1–5 star rating screen immediately after the trip ends. Bolt blocks the next booking until a rating is submitted (soft gate). Uber shows it as a push notification. | ✅ Prompt rating at trip end; soft-gate before next booking | CRITICAL |
| 8.2 | Star rating + tags | U B Y | Uber and Bolt offer predefined tag reasons for low ratings (e.g. "Rude driver", "Wrong route", "Unsafe driving"). Yango similar. inDrive uses star rating only. | ✅ Include tags: "Late departure", "Uncomfortable", "Great driver" | HIGH |
| 8.3 | Tip option post-trip | U B Y | All three allow tipping after rating. Uber's post-trip screen shows preset tip amounts (GHS 2, 5, 10, custom). Bolt similar. | ✅ After rating, before receipt — show tip prompt | MEDIUM |
| 8.4 | Digital receipt (in-app) | U B I Y (all) | All apps show a receipt in Trip History with date, route, distance, fare breakdown, and payment method. | ✅ Show trip, route, seat number, fare, payment method | CRITICAL |
| 8.5 | Receipt by email | U B | Uber automatically emails a receipt to the registered email address after every trip. Bolt emails a receipt on request or after card payment. inDrive/Yango do not consistently email receipts. | ✅ Auto-email receipt after every paid trip | HIGH |
| 8.6 | Share receipt | U | Uber has a "Share" button on the receipt to forward via WhatsApp, email, etc. | 🔄 Useful for business riders expensing the trip | MEDIUM |
| 8.7 | Report an issue post-trip | U B I Y (all) | All apps have a "Report an issue" flow accessible from trip history. Options include: driver behaviour, wrong route, overcharge, safety concern. | ✅ Include: "Driver was late", "Wrong route taken", "Safety concern" | HIGH |
| 8.8 | Lost item report | U B | Uber and Bolt have a dedicated "I lost an item" flow in trip history that connects the rider to the driver via a masked call or support ticket. inDrive/Yango have generic support only. | ✅ | HIGH |
| 8.9 | Bonus / reward for rating completion | None | None of the four offer explicit rewards for rating completion. | 🔄 EyeGo could give loyalty points for rating — drives engagement | LOW |

---

## 9. Trip History

| # | Feature | Apps | How it works in competitor apps | EyeGo fit | Priority |
|---|---------|------|--------------------------------|-----------|---------|
| 9.1 | Trip history list | U B I Y (all) | All apps show a chronological list of past trips with date, route/destination, fare, and status. Uber and Bolt show infinite scroll. | ✅ | CRITICAL |
| 9.2 | Trip detail view | U B I Y (all) | Tapping a trip shows: map route taken, driver name, fare breakdown, payment method, receipt. | ✅ Show: route name, departure time, seat, driver, fare, co-rider count | HIGH |
| 9.3 | Filter trip history | U | Uber allows filtering trips by date range. Bolt does not have a filter — just chronological list. inDrive/Yango are list-only. | 🔄 Filter by route, date range | MEDIUM |
| 9.4 | Re-book from history | U B | Uber shows a "Rebook" button on past trip screen which pre-fills the destination. Bolt similar. | 🔄 "Book this route again" | HIGH |
| 9.5 | Receipt download / PDF export | U | Uber allows downloading a PDF receipt for each trip. Bolt sends via email. inDrive/Yango do not offer download. | ✅ Especially useful for business riders | MEDIUM |
| 9.6 | Dispute a trip charge | U B | Uber and Bolt have a "Dispute this trip" or "Trip issue" flow from history, creating a support ticket. inDrive/Yango use general support chat. | ✅ | HIGH |
| 9.7 | Cancellation history | U B | Both show cancelled trips with reason and whether a fee was charged. | ✅ Show cancelled bookings + refund status | MEDIUM |

---

## 10. Profile & Account

| # | Feature | Apps | How it works in competitor apps | EyeGo fit | Priority |
|---|---------|------|--------------------------------|-----------|---------|
| 10.1 | Profile photo | U B I Y (all) | All apps support profile photo upload. Bolt and Uber compress and cache. | ✅ | HIGH |
| 10.2 | Name and phone edit | U B I Y (all) | All allow editing display name. Phone number change requires OTP re-verify. | ✅ | HIGH |
| 10.3 | Email address | U B | Uber/Bolt use email for receipts and account recovery. inDrive/Yango are phone-only in Africa. | ✅ Optional email field for receipts | MEDIUM |
| 10.4 | Saved places (Home / Work / Custom) | U B Y | Uber and Bolt have Home, Work, and up to 5 custom saved places. Yango has saved addresses. inDrive has a simple favourites list. | ✅ Save favourite stops/routes | HIGH |
| 10.5 | Emergency contacts | U B Y | Uber/Bolt/Yango allow adding trusted contacts who can be automatically notified in an SOS event. Bolt calls them "Trusted Contacts." | ✅ Up to 3 emergency contacts | HIGH |
| 10.6 | Payment methods management | U B I Y (all) | Add/remove/set default card, mobile money, or wallet. Uber and Bolt allow multiple saved methods. | ✅ | CRITICAL |
| 10.7 | Referral code | U B I Y (all) | All four apps generate a unique referral code per user. Shared via WhatsApp/SMS. Bolt Ghana page explicitly promotes referral. Uber Ghana shows it under "Free rides." | ✅ In-app share sheet + copy code | HIGH |
| 10.8 | Loyalty / reward points | None in Ghana | Uber One (subscription) is US-focused. Bolt has NO loyalty program. Yango has no loyalty in Ghana. inDrive has no loyalty program. This is a market gap. | ✅ DIFFERENTIATOR — EyeGo loyalty points for rides | HIGH |
| 10.9 | Business account | U B | Uber for Business allows companies to set up centralised billing, expense codes, automated reports, and third-party integrations. Bolt for Business similar. Both available in Ghana. inDrive/Yango have no business account feature. | 🔄 Business accounts for SME commuters — high opportunity in Accra | MEDIUM |
| 10.10 | Account deletion | U B I Y (all) | All apps required to provide this under GDPR / data protection laws. Uber/Bolt: Settings → Privacy → Delete Account with 30-day grace period. | ✅ Required | CRITICAL |
| 10.11 | Rider rating display | U B I Y (all) | Riders can see their own rating in their profile. Bolt shows a rider score; Uber shows a star average. Low-rated riders may be declined by drivers. | ✅ Show rider's own rating | HIGH |
| 10.12 | Women-for-Women option | B | Bolt offers a "Women for Women" ride type in select markets where female riders can request only female drivers. Not yet in Ghana. | 🔄 Consider for EyeGo female-only seats on routes | LOW |
| 10.13 | Dark mode | U B | Uber and Bolt support system dark mode. inDrive/Yango do not offer dark mode. | ✅ Follow system setting | MEDIUM |

---

## 11. Notifications

| # | Feature | Apps | How it works in competitor apps | EyeGo fit | Priority |
|---|---------|------|--------------------------------|-----------|---------|
| 11.1 | Push notifications (ride status) | U B I Y (all) | All apps send push for: driver assigned, driver approaching, driver arrived, trip started, trip ended, payment charged. | ✅ Map to EyeGo: seat confirmed, bus approaching stop, boarding time, trip started, trip completed | CRITICAL |
| 11.2 | SMS fallback | U B | Uber and Bolt fall back to SMS when push is undelivered (e.g., app not open). Critical in Ghana where background apps are often killed by Android OEMs. | ✅ SMS fallback for booking confirmation at minimum | HIGH |
| 11.3 | In-app notification centre | U B | Uber has a dedicated notification bell in the top bar showing all recent alerts. Bolt similar. inDrive/Yango have simpler in-app modals. | ✅ Notification history tab | MEDIUM |
| 11.4 | Promotional notifications | U B I Y (all) | All apps send promo offers push notifications. Uber/Bolt allow rider to opt out per category. | ✅ Allow per-category opt-out (promos, trip updates, account) | HIGH |
| 11.5 | Trip reminder (pre-departure) | None natively | No competitor sends pre-departure reminders for advance-booked rides, but Uber sends an early-morning alert for reserved rides. | ✅ UNIQUE — "Your 7:30am Route 4 trip departs in 30 min" | HIGH |
| 11.6 | Driver approaching your stop | None natively | No competitor does stop-level notifications (point-to-point model). | ✅ UNIQUE — "Bus is 2 stops away from Osu Junction" | CRITICAL |
| 11.7 | Seat booking confirmation | None | No competitor books seats; confirmation messages are for ride matching. | ✅ | CRITICAL |

---

## 12. Safety

| # | Feature | Apps | How it works in competitor apps | EyeGo fit | Priority |
|---|---------|------|--------------------------------|-----------|---------|
| 12.1 | SOS emergency button | U B I Y (all) | All four have this. Yango: always-visible red button on trip screen, one tap calls emergency services in-app. Bolt: "Emergency Assist" button in trip screen + Bolt Safety Team welfare call. Uber: emergency button connects to Ghana Police/Ambulance (191/0302776111). inDrive: SOS button in-trip. | ✅ Always-visible during active trip; connects to Ghana 191 + notifies emergency contacts | CRITICAL |
| 12.2 | Share trip (live link for contacts) | U B I Y (all) | Bolt generates a shareable URL showing car make/model/plate/live location. Uber similar. Link works for anyone, no app required. Yango supports sharing. inDrive has "Share my trip" button. | ✅ WhatsApp-shareable live link | CRITICAL |
| 12.3 | Emergency contacts (trusted contacts) | U B Y | Uber and Bolt allow saving 2–5 emergency contacts who are notified automatically on SOS activation. Yango has a "Share trip" feature connected to contacts. | ✅ | HIGH |
| 12.4 | Driver background check badge | U B Y | Uber and Bolt display "Background checked" or "Verified driver" on the driver card. Yango shows a verification badge. inDrive shows trip count as proxy for trust. | ✅ Show driver verification status | HIGH |
| 12.5 | PIN code / pickup verification | B Y | Bolt has "Pickup Codes" — rider is given a 4-digit code to confirm they're in the right car. Yango has a similar matching PIN system where both rider and driver see the same code. Uber does not have this in Ghana. | ✅ CRITICAL for shared-route context where multiple passengers board the same vehicle | CRITICAL |
| 12.6 | Speed monitoring / alert | Y B | Yango uses GPS + map speed limit data and accelerometer to detect speeding; shows a warning on the rider's screen. Bolt monitors on the driver side. | ✅ Passive monitoring; alert rider if driver exceeds limit | MEDIUM |
| 12.7 | Audio trip recording | B | Bolt-exclusive: rider triggers encrypted audio recording; stored 24h on device; accessible only by Bolt safety team. | 🔄 Strong trust signal for shared vehicle; consider for EyeGo | MEDIUM |
| 12.8 | Rider identity verification | B | Bolt launched selfie-based rider verification in South Africa (2023/24). Uber/inDrive/Yango do not verify rider identity in Ghana. | 🔄 Consider for EyeGo to reduce no-shows and bad actors on fixed routes | MEDIUM |
| 12.9 | Driving behaviour monitoring | Y | Yango uses accelerometer + gyroscope data from the driver's phone to detect harsh braking, sharp cornering, sudden acceleration. Alerts driver in real time. | 🔄 Server-side; does not require rider-facing UI | MEDIUM |
| 12.10 | Masked phone numbers | U B Y | Uber, Bolt, and Yango route calls through a relay so neither party sees the other's number. inDrive uses direct calling in some African markets. | ✅ | HIGH |
| 12.11 | Safety centre / tips | Y | Yango introduced a Safety Center in Ghana (Nov 2025) with safety tips displayed before and during the journey, plus a personalised safety checklist. | ✅ Onboarding-style safety tips; pre-trip safety checklist | MEDIUM |

---

## 13. Support

| # | Feature | Apps | How it works in competitor apps | EyeGo fit | Priority |
|---|---------|------|--------------------------------|-----------|---------|
| 13.1 | In-app support ticket / chat | U B I Y (all) | All four apps have an in-app help flow. Uber: Help → categorised topics → AI resolution or human ticket. Bolt: similar categorised flow with live chat during active trips. inDrive: 24/7 support chat. Yango: support accessible via in-app button. | ✅ Categorise by: booking issue, payment, safety, driver feedback, lost item | CRITICAL |
| 13.2 | FAQ / self-serve help | U B I Y (all) | All apps have a searchable help centre. Uber's is most comprehensive. Bolt's is good. inDrive/Yango are more limited. | ✅ FAQ for: how fixed routes work, seat booking, payment, safety | HIGH |
| 13.3 | Live chat during active trip | U B | Uber and Bolt escalate to live human agent during an active trip if safety concern is flagged. inDrive/Yango have bot-only during trip in most markets. | ✅ Human escalation path during active trip | HIGH |
| 13.4 | Phone support | U B | Uber Ghana has a driver/rider phone line. Bolt has a Safety Team phone line. inDrive/Yango primarily app-based. | 🔄 Phone line for safety emergencies; not needed for routine support | MEDIUM |
| 13.5 | Report driver | U B I Y (all) | All apps have "Report driver" in trip history and post-trip screen. Bolt/Uber flag reports for human review. | ✅ | HIGH |
| 13.6 | Lost item report | U B | Uber: "I lost an item" in trip history connects to a masked call to the driver. Bolt similar. inDrive/Yango have generic support only. | ✅ Masked call to driver + support ticket if unanswered | HIGH |
| 13.7 | Response time SLA | U B | Uber targets <24h for non-safety tickets. Bolt Safety Team responds in minutes for active safety issues. | ✅ Safety issues: <15 min. General: <24h | HIGH |

---

## 14. Promotions

| # | Feature | Apps | How it works in competitor apps | EyeGo fit | Priority |
|---|---------|------|--------------------------------|-----------|---------|
| 14.1 | Promo / discount codes | U B I Y (all) | All four apps support promo codes. Bolt Ghana has an active promos page (bolt.eu/en-gh/promo). Uber has a promo field. inDrive allows riders to propose below-market fares directly. Yango uses dynamic pricing discounts. | ✅ Promo code field at booking; Ghana-specific codes | HIGH |
| 14.2 | First-ride discount | U B I Y (all) | All four offer first-ride discounts (typically 50% off or a fixed GHS amount) for new users, often tied to referral code entry at signup. | ✅ Free or heavily discounted first seat booking | CRITICAL |
| 14.3 | Referral programme | U B I Y (all) | All four apps have refer-a-friend programmes. Bolt Ghana: share your code → friend gets a discount, you get Bolt Balance credits. Uber: credits for both referrer and referee. inDrive: referral credits. Yango: referral scheme. Bolt's referral page is live and promoted in Ghana. | ✅ Both sides get a free or discounted ride; WhatsApp share default | HIGH |
| 14.4 | Loyalty / points programme | None in Ghana | **Market gap.** No competitor has a loyalty points scheme in Ghana or West Africa. Uber discontinued Uber Rewards globally (replaced by Uber One subscription in the US). Bolt explicitly has NO loyalty programme. inDrive/Yango have none. | ✅ DIFFERENTIATOR — earn points per seat, redeem for free rides | HIGH |
| 14.5 | Subscription / pass | U (US only) | Uber One membership ($9.99/mo US) offers ride discounts + Eats perks. Uber Price Lock Pass ($2.99/mo US). Not available in Ghana yet. Bolt/inDrive/Yango have no subscriptions. | 🔄 "EyeGo Commuter Pass" — weekly/monthly route pass at a discount | MEDIUM |
| 14.6 | Quest / challenge system | U (historically) | Uber previously ran "Quests" for drivers (e.g., "Complete 10 rides this weekend, earn GHS 50 bonus"). Not commonly rider-facing in Africa. Bolt has driver quests. No rider-facing challenges in Ghana. | 🔄 "Take 5 rides this week, earn a free seat" — gamification for habit formation | MEDIUM |
| 14.7 | Seasonal / event promotions | U B | Uber and Bolt run time-limited promos for events (Christmas, Independence Day, etc.). Push notifications + banners in-app. | ✅ Ghana national events, local festivals | MEDIUM |
| 14.8 | Invite via WhatsApp (deep link) | B | Bolt's referral flow directly opens WhatsApp with a pre-filled message and referral link. Most effective channel in Ghana. | ✅ WhatsApp is the primary sharing channel in Ghana | HIGH |
| 14.9 | Corporate / bulk booking discount | U B | Uber for Business and Bolt for Business both offer negotiated rates for high-volume corporate customers. Not widely advertised in Ghana. | 🔄 Target corporate commuter routes (industrial areas, office parks) | MEDIUM |

---

## EyeGo-Specific Features (No Competitor Equivalent)

These are features that EyeGo needs which don't exist in any competitor because EyeGo's model is fundamentally different.

| # | Feature | Notes | Priority |
|---|---------|-------|---------|
| E.1 | Route catalogue / browse routes | Show all available fixed routes with map + stops + schedule. Like a metro app, not a taxi app. | CRITICAL |
| E.2 | Seat map (bus-layout seat picker) | Visual seat selection — show occupied vs. available seats for each trip. | CRITICAL |
| E.3 | Trip timetable view | Show all departure times for a route, with seats remaining per departure. | CRITICAL |
| E.4 | Advance seat reservation (days ahead) | Book a seat for tomorrow, next week, or recurring daily commute. | HIGH |
| E.5 | Recurring / subscription booking | "Book this seat every weekday at 7:30am for a month" — commuter pass. | HIGH |
| E.6 | Stop-level boarding / alighting | Rider selects which stop they board and which they alight at. Fare is distance-based between stops. | CRITICAL |
| E.7 | Driver trip creation flow | Driver creates a trip on a registered route, sets departure time, vehicle capacity. | CRITICAL |
| E.8 | Route stop arrival notifications | Push to rider: "Bus approaching your stop (2 min)". Push to driver: "Passenger at next stop." | CRITICAL |
| E.9 | Co-rider count visibility | Show "3 other riders on this trip" — builds social proof and trust; helps rider know the vehicle won't be empty. | HIGH |
| E.10 | No-show policy & penalty | Define and communicate consequences for booking a seat and not boarding. | HIGH |
| E.11 | Route-level reviews | Riders rate the route experience, not just the driver — punctuality, comfort, stop accuracy. | MEDIUM |
| E.12 | Dynamic capacity management | Prevent overbooking; handle real-time seat release when riders cancel. | CRITICAL |

---

## Summary: Key Competitive Gaps in the Ghana Market

| Gap | Opportunity for EyeGo |
|----|----------------------|
| No loyalty programme by any competitor | Launch with points-per-ride from day one |
| No fixed-route shared service | EyeGo's entire model is differentiated |
| No seat selection | Gives riders control and confidence |
| No stop-level arrival notifications | Better than trotro, better than Uber Pool |
| No departure timetables | Predictability = commuter habit formation |
| Yango has local language (Twi/Ga) but competitors don't | EyeGo should support Twi from launch |
| inDrive has lowest commission (5–8%) | EyeGo can compete on driver take-home to attract supply |
| No competitor has a commuter pass/subscription | EyeGo monthly route pass fills this gap |
| PIN-code boarding (only Bolt + Yango) | Adopt for shared-vehicle boarding verification |

---

*Sources: Bolt Ghana (bolt.eu/en-gh), Uber Ghana (uber.com/gh/en), inDrive Africa coverage, Yango Ghana (yango.com/en_gh), viewGhana ride-hailing guide (viewghana.com), Tour with MiCi Africa comparison (tourwithmici.com), Transport Analysis Africa Top 7 (transportanalysis.org), Accra Street Journal Accra comparison, Ghana Driver comparison (ghanadriver.com), Citi Newsroom Yango Ghana safety update (citinewsroom.com, Nov 2025).*
