/**
 * Shared Nominatim (OpenStreetMap) geocoding helpers for the driver app's
 * ad-hoc pickup/destination picker — mirrors apps/rider/utils/geocoding.ts.
 */

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
  address?: {
    road?: string;
    suburb?: string;
    city?: string;
    town?: string;
    county?: string;
  };
};

const HEADERS = { 'User-Agent': 'EyeGo/2.0 (eyego.app)' };

function primaryName(r: NominatimResult): string {
  const a = r.address;
  return a?.road ?? a?.suburb ?? a?.town ?? a?.city ?? r.display_name.split(',')[0];
}

/** Forward geocode: free-text query → up to `limit` Ghana places. */
export async function searchPlaces(query: string, limit = 6): Promise<GeocodeResult[]> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&countrycodes=gh&limit=${limit}&addressdetails=1`,
    { headers: HEADERS },
  );
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return (data as NominatimResult[]).map((r) => ({
    placeId: r.place_id,
    name: primaryName(r),
    fullAddress: r.display_name,
    latitude: parseFloat(r.lat),
    longitude: parseFloat(r.lon),
  }));
}

/** Reverse geocode: coordinates → nearest address (used by the map pin picker). */
export async function reverseGeocode(latitude: number, longitude: number): Promise<GeocodeResult | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&addressdetails=1`,
      { headers: HEADERS },
    );
    const r = (await res.json()) as NominatimResult & { error?: string };
    if (!r || r.error) return null;
    return {
      placeId: r.place_id,
      name: primaryName(r),
      fullAddress: r.display_name,
      latitude,
      longitude,
    };
  } catch {
    return null;
  }
}
