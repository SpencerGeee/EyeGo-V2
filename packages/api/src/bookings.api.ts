import { apiClient } from './client';
import type {
  ApiResponse,
  Booking,
  CreateBookingRequest,
  RatingRequest,
  GroupBooking,
} from '@eyego/types';

/**
 * Guard against an empty id being interpolated into a path.
 *
 * BUGFIX (group hub: "Couldn't create link — tap to retry", and "Couldn't
 * update pickup — Route PATCH … not found"): callers pass
 * `activeBooking?.id ?? ''`, and when the booking hadn't loaded yet that empty
 * string produced `/bookings//pickup`. Express matches no route for the double
 * slash and returns its generic 404 body, so the app reported a mysterious
 * routing error for what is really "we don't have a booking yet". Failing here
 * turns it into an explicit, debuggable error instead of a phantom 404.
 */
/** Exactly what POST /bookings returns inside the response envelope. */
export interface CreateBookingResult {
  booking: Booking;
  fareData?: {
    fareAmountPesewas?: number;
    commissionAmountPesewas?: number;
    deviationSurchargePesewas?: number;
    cargoSurcharge?: number;
  };
  holdExpiry?: string;
}

function requireId(id: string | undefined | null, op: string): string {
  const trimmed = (id ?? '').trim();
  if (!trimmed) throw new Error(`bookingsApi.${op}: called without a booking id`);
  return trimmed;
}

export const bookingsApi = {
  /**
   * Hold a seat. The server responds with a WRAPPER, not a bare Booking:
   * `created(res, { booking, fareData, holdExpiry })`.
   *
   * This was typed `ApiResponse<Booking>` for a long time, which is why the cash
   * flow kept "failing" while the seat was visibly held: the payment screen read
   * `res.data.data.id`, got `undefined` from the wrapper, sent `bookingId: ''`
   * to POST /payments/initiate, and the route's `body('bookingId').notEmpty()`
   * rejected it — surfacing as "validation failed" / "Payment initialization
   * failed, please try again" over a booking that had been created perfectly.
   * The type now matches the wire format so no caller can make that mistake
   * again silently.
   */
  create: (data: CreateBookingRequest) =>
    apiClient.post<ApiResponse<CreateBookingResult>>('/bookings', data),

  getById: (id: string) =>
    apiClient.get<ApiResponse<Booking>>(`/bookings/${id}`),

  // Group-hub joiner setting/changing their own pickup point — only allowed
  // pre-payment (SEAT_HELD); recomputes fare with any deviation surcharge.
  updatePickup: (id: string, data: { lat: number; lng: number; address?: string }) =>
    apiClient.patch<ApiResponse<Booking>>(`/bookings/${requireId(id, 'updatePickup')}/pickup`, data),

  // Heavy-cargo/luggage surcharge — was previously a client-only toggle that changed
  // the displayed price but never actually charged anything. Only allowed pre-payment.
  updateHeavyCargo: (id: string, heavyCargo: boolean) =>
    apiClient.patch<ApiResponse<Booking>>(`/bookings/${requireId(id, 'updateHeavyCargo')}/heavy-cargo`, { heavyCargo }),

  getActive: () =>
    apiClient.get<ApiResponse<Booking | null>>('/bookings/active'),

  getHistory: (params?: { page?: number; limit?: number; status?: string }) =>
    apiClient.get<ApiResponse<{ bookings: Booking[]; total: number; page: number; totalPages: number }>>('/bookings', { params }),

  /**
   * Returns `data: null`. The controller is `ok(res, null, 'Booking cancelled')`
   * — it drops the service's return value on the floor — so anything that
   * awaited this expecting a refreshed Booking got `undefined`, not a booking
   * with `status: 'CANCELLED'`. Typed for what actually arrives; refetch the
   * booking if you need its new state.
   */
  cancel: (id: string) =>
    apiClient.post<ApiResponse<null>>(`/bookings/${id}/cancel`),

  cancelWithReason: (id: string, data: { reason: string; note?: string }) =>
    apiClient.post<ApiResponse<null>>(`/bookings/${id}/cancel`, data),

  rate: (id: string, data: RatingRequest) =>
    apiClient.post<ApiResponse<Booking>>(`/bookings/${id}/rating`, data),

  generateInvite: (id: string) =>
    apiClient.post<ApiResponse<{ inviteToken: string; inviteLink: string }>>(
      `/bookings/${requireId(id, 'generateInvite')}/invite`
    ),

  getGroup: (id: string) =>
    apiClient.get<ApiResponse<GroupBooking>>(`/bookings/${requireId(id, 'getGroup')}/group`),

  joinGroup: (token: string) =>
    apiClient.post<ApiResponse<{ trip: import('@eyego/types').Trip }>>(
      `/bookings/join/${token}`
    ),

  applyPromo: (bookingId: string, code: string) =>
    apiClient.post<ApiResponse<any>>(`/bookings/${bookingId}/apply-promo`, { code }),

  tip: (bookingId: string, data: { amountPesewas: number; phone?: string }) =>
    apiClient.post<ApiResponse<{ reference: string }>>(`/bookings/${bookingId}/tip`, data),

  // ── Cancellation fee ────────────────────────────────────────────────
  // Deliberately NOT declared here. `cancellation.api.ts` owns these two
  // endpoints, and this file used to carry a second, stale copy of them whose
  // fee type was `{ fee: number }` — the pre-pesewas shape. The server sends
  // `feeAmountPesewas`, so anyone who reached for `bookingsApi.getCancellationFee`
  // by autocomplete got a type that typechecked and then read `undefined` at
  // runtime. One endpoint, one declaration: import `cancellationApi`.

  // ── Receipts ────────────────────────────────────────────────────────
  getReceipt: (id: string) =>
    apiClient.get<ApiResponse<{
      bookingId: string;
      tripId: string;
      routeName: string;
      /**
       * The rider's WHOLE obligation for the trip, not one seat of it — a
       * cover-all host owns one booking per covered seat, so `seatCount` is how
       * many seats `total` buys and `perSeatPesewas` is `total` with the
       * surcharges taken back out. Never multiply `perSeatPesewas` to reach a
       * total; `total` is the total.
       */
      fareBreakdown: {
        baseFarePesewas: number;
        platformFeePesewas: number;
        surcharges: number;
        discount: number;
        tip: number;
        total: number;
        seatCount?: number;
        perSeatPesewas?: number;
      };
      paymentMethod: string;
      paidAt: string;
      receiptNumber: string;
      trip: any;
    }>>(`/receipts/${id}`),

};
