import { apiClient } from './client';
import type { ApiResponse } from '@eyego/types';

/**
 * The half of "change it without an app-store release" that lives on the phone.
 *
 * The operator retunes fares, the seat-hold window, the wallet minimums, the
 * support number and an announcement banner from the admin console; those writes
 * land in `PlatformSetting`, and `GET /v1/config/public` is the explicit
 * allow-list of what a device is allowed to read back. Adding an internal knob
 * to the settings registry can never leak it here.
 *
 * This module exists because for a long time NOTHING called that endpoint. The
 * console accepted every change, the server honoured every change, and both apps
 * kept showing the constants they had been compiled with — a support number in
 * one screen's source, a `MIN_WITHDRAWAL_PESEWAS = 2000` in another's, and no way
 * at all to stop bookings during an incident.
 */
export interface PlatformTier {
  minFarePesewas: number;
  startFarePesewas: number;
  perKmRatePesewas: number;
  perMinRatePesewas: number;
  waitPerMinPesewas: number;
  /** Legacy alias for `startFarePesewas`. */
  baseFarePesewas: number;
}

export interface PlatformConfig {
  announcement: { text: string; level: 'info' | 'warning' | 'critical' } | null;
  /** Kill switch. False means the platform is not taking rider bookings right now. */
  bookingEnabled: boolean;
  /** Kill switch. False means drivers may not go online right now. */
  driverOnlineEnabled: boolean;
  supportPhone: string | null;
  /**
   * Dialled by both apps for the emergency services. Never null — the server
   * falls back to Ghana's unified line rather than publishing nothing, because
   * a panic button with no number is worse than a wrong one.
   */
  emergencyNumber: string;
  /**
   * Consent. The app compares these against the versions stamped on the user
   * and shows the consent gate when either differs — a null on the user side
   * being an account that predates consent being recorded at all.
   */
  termsVersion: string | null;
  privacyVersion: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
  seatHoldMinutes: number;
  minFarePerSeatPesewas: number;
  driverRequiredWalletPesewas: number;
  driverMinWithdrawalPesewas: number;
  groupSeatUplift: number;
  tiers: Record<'ECO' | 'COMFORT' | 'PREMIUM', PlatformTier>;
  bookingFeeRate: number;
  platformFeePesewas: number;
}

/**
 * What the app falls back to when the config call has not answered yet, or has
 * failed. Every value here MUST match the server default in `config/settings.js`
 * — a fallback that disagrees with the server is worse than no fallback, because
 * it disagrees silently.
 *
 * Both kill switches default to ON: a config fetch that fails must not take the
 * platform down with it.
 */
export const PLATFORM_CONFIG_FALLBACK: PlatformConfig = {
  announcement: null,
  bookingEnabled: true,
  driverOnlineEnabled: true,
  supportPhone: null,
  emergencyNumber: '112',
  // Null rather than a guess: a fallback version that disagreed with the server
  // would prompt every user for consent the moment the config call failed.
  termsVersion: null,
  privacyVersion: null,
  termsUrl: null,
  privacyUrl: null,
  seatHoldMinutes: 10,
  minFarePerSeatPesewas: 800,
  driverRequiredWalletPesewas: 2000,
  driverMinWithdrawalPesewas: 2000,
  groupSeatUplift: 0.35,
  tiers: {
    ECO: { minFarePesewas: 2000, startFarePesewas: 413, perKmRatePesewas: 208, perMinRatePesewas: 81, waitPerMinPesewas: 82, baseFarePesewas: 413 },
    COMFORT: { minFarePesewas: 2200, startFarePesewas: 475, perKmRatePesewas: 240, perMinRatePesewas: 94, waitPerMinPesewas: 94, baseFarePesewas: 475 },
    PREMIUM: { minFarePesewas: 3800, startFarePesewas: 620, perKmRatePesewas: 314, perMinRatePesewas: 121, waitPerMinPesewas: 123, baseFarePesewas: 620 },
  },
  bookingFeeRate: 0.061,
  platformFeePesewas: 100,
};

/**
 * The release gate, as the app sees it. Answered WITHOUT a token — see the
 * `/client` route in eyego-api/src/modules/config/config.routes.js for why that
 * is load-bearing rather than an oversight.
 */
export interface ClientGate {
  app: 'rider' | 'driver';
  platform: 'ios' | 'android';
  /** Oldest build the operator still serves. Null means the gate is off. */
  minVersion: string | null;
  /** Where to send someone to update. Null when the operator has not set it. */
  storeUrl: string | null;
  /** True when THIS build is below `minVersion`. */
  upgradeRequired: boolean;
  maintenance: boolean;
  maintenanceMessage: string | null;
}

/**
 * What the app assumes when the gate has not answered.
 *
 * Both flags OFF. A gate that fails closed would take the whole platform down
 * on a network blip — the exact failure it exists to prevent, caused by itself.
 */
export const CLIENT_GATE_FALLBACK: ClientGate = {
  app: 'rider',
  platform: 'android',
  minVersion: null,
  storeUrl: null,
  upgradeRequired: false,
  maintenance: false,
  maintenanceMessage: null,
};

export const configApi = {
  /**
   * Unauthenticated. Poll at cold start and on foreground, BEFORE the session
   * is restored — a build too old to refresh its token still has to be able to
   * find out that it is too old.
   */
  getClientGate: () => apiClient.get<ApiResponse<ClientGate>>('/config/client'),

  /**
   * Authenticated, edge-cached for a minute, and cheap. Poll it on foreground —
   * that is the whole point of it being remote.
   */
  getPublic: () => apiClient.get<ApiResponse<PlatformConfig>>('/config/public'),
};
