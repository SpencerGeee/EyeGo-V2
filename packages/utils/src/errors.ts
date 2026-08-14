/**
 * ONE PLACE THAT TURNS A FAILURE INTO A SENTENCE A PASSENGER CAN READ.
 *
 * WHAT THIS REPLACES. Roughly forty call sites across both apps shaped like:
 *
 *     Alert.alert('Error', (err as Error).message)
 *     err?.response?.data?.message ?? err?.message ?? 'Something went wrong'
 *
 * On the happy-ish path that reads the server's own copy, which is written for
 * humans and is fine. On every other path `err.message` is an axios string —
 * "Request failed with status code 400", "Network Error", "timeout of 15000ms
 * exceeded" — or a JSON blob, or a stack. Uber and Bolt never show those, and
 * the reason is not politeness: a status code tells the rider nothing about
 * what to DO, which is the only thing an error message is for.
 *
 * THE RULE. A message is shown to a user only if a human wrote it. Anything
 * machine-generated is replaced by copy chosen from the most specific signal
 * available, in this order:
 *
 *   1. an application error CODE the server sent (`INSUFFICIENT_WALLET`, …)
 *   2. a `message` from the server that reads as prose (see `looksMachineWritten`)
 *   3. the HTTP status
 *   4. the transport (offline, timeout, DNS)
 *   5. the caller's fallback
 *
 * NOTHING IS SWALLOWED. `describeError` returns `technical` alongside the human
 * copy, and the interceptor in `@eyego/api` keeps the original on
 * `err.technicalMessage`, so logs and Sentry still get the real string. The
 * change is about what a rider SEES, not about what the app knows.
 */

export interface FriendlyError {
  /** Short, sentence-case. Suitable as an Alert title or a banner heading. */
  title: string;
  /** One or two sentences. Says what happened and what to do about it. */
  message: string;
  /** The server's application code, when it sent one. */
  code: string | null;
  /** HTTP status, when there was a response. */
  status: number | null;
  /**
   * True when the same request is worth trying again unchanged — a timeout, a
   * dropped connection, a 5xx. False for anything the user must change first.
   */
  retryable: boolean;
  /** The original, machine-written string. For logs, never for a screen. */
  technical: string | null;
}

/** Shape we accept — axios errors, fetch errors, plain Errors, strings. */
interface ErrorLike {
  message?: unknown;
  code?: unknown;
  status?: unknown;
  response?: {
    status?: unknown;
    data?: {
      message?: unknown;
      error?: unknown;
      code?: unknown;
      errors?: unknown;
    };
  };
}

/**
 * Does this string read like something a person wrote for another person?
 *
 * Deliberately conservative in the direction of hiding: showing a rider a
 * technical string is a visible product failure, while replacing a slightly
 * awkward but valid server message with "Something went wrong" is merely a
 * missed opportunity. When in doubt, hide.
 */
export function looksMachineWritten(raw: string): boolean {
  const s = raw.trim();
  if (!s) return true;
  // Axios / fetch / node transport strings.
  if (/^request failed with status code/i.test(s)) return true;
  if (/^network error$/i.test(s)) return true;
  if (/^timeout of \d+ms exceeded/i.test(s)) return true;
  if (/\b(ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|ERR_[A-Z_]+)\b/.test(s)) return true;
  if (/^AxiosError\b/.test(s)) return true;
  // A serialized payload or a stack, not a sentence.
  if (/^[[{]/.test(s)) return true;
  if (/\bat .+\(.+:\d+:\d+\)/.test(s)) return true;
  // Prisma / Postgres / Zod leakage.
  if (/^(Invalid `prisma|PrismaClient|P\d{4}\b)/.test(s)) return true;
  if (/\b(relation|column|constraint) ".+" (does not exist|violates)/i.test(s)) return true;
  // Bare identifiers: SCREAMING_SNAKE codes and camelCase field names are the
  // two shapes that most often reach a user by accident.
  if (/^[A-Z][A-Z0-9_]{3,}$/.test(s)) return true;
  if (s.length > 240) return true;
  return false;
}

/**
 * Copy for the application codes the API actually raises.
 *
 * Anything not listed here still gets a sensible answer from the status
 * fallback below, so this table is an improvement, never a requirement — a new
 * server code cannot cause a blank or a raw string.
 */
const BY_CODE: Record<string, { title: string; message: string }> = {
  // ── Money ──
  INSUFFICIENT_WALLET: {
    title: 'Not enough balance',
    message: 'Add money to your wallet and try again.',
  },
  NEGATIVE_WALLET_BALANCE: {
    title: 'Wallet needs topping up',
    message: 'You owe commission on recent cash trips. Top up your wallet to go back online.',
  },
  PAYMENT_ERROR: {
    title: 'Payment did not go through',
    message: 'No money has left your account. Try again, or use another payment method.',
  },
  INVALID_AMOUNT: {
    title: 'Check the amount',
    message: 'Enter an amount greater than zero.',
  },

  // ── Seats and bookings ──
  SEAT_TAKEN: {
    title: 'Seat just went',
    message: 'Someone booked that seat a moment ago. Pick another one.',
  },
  NO_SEATS_AVAILABLE: {
    title: 'This ride is full',
    message: 'Every seat has been taken. Try another ride.',
  },
  BOOKING_NOT_FOUND: {
    title: 'Booking not found',
    message: 'This booking is no longer available. Pull down to refresh.',
  },

  // ── Dispatch and trips ──
  DISPATCH_UNAVAILABLE: {
    title: 'This ride has gone',
    message: 'Another driver took it, or it expired. You will get the next one.',
  },
  TRIP_ALREADY_IN_STATE: {
    title: 'Already done',
    message: 'This step has already been recorded.',
  },
  TRIP_TERMINAL: {
    title: 'This trip has ended',
    message: 'Nothing more can be changed on it.',
  },
  ILLEGAL_TRANSITION: {
    title: 'Not possible right now',
    message: 'The trip has moved on. Pull down to refresh and try again.',
  },
  VERSION_CONFLICT: {
    title: 'Someone got there first',
    message: 'This changed while you were looking at it. Refresh and try again.',
  },
  ACTOR_NOT_PERMITTED: {
    title: 'Not allowed',
    message: 'You cannot make this change.',
  },

  // ── Driver gating ──
  DOCUMENTS_NOT_VERIFIED: {
    title: 'Documents still under review',
    message: 'You can go online once your documents are approved.',
  },
  GEO_OUT_OF_BOUNDS: {
    title: 'Outside the service area',
    message: 'EyeGo only operates inside Ghana at the moment.',
  },

  // ── Auth ──
  AUTH_ERROR: {
    title: 'Please sign in again',
    message: 'Your session has expired.',
  },
  FORBIDDEN: {
    title: 'Not allowed',
    message: 'You do not have access to this.',
  },
  RECIPIENT_NOT_FOUND: {
    title: 'Person not found',
    message: 'Check the number and try again.',
  },
  INVALID_OTP: {
    title: 'Wrong code',
    message: 'Check the code and try again.',
  },
  OTP_EXPIRED: {
    title: 'Code expired',
    message: 'Request a new code.',
  },
};

const BY_STATUS: Record<number, { title: string; message: string; retryable?: boolean }> = {
  400: { title: 'Check your details', message: 'Something in that request was not quite right.' },
  401: { title: 'Please sign in again', message: 'Your session has expired.' },
  402: { title: 'Payment needed', message: 'This could not be completed without payment.' },
  403: { title: 'Not allowed', message: 'You do not have access to this.' },
  404: { title: 'Not found', message: 'That is no longer available. Pull down to refresh.' },
  408: { title: 'Took too long', message: 'The request timed out. Try again.', retryable: true },
  409: {
    title: 'Someone got there first',
    message: 'This changed while you were looking at it. Refresh and try again.',
  },
  413: { title: 'File is too large', message: 'Choose a smaller file and try again.' },
  422: { title: 'Check your details', message: 'Something in that request was not quite right.' },
  429: {
    title: 'Slow down a moment',
    message: 'Too many tries. Wait a few seconds and try again.',
    retryable: true,
  },
  500: {
    title: 'Something went wrong on our side',
    message: 'This is not your fault. Try again in a moment.',
    retryable: true,
  },
  502: { title: 'We are having trouble', message: 'Try again in a moment.', retryable: true },
  503: {
    title: 'EyeGo is briefly unavailable',
    message: 'We are back shortly. Try again in a moment.',
    retryable: true,
  },
  504: { title: 'Took too long', message: 'The server did not answer in time. Try again.', retryable: true },
};

const OFFLINE = {
  title: 'No connection',
  message: 'Check your data or Wi-Fi and try again.',
};

const TIMEOUT = {
  title: 'Took too long',
  message: 'Your connection is slow right now. Try again.',
};

function firstString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Pull the first field-level message out of an express-validator payload.
 * Those ARE human-written (the route declares `.withMessage(...)`), so they are
 * the most specific thing available when a 400 carries them.
 */
function firstValidationMessage(errors: unknown): string | null {
  if (!Array.isArray(errors)) return null;
  for (const e of errors) {
    const msg = (e as { msg?: unknown; message?: unknown })?.msg ?? (e as { message?: unknown })?.message;
    if (typeof msg === 'string' && msg.trim() && !looksMachineWritten(msg)) return msg.trim();
  }
  return null;
}

/**
 * Turn anything throwable into copy you can put on a screen.
 *
 * @param fallback  Shown when nothing better can be determined. Write it as the
 *                  MESSAGE ("We could not save your profile."), not as a title.
 */
export function describeError(err: unknown, fallback?: string): FriendlyError {
  if (err == null) {
    return {
      title: 'Something went wrong',
      message: fallback ?? 'Please try again.',
      code: null,
      status: null,
      retryable: true,
      technical: null,
    };
  }

  if (typeof err === 'string') {
    return looksMachineWritten(err)
      ? {
          title: 'Something went wrong',
          message: fallback ?? 'Please try again.',
          code: null,
          status: null,
          retryable: true,
          technical: err,
        }
      : { title: 'Something went wrong', message: err, code: null, status: null, retryable: false, technical: null };
  }

  const e = err as ErrorLike;
  const technical = firstString(e.message);
  const status =
    typeof e.response?.status === 'number'
      ? e.response.status
      : typeof e.status === 'number'
        ? e.status
        : null;
  const code =
    firstString(e.response?.data?.code, e.code) ?? null;

  // ── Transport: there was no response at all ──────────────────────────────
  if (status == null) {
    const raw = (technical ?? '').toLowerCase();
    const axiosCode = typeof e.code === 'string' ? e.code : '';
    if (axiosCode === 'ECONNABORTED' || raw.includes('timeout')) {
      return { ...TIMEOUT, code: axiosCode || null, status: null, retryable: true, technical };
    }
    if (
      axiosCode === 'ERR_NETWORK' ||
      raw.includes('network error') ||
      raw.includes('econnrefused') ||
      raw.includes('enotfound') ||
      raw.includes('failed to fetch')
    ) {
      return { ...OFFLINE, code: axiosCode || null, status: null, retryable: true, technical };
    }
    // A plain client-side Error thrown by our own code — usually already prose.
    if (technical && !looksMachineWritten(technical)) {
      return {
        title: 'Something went wrong',
        message: technical,
        code: axiosCode || null,
        status: null,
        retryable: false,
        technical: null,
      };
    }
    return {
      title: 'Something went wrong',
      message: fallback ?? 'Please try again.',
      code: axiosCode || null,
      status: null,
      retryable: true,
      technical,
    };
  }

  // ── 1. A code we have copy for wins, because it is the most specific ─────
  if (code && BY_CODE[code]) {
    const status5xx = status >= 500;
    return { ...BY_CODE[code], code, status, retryable: status5xx, technical };
  }

  // ── 2. Prose the server wrote ────────────────────────────────────────────
  const serverMessage =
    firstValidationMessage(e.response?.data?.errors) ??
    firstString(e.response?.data?.message, e.response?.data?.error);

  if (serverMessage && !looksMachineWritten(serverMessage)) {
    const byStatus = BY_STATUS[status];
    return {
      // The server said what happened; the status says how to frame it.
      title: byStatus?.title ?? 'Something went wrong',
      message: serverMessage,
      code,
      status,
      retryable: byStatus?.retryable ?? status >= 500,
      technical,
    };
  }

  // ── 3. The status ────────────────────────────────────────────────────────
  const byStatus = BY_STATUS[status];
  if (byStatus) {
    return {
      title: byStatus.title,
      message: fallback ?? byStatus.message,
      code,
      status,
      retryable: byStatus.retryable ?? status >= 500,
      technical,
    };
  }

  if (status >= 500) {
    return { ...BY_STATUS[500], code, status, retryable: true, technical };
  }

  return {
    title: 'Something went wrong',
    message: fallback ?? 'Please try again.',
    code,
    status,
    retryable: false,
    technical,
  };
}

/** Just the sentence — for inline form errors and banners. */
export function errorMessage(err: unknown, fallback?: string): string {
  return describeError(err, fallback).message;
}
