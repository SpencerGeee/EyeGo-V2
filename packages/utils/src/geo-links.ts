/**
 * EVERY LINK THAT SENDS A PLACE TO ANOTHER APP IS BUILT HERE.
 *
 * THE BUG THIS EXISTS FOR. The driver's Navigate button handed Google Maps a
 * bare `lat,lng`. That routes correctly and reads terribly: the destination
 * field shows "5.628876, -0.170849", the driver cannot tell at a glance where
 * they are being sent, cannot search or edit it, and cannot recognise the place
 * they already know by name. Reported as "it takes you to Google Maps but pure
 * coordinates so it's not searchable".
 *
 * It was not one call site. `externalNav.ts` accepted a `label` and then threw
 * it away in three of its four URL builders — `google.navigation:q=lat,lng` and
 * Apple's `daddr=lat,lng` have nowhere to put a name — and the one caller passed
 * `trip.route.destinationName`, which is null for every on-demand trip, so the
 * label was usually the literal string "Destination" anyway.
 *
 * THE RULE, so this does not come back:
 *
 *   An address is what a human reads and searches. Coordinates are what a
 *   router needs. Send the ADDRESS when there is one, and keep the coordinates
 *   as the fallback — never the other way round, and never coordinates alone
 *   when an address is in hand.
 *
 * Both apps import from here. If you find yourself writing `https://maps...` or
 * `geo:` anywhere else, put it in this file instead.
 */

/** A place, as every screen in both apps already has it. */
export interface GeoPlace {
  latitude: number;
  longitude: number;
  /**
   * A full, geocodable address — "True Jesus Church, Kotobabi, Accra". This is
   * the field that makes a link searchable, so pass it whenever the trip or
   * booking has one, even if it is long.
   */
  address?: string | null;
  /** A short human name for the pin — "Pickup", "Kotobabi". Display only. */
  label?: string | null;
}

export type NavApp = 'google' | 'apple' | 'waze';

export function hasCoords(place: GeoPlace | null | undefined): place is GeoPlace {
  return (
    !!place &&
    Number.isFinite(place.latitude) &&
    Number.isFinite(place.longitude)
  );
}

/**
 * The `lat,lng` pair, at the precision a router needs and no more.
 *
 * Six decimals is ~11cm. Anything beyond it is noise that makes the URL longer
 * and the coordinates look machine-generated in the rare case they are shown.
 */
export function coordString(place: GeoPlace): string {
  return `${place.latitude.toFixed(6)},${place.longitude.toFixed(6)}`;
}

/**
 * An address clean enough to hand to a search box, or null.
 *
 * Rejects the placeholders both apps use when they have nothing better —
 * "Current Location" is true on the device that wrote it and meaningless in
 * somebody else's map app, and it would resolve to the WRONG place if a maps
 * app took it literally. Falling through to coordinates is correct there.
 */
export function searchableAddress(place: GeoPlace | null | undefined): string | null {
  if (!place) return null;
  const candidates = [place.address, place.label];
  for (const raw of candidates) {
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (value.length < 3) continue;
    const lower = value.toLowerCase();
    if (
      lower === 'current location' ||
      lower === 'unknown' ||
      lower === 'destination' ||
      lower === 'pickup' ||
      lower === 'origin' ||
      // A string that is just a coordinate pair is not an address.
      /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(value)
    ) {
      continue;
    }
    return value;
  }
  return null;
}

/**
 * The best display name for a place — address first, then label, then coords.
 * Used for pin names and for the text of a shared location.
 */
export function placeDisplayName(place: GeoPlace): string {
  return searchableAddress(place) ?? coordString(place);
}

/**
 * Deep links that START TURN-BY-TURN navigation to `place`.
 *
 * `primary` is the app's own scheme (instant turn-by-turn, no browser hop);
 * `fallback` is an https universal link, which always resolves — worst case the
 * web map opens, which is still a usable route.
 */
export function navigationUrls(
  app: NavApp,
  place: GeoPlace,
  platform: 'ios' | 'android' | string,
  /**
   * Where the leg STARTS, when that is not "wherever the driver is standing".
   *
   * BUGFIX ("Navigate opens the map with my current location as the pickup and
   * the trip's pickup as the destination — it should use the trip's actual
   * pickup and destination"). Once a driver has the passenger aboard, the leg
   * they want to see is pickup → drop-off, and a link with only a destination
   * can only ever describe it as "from here".
   *
   * Optional, and omitted before departure on purpose: a driver still on their
   * way to the kerb genuinely does want turn-by-turn from where they are.
   *
   * Not every target honours it. Waze has no origin parameter at all, and
   * Android's `google.navigation:` scheme starts turn-by-turn from the current
   * position by definition — so there it is applied to the https fallback,
   * which is the form that can show a whole route.
   */
  origin?: GeoPlace | null,
): { primary: string; fallback: string } {
  const coords = coordString(place);
  const address = searchableAddress(place);
  const originParam = origin && hasCoords(origin)
    ? encodeURIComponent(searchableAddress(origin) ?? coordString(origin))
    : null;
  /**
   * What goes in the destination field. The address when we have one — that is
   * the whole point of this module — and the coordinates when we do not.
   *
   * A geocodable address resolves to the same place the coordinates describe,
   * while remaining something the driver can read, search and edit. The old
   * behaviour was to always send coordinates, which is why the destination
   * field showed a number pair.
   */
  const destination = encodeURIComponent(address ?? coords);
  const pinName = encodeURIComponent(placeDisplayName(place));

  switch (app) {
    case 'apple':
      return {
        // `daddr` takes an address string as happily as a coordinate pair, and
        // `dirflg=d` means drive. This used to send `daddr=lat,lng`.
        primary: `maps://?${originParam ? `saddr=${originParam}&` : ''}daddr=${destination}&dirflg=d`,
        fallback: `https://maps.apple.com/?${originParam ? `saddr=${originParam}&` : ''}daddr=${destination}&dirflg=d`,
      };

    case 'waze':
      /**
       * Waze is the one that genuinely cannot have both. `ll` is exact but
       * nameless; `q` is searchable but re-geocodes and can land on a different
       * branch of the same name. For a driver being sent to a specific kerb,
       * exactness wins — so Waze keeps coordinates and gets the name only in
       * the https form, which shows a search result the driver can confirm.
       */
      return {
        primary: `waze://?ll=${coords}&navigate=yes`,
        fallback: address
          ? `https://waze.com/ul?q=${destination}&navigate=yes`
          : `https://waze.com/ul?ll=${coords}&navigate=yes`,
      };

    case 'google':
    default:
      return {
        primary:
          platform === 'ios'
            ? `comgooglemaps://?${originParam ? `saddr=${originParam}&` : ''}daddr=${destination}&directionsmode=driving&q=${pinName}`
            : /**
               * Android: `google.navigation:q=` accepts an address string, not
               * just coordinates — which is the fix. It used to be handed
               * `q=lat,lng` unconditionally, so Google Maps opened with a
               * coordinate pair in the destination field.
               */
              `google.navigation:q=${destination}&mode=d`,
        fallback: `https://www.google.com/maps/dir/?api=1${originParam ? `&origin=${originParam}` : ''}&destination=${destination}&travelmode=driving`,
      };
  }
}

/**
 * A link that SHOWS a place without starting navigation — for "view on Google
 * Maps", a support tool opening an incident location, or an admin checking
 * where a trip actually went.
 *
 * Uses the search endpoint with the address so the pin arrives named and the
 * viewer can act on it. When only coordinates exist, `query` still accepts them.
 */
export function mapPreviewUrl(place: GeoPlace): string {
  const address = searchableAddress(place);
  const query = encodeURIComponent(address ?? coordString(place));
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

/**
 * A place as text for a share sheet, an SMS, or a WhatsApp message.
 *
 * Deliberately BOTH: the human reads the name, and the link is exact. Sharing a
 * bare link means the recipient cannot tell where they are being sent without
 * opening it, and sharing a bare name means they cannot get there.
 */
export function shareLocationText(place: GeoPlace, prefix?: string): string {
  const name = placeDisplayName(place);
  const link = mapPreviewUrl(place);
  const head = prefix ? `${prefix} ` : '';
  return `${head}${name}\n${link}`;
}
