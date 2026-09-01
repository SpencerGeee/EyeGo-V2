export { apiClient, configureApiClient, setApiBaseUrl, setAuthReadyGate } from './client';
export { authApi } from './auth.api';
export { userApi } from './user.api';
// "Improve maps" — corrections riders and drivers file about the real world.
export { mapReportsApi } from './mapReports.api';
export type { MapReport, MapReportDraft, MapReportType, MapReportStatus } from './mapReports.api';
export type { EmergencyContact, SafetySettings, PrivacySettings, NotificationPrefs, SavedPlace, SavedPlaceSlot, RiderPromotion, RiderPromotions } from './user.api';
export { tripsApi } from './trips.api';
// On-demand rides + the one realtime channel. See tripChannel.ts for why the
// ~20 ad-hoc socket listeners were collapsed into a single sequenced event.
export { ridesApi } from './rides.api';
export type {
  FareQuote,
  ActiveRideResponse,
  DriverStateResponse,
  DriverResyncResponse,
  PendingOffer,
  PendingDispatch,
} from './rides.api';
export {
  subscribeToTrip,
  reduceTripEvent,
  shouldApply,
  hasGap,
  serverNow,
  secondsRemaining,
} from './tripChannel';
export type {
  TripEvent,
  TripEventType,
  TripSnapshot,
  TripStatus,
  TripChannelState,
  // The route line and which leg it describes. Exported because both apps'
  // stores hold it: the geometry is the server's, and no client recomputes it.
  TripPath,
  TripLeg,
  TripEtaPush,
} from './tripChannel';
export { bookingsApi } from './bookings.api';
export { paymentsApi } from './payments.api';
export { getSocket, connectSocket, disconnectSocket, forceDisconnectSocket, socketEvents, configureSocket, refreshSocketAuth, refreshDriverSocketAuth } from './socket';
export { notificationsApi } from './notifications.api';
export type { Notification as AppNotification } from './notifications.api';
// DELETED: `routesApi` (./routes.api) and `eyego-api/src/modules/routes/`.
//
// It called `GET /v1/routes`, which was never mounted — the group/on-demand
// pivot retired fixed, admin-curated routes in favour of ad-hoc `Route` rows
// created behind a map pin, so every call in it 404'd. It was kept on disk in
// case the fixed-route product returned, unexported so nobody could reach the
// trap.
//
// Now removed. Unmounted, unexported, unreachable code is not a spare part: it
// is an untested surface that a future reader has to be warned about, and the
// warning was longer than the module. `git log` has it if it is ever wanted.
export { configApi, PLATFORM_CONFIG_FALLBACK, CLIENT_GATE_FALLBACK } from './config.api';
export type { PlatformConfig, PlatformTier, ClientGate } from './config.api';
export { driverApi, MOMO_NETWORKS, VEHICLE_TIERS, MIN_SEATER_COUNT, MAX_SEATER_COUNT } from './drivers.api';
export type { DriverProfile, DriverTrip, CreateTripPayload, DriverPerformance, DriverRatings, DriverDocument, PendingTripRequest, UpcomingScheduledTrip, MomoNetwork, DriverVerificationInput, VehicleTier } from './drivers.api';
export { walletApi } from './wallet.api';
export type { WalletBalance, WalletTransaction, TopUpRequest } from './wallet.api';
export { supportTicketsApi } from './support.api';
export type { SupportTicket } from './support.api';
export { cancellationApi } from './cancellation.api';
export { heatmapApi } from './heatmap.api';
export { questsApi } from './quests.api';
export type { DriverQuest, QuestHistoryItem } from './quests.api';
export { contactApi } from './contact.api';
export type { CallInitResponse } from './contact.api';
export { driverAuthApi } from './auth.api';
export {
  getDriverSocket,
  connectDriverSocket,
  disconnectDriverSocket,
  driverSocketEvents,
} from './socket';
export { queryKeys } from './queryKeys';

/**
 * Runtime checks for the payloads that decide what someone pays. See
 * packages/api/src/money-guards.ts — a cast is a promise the compiler cannot
 * keep, and for money a broken one is a plausible wrong number rather than a
 * blank field.
 */
export { MoneyShapeError, pesewas, optionalPesewas, multiplier, distanceKm, assertFareQuote } from './money-guards';
