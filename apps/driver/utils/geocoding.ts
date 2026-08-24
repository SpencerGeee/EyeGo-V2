/**
 * Geocoding for the driver app's ad-hoc pickup/destination picker.
 *
 * Goes through the SAME server proxy the rider app prefers (`/v1/geo`), which
 * fronts Mapbox Search Box and does the type-tiered reverse lookup that stops a
 * dropped pin being labelled with its city — see `REVERSE_TYPE_TIERS` in
 * eyego-api/src/modules/geo/geo.service.js. Nominatim stays as the fallback for
 * a deployment with no Mapbox token, or an API that cannot be reached.
 *
 * Mirrors apps/rider/utils/geocoding.ts. If one changes, change both.
 */

import { apiClient } from '@eyego/api';

export type GeocodeResult = {
  placeId: number;
  name: string;
  fullAddress: string;
  latitude: number;
  longitude: number;
};

type NominatimResult = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  name?: string;
  address?: {
    house_number?: string;
    road?: string;
    pedestrian?: string;
    footway?: string;
    building?: string;
    amenity?: string;
    shop?: string;
    neighbourhood?: string;
    suburb?: string;
    village?: string;
    city?: string;
    town?: string;
    county?: string;
  };
};

const HEADERS = { 'User-Agent': 'EyeGo/2.0 (eyego.app)' };
const REQUEST_TIMEOUT_MS = 7000;

/**
 * THE MOST SPECIFIC THING WE KNOW ABOUT THIS POINT — a street, not a city.
 *
 * BUGFIX (item 7). This chain was four entries long and started at `road`,
 * which is better than the rider's was, but it still could not name a house
 * number or a landmark: a pin dropped on Accra Mall printed the road behind it,
 * and a pin with no road at all fell straight through to `city`.
 */
function primaryName(r: NominatimResult): string {
  const a = r.address;
  const street = [a?.house_number, a?.road ?? a?.pedestrian ?? a?.footway]
    .filter(Boolean)
    .join(' ');
  return (
    street ||
    a?.building ||
    a?.amenity ||
    a?.shop ||
    a?.neighbourhood ||
    a?.suburb ||
    r.name ||
    a?.town ||
    a?.city ||
    r.display_name.split(',')[0]
  );
}

/** A stable numeric key from coordinates, for a proxy result that has no OSM id. */
const keyFor = (lat: number, lng: number) =>
  Math.round(lat * 1e5) * 1e5 + Math.round(lng * 1e5);

/** Forward geocode: free-text query → up to `limit` Ghana places. */
export async function searchPlaces(query: string, limit = 6): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  try {
    const { data } = await apiClient.get('/geo/search', {
      params: { q: trimmed, limit },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const rows = Array.isArray(data?.data) ? data.data : [];
    const mapped = rows
      .filter((r: any) => Number.isFinite(r?.latitude) && Number.isFinite(r?.longitude) && r?.name)
      .map((r: any) => ({
        placeId: keyFor(r.latitude, r.longitude),
        name: String(r.name),
        fullAddress: String(r.fullAddress ?? r.name),
        latitude: r.latitude,
        longitude: r.longitude,
      }));
    if (mapped.length > 0) return mapped;
  } catch {
    // fall through to OSM — a blip in our own API must not empty the list
  }

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(trimmed)}&format=json&countrycodes=gh&limit=${limit}&addressdetails=1&namedetails=1`,
      { headers: HEADERS },
    );
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return (data as NominatimResult[])
      .map((r) => ({
        placeId: r.place_id,
        name: primaryName(r),
        fullAddress: r.display_name,
        latitude: parseFloat(r.lat),
        longitude: parseFloat(r.lon),
      }))
      .filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude));
  } catch {
    return [];
  }
}

/** Reverse geocode: coordinates → nearest address (used by the map pin picker). */
export async function reverseGeocode(latitude: number, longitude: number): Promise<GeocodeResult | null> {
  try {
    const { data } = await apiClient.get('/geo/reverse', {
      params: { lat: latitude, lng: longitude },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const hit = data?.data;
    if (hit?.name) {
      return {
        placeId: keyFor(latitude, longitude),
        name: String(hit.name),
        fullAddress: String(hit.fullAddress ?? hit.name),
        latitude,
        longitude,
      };
    }
  } catch {
    // fall through
  }

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&addressdetails=1&zoom=18`,
      { headers: HEADERS },
    );
    const r = (await res.json()) as NominatimResult & { error?: string };
    if (!r || r.error || !r.display_name) return null;
    return {
      placeId: r.place_id,
      name: primaryName(r),
      fullAddress: r.display_name,
      // The pin is the source of truth; the geocode only supplies the label.
      latitude,
      longitude,
    };
  } catch {
    return null;
  }
}
