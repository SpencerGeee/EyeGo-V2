/**
 * Format a fare amount for display
 * e.g. formatCurrency(15.5, 'GHS') → 'GH₵ 15.50'
 */
export function formatCurrency(amount: number, currency = 'GHS'): string {
  const symbols: Record<string, string> = {
    GHS: 'GH₵',
    NGN: '₦',
    USD: '$',
    KES: 'KSh',
  };
  const symbol = symbols[currency] ?? currency;
  return `${symbol} ${amount.toFixed(2)}`;
}

/**
 * Format a date string to human-readable form
 * e.g. '2024-06-15T08:30:00Z' → 'Sat, 15 Jun · 8:30 AM'
 */
export function formatTripDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-GH', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Format duration in minutes to human-readable
 * e.g. 90 → '1h 30m'
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Format distance
 * e.g. 1.5 → '1.5 km'
 */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)}m`;
  return `${km.toFixed(1)} km`;
}

/**
 * Mask a phone number for display
 * e.g. '+233244123456' → '+233 244 ***456'
 */
export function maskPhone(phone: string): string {
  if (phone.length < 6) return phone;
  const visible = phone.slice(-3);
  return `${phone.slice(0, phone.length - 6)}***${visible}`;
}

/**
 * Format phone for display
 * e.g. '0244123456' → '+233 244 123 456'
 */
export function formatPhone(phone: string): string {
  const clean = phone.replace(/\D/g, '');
  if (clean.startsWith('233')) {
    const local = clean.slice(3);
    return `+233 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
  }
  if (clean.startsWith('0') && clean.length === 10) {
    return `+233 ${clean.slice(1, 4)} ${clean.slice(4, 7)} ${clean.slice(7)}`;
  }
  return phone;
}

/**
 * Get relative time label
 * e.g. '2 min ago', 'Just now', 'Yesterday'
 */
export function relativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diff = Math.floor((now - then) / 1000);

  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 172800) return 'Yesterday';
  return new Date(isoString).toLocaleDateString('en-GH', {
    day: 'numeric',
    month: 'short',
  });
}

/**
 * Generate initials from a name
 * e.g. 'Kwame Mensah' → 'KM'
 */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() ?? '')
    .join('');
}
