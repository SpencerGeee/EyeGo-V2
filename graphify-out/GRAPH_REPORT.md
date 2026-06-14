# Graph Report - C:/Users/user/Downloads/Projects/EyeGo V2/eyego  (2026-06-01)

## Corpus Check
- 197 files · ~106,746 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1320 nodes · 2092 edges · 102 communities (92 shown, 10 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 48 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Rider Screen Hub|Rider Screen Hub]]
- [[_COMMUNITY_Rider Package Deps|Rider Package Deps]]
- [[_COMMUNITY_Driver Package Deps|Driver Package Deps]]
- [[_COMMUNITY_Auth & Onboarding|Auth & Onboarding]]
- [[_COMMUNITY_Rider App Config|Rider App Config]]
- [[_COMMUNITY_i18n Language System|i18n Language System]]
- [[_COMMUNITY_Driver App Config|Driver App Config]]
- [[_COMMUNITY_Referral & Invite|Referral & Invite]]
- [[_COMMUNITY_Auth Layout & Profile|Auth Layout & Profile]]
- [[_COMMUNITY_English Translations|English Translations]]
- [[_COMMUNITY_Spanish Translations|Spanish Translations]]
- [[_COMMUNITY_French Translations|French Translations]]
- [[_COMMUNITY_Rider EAS Build|Rider EAS Build]]
- [[_COMMUNITY_Driver EAS Build|Driver EAS Build]]
- [[_COMMUNITY_Rider Native Packages|Rider Native Packages]]
- [[_COMMUNITY_Trip Detail View|Trip Detail View]]
- [[_COMMUNITY_Registration Flow|Registration Flow]]
- [[_COMMUNITY_Active Trip & Profile|Active Trip & Profile]]
- [[_COMMUNITY_Seat Selection|Seat Selection]]
- [[_COMMUNITY_CICD Build Pipeline|CI/CD Build Pipeline]]
- [[_COMMUNITY_Trip Complete & Ratings|Trip Complete & Ratings]]
- [[_COMMUNITY_Animated Fare UI|Animated Fare UI]]
- [[_COMMUNITY_EAS Dev Profile|EAS Dev Profile]]
- [[_COMMUNITY_Shared UI Components|Shared UI Components]]
- [[_COMMUNITY_TypeScript Base Config|TypeScript Base Config]]
- [[_COMMUNITY_Payment Card Entry|Payment Card Entry]]
- [[_COMMUNITY_UI Primitives|UI Primitives]]
- [[_COMMUNITY_Error Boundary (Driver)|Error Boundary (Driver)]]
- [[_COMMUNITY_Driver Trip List|Driver Trip List]]
- [[_COMMUNITY_Real-time Trip Status|Real-time Trip Status]]
- [[_COMMUNITY_Rider TS Config|Rider TS Config]]
- [[_COMMUNITY_Driver TS Config|Driver TS Config]]
- [[_COMMUNITY_Driver Earnings Chart|Driver Earnings Chart]]
- [[_COMMUNITY_Empty State Lottie|Empty State Lottie]]
- [[_COMMUNITY_Payment Success Lottie|Payment Success Lottie]]
- [[_COMMUNITY_Trip Complete Screen|Trip Complete Screen]]
- [[_COMMUNITY_Boarding Check Lottie|Boarding Check Lottie]]
- [[_COMMUNITY_Push Notifications|Push Notifications]]
- [[_COMMUNITY_Trip Creation Steps|Trip Creation Steps]]
- [[_COMMUNITY_Payment & SOS|Payment & SOS]]
- [[_COMMUNITY_Driver Info UI|Driver Info UI]]
- [[_COMMUNITY_Seat Status Badges|Seat Status Badges]]
- [[_COMMUNITY_API Package Config|API Package Config]]
- [[_COMMUNITY_Rider Trip Cards|Rider Trip Cards]]
- [[_COMMUNITY_Ride Selection|Ride Selection]]
- [[_COMMUNITY_Build Tooling|Build Tooling]]
- [[_COMMUNITY_Network Client Config|Network Client Config]]
- [[_COMMUNITY_In-App Chat|In-App Chat]]
- [[_COMMUNITY_Offline Queue|Offline Queue]]
- [[_COMMUNITY_Theme & Settings|Theme & Settings]]
- [[_COMMUNITY_UI Package Config|UI Package Config]]
- [[_COMMUNITY_Onboarding Slides|Onboarding Slides]]
- [[_COMMUNITY_Driver Tab Navigation|Driver Tab Navigation]]
- [[_COMMUNITY_Live Tracking|Live Tracking]]
- [[_COMMUNITY_Rider Tab Navigation|Rider Tab Navigation]]
- [[_COMMUNITY_Terms & Emergency Contacts|Terms & Emergency Contacts]]
- [[_COMMUNITY_Error Boundary (Rider)|Error Boundary (Rider)]]
- [[_COMMUNITY_Notification Preferences|Notification Preferences]]
- [[_COMMUNITY_Driver Settings|Driver Settings]]
- [[_COMMUNITY_Rate & Tip|Rate & Tip]]
- [[_COMMUNITY_Tier Selector|Tier Selector]]
- [[_COMMUNITY_Driver Documents|Driver Documents]]
- [[_COMMUNITY_Driver Performance|Driver Performance]]
- [[_COMMUNITY_Privacy Settings|Privacy Settings]]
- [[_COMMUNITY_OTP Verification|OTP Verification]]
- [[_COMMUNITY_Booking Status Badges|Booking Status Badges]]
- [[_COMMUNITY_Types Package Config|Types Package Config]]
- [[_COMMUNITY_Rider Metro Config|Rider Metro Config]]
- [[_COMMUNITY_Trip Receipt View|Trip Receipt View]]
- [[_COMMUNITY_Driver Metro Config|Driver Metro Config]]
- [[_COMMUNITY_Config Package|Config Package]]
- [[_COMMUNITY_Rider Package Main|Rider Package Main]]
- [[_COMMUNITY_Seat Map (Driver)|Seat Map (Driver)]]
- [[_COMMUNITY_Driver OTP|Driver OTP]]
- [[_COMMUNITY_Schedule Date Picker|Schedule Date Picker]]
- [[_COMMUNITY_Driver Dev Tooling|Driver Dev Tooling]]
- [[_COMMUNITY_Package Scripts|Package Scripts]]
- [[_COMMUNITY_Safety Screen|Safety Screen]]
- [[_COMMUNITY_Dispute Screen|Dispute Screen]]
- [[_COMMUNITY_Telemetry & Events|Telemetry & Events]]
- [[_COMMUNITY_Rider Claude Permissions|Rider Claude Permissions]]
- [[_COMMUNITY_Driver Claude Permissions|Driver Claude Permissions]]
- [[_COMMUNITY_App TS Config|App TS Config]]
- [[_COMMUNITY_App Dynamic Config|App Dynamic Config]]

## God Nodes (most connected - your core abstractions)
1. `Text()` - 90 edges
2. `fonts` - 67 edges
3. `fontSizes` - 60 edges
4. `Button()` - 48 edges
5. `useDriverStore` - 42 edges
6. `DriverColors` - 39 edges
7. `Colors` - 39 edges
8. `useAuthStore` - 35 edges
9. `useRideStore` - 31 edges
10. `apiClient` - 25 edges

## Surprising Connections (you probably didn't know these)
- `TripCard()` --calls--> `formatTripDate()`  [INFERRED]
  apps/rider/app/(tabs)/trips.tsx → packages/utils/src/index.ts
- `Rider Build Job` --references--> `EyeGo Rider App`  [EXTRACTED]
  .github/workflows/build.yml → apps/rider/assets/icon.png
- `Driver Build Job` --references--> `EyeGo Driver App`  [EXTRACTED]
  .github/workflows/build.yml → apps/driver/assets/icon.png
- `DriverOtpScreen()` --calls--> `useDriverStore`  [INFERRED]
  apps/driver/app/(auth)/otp.tsx → apps/driver/stores/driver.store.ts
- `AccountDeletionScreen()` --calls--> `useDriverStore`  [INFERRED]
  apps/driver/app/(profile)/account-deletion.tsx → apps/driver/stores/driver.store.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **EyeGo EAS Build Pipeline** — build_yml_ci_workflow, build_yml_rider_job, build_yml_driver_job, build_yml_eas_build, build_yml_expo_token [EXTRACTED 1.00]
- **Rider App Visual Assets** — rider_adaptive_icon, rider_icon, rider_splash_icon, rider_favicon, eyego_rider_app [INFERRED 0.95]
- **Driver App Visual Assets** — driver_adaptive_icon, driver_icon, driver_splash_icon, eyego_driver_app [INFERRED 0.95]
- **Rider Mapbox Integration Secrets** — build_yml_rider_job, build_yml_mapbox_token, build_yml_mapbox_downloads_token [EXTRACTED 1.00]
- **Shared Google Maps API Key** — build_yml_rider_job, build_yml_driver_job, build_yml_google_maps_key [EXTRACTED 1.00]

## Communities (102 total, 10 thin omitted)

### Community 0 - "Rider Screen Hub"
Cohesion: 0.05
Nodes (38): HomeScreen(), REASONS, { width: SCREEN_WIDTH }, CONTACT_OPTIONS, FAQ_ITEMS, authApi, driverAuthApi, SocialLoginRequest (+30 more)

### Community 1 - "Rider Package Deps"
Cohesion: 0.04
Nodes (49): dependencies, axios, babel-preset-expo, expo, expo-blur, expo-clipboard, expo-constants, expo-dev-client (+41 more)

### Community 2 - "Driver Package Deps"
Cohesion: 0.04
Nodes (45): dependencies, axios, babel-preset-expo, expo, expo-blur, expo-constants, expo-dev-client, expo-font (+37 more)

### Community 3 - "Auth & Onboarding"
Cohesion: 0.08
Nodes (12): SafetyScreen(), REQUIRED_DOCS, SAFETY_TIPS, DEFAULT_PLACES, Place, REPORT_TYPES, Button(), fonts (+4 more)

### Community 4 - "Rider App Config"
Cohesion: 0.05
Nodes (37): backgroundColor, foregroundImage, adaptiveIcon, edgeToEdgeEnabled, package, permissions, projectId, typedRoutes (+29 more)

### Community 5 - "i18n Language System"
Cohesion: 0.05
Nodes (36): languageDetector, common, back, cancel, confirm, error, loading, retry (+28 more)

### Community 6 - "Driver App Config"
Cohesion: 0.05
Nodes (37): backgroundColor, foregroundImage, adaptiveIcon, edgeToEdgeEnabled, package, permissions, projectId, typedRoutes (+29 more)

### Community 7 - "Referral & Invite"
Cohesion: 0.06
Nodes (28): formatCurrency(), InviteScreen(), ApiError, ApiResponse, DriverLocationEvent, PaginatedResponse, TripEtaEvent, TripStatusEvent (+20 more)

### Community 8 - "Auth Layout & Profile"
Cohesion: 0.07
Nodes (12): AccountDeletionScreen(), OnlineToggle(), Props, styles, DELETION_CONSEQUENCES, FAQS, Ticket, BANKS (+4 more)

### Community 9 - "English Translations"
Cohesion: 0.06
Nodes (35): common, back, cancel, confirm, error, loading, retry, save (+27 more)

### Community 10 - "Spanish Translations"
Cohesion: 0.06
Nodes (35): common, back, cancel, confirm, error, loading, retry, save (+27 more)

### Community 11 - "French Translations"
Cohesion: 0.06
Nodes (35): common, back, cancel, confirm, error, loading, retry, save (+27 more)

### Community 12 - "Rider EAS Build"
Cohesion: 0.08
Nodes (34): buildType, gradleCommand, resourceClass, serviceAccountKeyPath, track, build, development, preview (+26 more)

### Community 13 - "Driver EAS Build"
Cohesion: 0.08
Nodes (34): buildType, gradleCommand, resourceClass, serviceAccountKeyPath, track, build, development, preview (+26 more)

### Community 14 - "Rider Native Packages"
Cohesion: 0.06
Nodes (32): dependencies, expo-contacts, expo-localization, expo-notifications, i18next, react, react-i18next, react-native (+24 more)

### Community 15 - "Trip Detail View"
Cohesion: 0.10
Nodes (16): STATUS_FLOW, TRIP_STATUS_CONFIG, Message, TripChatScreen(), Coords, Options, Options, connectDriverSocket() (+8 more)

### Community 16 - "Registration Flow"
Cohesion: 0.12
Nodes (16): Index(), AccountDeletionScreen(), EditProfileScreen(), ProfileScreen(), RegisterScreen(), SocialAuthScreen(), CONSEQUENCES, getInitials() (+8 more)

### Community 17 - "Active Trip & Profile"
Cohesion: 0.11
Nodes (14): ActiveTripScreen(), EditProfileScreen(), HomeScreen(), ProfileScreen(), useColors(), DriverRegisterScreen(), CANCEL_REASONS, CancelTripScreen() (+6 more)

### Community 18 - "Seat Selection"
Cohesion: 0.13
Nodes (10): SeatPickerScreen(), PromotionsScreen(), GuestSelectionScreen(), ReserveScreen(), Booking, Seat, Trip, Location (+2 more)

### Community 19 - "CI/CD Build Pipeline"
Cohesion: 0.14
Nodes (22): EyeGo Build CI Workflow, DRIVER_API_URL Secret, Driver Build Job, EAS Build (Expo Application Services), EXPO_TOKEN Secret, GOOGLE_MAPS_API_KEY Secret, MAPBOX_DOWNLOADS_TOKEN Secret, MAPBOX_PUBLIC_TOKEN Secret (+14 more)

### Community 20 - "Trip Complete & Ratings"
Cohesion: 0.11
Nodes (4): COMPLIMENT_ICONS, RatingsScreen(), driverApi, Mode

### Community 21 - "Animated Fare UI"
Cohesion: 0.15
Nodes (14): AnimatedFareText(), AnimatedFareTextProps, RideCardProps, RideCardTrip, styles, EyeGoTextProps, TextVariant, variantStyles (+6 more)

### Community 22 - "EAS Dev Profile"
Cohesion: 0.11
Nodes (17): build, development, development-device, preview, production, cli, version, developmentClient (+9 more)

### Community 23 - "Shared UI Components"
Cohesion: 0.15
Nodes (12): ButtonProps, ButtonSize, ButtonVariant, sizeStyles, styles, variantStyles, EmptyState(), EmptyStateProps (+4 more)

### Community 24 - "TypeScript Base Config"
Cohesion: 0.13
Nodes (14): compilerOptions, allowImportingTsExtensions, esModuleInterop, jsx, moduleResolution, noEmit, paths, skipLibCheck (+6 more)

### Community 25 - "Payment Card Entry"
Cohesion: 0.14
Nodes (4): AnimatedText, Input(), InputProps, styles

### Community 26 - "UI Primitives"
Cohesion: 0.19
Nodes (10): Card(), CardProps, styles, OTPInput, OTPInputProps, OTPInputRef, styles, styles (+2 more)

### Community 27 - "Error Boundary (Driver)"
Cohesion: 0.15
Nodes (7): AppErrorBoundary, ErrorBoundaryState, errStyles, queryClient, RootLayout(), configureSocket(), driverLightColors

### Community 28 - "Driver Trip List"
Cohesion: 0.18
Nodes (8): Segment, SEGMENTS, Props, STATUS_COLORS, STATUS_LABELS, styles, TripCard(), DriverTrip

### Community 29 - "Real-time Trip Status"
Cohesion: 0.19
Nodes (9): safeRead(), styles, TripStatusListener(), BASE_URL, connectSocket(), disconnectSocket(), driverCallbacks, getSocket() (+1 more)

### Community 30 - "Rider TS Config"
Cohesion: 0.17
Nodes (11): compilerOptions, paths, strict, extends, include, @/*, @eyego/api, @eyego/config (+3 more)

### Community 31 - "Driver TS Config"
Cohesion: 0.17
Nodes (11): compilerOptions, paths, strict, extends, include, @/*, @eyego/api, @eyego/config (+3 more)

### Community 32 - "Driver Earnings Chart"
Cohesion: 0.22
Nodes (6): ChartDataPoint, EarningsChart(), Props, styles, Period, PERIODS

### Community 33 - "Empty State Lottie"
Cohesion: 0.18
Nodes (10): assets, ddd, fr, h, ip, layers, nm, op (+2 more)

### Community 34 - "Payment Success Lottie"
Cohesion: 0.18
Nodes (10): assets, ddd, fr, h, ip, layers, nm, op (+2 more)

### Community 35 - "Trip Complete Screen"
Cohesion: 0.27
Nodes (6): successLottie, TripCompleteScreen(), RideDetailScreen(), formatCurrency(), formatDistance(), formatDuration()

### Community 36 - "Boarding Check Lottie"
Cohesion: 0.18
Nodes (10): assets, ddd, fr, h, ip, layers, nm, op (+2 more)

### Community 37 - "Push Notifications"
Cohesion: 0.29
Nodes (6): NotificationsScreen(), DriverNotification, NotificationsState, NotificationType, useNotificationsStore, TYPE_CONFIG

### Community 38 - "Trip Creation Steps"
Cohesion: 0.24
Nodes (5): Props, StepIndicator(), styles, CreateTripScreen(), formatCurrency()

### Community 39 - "Payment & SOS"
Cohesion: 0.20
Nodes (5): PaymentScreen(), PaymentTab, rowStyles, SOSScreen(), socketEvents

### Community 40 - "Driver Info UI"
Cohesion: 0.22
Nodes (8): Avatar(), AvatarProps, styles, DriverInfoCard(), DriverInfoCardProps, styles, TripDriver, Vehicle

### Community 41 - "Seat Status Badges"
Cohesion: 0.22
Nodes (8): SeatBadge(), SeatBadgeProps, SeatStatus, STATUS_COLOR, styles, SeatBar(), SeatBarProps, styles

### Community 42 - "API Package Config"
Cohesion: 0.20
Nodes (9): main, name, private, scripts, android, ios, start, start:clear (+1 more)

### Community 43 - "Rider Trip Cards"
Cohesion: 0.22
Nodes (7): Segment, SEGMENTS, TripsScreen(), formatTripDate(), RideCard(), emptyLottie, TripCard()

### Community 44 - "Ride Selection"
Cohesion: 0.20
Nodes (6): MOCK_TRIPS, RideSelectScreen(), TIER_INFO, TripWithRoute, Skeleton(), SkeletonProps

### Community 45 - "Build Tooling"
Cohesion: 0.20
Nodes (9): devDependencies, @babel/core, tailwindcss, @types/react, typescript, main, name, private (+1 more)

### Community 46 - "Network Client Config"
Cohesion: 0.22
Nodes (8): dependencies, axios, socket.io-client, main, name, private, types, version

### Community 47 - "In-App Chat"
Cohesion: 0.22
Nodes (3): ChatMessage, ChatScreen(), QUICK_REPLIES

### Community 48 - "Offline Queue"
Cohesion: 0.25
Nodes (4): queryClient, RootLayout(), offlineQueue, QueuedAction

### Community 49 - "Theme & Settings"
Cohesion: 0.33
Nodes (5): SettingsScreen(), useColors(), ThemeState, useThemeStore, lightColors

### Community 50 - "UI Package Config"
Cohesion: 0.22
Nodes (8): main, name, peerDependencies, react, react-native, private, types, version

### Community 51 - "Onboarding Slides"
Cohesion: 0.25
Nodes (4): Slide, SLIDES, styles, { width: SCREEN_WIDTH, height: SCREEN_HEIGHT }

### Community 52 - "Driver Tab Navigation"
Cohesion: 0.25
Nodes (4): styles, TAB_ICONS, TAB_LABELS, TabRoute

### Community 53 - "Live Tracking"
Cohesion: 0.32
Nodes (4): pulseStyles, TrackingScreen(), useLocationInterpolation(), shareLiveTracking()

### Community 54 - "Rider Tab Navigation"
Cohesion: 0.25
Nodes (4): styles, TAB_ICONS, TAB_LABELS, TabRoute

### Community 56 - "Error Boundary (Rider)"
Cohesion: 0.25
Nodes (4): ErrorBoundary, Props, State, styles

### Community 57 - "Notification Preferences"
Cohesion: 0.25
Nodes (5): DEFAULT_PREFS, NotifPrefs, Section, SectionItem, SECTIONS

### Community 58 - "Driver Settings"
Cohesion: 0.29
Nodes (4): SettingsScreen(), LANGUAGES, NAV_OPTIONS, NavApp

### Community 59 - "Rate & Tip"
Cohesion: 0.29
Nodes (4): COMPLIMENTS, RateTipScreen(), STAR_MESSAGES, TIP_OPTIONS

### Community 60 - "Tier Selector"
Cohesion: 0.29
Nodes (6): styles, Tier, TierOption, TIERS, TierSelector(), TierSelectorProps

### Community 61 - "Driver Documents"
Cohesion: 0.40
Nodes (5): DOCUMENT_CONFIG, DocumentRow(), DocumentsScreen(), STATUS_CONFIG, styles()

### Community 63 - "Privacy Settings"
Cohesion: 0.33
Nodes (3): PrivacyScreen(), PRIVACY_KEYS, toggleStyles

### Community 64 - "OTP Verification"
Cohesion: 0.40
Nodes (3): OtpCellProps, OtpScreen(), maskPhone()

### Community 65 - "Booking Status Badges"
Cohesion: 0.33
Nodes (5): BookingStatus, STATUS_CONFIG, StatusBadge(), StatusBadgeProps, styles

### Community 66 - "Types Package Config"
Cohesion: 0.33
Nodes (5): main, name, private, types, version

### Community 67 - "Rider Metro Config"
Cohesion: 0.33
Nodes (5): config, { getDefaultConfig }, path, { withNativeWind }, workspaceRoot

### Community 69 - "Driver Metro Config"
Cohesion: 0.33
Nodes (5): config, { getDefaultConfig }, path, { withNativeWind }, workspaceRoot

### Community 70 - "Config Package"
Cohesion: 0.33
Nodes (5): main, name, private, types, version

### Community 71 - "Rider Package Main"
Cohesion: 0.33
Nodes (5): main, name, private, types, version

### Community 72 - "Seat Map (Driver)"
Cohesion: 0.40
Nodes (4): Props, Seat, SeatMap(), styles

### Community 74 - "Schedule Date Picker"
Cohesion: 0.60
Nodes (3): formatDate(), getMinDate(), ScheduleRideScreen()

### Community 75 - "Driver Dev Tooling"
Cohesion: 0.40
Nodes (5): devDependencies, @babel/core, tailwindcss, @types/react, typescript

### Community 76 - "Package Scripts"
Cohesion: 0.40
Nodes (5): scripts, android, ios, start, web

### Community 80 - "Telemetry & Events"
Cohesion: 0.50
Nodes (3): telemetry, TelemetryEvent, TelemetrySeverity

## Knowledge Gaps
- **666 isolated node(s):** `allow`, `name`, `slug`, `version`, `orientation` (+661 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Text()` connect `Auth Layout & Profile` to `Rider Screen Hub`, `Auth & Onboarding`, `Referral & Invite`, `Trip Detail View`, `Registration Flow`, `Active Trip & Profile`, `Seat Selection`, `Trip Complete & Ratings`, `Animated Fare UI`, `Shared UI Components`, `Payment Card Entry`, `UI Primitives`, `Driver Trip List`, `Real-time Trip Status`, `Driver Earnings Chart`, `Trip Complete Screen`, `Push Notifications`, `Trip Creation Steps`, `Payment & SOS`, `Driver Info UI`, `Rider Trip Cards`, `Ride Selection`, `In-App Chat`, `Offline Queue`, `Theme & Settings`, `Onboarding Slides`, `Driver Tab Navigation`, `Live Tracking`, `Rider Tab Navigation`, `Terms & Emergency Contacts`, `Notification Preferences`, `Driver Settings`, `Rate & Tip`, `Tier Selector`, `Driver Documents`, `Driver Performance`, `Privacy Settings`, `OTP Verification`, `Booking Status Badges`, `Trip Receipt View`, `Seat Map (Driver)`, `Driver OTP`, `Schedule Date Picker`, `Safety Screen`, `Dispute Screen`?**
  _High betweenness centrality (0.168) - this node is a cross-community bridge._
- **Why does `fonts` connect `Auth & Onboarding` to `Rider Screen Hub`, `Referral & Invite`, `Auth Layout & Profile`, `Trip Detail View`, `Registration Flow`, `Active Trip & Profile`, `Seat Selection`, `Trip Complete & Ratings`, `Payment Card Entry`, `Driver Trip List`, `Real-time Trip Status`, `Driver Earnings Chart`, `Push Notifications`, `Trip Creation Steps`, `Payment & SOS`, `Rider Trip Cards`, `Ride Selection`, `In-App Chat`, `Theme & Settings`, `Onboarding Slides`, `Driver Tab Navigation`, `Live Tracking`, `Rider Tab Navigation`, `Driver Settings`, `Rate & Tip`, `Driver Documents`, `Driver Performance`, `Privacy Settings`, `OTP Verification`, `Trip Receipt View`, `Seat Map (Driver)`, `Driver OTP`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **Why does `fontSizes` connect `Auth & Onboarding` to `Rider Screen Hub`, `Referral & Invite`, `Auth Layout & Profile`, `Trip Detail View`, `Registration Flow`, `Active Trip & Profile`, `Seat Selection`, `Trip Complete & Ratings`, `Driver Trip List`, `Real-time Trip Status`, `Driver Earnings Chart`, `Push Notifications`, `Trip Creation Steps`, `Payment & SOS`, `Ride Selection`, `In-App Chat`, `Theme & Settings`, `Onboarding Slides`, `Live Tracking`, `Rider Tab Navigation`, `Driver Settings`, `Rate & Tip`, `Driver Documents`, `Driver Performance`, `OTP Verification`, `Trip Receipt View`, `Seat Map (Driver)`, `Driver OTP`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **What connects `allow`, `name`, `slug` to the rest of the system?**
  _666 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Rider Screen Hub` be split into smaller, more focused modules?**
  _Cohesion score 0.0502283105022831 - nodes in this community are weakly interconnected._
- **Should `Rider Package Deps` be split into smaller, more focused modules?**
  _Cohesion score 0.04081632653061224 - nodes in this community are weakly interconnected._
- **Should `Driver Package Deps` be split into smaller, more focused modules?**
  _Cohesion score 0.044444444444444446 - nodes in this community are weakly interconnected._