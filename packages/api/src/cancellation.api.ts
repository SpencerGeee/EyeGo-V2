import { apiClient } from './client';

/** Peel the `{ success, data }` envelope, as rides.api does. */
const unwrap = <T>(res: { data: { data: T } }): T => res.data.data;

/**
 * WHAT CANCELLING WILL COST, BEFORE THE RIDER AGREES TO IT.
 *
 * This module used to be typed `{ fee: number; reason: string; eligible: boolean }`
 * and to return the raw axios response. Three things were wrong with that at
 * once, and together they meant the cancel sheet could never show a fee:
 *
 *   - the response was not unwrapped, so `data.fee` was reading a field off an
 *     AxiosResponse;
 *   - the envelope nests the answer under `cancellationFeePesewas`;
 *   - and none of `fee`, `reason` or `eligible` has ever existed on it.
 *
 * So `cancellationFeePesewas ?? 0` was always 0 and `eligible ?? false` always
 * false — the sheet showed "cancelling … may incur a cancellation fee" whatever
 * the real answer was, including when the rider was about to be charged one.
 * These are the fields the server actually sends (see
 * cancellation.service.cancellationTermsFor).
 */
export interface CancellationTerms {
  /** The fee as a percentage of the fare. 0 when cancelling is free. */
  feePercentage: number;
  /** What the rider will actually be charged, in pesewas. The number to show. */
  feeAmountPesewas: number;
  /** FREE · LATE_CANCELLATION · NO_SHOW */
  feeType: 'FREE' | 'LATE_CANCELLATION' | 'NO_SHOW';
  /** The whole obligation being walked away from — every seat this rider holds. */
  fareAmountPesewas: number;
  /** How many seats that covers, so the sheet can say "cancel all 4 seats". */
  seatCount: number;
  /** Hailed rides: the free window after a driver accepts, and how far into it we are. */
  freeCancelSeconds?: number;
  secondsSinceAssigned?: number | null;
  /** Scheduled/group trips: the same idea measured against departure instead. */
  freeCancelMinutes?: number;
  minutesUntilDeparture?: number;
}

export interface CancellationResult {
  cancellationFeePesewas: number | null;
  refundAmountPesewas: number;
  seatCount: number;
  alreadyCancelled?: boolean;
}

export const cancellationApi = {
  getFee: (bookingId: string) =>
    apiClient
      .get<{ data: { cancellationFeePesewas: CancellationTerms } }>(`/cancellation/${bookingId}/fee`)
      .then(unwrap<{ cancellationFeePesewas: CancellationTerms }>)
      .then((d) => d.cancellationFeePesewas),

  cancelWithFee: (bookingId: string, data: { reason: string; note?: string }) =>
    apiClient
      .post<{ data: CancellationResult }>(`/cancellation/${bookingId}/cancel`, data)
      .then(unwrap<CancellationResult>),
};
