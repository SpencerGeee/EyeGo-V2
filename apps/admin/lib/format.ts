/**
 * Formatting helpers. Shared by server and client components, so nothing here
 * may import node built-ins.
 *
 * The money rule for this codebase: every amount crossing the API is an INTEGER
 * NUMBER OF PESEWAS (1 GHS = 100 pesewas) and every such field is named with a
 * `...Pesewas` suffix. Formatting is the only place division by 100 is allowed —
 * doing it anywhere else is how a fare ends up off by 100x.
 */

const GHS = new Intl.NumberFormat('en-GH', {
  style: 'currency',
  currency: 'GHS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const GHS_WHOLE = new Intl.NumberFormat('en-GH', {
  style: 'currency',
  currency: 'GHS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const NUM = new Intl.NumberFormat('en-GH');

export function ghs(pesewas: number | null | undefined): string {
  if (pesewas === null || pesewas === undefined || Number.isNaN(pesewas)) return '—';
  return GHS.format(pesewas / 100);
}

/** For KPI tiles, where two decimals of a five-figure total are noise. */
export function ghsCompact(pesewas: number | null | undefined): string {
  if (pesewas === null || pesewas === undefined || Number.isNaN(pesewas)) return '—';
  return GHS_WHOLE.format(Math.round(pesewas / 100));
}

export function num(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return NUM.format(value);
}

export function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

export function km(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(1)} km`;
}

/** Ghana is UTC+0 year-round, so no timezone juggling is needed here. */
export function dateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function dateOnly(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function timeOnly(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * "4m ago" / "in 12m". Ops reads elapsed time far more than wall-clock time —
 * how long a trip has been unassigned is the number that matters.
 */
export function relative(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';

  const deltaMs = d.getTime() - Date.now();
  const future = deltaMs > 0;
  const secs = Math.abs(Math.round(deltaMs / 1000));

  const render = (v: number, unit: string) => (future ? `in ${v}${unit}` : `${v}${unit} ago`);

  if (secs < 10) return 'just now';
  if (secs < 60) return render(secs, 's');
  if (secs < 3600) return render(Math.round(secs / 60), 'm');
  if (secs < 86400) return render(Math.round(secs / 3600), 'h');
  if (secs < 2592000) return render(Math.round(secs / 86400), 'd');
  return dateOnly(d);
}

/** Minutes elapsed, for colour-coding how stale something is. */
export function minutesSince(iso: string | Date | null | undefined): number | null {
  if (!iso) return null;
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
}

export function duration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return '—';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * A HUMAN-READABLE REFERENCE FOR A TRIP — never `id.slice(0, 8)`.
 *
 * cuids are `c` + a base-36 TIMESTAMP + a counter + a fingerprint + randomness.
 * The timestamp comes first, so the leading characters of every record created
 * in the same period are nearly identical: "Trip cmspzwr6" and the rider id
 * "cmspzwr6…" looked like the same thing to the operator who reported this,
 * because for eight characters they genuinely were. Truncating from the front
 * also cannot distinguish two trips created seconds apart.
 *
 * Taking the TAIL uses the random half, which is what actually differs, and
 * uppercase grouping makes it readable over the phone. `EY-` marks it as an
 * EyeGo reference rather than a raw database id.
 */
export function tripRef(trip: { shortId?: string | null; id?: string | null } | string | null | undefined): string {
  const raw = typeof trip === 'string' ? trip : (trip?.shortId || trip?.id || '');
  if (!raw) return '—';
  const tail = raw.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase();
  return `EY-${tail}`;
}

/**
 * What to call a trip in a heading or a table when there is somewhere to go and
 * somewhere to arrive: "Accra Mall → Kotoka Terminal 3". The reference stays
 * beside it for lookups, but the human reads the journey.
 */
export function tripTitle(trip: {
  route?: { originName?: string | null; destinationName?: string | null } | null;
  pickupAddress?: string | null;
  dropoffAddress?: string | null;
} | null | undefined): string | null {
  const from = trip?.pickupAddress || trip?.route?.originName || null;
  const to = trip?.dropoffAddress || trip?.route?.destinationName || null;
  if (from && to) return `${from} → ${to}`;
  if (from) return `From ${from}`;
  if (to) return `To ${to}`;
  return null;
}

/** Ids are cuids; the first 8 characters are enough to match against a log. */
export function shortId(id: string | null | undefined): string {
  if (!id) return '—';
  return id.slice(0, 8);
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

/** Turns SCREAMING_SNAKE enum values into readable text. */
export function humanise(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function phone(value: string | null | undefined): string {
  if (!value) return '—';
  // Ghanaian MSISDNs arrive as +233XXXXXXXXX; group them so they can be read
  // aloud, which is what support actually does with them.
  const digits = value.replace(/[^\d+]/g, '');
  const m = digits.match(/^\+?233(\d{2})(\d{3})(\d{4})$/);
  if (m) return `+233 ${m[1]} ${m[2]} ${m[3]}`;
  return value;
}
