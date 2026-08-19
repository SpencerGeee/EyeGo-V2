export { apiClient, configureApiClient, setApiBaseUrl, setAuthReadyGate } from './client';
export { authApi } from './auth.api';
export { userApi } from './user.api';
export type { EmergencyContact, SafetySettings, PrivacySettings, NotificationPrefs, SavedPlace, RiderPromotion, RiderPromotions } from './user.api';
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
// NOT exported: `routesApi` in ./routes.api.
//
// It calls `GET /v1/routes`, and `routes.routes.js` is deliberately not mounted
// (see the note at the top of eyego-api/src/app.js) — the group/on-demand pivot
// retired fixed, admin-curated routes in favour of ad-hoc `Route` rows created
// behind a map pin. Every call in that module 404s. It stays on disk because the
// fixed-route product may come back; exporting it only offers callers a trap.
export { configApi, PLATFORM_CONFIG_FALLBACK } from './config.api';
export type { PlatformConfig, PlatformTier } from './config.api';
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
