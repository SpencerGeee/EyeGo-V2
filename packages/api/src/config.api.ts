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

export const configApi = {
  /**
   * Authenticated, edge-cached for a minute, and cheap. Poll it on foreground —
   * that is the whole point of it being remote.
   */
  getPublic: () => apiClient.get<ApiResponse<PlatformConfig>>('/config/public'),
};
