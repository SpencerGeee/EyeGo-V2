import { Share, Alert } from 'react-native';
import { reverseGeocode } from './geocoding';

/**
 * SHARING A TRIP, AND SHARING WHERE YOU ARE.
 *
 * Two things, one rule: whatever leaves this app has to be readable by the
 * person who receives it. Both of them used to fail that in the same way.
 *
 *   "When I choose to share my trip, the text generated shows the coordinates
 *    instead of the actual location. The Google Maps location is also showing
 *    coordinates."
 *
 *   "When I choose to share my trip it should be the shareable link that would
 *    redirect the user to the browser showing the live trip like it should…
 *    that's what is already done for share trip but it should be the same for
 *    the safety share live trip button."
 *
 * The coordinates came from `shareLocationText`, which falls back to a lat/lng
 * pair when the place it is handed has no `address` — and nothing on the SOS
 * screen ever geocoded the rider's position, so it never had one. The link was
 * then `?query=5.6037,-0.1870`, which drops the recipient on a nameless pin in
 * the middle of a road.
 *
 * So a shared position is resolved to a street address FIRST (the server's
 * reverse geocoder now answers with an address rather than a city — see
 * REVERSE_TYPE_TIERS in eyego-api/src/modules/geo/geo.service.js), and the
 * coordinates are the last resort rather than the default.
 *
 * And a shared TRIP is a tracking link, not a location: `/track/:shortId` is a
 * live page the recipient can keep open, which is what the person on the other
 * end actually wants. The safety toggle now sends the same link the share
 * button does, plus the current position for immediate context.
 */

/** Where the public tracking page lives, derived from the API's own origin. */
function trackingUrl(shortId: string): string {
  const apiBase =
    process.env.EXPO_PUBLIC_API_URL?.replace('/v1', '').replace('/api', '') ?? 'https://eyego.app';
  return `${apiBase}/track/${shortId}`;
}

/**
 * A human-readable name for a coordinate, or null.
 *
 * Never throws and never invents: a caller that gets null must say "location
 * unavailable" rather than printing numbers at somebody in an emergency.
 */
export async function describePosition(
  latitude: number,
  longitude: number,
): Promise<{ name: string; mapUrl: string } | null> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  let name: string | null = null;
  try {
    const place = await reverseGeocode(latitude, longitude);
    // `fullAddress` over `name`: the recipient is not standing there and needs
    // the district and city as well as the street.
    name = place?.fullAddress?.trim() || place?.name?.trim() || null;
  } catch {
    // A geocoder that is down must not stop a safety message going out.
  }
  /**
   * The map link is built from the COORDINATES, always — even when we have a
   * name for them.
   *
   * A `?query=<address>` link asks Google to search for the text, which lands
   * on whatever it decides that string means. For an emergency that is the
   * wrong trade: the exact point is the whole value of the message, so the link
   * is the point and the name is the label beside it.
   */
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
  return { name: name ?? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`, mapUrl };
}

/** "12 Osu Badu Street, Accra\nhttps://…" — or null when we know nothing. */
export async function positionShareText(
  latitude: number,
  longitude: number,
  prefix?: string,
): Promise<string | null> {
  const described = await describePosition(latitude, longitude);
  if (!described) return null;
  const head = prefix ? `${prefix} ` : '';
  return `${head}${described.name}\n${described.mapUrl}`;
}

/**
 * Share a live-tracking link for an active trip.
 *
 * @param shortId  The trip's `shortId` field (used in the /track/:shortId URL)
 * @param driverName  Driver display name
 * @param vehicleInfo  Plate number or vehicle description
 */
export const shareLiveTracking = async (
  shortId: string,
  driverName: string,
  vehicleInfo: string,
) => {
  try {
    if (!shortId) {
      Alert.alert('Not ready yet', 'This trip does not have a tracking link yet. Try again in a moment.');
      return;
    }
    const url = trackingUrl(shortId);
    const message = `I'm on an EyeGo trip with ${driverName} (${vehicleInfo}). Follow my ride live here: ${url}`;

    await Share.share({
      message,
      url, // iOS only
      title: 'Track my EyeGo Ride',
    });
  } catch (error) {
    Alert.alert('Error', 'Could not share live tracking link.');
  }
};

/**
 * The message body the SAFETY screen sends to a trusted contact.
 *
 * BUGFIX (item 16, second half). This screen used to send a bare location —
 * "here is a pin, good luck" — while the trip surface's Share button sent a
 * live tracking link. The safety path is the one where a link that keeps
 * updating matters MOST, and it was the one that did not have it.
 *
 * Both now: the tracking page so the contact can watch the ride, and the
 * current position with a real address so they know where it is right now
 * without opening anything.
 */
export async function safetyShareMessage({
  riderName,
  shortId,
  latitude,
  longitude,
  urgent = false,
}: {
  riderName: string;
  shortId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  urgent?: boolean;
}): Promise<string> {
  const lines: string[] = [];
  lines.push(
    urgent
      ? `🚨 EMERGENCY: ${riderName} has triggered an SOS alert on their EyeGo trip.`
      : `${riderName} is sharing their EyeGo trip with you.`,
  );

  if (shortId) {
    lines.push(`Follow the ride live: ${trackingUrl(shortId)}`);
  }

  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    const where = await positionShareText(latitude as number, longitude as number, 'Last known location:');
    if (where) lines.push(where);
  } else {
    lines.push('Their location is not available yet.');
  }

  if (urgent) lines.push('Please contact them immediately.');
  return lines.join('\n\n');
}
