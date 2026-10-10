'use strict';

/**
 * What a rider asks of the driver: saved ride preferences (Lyft/Uber Comfort
 * style) and a one-off note for this pickup ("blue gate, opposite the
 * pharmacy"). Preferences live in `User.preferences.ride`; the note on the
 * booking. The driver sees both on the offer card and the trip sheet.
 */
const RIDE_PREFS = ['quiet', 'ac', 'luggage'];
const NOTE_MAX = 140;

/** Only the known switches, only as booleans. */
function sanitizeRidePrefs(ride) {
  if (!ride || typeof ride !== 'object') return {};
  return Object.fromEntries(RIDE_PREFS.map((k) => [k, ride[k] === true]));
}

/** The switches that are on, from a raw `User.preferences` blob. */
function ridePrefsOf(rawPreferences) {
  try {
    const ride = (typeof rawPreferences === 'string' ? JSON.parse(rawPreferences) : rawPreferences)?.ride;
    return RIDE_PREFS.filter((k) => ride?.[k] === true);
  } catch {
    return [];
  }
}

/** Trimmed, single-spaced, capped; null when there is nothing to say. */
function cleanNote(note) {
  const s = typeof note === 'string' ? note.replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX) : '';
  return s || null;
}

module.exports = { RIDE_PREFS, sanitizeRidePrefs, ridePrefsOf, cleanNote };
