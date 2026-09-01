/**
 * PARSE, DON'T CAST — the zod half.
 *
 * ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
 *
 * `money-guards.ts` was written as hand-rolled predicates because zod was not a
 * dependency of this package at the time and adding one that could not be
 * installed would have broken Metro on a clean checkout. That constraint is
 * gone: zod is resolvable from the workspace root and is now declared in
 * `packages/api/package.json`. This file is the boundary the guards were a
 * stand-in for, and `money-guards.ts` is now a thin, source-compatible façade
 * over it — same function names, same `MoneyShapeError`, same messages.
 *
 * ── THE TWO RULES THAT SHAPE EVERY SCHEMA HERE ──────────────────────────────
 *
 * 1. **Loose, never strict.** Every object schema is `z.looseObject`, so a field
 *    the server adds tomorrow survives the parse and reaches the screen. A
 *    strict schema turns "the backend shipped a new field" into "the app cannot
 *    show a price", which is a worse failure than the one being prevented. The
 *    parsed value is the SAME object, not a rebuilt copy — see `parseOrThrow`.
 *
 * 2. **Money is checked, everything else is described.** A missing driver name
 *    renders as blank and someone files a cosmetic bug. A missing fare
 *    multiplies to `NaN`, formats as "GH₵ NaN", or — worse — arrives as the
 *    string `"2500"` and divides into a plausible wrong number that nobody
 *    notices. So the fields that decide what someone pays, and the seat counts
 *    that multiply them, are the ones that throw. Names and addresses are
 *    typed but nullable and never fatal.
 *
 * ── WHY IT THROWS RATHER THAN COERCING ──────────────────────────────────────
 *
 * Silently coercing `"2500"` to `2500` hides a changed server contract until
 * something downstream concatenates instead of adding. A thrown
 * `MoneyShapeError` is caught by the screen and shown as "we can't price this
 * right now", which is the honest answer. Refusing to show a price beats
 * showing a wrong one.
 */

import { z } from 'zod';

/** Thrown when a payload that decides what someone pays is not what it claims. */
export class MoneyShapeError extends Error {
  field: string;
  received: unknown;

  constructor(field: string, received: unknown) {
    super(
      `The server sent a ${field} this app cannot read (${describe(received)}). ` +
        'Refusing to show a price rather than showing a wrong one.',
    );
    this.name = 'MoneyShapeError';
    this.field = field;
    this.received = received;
  }
}

export function describe(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'missing';
  if (typeof v === 'number' && Number.isNaN(v)) return 'NaN';
  return `${typeof v}: ${String(v).slice(0, 40)}`;
}

// ── primitives ───────────────────────────────────────────────────────────────

/**
 * An integer count of pesewas.
 *
 * Rejects strings — including numeric ones — for the reason in the header, and
 * rejects fractional values for the same reason the schema column is an
 * integer: a third of a pesewa is not money.
 */
export const Pesewas = z.number().int().nonnegative();

/** Pesewas that may legitimately be negative: a driver's wallet after commission. */
export const SignedPesewas = z.number().int();

/** Absent is fine; present-but-wrong is not. `null` and `undefined` both mean absent. */
export const OptionalPesewas = Pesewas.nullish();
export const OptionalSignedPesewas = SignedPesewas.nullish();

/**
 * A multiplier such as surge.
 *
 * The upper bound is not arithmetic pedantry: a multiplier arriving as 1000
 * through a config mistake would price a ride at a thousand times its fare and
 * the app would render it without hesitation.
 */
export const Multiplier = z.number().positive().max(10);

/** A non-negative distance in kilometres. Fractional is expected here. */
export const DistanceKm = z.number().nonnegative();

/**
 * How many people are travelling.
 *
 * Guarded because it is a MULTIPLIER on money in every group path — a
 * cover-all host's total is `perSeat × seatCount`, and the cancellation sheet
 * says "cancel all N seats". A seat count that arrives as `"4"` makes that
 * string-repeat rather than multiply. The ceiling is the largest vehicle on the
 * platform; anything above it is a bug, not a booking.
 */
export const SeatCount = z.number().int().min(1).max(60);

/** Seat counts that are allowed to be zero (a released hold) but not absent-and-used. */
export const SeatCountOrZero = z.number().int().min(0).max(60);

const Iso = z.string().min(1);
const Id = z.string().min(1);
const NullableNumber = z.number().nullish();
const NullableString = z.string().nullish();

// ── the parse entry point ────────────────────────────────────────────────────

/**
 * Parse, and turn a zod failure into the error the apps already handle.
 *
 * Returns the ORIGINAL object rather than zod's output. That is deliberate: a
 * `looseObject` parse does preserve unknown keys, but it also rebuilds nested
 * values, and a rebuilt object breaks referential equality for anything that
 * memoises on identity (the ride store wakes components per GPS frame; handing
 * it a new object per parse would be a real regression). This is a CHECK, not a
 * transformation — nothing here is allowed to change what the caller sees.
 *
 * The field name in the error is the zod issue path prefixed with the label, so
 * `quote.breakdown.baseFarePesewas` names the exact field rather than "quote".
 */
export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (result.success) return value as T;

  const issue = result.error.issues[0];
  const path = issue?.path?.length ? `${label}.${issue.path.join('.')}` : label;
  // Walk the same path on the input so the error reports what actually arrived,
  // not `undefined` for every failure.
  const received = issue?.path?.length ? pluck(value, issue.path) : value;
  throw new MoneyShapeError(path, received);
}

function pluck(root: unknown, path: readonly PropertyKey[]): unknown {
  let cur: any = root;
  for (const key of path) {
    if (cur === null || cur === undefined) return cur;
    cur = cur[key as any];
  }
  return cur;
}

/**
 * `parseOrThrow` for a payload whose TypeScript type the caller already has.
 *
 * Same check, but the return type comes from the VALUE rather than the schema,
 * so vetting a `CancellationTerms` still yields a `CancellationTerms` and not
 * the schema's structurally-similar inference. Use this at API call sites;
 * `parseOrThrow` is for lifting a bare `unknown` into a checked primitive.
 */
export function assertShape<T>(schema: z.ZodType<any>, value: T, label: string): T {
  parseOrThrow(schema, value, label);
  return value;
}

/**
 * Parse where a failure must NOT take the screen down.
 *
 * For lists — a page of wallet transactions, a week of daily earnings — one bad
 * row should not blank the history. The caller gets `null` and decides; every
 * current caller drops the row and keeps the rest. Never use this for a price
 * the user is about to agree to.
 */
export function parseOrNull<T>(schema: z.ZodType<any>, value: T): T | null {
  return schema.safeParse(value).success ? value : null;
}

/**
 * Filter a list to the rows that parse, dropping the ones that do not.
 *
 * The element type comes from the ARRAY, not the schema, so a narrow schema can
 * vet a wider declared type without the caller having to cast the survivors
 * back. The schema is the check; the array already knows what it holds.
 */
export function parseEach<T>(schema: z.ZodType<any>, values: readonly T[] | unknown): T[] {
  if (!Array.isArray(values)) return [];
  return (values as T[]).filter((v) => schema.safeParse(v).success);
}

// ── rider: the fare quote ────────────────────────────────────────────────────

/**
 * The price the rider is about to agree to.
 *
 * `quoteId` is checked as hard as the amount: without it the booking cannot
 * reference the price it was quoted, and the rider is charged whatever the
 * server recalculates later.
 */
export const FareQuoteSchema = z.looseObject({
  quoteId: Id,
  amountPesewas: Pesewas,
  currency: z.string().optional(),
  distanceKm: DistanceKm,
  surgeMultiplier: Multiplier,

  // Both are optional in the payload and both are shown to the rider as a
  // saving, so a broken one misrepresents a discount rather than a price.
  listPricePesewas: OptionalPesewas,
  loyaltyDiscountPesewas: OptionalPesewas,

  // `breakdown` is `Record<string, number | boolean>` on the wire and is
  // rendered line by line under the price. A string in there renders as a fare
  // component, so the values are constrained even though the keys are not.
  breakdown: z.record(z.string(), z.union([z.number(), z.boolean()])).optional(),

  doorstepPickup: z.boolean().optional(),
  doorstepOffsetMeters: NullableNumber,
  durationMin: NullableNumber,

  // Described, not enforced — deliberately, and this is the line where the
  // file's rule gets tested. The countdown renders against these two rather
  // than `Date.now()`, so a missing pair degrades the timer to a clock-skewed
  // guess. That is a bad timer; it is not a wrong price. Requiring them would
  // turn "the quote arrived without a timestamp" into "we cannot show you a
  // fare at all", which trades a real, priced ride for a cosmetic invariant.
  expiresAtServerMs: z.number().optional(),
  serverNowMs: z.number().optional(),
});

// ── rider: booking, cancellation, receipt ────────────────────────────────────

/**
 * What POST /bookings actually returns — the wrapper, not a bare Booking.
 *
 * The booking id is required for the reason recorded in `bookings.api.ts`: an
 * empty one reached `POST /payments/initiate` as `bookingId: ''` and surfaced
 * as "validation failed" over a booking that had been created perfectly.
 */
export const CreateBookingResultSchema = z.looseObject({
  booking: z.looseObject({
    id: Id,
    fareAmountPesewas: OptionalPesewas,
    seats: SeatCountOrZero.nullish(),
  }),
  fareData: z
    .looseObject({
      fareAmountPesewas: OptionalPesewas,
      commissionAmountPesewas: OptionalPesewas,
      deviationSurchargePesewas: OptionalPesewas,
      cargoSurcharge: OptionalPesewas,
    })
    .optional(),
  holdExpiry: z.string().optional(),
});

/** What cancelling will cost, before the rider agrees to it. */
export const CancellationTermsSchema = z.looseObject({
  feePercentage: z.number().nonnegative().max(100),
  feeAmountPesewas: Pesewas,
  feeType: z.string().min(1),
  fareAmountPesewas: Pesewas,
  seatCount: SeatCountOrZero,
});

/** What cancelling actually cost. A refund is money leaving the platform. */
export const CancellationResultSchema = z.looseObject({
  cancellationFeePesewas: OptionalPesewas,
  refundAmountPesewas: Pesewas,
  seatCount: SeatCountOrZero,
});

/**
 * The receipt. The one document a rider may forward to a bank or an employer.
 *
 * `total` is the whole obligation and `perSeatPesewas` is `total` with the
 * surcharges taken back out — never multiply the latter to reach the former.
 * Both are checked so a receipt can never disagree with the ledger silently.
 */
export const ReceiptSchema = z.looseObject({
  bookingId: Id,
  fareBreakdown: z.looseObject({
    baseFarePesewas: Pesewas,
    platformFeePesewas: Pesewas,
    surcharges: Pesewas,
    discount: Pesewas,
    tip: Pesewas,
    total: Pesewas,
    seatCount: SeatCountOrZero.optional(),
    perSeatPesewas: OptionalPesewas,
  }),
  paymentMethod: z.string().min(1),
  receiptNumber: z.string().min(1),
});

// ── rider: wallet ────────────────────────────────────────────────────────────

export const WalletBalanceSchema = z.looseObject({
  // A rider wallet cannot go negative; a driver's can, and uses its own schema.
  balancePesewas: Pesewas,
  currency: z.string().min(1),
});

/**
 * One row of the wallet ledger.
 *
 * `amountPesewas` is SIGNED here — a withdrawal and a commission deduction are
 * both written as negatives — so this deliberately does not use `Pesewas`.
 */
export const WalletTransactionSchema = z.looseObject({
  id: Id,
  type: z.string().min(1),
  amountPesewas: SignedPesewas,
  createdAt: Iso,
});

// ── driver: offers, earnings, wallet ─────────────────────────────────────────

/**
 * A dispatch offer, as both the socket and `GET /rides/driver/state` send it.
 *
 * Every money field is nullable on the wire and that is correct — an offer for
 * a trip whose fare has not been computed yet legitimately carries nulls. What
 * is NOT allowed is a string or a fraction, which is exactly what these catch.
 * `walletRequiredPesewas` is the one a driver feels immediately: it is the
 * float a CASH seat's commission will debit at boarding, and getting it wrong
 * strands a driver at a pickup with the passenger standing there.
 */
export const PendingOfferSchema = z.looseObject({
  tripId: Id,
  farePesewas: OptionalPesewas,
  driverEarningsPesewas: OptionalPesewas,
  walletRequiredPesewas: OptionalPesewas,
  commissionPesewas: OptionalPesewas,
  // Optional for the same reason the quote's is: a missing countdown is a bad
  // timer, not a wrong number. The money above it is what throws.
  expiresAtServerMs: z.number().optional(),
});

export const PendingDispatchSchema = z.looseObject({
  tripId: Id,
  farePesewas: OptionalPesewas,
  driverEarningsPesewas: OptionalPesewas,
  walletRequiredPesewas: OptionalPesewas,
  commissionPesewas: OptionalPesewas,
  offeredToMe: z.boolean(),
});

/** The driver's own wallet. Negative is a real state: commission owed on cash. */
export const DriverWalletBalanceSchema = z.looseObject({
  balancePesewas: SignedPesewas,
  currency: z.string().min(1),
});

/**
 * The server's earnings arithmetic for a period.
 *
 * This is the schema behind backlog item 14. The earnings screen used to
 * re-derive these totals on the phone from ONE PAGE of wallet transactions,
 * which under-reports any period longer than the page — that is where the
 * flat-zero chart came from. The server aggregates over the whole period, so
 * these are the numbers to trust; parsing them means the screen can stop
 * hedging between two sources that disagree.
 *
 * `netEarnings` and `totalDeductions` are signed: deductions are written as
 * negatives, and a driver deep in commission debt has negative net earnings.
 */
export const EarningsBreakdownSchema = z.looseObject({
  totalEarningsPesewas: SignedPesewas,
  totalTrips: z.number().int().nonnegative(),
  totalTips: SignedPesewas,
  totalDeductions: SignedPesewas,
  netEarnings: SignedPesewas,
  averagePerTripPesewas: SignedPesewas,
  // `earnings` and `trips`, which is what `drivers.service.js` groups into.
  // The wrapper used to declare `amountPesewas` here and the server has never
  // sent it, so every bar on the earnings chart read `undefined` — a day with
  // no work and a day the client cannot read looked identical.
  dailyBreakdown: z.array(
    z.looseObject({
      date: z.string().min(1),
      earnings: SignedPesewas,
      trips: z.number().int().nonnegative(),
    }),
  ),
  recentTrips: z
    .array(
      z.looseObject({
        id: Id,
        shortId: NullableString,
        createdAt: Iso,
        baseFarePesewas: OptionalPesewas,
      }),
    )
    .optional(),
});

/** A withdrawal or top-up amount leaving or entering a driver's wallet. */
export const WalletMovementSchema = z.looseObject({ amountPesewas: Pesewas });

export type FareQuoteShape = z.infer<typeof FareQuoteSchema>;
export type EarningsBreakdownShape = z.infer<typeof EarningsBreakdownSchema>;
