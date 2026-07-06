export { apiClient, configureApiClient, setApiBaseUrl } from './client';
export { authApi } from './auth.api';
export { userApi } from './user.api';
export type { EmergencyContact, SafetySettings, PrivacySettings, NotificationPrefs, SavedPlace } from './user.api';
export { tripsApi } from './trips.api';
export { bookingsApi } from './bookings.api';
export { paymentsApi } from './payments.api';
export { configApi } from './config.api';
export { getSocket, connectSocket, disconnectSocket, forceDisconnectSocket, socketEvents, configureSocket, refreshSocketAuth } from './socket';
export { notificationsApi } from './notifications.api';
export type { Notification as AppNotification } from './notifications.api';
export { routesApi } from './routes.api';
export type { Route } from './routes.api';
export { driverApi } from './drivers.api';
export type { DriverProfile, DriverTrip, CreateTripPayload, DriverPerformance, DriverRatings, DriverDocument } from './drivers.api';
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
