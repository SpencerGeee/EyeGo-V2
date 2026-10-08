/**
 * Dates and times as the rider and driver read them — built by hand.
 *
 * `toLocaleTimeString` / `toLocaleDateString` answer from each platform's own
 * ICU data and the device's 12/24-hour setting, so the same departure read
 * "18:40" on one phone, "6:40 pm" on another and "06:40 PM" on a third, and
 * dates came out as "Sat, 15 Jun" or "Sat 15 Jun" or "15 Jun Sat". Every
 * user-facing date in both apps goes through here so iPhone and Android
 * print exactly the same string.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

type DateLike = Date | string | number | null | undefined;

/** A valid Date or null — never an Invalid Date that renders "NaN:NaN". */
export function toDate(value: DateLike): Date | null {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "6:40 PM" */
export function clockTime(value: DateLike): string {
  const d = toDate(value);
  if (!d) return '—';
  const h = d.getHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "Sat" */
export function weekdayShort(value: DateLike): string {
  const d = toDate(value);
  return d ? WEEKDAYS[d.getDay()] : '—';
}

/** "15 Jun" */
export function dayMonth(value: DateLike): string {
  const d = toDate(value);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : '—';
}

/** "15 Jun 2026" */
export function dayMonthYear(value: DateLike): string {
  const d = toDate(value);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '—';
}

/** "Jun 2026" */
export function monthYear(value: DateLike): string {
  const d = toDate(value);
  return d ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '—';
}

/** "Saturday 15 June" */
export function longDate(value: DateLike): string {
  const d = toDate(value);
  return d ? `${WEEKDAYS_LONG[d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}` : '—';
}

/** "Sat 15 Jun" */
export function shortDate(value: DateLike): string {
  const d = toDate(value);
  return d ? `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}` : '—';
}

/** "15 Jun, 6:40 PM" */
export function dayMonthTime(value: DateLike): string {
  const d = toDate(value);
  return d ? `${dayMonth(d)}, ${clockTime(d)}` : '—';
}

/** "Sat 15 Jun · 6:40 PM" */
export function shortDateTime(value: DateLike): string {
  const d = toDate(value);
  return d ? `${shortDate(d)} · ${clockTime(d)}` : '—';
}

/** "Today" / "Tomorrow" / "Sat 15 Jun" — the day half of a departure. */
export function relativeDay(value: DateLike, now: Date = new Date()): string {
  const d = toDate(value);
  if (!d) return '—';
  const a = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const b = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((b - a) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  return shortDate(d);
}

/** "Today, 6:40 PM" / "Tomorrow, 6:40 PM" / "Sat 15 Jun, 6:40 PM" */
export function relativeDayTime(value: DateLike, now: Date = new Date()): string {
  const d = toDate(value);
  return d ? `${relativeDay(d, now)}, ${clockTime(d)}` : '—';
}
