/**
 * Money on the client. Integer pesewas in, formatted strings out.
 *
 * The server stores and sends money as an INTEGER NUMBER OF PESEWAS
 * (1 GH₵ = 100 pesewas; GH₵25.50 is `2550`). See eyego-api/src/utils/money.js
 * for the full reasoning. The short version: floats cannot represent 0.01, so
 * any decimal money that is added, split or re-summed drifts, and a receipt
 * stops agreeing with the driver's earnings by a pesewa that nobody can
 * explain.
 *
 * THE CLIENT NEVER DOES MONEY ARITHMETIC. It receives pesewas and formats
 * them. If a screen needs a total, the server sends the total. This is not a
 * style preference: the moment a client adds two fares it has to decide how to
 * round, and it will decide differently from the server that issues the
 * receipt.
 *
 * ── WHY `formatCurrency` WAS DELETED ────────────────────────────────────────
 * It took cedis. Keeping it while the values underneath became pesewas would
 * have left every one of its ~38 call sites compiling perfectly and rendering
 * "GH₵ 2550.00" for a GH₵25.50 ride. Removing it makes the compiler point at
 * every site instead. Use `formatGhs`.
 */

/**
 * An integer number of pesewas.
 *
 * Branded so a raw `number` cannot be passed where money is expected — the
 * whole class of bug this migration is about is a plain number being read as
 * the wrong unit. API response types declare their money fields as `Pesewas`,
 * so values flowing from the server carry the brand for free; only hand-made
 * literals need `asPesewas`.
 */
export type Pesewas = number & { readonly __brand: unique symbol };

/** Assert at the boundary that a raw number is pesewas. Use sparingly. */
export function asPesewas(n: number): Pesewas {
  return Math.round(n) as Pesewas;
}

/** Cedis a human typed → pesewas. The only place `* 100` is allowed. */
export function pesewasFromCedis(cedis: number): Pesewas {
  return Math.round((cedis + Number.EPSILON) * 100) as Pesewas;
}

/**
 * "GH₵25.50". The canonical way money appears anywhere in either app.
 *
 * Built by integer division rather than `toFixed`, because `toFixed` goes back
 * through a float and can render 25.49 for a value that is exactly 2550.
 */
export function formatGhs(
  pesewas: Pesewas | number | null | undefined,
  opts: { showDecimals?: boolean; signed?: boolean } = {},
): string {
  if (pesewas == null || !Number.isFinite(Number(pesewas))) return 'GH₵—';
  const { showDecimals = true, signed = false } = opts;

  const n = Math.round(Number(pesewas));
  const negative = n < 0;
  const abs = Math.abs(n);
  const cedis = Math.floor(abs / 100);
  const rem = abs % 100;

  const sign = negative ? '−' : signed ? '+' : '';
  const body = showDecimals
    ? `${withThousands(cedis)}.${String(rem).padStart(2, '0')}`
    : withThousands(rem >= 50 ? cedis + 1 : cedis);

  return `${sign}GH₵${body}`;
}

/** "25.50" — for inputs and places that render the symbol separately. */
export function pesewasToDecimalString(pesewas: Pesewas | number | null | undefined): string {
  if (pesewas == null || !Number.isFinite(Number(pesewas))) return '0.00';
  const n = Math.abs(Math.round(Number(pesewas)));
  return `${Math.floor(n / 100)}.${String(n % 100).padStart(2, '0')}`;
}

/**
 * Pesewas → a plain cedis Number, for the rare consumer that demands decimals
 * (a chart axis, a third-party SDK). Never feed the result back into money.
 */
export function pesewasToCedis(pesewas: Pesewas | number | null | undefined): number {
  return Math.round(Number(pesewas) || 0) / 100;
}

function withThousands(n: number): string {
  return n.toLocaleString('en-GH', { maximumFractionDigits: 0 });
}
