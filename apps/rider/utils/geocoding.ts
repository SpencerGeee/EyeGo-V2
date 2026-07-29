/**
 * Shared geocoding helpers — single source for where-to search, saved-places
 * search, and the map place-picker.
 *
 * WHY TWO PROVIDERS: this used to be Nominatim `/search` alone. Nominatim's
 * search endpoint is a *full-text lookup*, not a typeahead — it matches whole
 * tokens against place names, so a partially typed query ("east le",
 * "kotoka int") or a POI whose OSM name differs slightly from what the rider
 * typed returns an EMPTY array. That is the reported "some locations show
 * blank when searched". `countrycodes=gh` narrowed it further, dropping
 * anything whose administrative record isn't cleanly tagged to Ghana.
 *
 * Photon (photon.komoot.io) is built specifically for autocomplete over the
 * same OSM data: prefix matching, fuzzy tolerance, location bias. We query it
 * first and merge Nominatim's results in behind it, deduped — Photon supplies
 * breadth and partial matches, Nominatim keeps the precise full-address hits
 * Photon sometimes ranks lower. If either provider fails, the other still
 * answers, so a network blip no longer empties the list.
 *
 * Nominatim usage policy: identify the app via User-Agent, debounce callers.
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
  address?: {
    road?: string;
    pedestrian?: string;
    suburb?: string;
    neighbourhood?: string;
    village?: string;
    city?: string;
    town?: string;
    county?: string;
    state?: string;
    country?: string;
  };
  name?: string;
};

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    osm_id?: number;
    name?: string;
    street?: string;
    housenumber?: string;
    district?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
    postcode?: string;
  };
};

const HEADERS = { 'User-Agent': 'EyeGo/2.0 (eyego.app)' };

/** Accra — used to bias autocomplete toward the rider's operating region when no GPS fix is available. */
const BIAS_CENTER = { lat: 5.6037, lon: -0.187 };

/** Nominatim/Photon both go silent on a slow link; without this the search spinner hangs forever. */
const REQUEST_TIMEOUT_MS = 7000;

async function fetchJson(url: string): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function primaryName(r: NominatimResult): string {
  const a = r.address;
  return (
    r.name ||
    a?.road ||
    a?.pedestrian ||
    a?.neighbourhood ||
    a?.suburb ||
    a?.village ||
    a?.town ||
    a?.city ||
    r.display_name.split(',')[0]
  );
}

function photonToResult(f: PhotonFeature): GeocodeResult | null {
  const coords = f.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length !== 2) return null;
  const [lon, lat] = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const p = f.properties ?? {};
  // Photon returns POIs with a `name` and plain addresses with only a street,
  // so the label has to fall through both — a result with neither is unusable
  // and is dropped rather than rendered as an empty row.
  const streetLabel = [p.housenumber, p.street].filter(Boolean).join(' ');
  const name = p.name || streetLabel || p.district || p.city || '';
  if (!name) return null;

  const fullAddress =
    [name, p.street && p.street !== name ? p.street : null, p.district, p.city, p.county, p.state, p.country]
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .join(', ');

  return {
    placeId: p.osm_id ?? Math.round(lat * 1e5) * 1e5 + Math.round(lon * 1e5),
    name,
    fullAddress: fullAddress || name,
    latitude: lat,
    longitude: lon,
  };
}

/**
 * Backend geocoding proxy (`/v1/geo`). Returns [] on any failure so the OSM
 * providers below still answer — a rider must never get an empty search box
 * because our own API blipped.
 */
async function searchViaApi(
  query: string,
  limit: number,
  bias: { lat: number; lon: number },
): Promise<GeocodeResult[]> {
  try {
    const { data } = await apiClient.get('/geo/search', {
      params: { q: query, limit, lat: bias.lat, lng: bias.lon },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const rows = Array.isArray(data?.data) ? data.data : [];
    return rows
      .filter((r: any) => Number.isFinite(r?.latitude) && Number.isFinite(r?.longitude) && r?.name)
      .map((r: any) => ({
        // The proxy returns Mapbox's string ids; GeocodeResult has always typed
        // placeId as a number, and callers only use it as a list key, so derive
        // a stable numeric key from the coordinates rather than widening the type.
        placeId: Math.round(r.latitude * 1e5) * 1e5 + Math.round(r.longitude * 1e5),
        name: String(r.name),
        fullAddress: String(r.fullAddress ?? r.name),
        latitude: r.latitude,
        longitude: r.longitude,
      }));
  } catch {
    return [];
  }
}

/** Two results within ~11 m of each other are the same place to a rider. */
function dedupeKey(r: GeocodeResult): string {
  return `${r.latitude.toFixed(4)},${r.longitude.toFixed(4)}`;
}

async function searchPhoton(query: string, limit: number, bias: { lat: number; lon: number }): Promise<GeocodeResult[]> {
  const data = await fetchJson(
    `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=${limit}&lang=en&lat=${bias.lat}&lon=${bias.lon}`,
  );
  const features: PhotonFeature[] = Array.isArray(data?.features) ? data.features : [];
  return features.map(photonToResult).filter((r): r is GeocodeResult => r !== null);
}

async function searchNominatim(query: string, limit: number, bias: { lat: number; lon: number }): Promise<GeocodeResult[]> {
  // A ~1.5° box around the bias point ranks nearby hits first WITHOUT the hard
  // `countrycodes` filter that was silently dropping valid places, because
  // `bounded=0` keeps out-of-box matches instead of discarding them.
  const viewbox = [bias.lon - 1.5, bias.lat + 1.5, bias.lon + 1.5, bias.lat - 1.5].join(',');
  const data = await fetchJson(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}` +
      `&format=json&limit=${limit}&addressdetails=1&namedetails=1&viewbox=${viewbox}&bounded=0`,
  );
  if (!Array.isArray(data)) return [];
  return (data as NominatimResult[])
    .map((r) => {
      const latitude = parseFloat(r.lat);
      const longitude = parseFloat(r.lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      return {
        placeId: r.place_id,
        name: primaryName(r),
        fullAddress: r.display_name,
        latitude,
        longitude,
      };
    })
    .filter((r): r is GeocodeResult => r !== null && !!r.name);
}

/**
 * Forward geocode: free-text query → places, ranked by relevance to `near`.
 *
 * Both providers are queried in parallel and merged; whichever answers first
 * in the result array wins on ties. Never throws — an unreachable provider
 * contributes nothing instead of blanking the list.
 */
export async function searchPlaces(
  query: string,
  limit = 8,
  near?: { latitude: number; longitude: number } | null,
): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const bias =
    near && Number.isFinite(near.latitude) && Number.isFinite(near.longitude)
      ? { lat: near.latitude, lon: near.longitude }
      : BIAS_CENTER;

  // PREFERRED PATH: our own /geo/search, which fronts Mapbox. Photon and
  // Nominatim below index OpenStreetMap only, and OSM's Ghanaian commercial-POI
  // coverage is thin enough that ordinary searches ("IPMC showroom") return
  // nothing at all. Mapbox carries that POI data. The token is a secret so the
  // call has to be server-side; see eyego-api/src/modules/geo.
  const proxied = await searchViaApi(trimmed, limit, bias);
  if (proxied.length > 0) return proxied.slice(0, limit);

  const [photon, nominatim] = await Promise.all([
    searchPhoton(trimmed, limit, bias).catch(() => []),
    searchNominatim(trimmed, limit, bias).catch(() => []),
  ]);

  const seen = new Set<string>();
  const merged: GeocodeResult[] = [];
  for (const r of [...photon, ...nominatim]) {
    const key = dedupeKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(r);
  }
  return merged.slice(0, limit);
}

/** Reverse geocode: coordinates → nearest address (used by the map pin picker). */
export async function reverseGeocode(latitude: number, longitude: number): Promise<GeocodeResult | null> {
  // Same reasoning as searchPlaces: Mapbox first via our proxy, OSM as backup.
  // This is also what stops a dropped map pin from being labelled with its own
  // raw coordinates — Nominatim simply has no record for large parts of Accra,
  // and every caller falls back to printing lat/lng when this returns null.
  try {
    const { data } = await apiClient.get('/geo/reverse', {
      params: { lat: latitude, lng: longitude },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const hit = data?.data;
    if (hit?.name) {
      return {
        placeId: Math.round(latitude * 1e5) * 1e5 + Math.round(longitude * 1e5),
        name: String(hit.name),
        fullAddress: String(hit.fullAddress ?? hit.name),
        latitude,
        longitude,
      };
    }
  } catch {
    // fall through to the OSM providers below
  }

  const r = (await fetchJson(
    `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&addressdetails=1&zoom=18`,
  )) as (NominatimResult & { error?: string }) | null;

  if (r && !r.error && r.display_name) {
    return {
      placeId: r.place_id,
      name: primaryName(r),
      fullAddress: r.display_name,
      latitude,
      longitude,
    };
  }

  // Nominatim reverse has no coverage over water/unmapped areas and 403s under
  // load. Photon's reverse endpoint covers the same data from a different host,
  // so the pin still resolves to a real street name instead of raw coordinates.
  const photon = await fetchJson(
    `https://photon.komoot.io/reverse?lat=${latitude}&lon=${longitude}&lang=en&limit=1`,
  );
  const feature: PhotonFeature | undefined = Array.isArray(photon?.features) ? photon.features[0] : undefined;
  const mapped = feature ? photonToResult(feature) : null;
  if (!mapped) return null;
  // Keep the caller's exact coordinates — the pin is the source of truth, the
  // geocode only supplies the label.
  return { ...mapped, latitude, longitude };
}
