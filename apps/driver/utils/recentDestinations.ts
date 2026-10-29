import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GeocodeResult } from './geocoding';

/**
 * The last few places this driver actually ran a trip to.
 *
 * WHY THIS EXISTS. Create-trip offered one way to set a destination: open the
 * picker and search for it. Drivers do not work that way — the same handful of
 * routes get published over and over, so every trip meant retyping a place the
 * app had already seen a dozen times. Reported as "there's no recent
 * destinations so every time I have to put the destination there".
 *
 * Deliberately LOCAL. This is a keyboard shortcut, not a record: it needs no
 * server round trip, it works with no signal, and it carries nothing the driver
 * has not already typed into this device. It is written on publish rather than
 * on selection so the list reflects trips that really happened, not places that
 * were considered and abandoned.
 */
const KEY = 'eyego_driver_recent_destinations';

/** Small on purpose — a suggestion list long enough to scan is not a shortcut. */
export const MAX_RECENT_DESTINATIONS = 3;

/** Two places are "the same" within about 50 m, so a re-pin does not duplicate. */
const SAME_PLACE_DEGREES = 0.0005;

function isSamePlace(a: GeocodeResult, b: GeocodeResult): boolean {
  if (a.placeId && b.placeId && a.placeId === b.placeId) return true;
  return (
    Math.abs(a.latitude - b.latitude) < SAME_PLACE_DEGREES &&
    Math.abs(a.longitude - b.longitude) < SAME_PLACE_DEGREES
  );
}

export async function getRecentDestinations(): Promise<GeocodeResult[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Guard every field: this is user data that survives app upgrades, and a
    // half-written entry must not be able to crash the create-trip screen.
    return parsed
      .filter(
        (p): p is GeocodeResult =>
          !!p &&
          typeof p.name === 'string' &&
          Number.isFinite(p.latitude) &&
          Number.isFinite(p.longitude),
      )
      .slice(0, MAX_RECENT_DESTINATIONS);
  } catch {
    return [];
  }
}

/** Record a destination the driver just published a trip to. Most recent first. */
export async function rememberDestination(place: GeocodeResult | null): Promise<void> {
  if (!place || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) return;
  try {
    const existing = await getRecentDestinations();
    const next = [place, ...existing.filter((p) => !isSamePlace(p, place))].slice(
      0,
      MAX_RECENT_DESTINATIONS,
    );
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // A shortcut that fails to save is a shortcut the driver does not get next
    // time. It is never worth failing a publish over.
  }
}

/**
 * "REPEAT LAST RUN" (client 2026-10-29). A trotro driver runs the same corridor
 * all day: the whole last publish — both ends, seats, tier — is one tap, and
 * only the departure time is asked again. Local for the same reasons as above.
 */
const LAST_RUN_KEY = 'eyego_driver_last_run';
export type LastRun = { origin: GeocodeResult; destination: GeocodeResult; seats: number; tier: 'ECONOMY' | 'COMFORT' | 'PREMIUM' };

const isPlace = (p: any): p is GeocodeResult =>
  !!p && typeof p.name === 'string' && Number.isFinite(p.latitude) && Number.isFinite(p.longitude);

export async function getLastRun(): Promise<LastRun | null> {
  try {
    const run = JSON.parse((await AsyncStorage.getItem(LAST_RUN_KEY)) ?? 'null');
    if (!run || !isPlace(run.origin) || !isPlace(run.destination) || !Number.isInteger(run.seats)) return null;
    if (!['ECONOMY', 'COMFORT', 'PREMIUM'].includes(run.tier)) return null;
    return run as LastRun;
  } catch {
    return null;
  }
}

export async function rememberLastRun(run: LastRun): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_RUN_KEY, JSON.stringify(run));
  } catch {
    // Same as rememberDestination: never worth failing a publish over.
  }
}
