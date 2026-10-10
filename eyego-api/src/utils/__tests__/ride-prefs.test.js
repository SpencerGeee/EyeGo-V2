'use strict';

const { sanitizeRidePrefs, ridePrefsOf, cleanNote } = require('../ride-prefs');

describe('ride prefs + pickup note', () => {
  it('keeps only known switches, only as booleans', () => {
    expect(sanitizeRidePrefs({ quiet: true, ac: 'yes', smoking: true })).toEqual({ quiet: true, ac: false, luggage: false });
  });
  it('reads the on switches out of a raw preferences blob, and survives garbage', () => {
    expect(ridePrefsOf(JSON.stringify({ theme: 'dark', ride: { quiet: true, luggage: true } }))).toEqual(['quiet', 'luggage']);
    expect(ridePrefsOf('not json')).toEqual([]);
    expect(ridePrefsOf(null)).toEqual([]);
  });
  it('cleans the note', () => {
    expect(cleanNote('  blue   gate\n opposite pharmacy ')).toBe('blue gate opposite pharmacy');
    expect(cleanNote('   ')).toBeNull();
    expect(cleanNote('x'.repeat(300))).toHaveLength(140);
  });
});
