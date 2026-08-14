'use strict';

/**
 * Server-side twin of packages/utils/src/geo-links.ts.
 *
 * The apps share one TypeScript module for every link that hands a place to
 * another app; this API is CommonJS and cannot import it, so the same rule is
 * written down once more here rather than being re-improvised at each call site
 * — which is exactly how the "Google Maps opens on bare coordinates" bug got
 * into four different files in the first place.
 *
 * THE RULE. An address is what a human reads and searches; coordinates are what
 * a router needs. Send the address when there is one and keep coordinates as
 * the fallback.
 *
 * One deliberate exception lives here: an SOS carries the LIVE position of a
 * moving vehicle, which has no address, and reverse-geocoding it would add a
 * network round trip to the one code path that must never wait. Those links
 * stay coordinate-based on purpose — but they use the documented search URL, so
 * the recipient still gets a proper named pin they can navigate from rather
 * than the legacy `?q=` form's bare marker.
 */

const isFiniteNumber = (n) => typeof n === 'number' && Number.isFinite(n);

/** Placeholders that must never be sent to another app as if they were places. */
const PLACEHOLDERS = new Set([
  'current location',
  'unknown',
  'destination',
  'pickup',
  'origin',
]);

function searchableAddress(address) {
  if (typeof address !== 'string') return null;
  const value = address.trim();
  if (value.length < 3) return null;
  if (PLACEHOLDERS.has(value.toLowerCase())) return null;
  if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(value)) return null;
  return value;
}

/**
 * A Google Maps link that opens a named, actionable pin.
 *
 * @param {{lat?: number, lng?: number, address?: string|null}} place
 * @returns {string|null} null when there is nothing worth linking to — callers
 *   should say "location unavailable" rather than link to 0,0, which is a point
 *   in the Gulf of Guinea and the last thing to send someone in an emergency.
 */
function mapLink({ lat, lng, address } = {}) {
  const named = searchableAddress(address);
  if (isFiniteNumber(lat) && isFiniteNumber(lng)) {
    const query = encodeURIComponent(`${lat.toFixed(6)},${lng.toFixed(6)}`);
    return `https://www.google.com/maps/search/?api=1&query=${query}`;
  }
  if (named) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(named)}`;
  }
  return null;
}

/** "<name> — <link>", or a plain admission that we do not know where they are. */
function describeLocation(place, fallbackText = 'Location unavailable') {
  const link = mapLink(place);
  if (!link) return fallbackText;
  const named = searchableAddress(place?.address);
  return named ? `${named} — ${link}` : link;
}

module.exports = { mapLink, describeLocation, searchableAddress };
