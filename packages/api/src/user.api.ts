import { apiClient } from './client';
import type { ApiResponse, User, UpdateProfileRequest } from '@eyego/types';

export interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
}

export interface SafetySettings {
  shareTrip?: boolean;
  rideCheck?: boolean;
  speedAlerts?: boolean;
  nightSafety?: boolean;
  // Cloudinary URL of the uploaded emergency insurance card (stored in the
  // same safetySettings JSON blob server-side; written by uploadInsurance).
  insuranceCardUrl?: string;
}

export interface PrivacySettings {
  locationSharing?: boolean;
  marketingNotifs?: boolean;
  analytics?: boolean;
}

export interface NotificationPrefs {
  driverArriving?: boolean;
  tripStarted?: boolean;
  tripCompleted?: boolean;
  chatMessages?: boolean;
  paymentConfirmations?: boolean;
  promotions?: boolean;
  newFeatures?: boolean;
  safetyAlerts?: boolean;
}

export interface SavedPlace {
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
  icon?: string | null;
}

/**
 * Flatten the `/user/me` envelope.
 *
 * BUGFIX ("i finish onboarding, close the app, reopen it and it asks for my
 * full name and date of birth again"). The controller replies with
 * `ok(res, { user })`, i.e. `{ success, message, data: { user: {...} } }` —
 * but `getProfile`/`updateProfile` are typed `ApiResponse<User>` and every one
 * of their six call sites reads `res.data.data` as the user itself. So the
 * whole rider profile stack was one level short:
 *
 *   - `register.tsx` persisted `{ user: {...}, dob }` into SecureStore, an
 *     object with no top-level `name`. `index.tsx` gates on `!user?.name`, so
 *     every cold start bounced the rider back to "Complete your profile" —
 *     forever, no matter how many times they filled it in.
 *   - `useProfileSync` merged that same `{ user }` blob over the auth store,
 *     so the server copy could never repair it either.
 *   - `edit.tsx`, `business.tsx` and `scan-pay.tsx` read `.name`, `.phone` and
 *     `.businessMode` off the wrapper and got `undefined` every time.
 *
 * Unwrapping here rather than at the six call sites keeps the declared
 * `ApiResponse<User>` contract honest. The `?? data` fallback means this stays
 * correct if the server is ever flattened to match.
 */
const unwrapUser = <T extends { data?: any }>(res: T): T => {
  const body = res?.data;
  if (!body || typeof body !== 'object') return res;
  const payload = body.data;
  if (payload && typeof payload === 'object' && 'user' in payload) {
    return { ...res, data: { ...body, data: payload.user } };
  }
  return res;
};

/**
 * What the account is still missing, decided by the server so the app and the
 * console cannot disagree about it. See users.service#getAccountChecklist.
 */
export interface AccountChecklistItem {
  id: string;
  label: string;
  description: string;
  severity: 'required' | 'recommended' | 'optional';
  done: boolean;
  /** Where to send the rider to fix it, or null when there is nothing to do. */
  route: string | null;
  value: string | null;
}

export interface AccountChecklist {
  completeness: number;
  outstandingRequired: number;
  outstandingRecommended: number;
  items: AccountChecklistItem[];
  context: { paidTrips: number; memberSince: string; authProvider?: string | null };
}

export const userApi = {
  getProfile: () =>
    apiClient.get<ApiResponse<User>>('/user/me').then(unwrapUser),

  getAccountChecklist: () =>
    apiClient.get<ApiResponse<AccountChecklist>>('/user/me/account-checklist'),

  updateProfile: (data: UpdateProfileRequest) =>
    apiClient.patch<ApiResponse<User>>('/user/me', data).then(unwrapUser),

  uploadAvatar: async (uri: string): Promise<string> => {
    const formData = new FormData();
    const filename = uri.split('/').pop() ?? 'avatar.jpg';
    const match = /\.(\w+)$/.exec(filename);
    const type = match ? `image/${match[1]}` : 'image/jpeg';
    formData.append('avatar', { uri, name: filename, type } as unknown as Blob);

    const response = await apiClient.post<ApiResponse<{ avatarUrl: string }>>(
      '/user/avatar',
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
    return response.data.data.avatarUrl;
  },

  uploadInsurance: async (uri: string): Promise<string> => {
    const formData = new FormData();
    const filename = uri.split('/').pop() ?? 'insurance.jpg';
    const match = /\.(\w+)$/.exec(filename);
    const type = match ? `image/${match[1]}` : 'image/jpeg';
    formData.append('card', { uri, name: filename, type } as unknown as Blob);

    const response = await apiClient.post<ApiResponse<{ insuranceCardUrl: string }>>(
      '/user/me/insurance',
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
    return response.data.data.insuranceCardUrl;
  },

  updateFcmToken: (data: { fcmToken: string }) =>
    apiClient.post<ApiResponse<void>>('/user/fcm-token', data),

  deleteAccount: () =>
    apiClient.delete<ApiResponse<null>>('/user/me'),

  getEmergencyContacts: () =>
    apiClient.get<ApiResponse<{ contacts: EmergencyContact[] }>>('/user/me/emergency-contacts'),

  syncEmergencyContacts: (contacts: { name: string; phone: string }[]) =>
    apiClient.put<ApiResponse<{ contacts: EmergencyContact[] }>>('/user/me/emergency-contacts', { contacts }),

  getNotificationPrefs: () =>
    apiClient.get<ApiResponse<{ prefs: NotificationPrefs }>>('/user/me/notifications'),

  updateNotificationPrefs: (prefs: NotificationPrefs) =>
    apiClient.patch<ApiResponse<{ prefs: NotificationPrefs }>>('/user/me/notifications', prefs),

  // Previously the rider's dark/light toggle only lived in AsyncStorage —
  // a reinstall or new device silently reset it. Same JSON-blob pattern the
  // driver app already uses for its preferences.
  getPreferences: () =>
    apiClient.get<ApiResponse<{ preferences: { theme?: 'dark' | 'light' } }>>('/user/me/preferences'),

  updatePreferences: (patch: { theme?: 'dark' | 'light' }) =>
    apiClient.patch<ApiResponse<{ preferences: { theme?: 'dark' | 'light' } }>>('/user/me/preferences', patch),

  getSafetySettings: () =>
    apiClient.get<ApiResponse<{ settings: SafetySettings }>>('/user/me/safety-settings'),

  updateSafetySettings: (settings: SafetySettings) =>
    apiClient.put<ApiResponse<{ settings: SafetySettings }>>('/user/me/safety-settings', settings),

  getPrivacySettings: () =>
    apiClient.get<ApiResponse<{ settings: PrivacySettings }>>('/user/me/privacy-settings'),

  updatePrivacySettings: (settings: PrivacySettings) =>
    apiClient.put<ApiResponse<{ settings: PrivacySettings }>>('/user/me/privacy-settings', settings),

  getSavedPlaces: () =>
    apiClient.get<ApiResponse<{ places: SavedPlace[] }>>('/user/me/saved-places'),

  createSavedPlace: (place: Omit<SavedPlace, 'id'>) =>
    apiClient.post<ApiResponse<{ place: SavedPlace }>>('/user/me/saved-places', place),

  deleteSavedPlace: (placeId: string) =>
    apiClient.delete<ApiResponse<Record<string, never>>>(`/user/me/saved-places/${placeId}`),
};
